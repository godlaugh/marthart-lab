import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import * as expression from '../src/engine/expression';
import {parseScene} from '../src/engine/document';
import {IteratedDensitySession,generateIteratedDensity} from '../src/scenes/iteratedDensity';
import {IteratedDensityGpu} from '../src/engine/iteratedDensityGpu';
import type {SceneDocument,SceneOutput} from '../src/types';
import baseline from './fixtures/samila-cpu-cache-baseline.json';

const context={...baseline.context,quality:'export' as const};
function scene(index=0):SceneDocument {return parseScene(JSON.stringify(baseline.cases[index].scene));}
function outputFacts(output:SceneOutput) {
 if(output.type!=='raster'||!output.temporal)throw new Error('Expected continuous raster');
 const {elapsedMs,...stats}=output.stats,{cacheHits,...temporal}=output.temporal;
 return{pixelsSha256:createHash('sha256').update(output.pixels).digest('hex'),stats,density:output.density,temporal};
}
afterEach(()=>vi.restoreAllMocks());

describe('session-owned Samila CPU programs',()=>{
 for(const [index,row]of baseline.cases.entries())it(`matches pre-cache production pixels and counts: ${row.name}`,()=>{
  const source=scene(index),owner=new IteratedDensitySession(),compile=vi.spyOn(expression,'compileReal');
  try {
   for(const time of [0,.1,.2,.3])owner.generate(source,{...context,time});
   expect(outputFacts(owner.generate(source,context))).toEqual(row.expected);
   expect(outputFacts(owner.generate(source,{...context,time:.39}))).toEqual(row.expected);
   owner.generate(source,{...context,time:.1});
   expect(outputFacts(owner.generate(source,context))).toEqual(row.expected);
   expect(outputFacts(owner.generate(parseScene(JSON.stringify(source)),context))).toEqual(row.expected);
   expect(compile.mock.calls).toEqual([[source.equations.f1],[source.equations.f2]]);
   expect(owner.diagnostics().samilaCompiledExpressions).toBe(2);
   expect(outputFacts(generateIteratedDensity(source,context))).toEqual(row.expected);
  }finally{owner.reset();}
  expect(owner.diagnostics()).toMatchObject({retainedBytes:0,samilaCompiledExpressions:0});
 });

 it('keeps current runtime symbols and lazy unknown branches across parameter edits and reordered names',()=>{
  const source=scene(),owner=new IteratedDensitySession(),compile=vi.spyOn(expression,'compileReal');
  source.timeline.tracks=[];source.equations={f1:'a > 0 ? x : missing',f2:'y'};source.parameters={a:1};
  try {
   const initial=owner.generate(source,{...context,time:0});
   source.parameters={missing:.2,a:1};
   expect(outputFacts(owner.generate(source,{...context,time:0}))).toEqual(outputFacts(initial));
   source.parameters={a:1,missing:.2};owner.generate(source,{...context,time:0});
   delete source.parameters.missing;owner.generate(source,{...context,time:0});
   expect(compile.mock.calls).toEqual([[source.equations.f1],[source.equations.f2]]);
   source.parameters.a=-1;
   expect(()=>owner.generate(source,{...context,time:0})).toThrow('未知变量 missing');
   expect(owner.diagnostics()).toMatchObject({retainedBytes:0,samilaCompiledExpressions:0});
   source.parameters.missing=.2;
   const repaired=owner.generate(source,{...context,time:0});
   expect(repaired.stats.generated).toBe(31);expect(compile).toHaveBeenCalledTimes(4);
   expect(outputFacts(repaired)).toEqual(outputFacts(generateIteratedDensity(source,{...context,time:0})));
  }finally{owner.reset();}
 });

 it('reuses only arithmetic programs while fresh mappings, seed, view, rotation and time bind to replay',()=>{
  const source=scene(4),owner=new IteratedDensitySession(),compile=vi.spyOn(expression,'compileReal');
  source.timeline.tracks=[];
  try {
   const initial=owner.generate(source,context);
   source.parameters={a:1.2,b:1.9,c:.2,d:.8};source.settings.seed=17;
   source.settings.mapping='x_warp';source.settings.rotation=.4;source.settings.densitySpan=5;
   const changed=owner.generate(source,{...context,time:.5,width:39});
   expect(compile).toHaveBeenCalledTimes(2);
   expect(outputFacts(changed).pixelsSha256).not.toBe(outputFacts(initial).pixelsSha256);
   expect(outputFacts(changed)).toEqual(outputFacts(generateIteratedDensity(source,{...context,time:.5,width:39})));
  }finally{owner.reset();}
 });

 it('keys exact source text, replaces the pair and releases both evaluators on explicit reset',()=>{
  const source=scene(),owner=new IteratedDensitySession(),compile=vi.spyOn(expression,'compileReal');
  try {
   const initial=owner.generate(source,context);
   source.equations.f1+=' ';
   expect(outputFacts(owner.generate(source,context))).toEqual(outputFacts(initial));
   expect(compile).toHaveBeenCalledTimes(4);
   source.equations.f1='x';source.equations.f2='y';owner.generate(source,context);
   expect(compile).toHaveBeenCalledTimes(6);expect(owner.diagnostics().samilaCompiledExpressions).toBe(2);
   owner.reset();expect(owner.diagnostics().samilaCompiledExpressions).toBe(0);
   owner.generate(source,context);expect(compile).toHaveBeenCalledTimes(8);
  }finally{owner.reset();}
 });

 it('does not retain a partially compiled replacement or state after cancellation',()=>{
  const source=scene(),owner=new IteratedDensitySession(),compile=vi.spyOn(expression,'compileReal');
  try {
   owner.generate(source,context);source.equations={f1:'x+1',f2:'sin('};
   expect(()=>owner.generate(source,context)).toThrow();
   expect(compile).toHaveBeenCalledTimes(4);
   expect(owner.diagnostics()).toMatchObject({retainedBytes:0,samilaCompiledExpressions:0});
   source.equations=scene().equations;compile.mockClear();
   expect(()=>owner.generate(source,{...context,isCancelled:()=>compile.mock.calls.length===2})).toThrow(/取消/);
   expect(compile).toHaveBeenCalledTimes(2);
   expect(owner.diagnostics()).toMatchObject({retainedBytes:0,samilaCompiledExpressions:0});
   expect(outputFacts(owner.generate(source,context))).toEqual(baseline.cases[0].expected);
   expect(compile).toHaveBeenCalledTimes(4);
  }finally{owner.reset();}
 });

 it('recompiles once for a complete CPU replay after GPU failure and clears on leaving Samila',()=>{
  const source=scene(1),owner=new IteratedDensitySession(),compile=vi.spyOn(expression,'compileReal');
  const step=vi.spyOn(IteratedDensityGpu.prototype,'step').mockImplementation(()=>{throw new Error('cache regression GPU failure');});
  try {
   owner.generate(source,context);source.settings.iteratedBackend='gpu';
   const fallback=owner.generate(source,context);
   expect(fallback.backend).toBe('cpu');expect(fallback.warnings?.join()).toContain('cache regression GPU failure');
   expect(outputFacts(fallback)).toEqual(baseline.cases[1].expected);
   expect(compile).toHaveBeenCalledTimes(4);expect(step).toHaveBeenCalledTimes(1);
   owner.generate(source,{...context,time:.4});expect(compile).toHaveBeenCalledTimes(4);expect(step).toHaveBeenCalledTimes(1);
   const map={...scene(),kind:'map' as const,equations:{x:'x',y:'y'},parameters:{},timeline:{...source.timeline,tracks:[]},settings:{...source.settings,iteratedBackend:'cpu',batchSize:1,burnIn:0}};
   owner.generate(map,{...context,time:0});expect(owner.diagnostics().samilaCompiledExpressions).toBe(0);
  }finally{owner.reset();}
 });
});
