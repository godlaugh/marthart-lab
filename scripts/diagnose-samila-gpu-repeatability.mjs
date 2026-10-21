/** Observe original-shader repeatability independently of product code or saved goldens.
 * Run from studio/: node scripts/diagnose-samila-gpu-repeatability.mjs [directory]
 * Requires the fixed local reference JAR, Python 3, and installed Chrome.
 * A measured report is NOT a parity pass. Only disposable headless browsers are used.
 */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const directory = process.argv[2] ?? '.cache/samila-gpu-repeatability';
if (directory === '--help') {
  console.log('node scripts/diagnose-samila-gpu-repeatability.mjs [directory] — fixed local JAR; no native UI or product import');
  process.exit(0);
}
const sha = value => createHash('sha256').update(value).digest('hex');
const assert = (value, message) => { if (!value) throw Error(message); };
const script = 'scripts/diagnose-samila-gpu-repeatability.mjs';
const jar = '../.cache/mathart-investigation/MathArt.app/Contents/app/MathArt-1.7.8-b07191b3e97da6fe465555ef6e61a0be.jar';
const jarSha256 = sha(await readFile(jar));
assert(jarSha256 === 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018', 'Reference JAR identity changed');
const extract = name => execFileSync('python3', ['-c',
  'import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',
  jar, 'data/shader/' + name], { encoding: 'utf8' });
const originalVertex = extract('samila_splat.vert');
const originalFragment = extract('samila_splat.frag');
const marker = '// %SAMILA_FUNCTION_BODY%';
const adapt = source => {
  assert(source.startsWith('#version 410\n'), 'Shader version anchor changed');
  return source.replace('#version 410\n', '#version 300 es\nprecision highp float;precision highp int;precision highp sampler2D;\n');
};
assert(originalVertex.split(marker).length === 2, 'Formula anchor changed');
const vertex = adapt(originalVertex).replace(marker,
  'uniform float a,b,c,d;\nfloat samila_f1(float x,float y){return x;}\nfloat samila_f2(float x,float y){return y;}');
const fragment = adapt(originalFragment);
const seeds = [0, -1, -2147483648, 2147483647];
const ranges = [
  { name: 'negative', start: -5, stop: -1 },
  { name: 'default-pi', start: -Math.PI, stop: Math.PI },
  { name: 'asymmetric', start: -3, stop: 2 },
  { name: 'fractional', start: .1, stop: .7 },
  { name: 'large-finite', start: 1e30, stop: 2e30 },
];
const cases = seeds.flatMap(seed => ranges.map(range => ({ seed, range })));
const modes = [
  { name: 'default', args: [] },
  { name: 'no-program-cache', args: ['--disable-gpu-program-cache'] },
  { name: 'no-disk-cache', args: ['--disable-gpu-shader-disk-cache'] },
  { name: 'neither-cache', args: ['--disable-gpu-program-cache', '--disable-gpu-shader-disk-cache'] },
  { name: 'no-angle-program-cache', args: ['--enable-angle-features=disableProgramCaching'] },
  { name: 'default-after-angle-control', args: [] },
];
const report = {
  status: 'running',
  source: { jar, jarSha256, scriptSha256: sha(await readFile(script)),
    originalVertexSha256: sha(originalVertex), originalFragmentSha256: sha(originalFragment),
    vertexSha256: sha(vertex), fragmentSha256: sha(fragment) },
  cases, modes: [],
  limits: [
    'GLSL410 adapted to GLES300 with high precision and identity formulas; original fragment and existing vTexCoord output retained. Not original JVM/JOGL execution.',
    'Same shader text, transform-feedback layout, sample ID 1, and uniform inputs throughout. No saved golden or production code is imported.',
    'Comparison is against the first draw in each disposable browser, not proof that the first draw is mathematically or natively correct.',
    'Cache flags are requested launch arguments; lack of an effect does not prove all ANGLE/Metal caches were disabled.',
    'Measured wall time only; CPU time, process-family peak memory, GPU memory and token cost unmeasured.',
  ],
};
await mkdir(directory, { recursive: true });
const started = performance.now();
try {
  for (const mode of modes) {
    const row = { ...mode, status: 'running' };
    report.modes.push(row);
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: mode.args });
    try {
      row.browserVersion = browser.version();
      const cdp = await browser.newBrowserCDPSession();
      try { row.browser = await cdp.send('Browser.getVersion'); }
      finally { await cdp.detach(); }
      const page = await browser.newPage();
      row.programs = await page.evaluate(({ vertex, fragment, cases }) => {
        const check = (value, message) => { if (!value) throw Error(message); };
        const bits = value => Array.from(new Uint32Array(new Float32Array(value).buffer));
        const programs = [];
        for (let contextIndex = 0; contextIndex < 3; contextIndex++) {
          const gl = new OffscreenCanvas(48, 32).getContext('webgl2');
          check(gl, 'WebGL2 unavailable');
          try {
            for (let linkIndex = 0; linkIndex < 3; linkIndex++) {
              const program = gl.createProgram(), buffer = gl.createBuffer();
              const feedback = gl.createTransformFeedback(), vao = gl.createVertexArray(), shaders = [];
              const result = { contextIndex, linkIndex, draws: [] };
              programs.push(result);
              try {
                check(program && buffer && feedback && vao, 'Resource allocation failed');
                const debug = gl.getExtension('WEBGL_debug_renderer_info');
                result.renderer = gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
                for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
                  const shader = gl.createShader(type);
                  check(shader, 'Shader allocation failed');
                  shaders.push(shader);
                  gl.shaderSource(shader, code);
                  gl.compileShader(shader);
                  check(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader));
                  gl.attachShader(program, shader);
                  if (type === gl.VERTEX_SHADER) result.translated = gl.getExtension('WEBGL_debug_shaders')?.getTranslatedShaderSource(shader);
                }
                gl.transformFeedbackVaryings(program, ['vTexCoord'], gl.INTERLEAVED_ATTRIBS);
                gl.linkProgram(program);
                check(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program));
                const varying = gl.getTransformFeedbackVarying(program, 0);
                check(varying?.name === 'vTexCoord' && varying.type === gl.FLOAT_VEC2 && varying.size === 1, 'Unexpected TF layout');
                result.feedbackLayout = { name: varying.name, type: varying.type, size: varying.size, bytes: 8 };
                gl.useProgram(program);
                gl.bindVertexArray(vao);
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, feedback);
                gl.enable(gl.RASTERIZER_DISCARD);
                const uniform = (name, method, ...values) => gl[method](gl.getUniformLocation(program, name), ...values);
                for (const [name, value] of Object.entries({ u_rotation: 0, radius: 3, u_aspectRatio: 1.5,
                  noiseFrequency: .1, noiseAmplitude: .5, noiseLutScale: 1, alpha: .2,
                  colorPhase: 0, colorSpeed: 1, a: 0, b: 0, c: 0, d: 0 })) uniform(name, 'uniform1f', value);
                for (const [name, value] of Object.entries({ u_generateMode: 1, u_projection: 0,
                  u_quadSplat: 0, u_particleCount: 2, noiseLUT: 0, paletteLUT: 1,
                  useNoiseLUT: 0, useLUT: 0 })) uniform(name, 'uniform1i', value);
                uniform('scale', 'uniform2f', .5, .5);
                uniform('offset', 'uniform2f', 0, 0);
                uniform('u_viewportSize', 'uniform2f', 48, 32);
                for (let drawIndex = 0; drawIndex < 3; drawIndex++) {
                  const samples = [];
                  for (const item of cases) {
                    uniform('u_frameSeed', 'uniform1i', item.seed);
                    uniform('u_rangeStart', 'uniform1f', item.range.start);
                    uniform('u_rangeStop', 'uniform1f', item.range.stop);
                    const uniformBits = bits(['u_rangeStart', 'u_rangeStop'].map(name => gl.getUniform(program, gl.getUniformLocation(program, name))));
                    const output = new Uint32Array(2);
                    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffer);
                    gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER, output.byteLength, gl.STREAM_READ);
                    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffer);
                    gl.beginTransformFeedback(gl.POINTS);
                    gl.drawArrays(gl.POINTS, 1, 1);
                    gl.endTransformFeedback();
                    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
                    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, buffer);
                    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, output);
                    check(gl.getError() === gl.NO_ERROR, 'Transform-feedback GL error');
                    samples.push({ seed: item.seed, range: item.range.name, uniformBits, bits: Array.from(output) });
                  }
                  result.draws.push({ drawIndex, samples });
                }
              } finally {
                gl.disable(gl.RASTERIZER_DISCARD);
                gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
                gl.bindVertexArray(null);
                gl.useProgram(null);
                gl.deleteTransformFeedback(feedback);
                gl.deleteVertexArray(vao);
                gl.deleteBuffer(buffer);
                gl.deleteProgram(program);
                shaders.forEach(shader => gl.deleteShader(shader));
                result.cleanup = 'released';
              }
            }
          } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
        }
        return programs;
      }, { vertex, fragment, cases });
      const baseline = row.programs[0].draws[0].samples;
      for (const program of row.programs) {
        program.translatedSha256 = program.translated ? sha(program.translated) : null;
        delete program.translated;
        for (const draw of program.draws) {
          draw.equalToFirstDraw = draw.samples.filter((sample, index) => {
            const initial = baseline[index];
            assert(sample.seed === initial.seed && sample.range === initial.range &&
              JSON.stringify(sample.uniformBits) === JSON.stringify(initial.uniformBits), 'Input identity changed');
            return sample.bits.every((value, axis) => value === initial.bits[axis]);
          }).length;
        }
      }
      row.status = 'measured';
    } finally { await browser.close(); row.cleanup = 'closed'; }
  }
  report.status = 'measured';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack ?? error); process.exitCode = 1;
} finally {
  report.scriptStable = report.source.scriptSha256 === sha(await readFile(script));
  if (!report.scriptStable) { report.status = 'failed'; process.exitCode = 1; }
  report.elapsedMs = performance.now() - started;
  await writeFile(directory + '/report.json', JSON.stringify(report, null, 2));
  const lines = report.modes.flatMap(mode => (mode.programs ?? []).map(program =>
    `| ${mode.name} | ${program.contextIndex} | ${program.linkIndex} | ${program.draws.map(draw => draw.equalToFirstDraw + '/20').join(' · ')} |`));
  await writeFile(directory + '/report.md', `# Samila GPU 重复性诊断\n\n状态：${report.status}；${(report.elapsedMs / 1000).toFixed(2)} 秒。measured 仅代表完成测量，不表示原版一致性通过。\n\n每行三次绘制与该浏览器第一帧相比的逐位相同样本数：\n\n| 模式 | 上下文 | 链接序号 | 三次绘制 |\n| --- | ---: | ---: | --- |\n${lines.join('\n')}\n\n${report.error ?? ''}\n\n${report.limits.map(limit => '- ' + limit).join('\n')}\n`);
  console.log(JSON.stringify({ status: report.status, directory, elapsedMs: report.elapsedMs,
    modes: report.modes.map(mode => ({ name: mode.name, equal: mode.programs?.map(program => program.draws.map(draw => draw.equalToFirstDraw)) })), error: report.error }));
}
