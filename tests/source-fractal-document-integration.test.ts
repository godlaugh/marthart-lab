import {expect,it} from 'vitest';
import fixture from './fixtures/source-fractal-runtime/source.json';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene,persistentScene} from '../src/engine/document';
import {sceneAtTime,resolveTimeline,createAnimationTrack} from '../src/engine/timeline';
import {prepareSourceFractalScene} from '../src/engine/sourceFractalTimeline';
import {SourceFractalSceneRuntime} from '../src/engine/sourceFractalSceneRuntime';
const original=(timeline:unknown[]=[],fractal:Record<string,unknown>={})=>({config_version:'1.0.0',type:'FRACTAL',name:'source scene',fractal:{formula_id:'newton',parameters:fixture.initialInput.parameters,...fractal},timeline});
const load=(timeline:unknown[]=[],fractal:Record<string,unknown>={})=>parseScene(serializeScene(parseProjectFile(JSON.stringify(original(timeline,fractal))).scene));
for(const c of fixture.cases)it(`imports/saves/reopens original complete Fractal chain ${c.id}`,()=>{
 const scene=load(c.input.timeline);scene.timeline.fps=60;
 scene.fractalSourceColor!.palette.offset=.125;scene.fractalSourceColor!.inside.offset=-.25;scene.fractalSourceColor!.outside.offset=.375;
 const runtime=new SourceFractalSceneRuntime(prepareSourceFractalScene(scene),{reserve(){}});
 for(const row of c.frames){runtime.clock.step(row.rawStep.value,row.paused);const frame=runtime.snapshot(),expected=row.state;
  expect(frame.scene.queueIndex).toBe(expected.managerIndex);expect(frame.scene.queueComplete).toBe(expected.managerFinished);expect(frame.scene.sceneTime).toBe(expected.sceneTime.value);
  expect(frame.scene.object.bailout).toBe(expected.fractalProperties.bailout.value);expect(frame.scene.object.juliaReal).toBe(expected.fractalProperties.juliaCx.value);expect(frame.scene.object.juliaImag).toBe(expected.fractalProperties.juliaCy.value);
  expect(frame.formula.native.power).toBe(expected.formula.power);expect(frame.formula.native.formulaParams).toEqual(expected.formula.formulaParams.map(v=>v.value));expect(frame.formula.native.dynamicParams).toEqual(expected.formula.dynamicParams.map(v=>v.value));
  expect(frame.offsets).toEqual(Object.fromEntries(['palette','inside','outside'].map((key,i)=>[key,expected.gradient.offsets[i].value])));
 }
});
it('keeps fresh source defaults and ignored initial DD extensions separate from target DD',()=>{
 const scene=load([{type:'fractal_zoom',duration:1,center_hi_lo:[1,1e-20,2,-1e-20]}],{center_hi_lo:[3,1e-20,4,1e-20],rotation:.1,iterations:'2+3'});
 expect(scene.settings).toMatchObject({centerX:0,centerY:0,centerXLow:0,centerYLow:0,rotation:Math.fround(.1),iterations:5,zoom:1});
 expect(scene.timeline.tracks[0].sourceFractalZoom).toMatchObject({centerX:1,centerXLow:1e-20,centerY:2,centerYLow:-1e-20});
 const prepared=prepareSourceFractalScene(scene);expect(prepared.initial.rotationRate).toBe(0);expect(prepared.initial.ambientRates).toEqual([0,0,0]);expect(prepared.cameraAngles).toEqual([Math.fround(Math.PI/2),0,0]);
});
it('keeps native parameter presence and legacy values without reverse mapping authored settings',()=>{
 const scene=load([],{parameters:undefined,bailout:9,power:7});const frame=sceneAtTime(scene,0);
 expect(scene.fractalSource!.formula.parameters).toBeUndefined();expect(frame.evaluatedFractalScene!.formula.native).toMatchObject({power:7,bailout:9,dynamicParams:Array(32).fill(0)});
 expect(scene.evaluatedFractalScene).toBeUndefined();expect(persistentScene(frame).evaluatedFractalScene).toBeUndefined();expect(parseScene(serializeScene(scene)).fractalSource).toEqual(scene.fractalSource);
});
it('routes standalone param and unknown clips to waits and preserves zero-length queue items',()=>{
 const scene=load([{type:'param',duration:0,parameters:{exponent:{min:2,max:4,step:.1}}},{type:'hold',duration:.1},{type:'animate',duration:.1,actions:[]},{enabled:false},{type:'future'}]);
 expect(scene.timeline.tracks.map(t=>[t.type,t.duration])).toEqual([['wait',0],['wait',Math.fround(.1)],['animate',Math.fround(.1)],['wait',1]]);
 expect(sceneAtTime(scene,0).evaluatedFractalScene!.scene.queueIndex).toBe(1);expect(resolveTimeline(scene).tracks[1].start).toBe(1/scene.timeline.fps);
 expect(createAnimationTrack(scene,'animate').fractalSource).toBeDefined();expect(()=>createAnimationTrack(scene,'param')).toThrow('只支持');
});
it('rejects malformed source payloads and mixed local actions even on disabled clips',()=>{
 const scene=load([{type:'animate',duration:1,actions:[]}]);
 for(const patch of [{actions:[]},{fractalSource:{...scene.timeline.tracks[0].fractalSource,extra:1}},{fractalSource:{model:'mathart-1.7.8-actions-v1',targets:{},parameters:[{kind:'start',scope:{kind:'named',name:'exponent'}}]}}]){
  const bad=structuredClone(scene);Object.assign(bad.timeline.tracks[0],patch,{enabled:false});expect(()=>parseScene(JSON.stringify(bad))).toThrow();expect(()=>sceneAtTime(bad,0)).toThrow();
 }
});
it('rebuilds fixed frame state on backwards seek and retains actual parameter writes',()=>{
 const scene=load(fixture.cases[1].input.timeline);const first=sceneAtTime(scene,0),later=sceneAtTime(scene,.15);expect(later.evaluatedFractalScene!.formula.parameters).not.toEqual(first.evaluatedFractalScene!.formula.parameters);
 expect(sceneAtTime(scene,0).evaluatedFractalScene).toEqual(first.evaluatedFractalScene);
 expect(()=>sceneAtTime(scene,.2,{isCancelled:()=>true})).toThrow(expect.objectContaining({name:'AbortError'}));expect(()=>sceneAtTime(scene,.2)).not.toThrow();
});

it('bounds aggregate actions before constructing a runtime, including disabled payloads',()=>{
 const scene=load([{type:'animate',duration:1,actions:[]},{type:'animate',duration:1,actions:[]}]);
 for(const track of scene.timeline.tracks)track.fractalSource!.parameters=Array.from({length:2049},()=>({kind:'stop' as const,scope:{kind:'all' as const}}));
 scene.timeline.tracks[1].enabled=false;
 expect(()=>prepareSourceFractalScene(scene)).toThrow('共享容量');expect(()=>resolveTimeline(scene)).toThrow('共享容量');
});
it('reuses only valid timing layouts and invalidates duration, enabled and fps inputs',()=>{
 const scene=load([{type:'wait',duration:.1},{type:'wait',duration:.2}]);scene.timeline.fps=30;
 const first=resolveTimeline(scene);expect(resolveTimeline(scene)).toEqual(first);
 scene.timeline.tracks[1].id='new-identity';expect(resolveTimeline(scene).tracks[1]).toMatchObject({id:'new-identity',start:first.tracks[1].start});
 scene.timeline.tracks[0].duration=.2;expect(resolveTimeline(scene).tracks[1].start).toBeGreaterThan(first.tracks[1].start);
 scene.timeline.fps=60;const next=resolveTimeline(scene);expect(next.tracks[1].start).not.toBe(first.tracks[1].start);
 scene.timeline.tracks[0].enabled=false;expect(resolveTimeline(scene).tracks[1].start).toBe(0);
 scene.timeline.tracks[0].duration=NaN;expect(()=>resolveTimeline(scene)).toThrow('时长');
});
