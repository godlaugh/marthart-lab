import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect,afterEach} from 'vitest';
import {SourceSymmetryGradientRuntime} from '../src/engine/sourceSymmetryGradient';
import {sourceIterationPaletteFrame,replaySourceIteratedTimeline,clearSourceIteratedTimelineCache} from '../src/engine/sourceIteratedTimeline';
import {sourceSymmetryPaletteLut,prepareSourceSymmetryPalette} from '../src/engine/sourceSymmetryPalette';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';
import {prepareIteratedFrame} from '../src/scenes/iteratedDensity';
import {gradientAnimationCapabilities} from '../src/engine/gradientOffsets';
import type {SourceGradientConfiguration} from '../src/engine/sourceGradientRuntime';
type Step={action:'start'|'stop'|'frame';config?:{mode:string;interpolation:string;speed:number};eased?:number;finish?:boolean;dt?:number};
type Frame={paletteOffset:number;insideGradientOffset:number;outsideGradientOffset:number;running:boolean;dirty:boolean;lutSha256:string};
const fixture=JSON.parse(readFileSync(new URL('./fixtures/symmetry/gradient-runtime.json',import.meta.url),'utf8')) as {cases:{id:string;document:unknown;offset:number;steps:Step[];frames:Frame[]}[]};
const hash=(values:Float32Array)=>{const bytes=Buffer.alloc(values.length*4);values.forEach((v,i)=>bytes.writeFloatLE(v,i*4));return createHash('sha256').update(bytes).digest('hex');};
const source=(actions:unknown[])=>({config_version:'1.0.0',type:'SYMMETRY_CHAOS',name:'Gradient',settings:{batch_size:8},palette:['#FF0000','#00FF00','#0000FF'],timeline:[{type:'animate',duration:.5,actions},{type:'wait',duration:1}]});
afterEach(clearSourceIteratedTimelineCache);
describe('Symmetry original gradient callbacks and effective LUT',()=>{
 for(const row of fixture.cases)it(row.id+' matches all native offsets and 1024 RGB entries at every display',()=>{
  const scene=parseProjectFile(JSON.stringify(row.document)).scene;scene.palette.offset=row.offset;
  const runtime=new SourceSymmetryGradientRuntime(row.offset);
  row.steps.forEach((step,index)=>{
   if(step.action==='start')runtime.begin([{kind:'start',config:{mode:step.config!.mode.toLowerCase(),interpolation:step.config!.interpolation.toLowerCase(),speed:step.config!.speed} as SourceGradientConfiguration}]);
   else if(step.action==='stop')runtime.begin([{kind:'stop'}]);
   if(step.eased!==undefined)runtime.interpolate(step.eased,step.finish??false);
   runtime.update(step.dt??0);
   const observed=runtime.snapshot(),expected=row.frames[index];
   expect(observed.gradient.running).toBe(expected.running);expect(observed.dirty).toBe(expected.dirty);
   expect(observed.offsets.palette).toBeCloseTo(expected.paletteOffset,14);
   expect(observed.offsets.inside).toBeCloseTo(expected.insideGradientOffset,14);
   expect(observed.offsets.outside).toBeCloseTo(expected.outsideGradientOffset,14);
   expect(hash(sourceSymmetryPaletteLut(scene.palette,runtime.display())),`frame ${index}`).toBe(expected.lutSha256);
  });
 });
 it('imports object/first-array config, scopes targetDomain and preserves raw evidence',()=>{
  const raw=source([{method:'gradientStart',args:{targetDomain:' symmetry_chaos ',mode:'CROSS_FADE',interpolation:'OKLCH',speed:'0x1.2p6',affectInside:false}},{method:'gradientStart',args:[{targetDomain:'FRACTAL'}]},{method:'gradientStart',args:[null,{speed:1}]},{method:'gradientStart',args:null}]);
  const result=parseProjectFile(JSON.stringify(raw)),scene=parseScene(serializeScene(result.scene)),actions=scene.timeline.tracks[0].actions!;
  expect(actions).toHaveLength(2);expect(actions[0].gradient).toMatchObject({model:'offsets',mode:'cross_fade',interpolation:'oklch',speed:72,affectInside:true,affectOutside:true});expect(actions[1].gradient?.speed).toBe(60);
  expect(scene.provenance?.original).toEqual(raw);expect(gradientAnimationCapabilities(scene)).toMatchObject({localPalette:false,offsets:true});
  expect(result.warnings.some(w=>w.includes('既有本地解析'))).toBe(false);
 });
 it('carries one source queue frame through public save/reopen and density job preparation',()=>{
  const scene=parseScene(serializeScene(parseProjectFile(JSON.stringify(source([{method:'gradientStart',args:{mode:'HUE_ROTATE',speed:240}}]))).scene));
  const current=sceneAtTime(scene,.4),frame=sourceIterationPaletteFrame(current)!;
  expect(frame.runtime).toEqual({interpolation:'oklab',cyclic:true});expect(frame.offset).toBeGreaterThan(0);
  const job=prepareIteratedFrame(current,.4,12,scene);expect(job.symmetryPalette).toMatchObject({model:'source-rgb1024',frame});
  expect(job.config.fps).toBe(30);expect(current.evaluatedSourceCamera?.frameIndex).toBe(12);expect(scene.palette.offset).toBe(0);
  const reopened=parseScene(serializeScene(current));expect(sourceIterationPaletteFrame(reopened)).toBeUndefined();
 });
 it('makes lookahead, backward seek and warm replay agree with a fresh queue',()=>{
  const scene=parseProjectFile(JSON.stringify(source([{method:'gradientStart',args:{mode:'PALETTE_MORPH',speed:360}}]))).scene;
  const times=[1.2,0,.2,.3,1,.1,.9],warm=times.map(t=>replaySourceIteratedTimeline(scene,t));
  times.forEach((t,i)=>{clearSourceIteratedTimelineCache();expect(replaySourceIteratedTimeline(scene,t)).toEqual(warm[i]);});
 });
 it('continues gradient updates after the source queue completes',()=>{
  const scene=parseProjectFile(JSON.stringify(source([{method:'gradientStart',args:{mode:'CROSS_FADE',speed:240}}]))).scene;
  const first=replaySourceIteratedTimeline(scene,2),later=replaySourceIteratedTimeline(scene,3);
  expect(first.frame.queueComplete).toBe(true);expect(first.update.calls).toHaveLength(1);expect(later.update.calls).toHaveLength(1);expect(later.palette).not.toEqual(first.palette);
  expect(later.palette.runtime?.cyclic).toBe(true);
 });
 it('reconstructs from owned inputs even after the original caller object is edited',()=>{
  const scene=parseProjectFile(JSON.stringify(source([{method:'gradientStart',args:{speed:120}}]))).scene,unchanged=structuredClone(scene);
  for(const time of [1,.5,.25])replaySourceIteratedTimeline(scene,time);
  scene.palette.offset=.8;
  const reconstructed=replaySourceIteratedTimeline(unchanged,0);clearSourceIteratedTimelineCache();
  expect(reconstructed).toEqual(replaySourceIteratedTimeline(unchanged,0));
 });
 it('rejects mismatched markers, invalid disabled actions and unsupported animated palette extensions',()=>{
  const scene=parseProjectFile(JSON.stringify(source([{method:'gradientStart',args:{}}]))).scene;
  scene.timeline.tracks[0].enabled=false;scene.timeline.tracks[0].actions![0].gradient!.affectInside=false;
  expect(()=>parseScene(serializeScene(scene))).toThrow('同时作用');
  const other=parseProjectFile(JSON.stringify(source([]))).scene;other.settings.symmetryGradientModel='unknown';expect(()=>parseScene(serializeScene(other))).toThrow('源 Symmetry 渐变');
  expect(()=>prepareSourceSymmetryPalette({...other.palette,cycles:2},{offset:0,runtime:{interpolation:'rgb',cyclic:true}})).toThrow('单循环');
 });
});
