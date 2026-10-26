import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {Timeline} from '../src/components/Timeline';
import {parseProjectFile} from '../src/engine/legacyImport';
import {resolveTimeline,timelineWarnings} from '../src/engine/timeline';
import * as cameraReplay from '../src/engine/sourceAttractorReplay';
import {generateSceneAsync,TemporalGenerationSession} from '../src/engine/temporal';
import {executeSourceAttractorWarmup,type SourceAttractorWarmupRequest} from '../src/engine/sourceAttractorWarmup';
import type {SourceAttractorWarmupWorkerPort} from '../src/engine/sourceAttractorWarmupPool';
import type {GenerateContext,SceneOutput} from '../src/types';

// Unmodified shipped input, pinned to the observed packaged failure. No local
// reduction of 500 particles or warmup 250 + stagger 100..5000.
const raw=readFileSync(new URL('./fixtures/source-attractor/dadras-source.json',import.meta.url),'utf8');
const source=()=>parseProjectFile(raw).scene;
const context:GenerateContext={time:0,width:80,height:60,quality:'preview',sourceViewport:{logicalWidth:80,logicalHeight:60,referenceLogicalHeight:60,target:'primary',projectionPass:'perspective'},sourcePointPixelDensity:1};
function geometry(output:SceneOutput){if(output.type!=='geometry')throw Error('geometry expected');return output;}
class CpuPort implements SourceAttractorWarmupWorkerPort {
 onmessage:SourceAttractorWarmupWorkerPort['onmessage']=null;onerror:SourceAttractorWarmupWorkerPort['onerror']=null;onmessageerror:SourceAttractorWarmupWorkerPort['onmessageerror']=null;terminated=false;
 // Real warmup kernel and transferable handoff, simulated scheduling only.
 // Actual browser/nested-worker coverage is a separate public verifier.
 postMessage(data:SourceAttractorWarmupRequest,transfer:Transferable[]){const input=structuredClone(data,{transfer});queueMicrotask(()=>{if(this.terminated)return;const result=executeSourceAttractorWarmup(input);this.onmessage?.({data:structuredClone(result,{transfer:[result.raw.buffer,result.steps.buffer]})} as MessageEvent);});}
 terminate(){this.terminated=true;}
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('source Attractor timeline metadata does not own motion',()=>{
 it('renders the actual Dadras toolbar and authored queue diagnostics without synchronous particle replay',()=>{
  expect(createHash('sha256').update(raw).digest('hex')).toBe('6290bc6032d7d7bad7c24c3df8c52d9ed8d6b3914e91333cbb8dd5d6c74f6c19');
  const s=source(),replay=vi.spyOn(cameraReplay,'replaySourceAttractorCamera');
  expect(s.attractorSource!.configuration).toMatchObject({particleCountCPU:500,warmup:{steps:250,staggerMin:100,staggerMax:5000}});
  expect(resolveTimeline(s).duration).toBeGreaterThan(60);expect(timelineWarnings(s).join()).toContain('固定帧率');
  const html=renderToStaticMarkup(<Timeline scene={s} time={0} playing={false} onTime={()=>{}} onPlay={()=>{}} onRestart={()=>{}} onChange={()=>{}}/>);
  expect(html).toContain('返回起点');expect(html).not.toContain('2000 万');expect(html).not.toContain('disabled=""');expect(replay).not.toHaveBeenCalled();
 });
 it('retains static source sequence warnings and rejects invalid queue fields without evaluating particles',()=>{
  const s=source(),replay=vi.spyOn(cameraReplay,'replaySourceAttractorCamera');s.timeline.tracks[0].start=7;s.timeline.tracks[0].repeat=2;
  const warnings=timelineWarnings(s);expect(warnings.some(w=>w.includes('绝对 start'))).toBe(true);expect(warnings.some(w=>w.includes('repeat/pingPong'))).toBe(true);expect(replay).not.toHaveBeenCalled();
  s.timeline.fps=NaN;expect(()=>timelineWarnings(s)).toThrow();expect(replay).not.toHaveBeenCalled();
 });
 it('replays the full Dadras forward then back through the public async owner, while same-time queries retain motion',async()=>{
  const ports:CpuPort[]=[];vi.stubGlobal('Worker',class extends CpuPort{constructor(){super();ports.push(this);}});
  const s=source(),owner=new TemporalGenerationSession();
  try{
   const first=geometry(await generateSceneAsync(s,context,owner));expect(first.positions).toHaveLength(1500);expect(first.temporal!.recordedPoints).toBe(1500);const initial=ports.length;expect(initial).toBeGreaterThan(1);expect(initial).toBeLessThanOrEqual(4);
   const forward=geometry(await generateSceneAsync(s,{...context,time:1/s.timeline.fps},owner));expect(forward.sourceCameraFrame!.frameIndex).toBe(1);expect(forward.temporal!.recordedPoints).toBe(3000);expect(ports).toHaveLength(initial);
   const restarted=geometry(await generateSceneAsync(s,context,owner));expect(ports).toHaveLength(initial*2);expect(restarted.positions).toEqual(first.positions);expect(restarted.trails).toEqual(first.trails);expect(restarted.sourceCameraFrame).toEqual(first.sourceCameraFrame);expect(restarted.formulaPresentation).toEqual(first.formulaPresentation);
   await generateSceneAsync(s,context,owner);expect(ports).toHaveLength(initial*2);expect(owner.diagnostics().sourceAttractor.constructions).toBe(2);expect(ports.every(p=>p.terminated)).toBe(true);
  }finally{owner.reset();}
 });
});
