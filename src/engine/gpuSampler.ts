import { parse, type MathNode } from 'mathjs';
import type { Scope } from './expression';
import {canonicalRealFunctionName} from './realFunctionAliases';

export type SamplingBackend = 'cpu' | 'webgl2';
export interface GpuSamplingResult { values?: Float32Array; backend: SamplingBackend; warnings: string[]; }
type Program = { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null>; };
const constants: Scope = { pi: Math.PI, PI: Math.PI, TWO_PI: 2 * Math.PI, HALF_PI: Math.PI / 2, e: Math.E };
const scalarFunctions: Record<string, [string, number]> = {
  sin: ['sin', 1], cos: ['cos', 1], tan: ['tan', 1],
  sinh: ['sinh', 1], cosh: ['cosh', 1], tanh: ['tanh', 1], asin: ['realAsin', 1], acos: ['realAcos', 1], atan: ['atan', 1],
  atan2: ['atan', 2], exp: ['exp', 1], log: ['realLog', 1], ln: ['realLog', 1], sqrt: ['realSqrt', 1], abs: ['abs', 1],
  sign: ['sign', 1], floor: ['floor', 1], ceil: ['ceil', 1], fract: ['fract', 1], step: ['step', 2],
  pow: ['realPow', 2], round: ['jsRound', 1], mod: ['positiveMod', 2],
};
export const glslRealPrelude = `
float realNaN(){return uintBitsToFloat(0x7fc00000u);}
float realPow(float x,float y){if(y==0.0)return 1.0;if(x==0.0&&y<0.0)return uintBitsToFloat(0x7f800000u);if(x<0.0){if(y!=floor(y))return realNaN();float a=pow(-x,y);return mod(abs(y),2.0)==1.0?-a:a;}return pow(x,y);}
float realLog(float x){return x<0.0?realNaN():x==0.0?-uintBitsToFloat(0x7f800000u):log(x);}
float realSqrt(float x){return x<0.0?realNaN():sqrt(x);}
float realAsin(float x){return abs(x)>1.0?realNaN():asin(x);}
float realAcos(float x){return abs(x)>1.0?realNaN():acos(x);}
float jsRound(float x){return floor(x+0.5);}
float jsRemainder(float x,float y){return x-y*trunc(x/y);}
float positiveMod(float x,float y){return jsRemainder(jsRemainder(x,y)+y,y);}
`;

/** Emits only a bounded numeric expression subset. No source identifier enters GLSL. */
export function compileGlslExpression(source: string, coordinates: string[], parameters: string[]): string {
  if (source.length > 8192) throw new Error('公式超过 8192 字符');
  let count = 0;
  function emit(node: MathNode): string {
    if (++count > 512) throw new Error('公式超过 512 个节点');
    const n = node as unknown as Record<string, any>;
    const call = (name: string, args: string[]) => `${name}(${args.join(',')})`;
    if (node.type === 'ConstantNode') {
      const value = Number(n.value);
      if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) throw new Error('常量超出 GPU float32 范围');
      const literal=String(value);
      return /[.eE]/.test(literal)?literal:literal+'.0';
    }
    if (node.type === 'SymbolNode') {
      const variable = coordinates.indexOf(n.name), parameter = parameters.indexOf(n.name);
      if (variable >= 0) return `samplePosition.${'xyz'[variable]}`;
      if (parameter >= 0) return `parameter${parameter}`;
      if (Object.hasOwn(constants, n.name)) return String(constants[n.name]);
      throw new Error(`GPU 未知变量 ${n.name}`);
    }
    if (node.type === 'ParenthesisNode') return `(${emit(n.content)})`;
    if (node.type === 'ConditionalNode') return `((${emit(n.condition)})!=0.0?(${emit(n.trueExpr)}):(${emit(n.falseExpr)}))`;
    if (node.type === 'FunctionNode') {
      const args = n.args.map(emit), name = canonicalRealFunctionName(n.fn.name);
      if ((name === 'min' || name === 'max') && args.length >= 2) return args.slice(1).reduce((a: string, b: string) => call(name, [a, b]), args[0]);
      if (name === 'clamp' && args.length === 3) return `max(${args[1]},min(${args[2]},${args[0]}))`;
      if (name === 'mix' && args.length === 3) return `(${args[0]}+(${args[1]}-${args[0]})*${args[2]})`;
      if (name === 'log10' && args.length === 1) return `(realLog(${args[0]})/log(10.0))`;
      const spec = scalarFunctions[name];
      if (!spec || args.length !== spec[1]) throw new Error(`GPU 不支持函数或参数数量 ${n.fn.name}`);
      return call(spec[0], args);
    }
    if (node.type === 'OperatorNode') {
      const args = n.args.map(emit), [a, b] = args;
      const operators: Record<string, string> = { add: '+', subtract: '-', multiply: '*', divide: '/' };
      const comparisons: Record<string, string> = { smaller: '<', larger: '>', smallerEq: '<=', largerEq: '>=', equal: '==', unequal: '!=' };
      if (operators[n.fn]) return `(${a}${operators[n.fn]}${b})`;
      if (comparisons[n.fn]) return `((${a}${comparisons[n.fn]}${b})?1.0:0.0)`;
      if (n.fn === 'and' || n.fn === 'or') return `(((${a})!=0.0${n.fn === 'and' ? '&&' : '||'}(${b})!=0.0)?1.0:0.0)`;
      if (n.fn === 'pow') return `realPow(${a},${b})`;
      if (n.fn === 'mod') return `jsRemainder(${a},${b})`;
      if (n.fn === 'unaryMinus') return `(-${a})`;
      if (n.fn === 'unaryPlus') return a;
      throw new Error(`GPU 不支持运算 ${n.fn}`);
    }
    throw new Error(`GPU 不支持表达式 ${node.type}`);
  }
  return emit(parse(source.replaceAll('π', 'pi')));
}

/** Worker-local WebGL2 transform feedback; reads back math samples, never pixels. */
export class GpuFormulaSampler {
  private gl: WebGL2RenderingContext | null = null;
  private programs = new Map<string, Program>();
  private failure?: string;
  private getContext() {
    if (this.gl && !this.gl.isContextLost()) return this.gl;
    if (this.gl) { this.programs.clear(); this.gl = null; this.failure = undefined; }
    if (this.failure) throw new Error(this.failure);
    if (typeof OffscreenCanvas === 'undefined') { this.failure = 'OffscreenCanvas 不可用'; throw new Error(this.failure); }
    this.gl = new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, alpha: false });
    if (!this.gl) { this.failure = 'WebGL2 上下文不可用'; throw new Error(this.failure); }
    return this.gl;
  }
  sample(sources: string[], coordinates: Float32Array, names: string[], scope: Scope): GpuSamplingResult {
    try {
      if (coordinates.length % 3 || coordinates.length > 3_000_000 || !sources.length || sources.length > 3 || names.length > 3) throw new Error('GPU 采样格式或预算不受支持');
      if (!coordinates.every(Number.isFinite)) throw new Error('坐标超出 GPU float32 范围');
      if (![...Object.values(scope)].every(value => Number.isFinite(Math.fround(value)))) throw new Error('参数超出 GPU float32 范围');
      // Parameter values are uniforms, deliberately absent from the program key.
      const parameters = Object.keys(scope).filter(name => !names.includes(name)).sort();
      const expressions = sources.map(source => compileGlslExpression(source, names, parameters));
      const key = JSON.stringify([expressions, parameters]);
      const gl = this.getContext();
      if (parameters.length > gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS) - 8) throw new Error('公式参数超过 GPU uniform 容量');
      let cached = this.programs.get(key);
      if (!cached) {
        const vertex = `#version 300 es\nprecision highp float;\nlayout(location=0) in vec3 samplePosition;\n${parameters.map((_, i) => `uniform float parameter${i};`).join('\n')}\nout vec3 sampled;\n${glslRealPrelude}\nvoid main(){sampled=vec3(${[...expressions, ...Array(3 - expressions.length).fill('0.0')].join(',')});gl_Position=vec4(0.0);}`;
        const shaders: WebGLShader[] = [];
        const program = gl.createProgram();
        if (!program) throw new Error('无法分配 GPU program');
        try {
          for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;out vec4 color;void main(){color=vec4(0.0);}']] as const) {
            const shader = gl.createShader(type);
            if (!shader) throw new Error('无法分配 shader');
            shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`GPU shader 编译失败：${gl.getShaderInfoLog(shader)?.slice(0, 300)}`);
            gl.attachShader(program, shader);
          }
          gl.transformFeedbackVaryings(program, ['sampled'], gl.INTERLEAVED_ATTRIBS); gl.linkProgram(program);
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`GPU program 链接失败：${gl.getProgramInfoLog(program)?.slice(0, 300)}`);
          cached = { program, uniforms: new Map(parameters.map((name, i) => [name, gl.getUniformLocation(program, `parameter${i}`)])) };
          this.programs.set(key, cached);
          if (this.programs.size > 8) { const oldest = this.programs.keys().next().value!; gl.deleteProgram(this.programs.get(oldest)!.program); this.programs.delete(oldest); }
        } catch (error) { gl.deleteProgram(program); throw error; }
        finally { for (const shader of shaders) gl.deleteShader(shader); }
      } else { this.programs.delete(key); this.programs.set(key, cached); }
      const input = gl.createBuffer(), output = gl.createBuffer(), vao = gl.createVertexArray(), feedback = gl.createTransformFeedback();
      if (!input || !output || !vao || !feedback) { gl.deleteBuffer(input); gl.deleteBuffer(output); gl.deleteVertexArray(vao); gl.deleteTransformFeedback(feedback); throw new Error('无法分配 GPU 采样缓冲'); }
      let active = false;
      try {
        gl.useProgram(cached.program);
        for (const [name, location] of cached.uniforms) gl.uniform1f(location, scope[name]);
        gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, input); gl.bufferData(gl.ARRAY_BUFFER, coordinates, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
        gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, output); gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, coordinates.byteLength, gl.STREAM_READ);
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output); gl.enable(gl.RASTERIZER_DISCARD);
        gl.beginTransformFeedback(gl.POINTS); active = true; gl.drawArrays(gl.POINTS, 0, coordinates.length / 3); gl.endTransformFeedback(); active = false;
        const values = new Float32Array(coordinates.length); gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, values);
        const error = gl.getError(); if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`GPU 采样失败 (${error})`);
        return { values, backend: 'webgl2', warnings: [] };
      } finally {
        if (active) gl.endTransformFeedback();
        gl.disable(gl.RASTERIZER_DISCARD); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindVertexArray(null);
        gl.deleteBuffer(input); gl.deleteBuffer(output); gl.deleteVertexArray(vao); gl.deleteTransformFeedback(feedback);
      }
    } catch (error) { return { backend: 'cpu', warnings: [`GPU 采样回退 CPU：${error instanceof Error ? error.message : String(error)}`] }; }
  }
  dispose() { if (this.gl) { for (const entry of this.programs.values()) this.gl.deleteProgram(entry.program); this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } this.programs.clear(); this.gl = null; this.failure = undefined; }
}
export const gpuFormulaSampler = new GpuFormulaSampler();
