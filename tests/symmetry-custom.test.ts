import {describe,expect,it} from 'vitest';
import {bindSymmetryCustomParameters,hasSymmetryCustom,MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH,prepareSymmetryCustomSource,readSymmetryCustomSource,symmetryCustomCompileDegree,symmetryCustomParameterNameError,SYMMETRY_CUSTOM_PLAN_CACHE_SIZE} from '../src/engine/symmetryCustom';
import {symmetryCustomFragmentSource} from '../src/engine/symmetryCustomShader';
const source=(body='nextPos=pos;stepMetric=-3.;',helpers='')=>helpers+'\nvoid calculate_next(in vec3 pos,out vec3 nextPos,out float stepMetric){'+body+'}';
const prepare=(body:string,helpers='')=>prepareSymmetryCustomSource(source(body,helpers),5);

describe('Symmetry custom source and binding facts',()=>{
 it('owns absence and retains the exact nonblank caller text',()=>{
  for(const value of [null,undefined,'',' \n\t'])expect(readSymmetryCustomSource(value)).toBeUndefined();
  for(const value of [42,{},false])expect(()=>readSymmetryCustomSource(value)).toThrow('文本');
  const raw=' \r\n'+source()+'\n ';expect(readSymmetryCustomSource(raw)).toBe(raw);expect(prepareSymmetryCustomSource(raw,5).rawSource).toBe(raw);
  expect(hasSymmetryCustom({kind:'symmetry',equations:{glsl:raw}})).toBe(true);expect(hasSymmetryCustom({kind:'map',equations:{glsl:raw}})).toBe(false);expect(hasSymmetryCustom({kind:'symmetry',equations:{glsl:' '}})).toBe(false);
 });
 it('separates compile N from runtime symmetry_degree and preserves raw placeholders',()=>{
  const raw=source('nextPos=vec3(float({N}),symmetry_degree,float({N_MINUS_2}));stepMetric=-2.;','uniform float symmetry_degree;'),plan=prepareSymmetryCustomSource(raw,5);
  expect(plan.rawSource).toBe(raw);expect(plan.expandedSource).toContain('float(5),symmetry_degree,float(3)');
  expect(bindSymmetryCustomParameters(plan,{symmetry_degree:9})).toEqual({symmetry_degree:9});expect(prepareSymmetryCustomSource(raw,5)).toBe(plan);
  expect(prepareSymmetryCustomSource(raw,7).programKey).not.toBe(plan.programKey);
  expect(prepareSymmetryCustomSource(source(),7).programKey).toBe(prepareSymmetryCustomSource(source(),5).programKey);
 });
 it('retains the native narrow matcher including comments without reflection expansion',()=>{
  const plan=prepare('nextPos=pos;stepMetric=a;','// uniform float commented;\nuniform float a; uniform float a; uniform highp float precisionOnly; uniform float first,second; uniform vec2 vector; uniform float time;');
  expect(plan.bindingNames).toEqual(['commented','a','time']);expect(bindSymmetryCustomParameters(plan,{commented:2,a:7,time:9,precisionOnly:5,extra:1})).toEqual({commented:2,a:7,time:9});
 });
 it('uses native safeFloat and never inherits named values or injects time',()=>{
  const plan=prepare('nextPos=pos;stepMetric=0.;','uniform float a;uniform float b;uniform float c;uniform float time;');
  expect(bindSymmetryCustomParameters(plan,{a:1e300,b:-Infinity,c:1e-300})).toEqual({a:0,b:0,c:0,time:0});
  expect(bindSymmetryCustomParameters(plan,Object.create({a:9}))).toEqual({a:0,b:0,c:0,time:0});
  expect(bindSymmetryCustomParameters(plan,{a:1.1}).a).toBe(Math.fround(1.1));
 });
 it('bounds retained prepared plans and excludes runtime parameters from compilation identity',()=>{
  const raw=source(),first=prepareSymmetryCustomSource(raw,5);bindSymmetryCustomParameters(first,{a:45});expect(prepareSymmetryCustomSource(raw,5)).toBe(first);
  for(let i=0;i<SYMMETRY_CUSTOM_PLAN_CACHE_SIZE;i++)prepareSymmetryCustomSource(source(`nextPos=pos;stepMetric=${i}.;`),5);
  const again=prepareSymmetryCustomSource(raw,5);expect(again).not.toBe(first);expect(again.programKey).toBe(first.programKey);
 });
 it('checks raw and placeholder-expanded text before larger representations are allocated',()=>{
  expect(()=>prepareSymmetryCustomSource('/'.repeat(MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH+1),5)).toThrow('64 Ki');
  const raw='/*'+('{N}'.repeat(20000))+'*/'+source();expect(raw.length).toBeLessThan(MAX_SYMMETRY_CUSTOM_SOURCE_LENGTH);expect(()=>prepareSymmetryCustomSource(raw,2147483647)).toThrow('96 Ki');
  for(const degree of [0,1,2.5,NaN,Infinity,2147483648])expect(()=>prepareSymmetryCustomSource(source(),degree)).toThrow('阶数');
 });
 it('shares the custom signed-int degree contract without the builtin editor ceiling',()=>{
  expect(symmetryCustomCompileDegree({settings:{}})).toBe(5);
  for(const degree of [2,50,51,2147483647]){expect(symmetryCustomCompileDegree({settings:{degree}})).toBe(degree);expect(prepareSymmetryCustomSource(source(),degree).compileDegree).toBe(degree);}
  for(const degree of [1,2.5,2147483648,'5',true])expect(()=>symmetryCustomCompileDegree({settings:{degree}})).toThrow('阶数');
 });
 it('admits GLSL identifier structure independently from MathJS names',()=>{
  for(const name of ['_gain','x','time','sin','symmetry_degree','a'.repeat(100)])expect(symmetryCustomParameterNameError(name)).toBeUndefined();
  for(const name of ['','1gain','gain-x','a'.repeat(101),'__proto__','prototype','constructor'])expect(symmetryCustomParameterNameError(name)).toBeTypeOf('string');
 });
});

describe('budget instrumentation without a replacement GLSL type checker',()=>{
 it('instruments braced and single-statement for/while/do including dangling else',()=>{
  const plan=prepare('for(int i=0;i<{N};i++) if(i>1) nextPos.x++; else nextPos.y++; while(nextPos.x<10.) nextPos.x++; do nextPos.y++; while(nextPos.y<5.);stepMetric=-1.;');
  expect(plan.loopCount).toBe(3);expect(plan.instrumentedSource).toContain('for(int i=0;i<5;i++) {if(!rea_customLoopTick())break;if(i>1) nextPos.x++; else nextPos.y++;}');
  expect(plan.instrumentedSource).toContain('while(nextPos.x<10.) {if(!rea_customLoopTick())break;nextPos.x++;}');expect(plan.instrumentedSource).toContain('do {if(!rea_customLoopTick())break;nextPos.y++;} while(nextPos.y<5.);');
 });
 it('covers nested loops and helper loops in condition/update calls, retaining continue',()=>{
  const plan=prepare('nextPos=pos;for(int i=0;condition(i);i=advance(i)){for(int j=0;j<2;j++){if(j==0)continue;nextPos.x++;}}stepMetric=-1.;','bool condition(int n){int q=0;while(q<2)q++;return n<q;} int advance(int n){do n++;while(false);return n;}');
  expect(plan.loopCount).toBe(4);expect(plan.instrumentedSource.match(/if\(!rea_customLoopTick\(\)\)break;/g)).toHaveLength(4);expect(plan.instrumentedSource).toContain('if(j==0)continue;');
 });
 it('does not confuse comments with loops or hide CR-delimited real code',()=>{
  const plan=prepare('/* for(;;){} while(true){} do{}while(true); #define rea_bad */ // while(true){}\rfor(;;)break;stepMetric=-1.;nextPos=pos;');expect(plan.loopCount).toBe(1);
  expect(plan.rawSource).toContain('// while(true){}\rfor(;;)');
 });
 it('rejects unknown preprocessing, host namespace and discard while preserving ordinary builtins',()=>{
  for(const text of ['#define HIDDEN while(true){}\n'+source(),source('discard;'),source('nextPos=rea_lower;stepMetric=1.;'),source('nextPos=pos;stepMetric=1.;','// uniform float rea_escapeRadius;')])expect(()=>prepareSymmetryCustomSource(text,5)).toThrow();
  expect(()=>prepare('nextPos=vec3(gl_FragCoord.xy,9.);stepMetric=dFdx(gl_FragCoord.x);')).not.toThrow();
  // Unknown functions and desktop-only types receive actual driver diagnostics,
  // rather than being guessed from a hand-maintained builtin allowlist.
  expect(()=>prepare('nextPos=unknownFunction(pos);stepMetric=1.;')).not.toThrow();
 });
 it('fails closed on malformed comments, delimiters and control statements',()=>{
  for(const text of ['/* unterminated',source('for(int i=0;i<2;i++)'),source('while(true){'),source('do nextPos.x++; nope(false);'),source('for(int i=0;i<2;i++) nextPos.x++')])expect(()=>prepareSymmetryCustomSource(text,5)).toThrow();
 });
 it('emits a fragment kernel with independent raw metric/validity and sticky loop failure',()=>{
  const shader=symmetryCustomFragmentSource(prepare('nextPos=vec3(pos.xy,9.);stepMetric=-3.;'));
  expect(shader).toContain('#version 300 es');expect(shader).toContain('calculate_next(rea_position,rea_next,rea_stepMetric);rea_next.z=0.;');expect(shader).toContain('rea_metric=rea_stepMetric;');
  expect(shader).toContain('rea_finiteFloat(rea_metric)');expect(shader).not.toContain('rea_metric>=0');expect(shader).toContain('bool rea_failed=(rea_meta.g&2u)!=0u;');expect(shader).toContain('if(rea_customLoopExceeded){rea_failed=true;rea_valid=false;break;}');
 });
});
