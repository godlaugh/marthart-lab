import {describe,expect,it} from 'vitest';
import {importSourcePerlinGradientGroup,SourcePerlinGradientImportError} from '../src/engine/sourcePerlinGradientImport';
import {SourceParticleGradientConfigurationError} from '../src/engine/sourceParticleGradientConfig';
import {SOURCE_JSON_LIMITS} from '../src/engine/sourceJson';

const start=(args:unknown)=>({method:'gradientStart',args});
const stop=(args:unknown=[])=>({method:'gradientStop',args});
const defaultAction={kind:'start',config:{model:'offsets',mode:'hue_rotate',interpolation:'oklab',speed:60,affectInside:true,affectOutside:true}};

describe('JsonPerlinConfig last successfully built gradient child',()=>{
 it('selects the last valid child while retaining superseded and unrelated inputs',()=>{
  const raw=[start({speed:15}),{method:'paramStart',args:{parameters:{noise_scale:{step:1}}}},stop(),start([{mode:'CROSS_FADE',speed:90}])];
  const before=structuredClone(raw),facts=importSourcePerlinGradientGroup(raw);
  expect(facts.selectedIndex).toBe(3);
  expect(facts.action).toMatchObject({kind:'start',config:{mode:'cross_fade',speed:90}});
  expect(facts.entries.map(e=>e.status)).toEqual(['superseded','unhandled','superseded','selected']);
  expect(facts.entries[0]).toMatchObject({supersededBy:2});
  expect(facts.entries[2]).toMatchObject({supersededBy:3});
  facts.entries.forEach((entry,i)=>expect(entry.source).toBe(raw[i]));
  expect(raw).toEqual(before);
  expect(facts.consumedPaths.some(path=>path[0]==='1')).toBe(false);
 });
 it('does not erase an earlier valid child when later gradient mode is unknown',()=>{
  const facts=importSourcePerlinGradientGroup([start({mode:'offset_cycle'}),start({mode:'unknown',speed:-3}),stop(null)]);
  expect(facts.selectedIndex).toBe(0);expect(facts.action).toMatchObject({config:{mode:'offset_cycle'}});
  expect(facts.entries.map(e=>e.status)).toEqual(['selected','skipped','skipped']);
  expect(facts.entries[1]).toMatchObject({reason:'unknown-mode'});
  expect(facts.entries[2]).toMatchObject({reason:'args-null'});
  expect(facts.diagnostics.some(note=>note.includes('覆盖'))).toBe(false);
 });
 it.each([undefined,null,1,true,'[]'])('skips invalid args %s before invoking default config',args=>{
  const facts=importSourcePerlinGradientGroup([start(args)]);
  expect(facts.selectedIndex).toBeNull();expect(facts.action).toBeUndefined();
  expect(facts.entries[0]).toMatchObject({status:'skipped'});
 });
 it('distinguishes missing args from empty arrays and objects',()=>{
  const facts=importSourcePerlinGradientGroup([{method:'gradientStart'},{method:'gradientStop'},start([]),start({})]);
  expect(facts.entries[0]).toMatchObject({status:'skipped',reason:'args-missing'});
  expect(facts.entries[1]).toMatchObject({status:'skipped',reason:'args-missing'});
  expect(facts.action).toEqual(defaultAction);
  expect(facts.entries[2]).toMatchObject({status:'superseded',facts:{payloadPath:null}});
  expect(facts.entries[3]).toMatchObject({status:'selected',facts:{payloadPath:[],payloadEmpty:true}});
 });
 it('extracts object directly or only array index zero, never searches or enforces length one',()=>{
  const supplied={mode:'PALETTE_MORPH',speed:'0x1.ep5',interpolation:'LINEAR'};
  for(const args of [supplied,[supplied,{mode:'HUE_ROTATE'}]]){
   expect(importSourcePerlinGradientGroup([start(args)]).action).toMatchObject({config:{mode:'palette_morph',speed:60,interpolation:'linear'}});
  }
  for(const args of [[null,supplied],[false,supplied],[[],supplied]]){
   expect(importSourcePerlinGradientGroup([start(args)]).action).toEqual(defaultAction);
  }
 });
 it('stop ignores all payload content once args is array or object',()=>{
  for(const args of [{mode:'invalid',speed:'NaN',affectOutside:false},[false,{mode:'invalid'}]]){
   const facts=importSourcePerlinGradientGroup([start({speed:1}),stop(args)]);
   expect(facts.action).toEqual({kind:'stop'});expect(facts.selectedIndex).toBe(1);
   expect(facts.consumedPaths.filter(path=>path[0]==='1')).toEqual([['1','method']]);
  }
 });
 it('forces both regions, ignores targetDomain, and does not consume later slots or unknown fields',()=>{
  const facts=importSourcePerlinGradientGroup([start([{mode:'HUE_ROTATE',affectInside:false,affectOutside:false,targetDomain:'FRACTAL',unknown:42},{speed:999}])]);
  expect(facts.action).toEqual(defaultAction);
  expect(facts.consumedPaths).toEqual([['0','method'],['0','args','0','mode'],['0','args','0','affectInside'],['0','args','0','affectOutside']]);
  expect(facts.entries[0].source.args).toEqual([{mode:'HUE_ROTATE',affectInside:false,affectOutside:false,targetDomain:'FRACTAL',unknown:42},{speed:999}]);
 });
 it('ignores action enabled and keeps method comparison case sensitive',()=>{
  const facts=importSourcePerlinGradientGroup([{method:'gradientStart',enabled:false,args:{}},{method:'gradientstop',args:[]}]);
  expect(facts.selectedIndex).toBe(0);expect(facts.entries[1].status).toBe('unhandled');
  expect(facts.consumedPaths).not.toContainEqual(['0','enabled']);
 });
 it.each([['',60],['NaN',60],['Infinity',60],[-12,0],['-0x1.0p2',0],[true,60],[{},60]])('uses source speed fallback/clamp for %s', (speed,expected)=>{
  const facts=importSourcePerlinGradientGroup([start({speed})]);
  expect(facts.action).toMatchObject({config:{speed:expected}});
 });
 it('defaults blank mode and unknown interpolation without skipping the action',()=>{
  const facts=importSourcePerlinGradientGroup([start({mode:' \t',interpolation:'not-a-space'})]);
  expect(facts.action).toEqual(defaultAction);
 });
 it('returns no selection for empty or wholly unrelated groups',()=>{
  expect(importSourcePerlinGradientGroup([])).toEqual({selectedIndex:null,entries:[],consumedPaths:[],diagnostics:[]});
  expect(importSourcePerlinGradientGroup([{method:'zoom',args:[2]}]).selectedIndex).toBeNull();
 });
 it('rejects malformed action containers rather than reporting them as source no-ops',()=>{
  for(const value of [null,{},false,[null],[2],[[]]])expect(()=>importSourcePerlinGradientGroup(value)).toThrow(SourcePerlinGradientImportError);
 });
 it('bounds the whole raw group, including unrelated actions, before inspecting entries',()=>{
  expect(()=>importSourcePerlinGradientGroup(Array(65).fill(null))).toThrow(/64/);
  expect(importSourcePerlinGradientGroup(Array.from({length:64},()=>({method:'zoom',args:[1]}))).entries).toHaveLength(64);
 });
 it('propagates scalar resource failures even for a subsequently superseded constructor',()=>{
  expect(()=>importSourcePerlinGradientGroup([start({speed:'1'.repeat(SOURCE_JSON_LIMITS.characters+1)}),stop()])).toThrow(SourceParticleGradientConfigurationError);
 });
});
