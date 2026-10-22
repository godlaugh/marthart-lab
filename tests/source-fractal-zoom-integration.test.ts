import {describe,it,expect} from 'vitest';
import fixture from './fixtures/source-fractal-zoom/source.json';
import ingress from './fixtures/source-fractal-actions/source.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sceneAtTime,timelineControlsTarget} from '../src/engine/timeline';
const raw=(timeline:unknown[],fractal:Record<string,unknown>={})=>({config_version:'1.0.0',type:'FRACTAL',name:'zoom',fractal:{formula_id:'phoenix',center:[0,0],zoom:1,...fractal},timeline});
const parse=(timeline:unknown[],fractal:Record<string,unknown>={})=>parseProjectFile(JSON.stringify(raw(timeline,fractal))).scene;
const fields=['zoom','centerX','centerXLow','centerY','centerYLow'] as const;
// This fixture invokes a standalone target callback at arbitrary progress.
// Phoenix retains the legacy hybrid import/absolute-time adapter. Complete
// source Mandelbrot clocks are covered by source-fractal-power and scene-runtime.
describe('legacy hybrid source target import, persistence and timeline consumers',()=>{
 it.each(fixture.samples.filter(s=>s.progress>=0&&s.progress<=1))('replays imported original sample $id',sample=>{
  const a=sample.start,b=sample.target;
  const scene=parse([{type:'fractal_zoom',duration:1,easing:sample.easing,center_hi_lo:[b.centerX,b.centerXLow,b.centerY,b.centerYLow],zoom:b.zoom,max_zoom:b.maxZoom}],{center:undefined,center_hi_lo:[a.centerX,a.centerXLow,a.centerY,a.centerYLow],zoom:a.zoom});
  const saved=parseScene(serializeScene(scene)),out=sceneAtTime(saved,sample.progress);
  expect(saved.timeline.tracks[0].keyframes).toBeUndefined();
  for(const key of fields){expect(Math.abs(Number(out.settings[key])-sample.output[key]),key).toBeLessThanOrEqual(Math.max(Number.MIN_VALUE,Math.abs(sample.output[key])*Number.EPSILON*8));expect(timelineControlsTarget(out,'settings.'+key)).toBe(true);}
 });
 it.each(fixture.parseTargets.map((sample,index)=>({...sample,index})))('matches original target parser case $index',sample=>{
  const a=fixture.parseInitial,run=()=>parse([{type:'fractal_zoom',duration:1,...sample.input}],{center:undefined,center_hi_lo:[a.centerX,a.centerXLow,a.centerY,a.centerYLow],zoom:a.zoom});
  if('error' in sample||sample.target?.some(v=>typeof v.value!=='number'||!Number.isFinite(v.value))){expect(run).toThrow();return;}
  const parsed=run().timeline.tracks[0].sourceFractalZoom!;
  for(const [i,key] of fields.entries())expect(parsed[key]).toBe(key==='zoom'?Math.max(1e-9,Number(sample.target![i].value)):sample.target![i].value);
  expect(parsed.maxZoom).toBe(sample.maxZoom?.value??1e300);
 });
 it.each(ingress.timing.map((sample,index)=>({...sample,index})))('preserves JSONObject float duration/key rounding case $index',sample=>{
  if(typeof sample.native.duration!=='number'){expect(()=>parse([sample.input])).toThrow();return;}
  const scene=parse([sample.input]),track=parseScene(serializeScene(scene)).timeline.tracks[0];
  expect(track.duration).toBe(sample.native.duration);expect(track.sourceFractalZoom!.zoom).toBe(sample.native.targetZoom);
 });
 it('normalizes the initial source minimum zoom before capturing or resolving omitted targets',()=>{
  const s=parse([{type:'fractal_zoom',duration:1}],{zoom:1e-9});expect(s.settings.zoom).toBe(1e-6);expect(s.timeline.tracks[0].sourceFractalZoom!.zoom).toBe(1e-6);expect(sceneAtTime(s,.5).settings.zoom).toBeCloseTo(1e-6,18);
 });
 it('captures an edited viewport at the clip start and uses the previous clip result',()=>{
  const s=parse([{type:'fractal_zoom',duration:1,easing:'LINEAR',zoom:100,center:[1,0]},{type:'fractal_zoom',duration:1,easing:'LINEAR',zoom:10000,center:[2,0]}]);
  s.settings.centerX=-1;s.settings.zoom=4;
  expect(sceneAtTime(s,0).settings.centerX).toBe(-1);
  expect(sceneAtTime(s,.5).settings.centerX).toBeCloseTo(2/3,14);
  expect(sceneAtTime(s,1.5).settings.centerX).toBeCloseTo(1+10/11,14);
 });
 it('resolves omitted targets when loading the original config, independently from the later start capture',()=>{
  const s=parse([{type:'fractal_zoom',duration:1,zoom:100,center:[1,0]},{type:'fractal_zoom',duration:1,easing:'LINEAR'}]);
  expect(s.timeline.tracks[1].sourceFractalZoom).toMatchObject({zoom:1,centerX:0});
  expect(sceneAtTime(s,2).settings.centerX).toBe(0);
 });
 it('selects the final equal Float32 time and retains original input',()=>{
  const input=raw([{type:'fractal_zoom',duration:1,keys:[{time:1.00000001,zoom:2},{time:1,zoom:7}]}]);const s=parseProjectFile(JSON.stringify(input)).scene;
  expect(s.timeline.tracks[0].sourceFractalZoom!.zoom).toBe(7);expect(s.provenance!.original).toEqual(input);
 });
 it('handles source defaults, explicit null, invalid scalars, clipping and native easing lookup',()=>{
  const s=parse([{type:'fractal_zoom',zoom:null,centerX:'invalid',centerY:'2+3',max_zoom:'NaN',easing:'not-a-curve'}]);
  expect(s.timeline.tracks[0]).toMatchObject({duration:4,easing:'sine-in-out',sourceFractalZoom:{zoom:1e-9,centerX:0,centerY:5,maxZoom:1e300}});
  expect(sceneAtTime(s,4).settings.zoom).toBe(1e-6);
  for(const easing of [null,42,{},[]])expect(parse([{type:'fractal_zoom',easing}]).timeline.tracks[0].easing).toBe('sine-in-out');
  expect(parse([{type:'fractal_zoom',duration:0}]).timeline.tracks[0].duration).toBe(Math.fround(1e-4));
  expect(parse([{type:'fractal_zoom',duration:'invalid'}]).timeline.tracks[0].duration).toBe(Math.fround(1e-4));
  expect(parse([{type:'fractal_zoom',enabled:false,center:null}]).timeline.tracks).toEqual([]);
 });
 it('keeps source and local keyframe ownership exclusive at both saved and runtime boundaries',()=>{
  const s=parse([{type:'fractal_zoom',duration:1,zoom:100}]);
  for(const patch of [{interpolation:'linear'},{keyframes:[]},{repeat:2},{pingPong:true},{sourceFractalZoom:{...s.timeline.tracks[0].sourceFractalZoom,unknown:1}}]){
   const bad=structuredClone(s);Object.assign(bad.timeline.tracks[0],patch);
   expect(()=>parseScene(JSON.stringify(bad))).toThrow();expect(()=>sceneAtTime(bad,.5)).toThrow();
  }
 });
 it('reports renderer capacity instead of silently capping an unsupported zoom',()=>{
  const s=parse([{type:'fractal_zoom',duration:1,zoom:1e100}]);expect(()=>sceneAtTime(s,1)).toThrow('1e28');
 });
});
