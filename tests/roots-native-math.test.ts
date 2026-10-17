import {describe,expect,it} from 'vitest';
import vectors from './fixtures/roots/native-math.json';
import {prepareRootsNativeExpression,RootsNativeError,ROOTS_NATIVE_EXPRESSION_LIMITS,type RootsNativeComplex,type RootsNativeResult} from '../src/engine/rootsNativeExpression';
import {prepareRootsNativePolynomial,ROOTS_NATIVE_POLYNOMIAL_LIMITS,type RootsNativeCoefficients} from '../src/engine/rootsNativePolynomial';
import {createRootsNativeSolver,ROOTS_NATIVE_SOLVER_LIMITS} from '../src/engine/rootsNativeSolver';

function value<T>(r:RootsNativeResult<T>):T{if(!r.ok)throw r.error;return r.value;}
function failure<T>(r:RootsNativeResult<T>):RootsNativeError{if(r.ok)throw new Error('Expected failure');return r.error;}
const scope=(entries:Record<string,RootsNativeComplex>={})=>new Map(Object.entries(entries));
const expression=(text:string,entries:Record<string,RootsNativeComplex>={})=>{const p=value(prepareRootsNativeExpression(text));try{return value(p.evaluate(scope(entries)));}finally{p.dispose();}};
const coefficients=(rows:readonly (readonly number[])[],degree=rows.length-1):RootsNativeCoefficients=>({real:Float64Array.from(rows.map(a=>a[0])),imag:Float64Array.from(rows.map(a=>a[1])),declaredDegree:degree});
function polynomial(rows:readonly (readonly [string,string])[],variable='x'){return value(prepareRootsNativePolynomial({variable,coefficients:rows.map(([exponent,expression])=>({exponent,expression}))}));}
const near=(actual:number,expected:number,tolerance=2e-12)=>expect(Math.abs(actual-expected)).toBeLessThanOrEqual(tolerance*Math.max(1,Math.abs(expected)));

describe('native Roots coefficient grammar and arithmetic',()=>{
 it.each([
  ['-2^2',[4,0]],['2^3^2',[512,0]],['2^-2',[.25,0]],['-2*-3+1',[7,0]],['1e3+2E-2',[1000.02,0]],
  ['(1+2*i)*(3-4*i)',[11,2]],['(1+2*i)/(3-4*i)',[-.2,.4]],['0^0',[1,0]],['(1+i)^-2',[0,-.5]],
  ['I+Pi+E',[Math.PI+Math.E,1]],['Re (1+2*i)+IM(3+4*i)',[5,0]],
 ] as const)('source grammar %s',(source,expected)=>{const actual=expression(source);near(actual[0],expected[0]);near(actual[1],expected[1]);});
 it.each(vectors.functions)('independent function $function at $input',v=>{const actual=expression(`${v.function}(a)`,{a:v.input as [number,number]});near(actual[0],v.expected[0]);near(actual[1],v.expected[1]);});
 it('uses the sample-only case-sensitive map and reserves only i/pi/e constants',()=>{
  expect(expression('a+A+π+_gain',{a:[1,0],A:[2,0],π:[3,0],_gain:[4,1]})).toEqual([10,1]);
  expect(expression('i+PI+e',{i:[7,9],PI:[8,9],e:[9,9]})).toEqual([Math.PI+Math.E,1]);
  for(const name of ['a','time','x','constructor','__proto__'])expect(failure(value(prepareRootsNativeExpression(name)).evaluate(new Map())).kind).toBe('evaluation');
  expect(expression('constructor+__proto__',Object.fromEntries([['constructor',[2,0]],['__proto__',[3,0]]]))).toEqual([5,0]);
  expect(expression('a١',{a١:[8,2]})).toEqual([8,2]);
 });
 it.each(['',' ','2a','2(3)','sin()','sin(1,2)','1.2.3','1e+','a.b','1\u00a0+2','١','𝒂'])('rejects source syntax %j',raw=>{expect(failure(prepareRootsNativeExpression(raw)).kind).toBe('syntax');});
 it('uses Java whitespace and defers unknown function failure to evaluation',()=>{
  expect(expression('\u20031 +\u001c 2')).toEqual([3,0]);
  const p=value(prepareRootsNativeExpression('sqrt(a)'));expect(failure(p.evaluate(scope({a:[4,0]})))).toMatchObject({kind:'evaluation',facts:{function:'sqrt'}});
  expect(failure(p.evaluate(scope()))).toMatchObject({kind:'evaluation',facts:{parameter:'a'}});
 });
 it('keeps naive nonfinite arithmetic and general complex power cuts',()=>{
  expect(expression('1e309')).toEqual([Infinity,0]);expect(expression('1^1e309')).toEqual([1,0]);
  for(const text of ['1/0','0^-1','0^(1+i)']){const actual=expression(text);expect(actual.every(Number.isNaN)).toBe(true);}
  // Unary negation retains scratch -0; explicitly adding +0 chooses the other cut.
  const plus=expression('(-1+0*i)^.5');near(plus[0],0);near(plus[1],1);near(expression('(-1)^.5')[1],-1);
  const negativeImag=expression('(-1-0*i)^.5');near(negativeImag[1],-1);
  expect(failure(value(prepareRootsNativeExpression('2^-2147483648')).evaluate(scope()))).toMatchObject({kind:'capacity',facts:{resource:'negative integer power recursion'}});
 });
 it('reuses expression workspace and exposes dispose rather than stale results',()=>{
  const p=value(prepareRootsNativeExpression('a*a'));expect(p.workspaceBytes).toBe(16*p.nodeCount);expect(value(p.evaluate(scope({a:[2,1]})))).toEqual([3,4]);expect(value(p.evaluate(scope({a:[3,2]})))).toEqual([5,12]);p.dispose();expect(failure(p.evaluate(scope())).kind).toBe('input');
 });
 it('propagates cancellation and callback errors through nested Result boundaries',()=>{
  const ownedLike=new RootsNativeError('evaluation','consumer failure'),plain=new Error('request work budget');
  for(const error of [ownedLike,plain]){
   expect(()=>prepareRootsNativeExpression('1',{onWork(){throw error;}})).toThrow(error);
   const p=polynomial([['2','a^10'],['0','-1']]);expect(()=>p.evaluate(scope({a:[2,0]}),{onWork(){throw error;}})).toThrow(error);p.dispose();
  }
  expect(()=>prepareRootsNativeExpression('1',{isCancelled:()=>true})).toThrowError(/cancelled/);
  expect(()=>prepareRootsNativeExpression('1',{isCancelled(){throw ownedLike;}})).toThrow(ownedLike);
  // A prior external failure does not poison subsequent independent calls.
  expect(expression('1+2')).toEqual([3,0]);
 });
 it('admits bounded syntax and reports distinct text/node/stack capacities',()=>{
  expect(failure(prepareRootsNativeExpression(' '.repeat(ROOTS_NATIVE_EXPRESSION_LIMITS.characters+1))).kind).toBe('capacity');
  expect(failure(prepareRootsNativeExpression('1+'.repeat(5000)+'1'))).toMatchObject({kind:'capacity',facts:{resource:'expression nodes'}});
  expect(failure(prepareRootsNativeExpression('('.repeat(200)+'1'+')'.repeat(200)))).toMatchObject({kind:'capacity',facts:{resource:'parser depth'}});
 });
});

describe('source coefficient table identity and reusable production plan',()=>{
 it('resolves integer aliases once, retains winning expressions and declared high zero',()=>{
  const raw={variable:' \u0000X ',coefficients:[{exponent:'01',expression:'('},{exponent:'1',expression:'a'},{exponent:'３',expression:'0'},{exponent:'-0',expression:'1'}]};
  const p=value(prepareRootsNativePolynomial(raw));expect(p.source).toEqual(raw);expect(p.source).not.toBe(raw);expect(p.variable).toBe('X');expect(p.declaredDegree).toBe(3);
  const first=value(p.evaluate(scope({a:[7,2]})));expect(Array.from(first.real)).toEqual([1,7,0,0]);expect(Array.from(first.imag)).toEqual([0,2,0,0]);
  const next=value(p.evaluate(scope({a:[9,4]})));expect(next.real).toBe(first.real);expect(Array.from(first.real)).toEqual([1,9,0,0]);expect(next.declaredDegree).toBe(3);
  raw.coefficients[1].expression='broken(';expect(value(p.evaluate(scope({a:[5,6]}))).real[1]).toBe(5);p.dispose();expect(failure(p.evaluate(scope())).kind).toBe('input');
 });
 it('keeps polynomial variable metadata separate from coefficient bindings',()=>{
  for(const variable of ['x','time','i',' ']){const p=polynomial([['1','x']],variable);expect(failure(p.evaluate(scope())).kind).toBe('evaluation');expect(value(p.evaluate(scope({x:[3,0]}))).real[1]).toBe(3);}
  const p=value(prepareRootsNativePolynomial({variable:{sourceValue:1.5,numberToken:'1.5'},coefficients:[{exponent:'1',expression:'1'}]}));expect(p.variable).toBeUndefined();expect(p.variableFacts.status).toBe('unknown');expect(value(p.evaluate(scope())).real[1]).toBe(1);
  expect(polynomial([],'\u2003').variable).toBe('x');
 });
 it.each([
  [[['-1','1']],'input'],[[['1','1'],['1','2']],'input'],[[['1.0','1']],'syntax'],[[['2147483648','1']],'syntax'],[[['1','sin(']],'syntax'],
 ] as const)('classifies structural/table and active-expression errors %j',(rows,kind)=>{expect(failure(prepareRootsNativePolynomial({variable:'x',coefficients:rows.map(([exponent,expression])=>({exponent,expression}))})).kind).toBe(kind);});
 it('preflights sparse degree and total characters before dense allocation',()=>{
  const result=prepareRootsNativePolynomial({variable:'x',coefficients:[{exponent:'2147483647',expression:'0'}]});expect(failure(result)).toMatchObject({kind:'capacity',facts:{resource:'polynomial workspace bytes',actual:2147483648*16,limit:ROOTS_NATIVE_POLYNOMIAL_LIMITS.workspaceBytes}});
  expect(failure(prepareRootsNativePolynomial({variable:' '.repeat(ROOTS_NATIVE_POLYNOMIAL_LIMITS.totalCharacters+1),coefficients:[]})).kind).toBe('capacity');
 });
 it('cancels preparation and dense coefficient reset independently of the solver',()=>{
  let cancelled=false;expect(()=>prepareRootsNativePolynomial({variable:'x',coefficients:[{exponent:'3',expression:'1'},{exponent:'0',expression:'1'}]},{isCancelled:()=>cancelled,onWork(){cancelled=true;}})).toThrow(/cancelled/);
  const p=polynomial([['10000','a']]);let cleared=0;expect(()=>p.evaluate(scope({a:[1,0]}),{isCancelled:()=>cleared>1024,onWork:n=>{cleared+=n;}})).toThrow(/cancelled/);expect(cleared).toBeLessThan(10000);p.dispose();
 });
});

describe('retained Aberth + power substitution mathematical contract',()=>{
 it.each(vectors.solver)('independent source fixture $id',v=>{
  const solver=createRootsNativeSolver();const r=value(solver.solve(coefficients(v.coefficients),{maxIterations:v.maxIterations,tolerance:v.tolerance}));
  expect({declaredDegree:r.declaredDegree,effectiveDegree:r.effectiveDegree,powerSubstitution:r.powerSubstitution,iterations:r.iterations,stop:r.stop}).toEqual({declaredDegree:v.expected.declaredDegree,effectiveDegree:v.expected.effectiveDegree,powerSubstitution:v.expected.powerSubstitution,iterations:v.expected.iterations,stop:v.expected.stop});
  expect(r.rootCount).toBe(v.expected.roots.length);for(let k=0;k<r.rootCount;k++){near(r.roots[k*2],v.expected.roots[k][0]);near(r.roots[k*2+1],v.expected.roots[k][1]);}
  near(r.maxCorrectionSquared,v.expected.maxCorrectionSquared,1e-10);expect(r.nonfiniteRootCount).toBe(0);expect(r.work).toBeGreaterThan(0);solver.dispose();
 });
 it('returns finite approximate roots at the iteration limit without residual rejection or sorting',()=>{
  const solver=createRootsNativeSolver(),r=value(solver.solve(coefficients([[0,0],[-1,0],[1,0]]),{maxIterations:1,tolerance:1e-9}));expect(r.stop).toBe('iteration-limit');expect(r.nonfiniteRootCount).toBe(0);expect(r.roots[0]).toBeGreaterThan(r.roots[2]);
  const [x,y]=r.roots;expect(Math.hypot(x*x-y*y-x,2*x*y-y)).toBeGreaterThan(.1);solver.dispose();
 });
 it('preserves explicit high zero before trim rather than changing substitution routes',()=>{
  const a=polynomial([['2','1'],['0','-1']]),b=polynomial([['2','1'],['0','-1'],['3','0']]),s=createRootsNativeSolver();
  const r1=value(s.solve(value(a.evaluate(scope())),{maxIterations:1,tolerance:1e-9}));expect(r1.powerSubstitution).toBe(2);expect(r1.stop).toBe('linear');
  const r2=value(s.solve(value(b.evaluate(scope())),{maxIterations:1,tolerance:1e-9}));expect(r2.powerSubstitution).toBe(1);expect(r2.effectiveDegree).toBe(2);expect(r2.stop).toBe('iteration-limit');s.dispose();a.dispose();b.dispose();
 });
 it('retains naive linear underflow, nonfinite lower coefficients, and leading validation',()=>{
  const s=createRootsNativeSolver(),opts={maxIterations:2,tolerance:1e-9};
  for(const a of [[[1,0],[1e-200,0]],[[Infinity,0],[1,0]]] as number[][][]){const r=value(s.solve(coefficients(a),opts));expect(r.nonfiniteRootCount).toBe(1);expect(r.rootCount).toBe(1);}
  for(const leading of [NaN,Infinity])expect(failure(s.solve(coefficients([[1,0],[leading,0]]),opts))).toMatchObject({kind:'evaluation',facts:{stage:'leading-coefficient'}});
  expect(value(s.solve(coefficients([[NaN,0]]),opts)).rootCount).toBe(0);
  const r=value(s.solve(coefficients([[NaN,0],[0,0],[1,0]]),opts));expect(r.rootCount).toBe(2);expect(r.nonfiniteRootCount).toBe(2);s.dispose();
 });
 it('source solver options clamp iterations and tolerance but do not invent a NaN convergence',()=>{
  const s=createRootsNativeSolver(),c=coefficients([[0,0],[-1,0],[1,0]]);
  expect(value(s.solve(c,{maxIterations:0,tolerance:1e-9})).iterations).toBe(1);
  expect(value(s.solve(c,{maxIterations:3,tolerance:NaN})).stop).toBe('iteration-limit');
  expect(value(s.solve(c,{maxIterations:3,tolerance:Infinity})).iterations).toBe(1);s.dispose();
 });
 it('reuses buffers, clears current result span, and releases only its own state',()=>{
  const s=createRootsNativeSolver(),opts={maxIterations:1,tolerance:1e-9};const first=value(s.solve(coefficients([[0,0],[-1,0],[1,0]]),opts)),buffer=first.roots;
  const bytes=s.diagnostics().workspaceBytes;const next=value(s.solve(coefficients([[-3,0],[1,0]]),opts));expect(next.roots).toBe(buffer);expect(next.rootCount).toBe(1);expect(next.roots[0]).toBe(3);expect(s.diagnostics().workspaceBytes).toBe(bytes);
  const other=createRootsNativeSolver();value(other.solve(coefficients([[-2,0],[1,0]]),opts));s.dispose();expect(s.diagnostics()).toEqual({workspaceBytes:0,capacity:0,disposed:true});expect(other.diagnostics().workspaceBytes).toBeGreaterThan(0);expect(failure(s.solve(coefficients([[0,0]]),opts)).kind).toBe('input');other.dispose();
 });
 it('enforces memory before scan and work inside Horner, pair and lift loops',()=>{
  const s=createRootsNativeSolver(),slots=Math.floor(ROOTS_NATIVE_SOLVER_LIMITS.workspaceBytes/64)+1;
  const tooLarge={real:new Float64Array(slots),imag:new Float64Array(slots),declaredDegree:slots-1};let work=0;expect(failure(s.solve(tooLarge,{maxIterations:1,tolerance:1e-9,onWork:n=>{work+=n;}}))).toMatchObject({kind:'capacity',facts:{resource:'solver workspace bytes'}});expect(work).toBe(0);expect(s.diagnostics().workspaceBytes).toBe(0);
  const dense=coefficients(Array.from({length:65},(_,i)=>i===64?[1,0]:i===1?[-1,0]:[0,0]));expect(failure(s.solve(dense,{maxIterations:10,tolerance:1e-9,maxWork:300}))).toMatchObject({kind:'capacity',facts:{resource:'solver work',actual:301,limit:300}});
  let charged=0;expect(()=>s.solve(dense,{maxIterations:10,tolerance:1e-9,onWork:n=>{charged+=n;},isCancelled:()=>charged>=300})).toThrow(/cancelled/);expect(charged).toBe(300);
  const lift=coefficients(Array.from({length:129},(_,i)=>i===128?[1,0]:i===0?[-1,0]:[0,0]));expect(failure(s.solve(lift,{maxIterations:1,tolerance:1e-9,maxWork:150}))).toMatchObject({kind:'capacity',facts:{resource:'solver work'}});s.dispose();
 });
 it('rejects undersized coefficient views instead of silently lowering declared degree',()=>{
  const s=createRootsNativeSolver();expect(failure(s.solve(coefficients([[1,0],[1,0]],5),{maxIterations:1,tolerance:1e-9}))).toMatchObject({kind:'input'});expect(s.diagnostics().workspaceBytes).toBe(0);s.dispose();
 });
 it('preserves caller work failures instead of treating them as bad polynomial samples',()=>{
  const s=createRootsNativeSolver(),error=new RootsNativeError('evaluation','caller work signal');expect(()=>s.solve(coefficients([[0,0],[-1,0],[1,0]]),{maxIterations:10,tolerance:1e-9,onWork(){throw error;}})).toThrow(error);s.dispose();
 });
});
