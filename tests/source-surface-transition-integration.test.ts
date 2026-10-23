import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import {sceneAtTime,resolveTimeline} from '../src/engine/timeline';
import {outputBuffers} from '../src/engine/outputBuffers';
import {validateFormulaPresentation,hasFormulaComposition} from '../src/engine/formulaConfig';

function source(mode='POINTS'){
 return{config_version:'1.0.0',type:'SURFACE',name:'Public mode transition',parameters:{a:0},equations:{x:'u+a',y:'v',z:'0'},settings:{surface_mode:mode,render_mode:'CPU',u_segments:2,v_segments:2,mesh_u_segments:3,mesh_v_segments:2,u_min:0,u_max:2,v_min:0,v_max:2,scale_x:1,scale_y:1,scale_z:1,speed_u:1,speed_v:0,show_trails:true,background_color:'#804080C0'},timeline:[{type:'surface_mode_transition',to:'MESH',duration:1,easing:'LINEAR'},{type:'surface_mode_transition',to:'POINTS',duration:.5,easing:'LINEAR'}]};
}
const scene=(raw=source())=>{const s=parseProjectFile(JSON.stringify(raw)).scene;s.timeline.fps=4;return s;};
function output(s:ReturnType<typeof scene>,time:number){const out=generateScene(s,{time,width:96,height:64,quality:'preview',sourceViewport:ordinarySourceViewport(s,96,64,'primary',64)});if(out.type!=='geometry')throw Error('geometry');return out;}
describe('public CPU surface mode transition workflow',()=>{
 it('delivers the final transition after enabled formulas through import, save and replay',()=>{
  const s=scene({...source(),main_equation:{enabled:true,latex:'x',position:[0,0],scale:.5,color:'#FFFFFF'}} as ReturnType<typeof source>);
  const saved=parseScene(serializeScene(s));
  for(const [time,alpha]of [[0,128],[.25,255],[.5,128],[.75,0],[0,128]]){
   const frame=output(saved,time);expect(frame.formulaPresentation!.labels[0].latex).toContain('x = ');
   expect(frame.sourceSurfaceOverlayAlpha).toBe(alpha?undefined:0);
   expect(validateFormulaPresentation(structuredClone(frame.formulaPresentation))).toMatchObject(alpha?{finalBlackOverlayAlpha:alpha}:{});
   expect(hasFormulaComposition(frame.formulaPresentation)).toBe(true);
  }
  saved.formulas!.main.visible=false;
  expect(output(saved,0)).toMatchObject({sourceSurfaceOverlayAlpha:128,formulaPresentation:{labels:[]}});
 });
 it('rejects malformed final overlays and preserves an explicit empty-label overlay',()=>{
  const base={layout:'source-surface-centered-v1',primaryLogicalHeight:64,labels:[]};
  for(const alpha of [-1,256,.5,NaN,'128'])expect(()=>validateFormulaPresentation({...base,finalBlackOverlayAlpha:alpha})).toThrow('遮罩');
  expect(()=>validateFormulaPresentation({referenceWidth:64,referenceHeight:64,labels:[],finalBlackOverlayAlpha:128})).toThrow('遮罩');
  expect(hasFormulaComposition(validateFormulaPresentation({...base,finalBlackOverlayAlpha:128}))).toBe(true);
  expect(hasFormulaComposition(validateFormulaPresentation(base))).toBe(false);
  expect(()=>hasFormulaComposition({...base,layout:'source-surface-centered-v1',finalBlackOverlayAlpha:-1})).toThrow('遮罩');
 });
 it('imports both modes into one configuration and replays matching camera/geometry/overlay through save and backward seek',()=>{
  const original=scene(),saved=serializeScene(original),s=parseScene(saved);
  expect(s.surfaceSource).toMatchObject({mode:'points',points:{uSegments:2},mesh:{uSegments:3}});
  for(const [time,mode,alpha]of [[0,'points',128],[.25,'mesh',255],[.5,'mesh',128],[.75,'mesh',0],[1,'points',255],[1.25,'points',0],[.25,'mesh',255]] as const){
   const out=output(s,time);expect(out.topology).toBe(mode);expect(out.sourceSurfaceOverlayAlpha).toBe(alpha);expect(out.sourceBackgroundColor).toBe(0x804080c0);
   expect(out.sourceCameraFrame!.camera).toEqual(sceneAtTime(s,time).evaluatedSourceCamera!.camera);
   expect(mode==='mesh'?out.sourceMeshAppearance:out.sourcePointAppearance).toBeDefined();
   structuredClone(out,{transfer:outputBuffers(out)});
  }
  expect(serializeScene(s)).toBe(saved);expect(resolveTimeline(s).duration).toBe(1.5);
 });
 it('preserves same-mode queue timing after import without rewriting the authored duration',()=>{
  const s=scene(source('MESH')),layout=resolveTimeline(s);
  expect(s.timeline.tracks[0].duration).toBe(1);expect(layout.tracks[0].duration).toBe(.25);
  expect(output(s,0).sourceSurfaceOverlayAlpha).toBe(0);expect(output(s,.25).topology).toBe('points');
 });
 it('uses original target fallback, duration fallback and fixed JSON fade ratio while retaining unconsumed fields',()=>{
  const raw=source('MESH');raw.timeline=[{type:'surface_mode_transition',to:' unknown ',duration:-1,easing:'LINEAR'}];
  const imported=parseProjectFile(JSON.stringify({...raw,timeline:raw.timeline.map(t=>({...t,fadeOutRatio:.1}))})).scene;
  expect(imported.timeline.tracks[0]).toMatchObject({surfaceMode:'points',duration:1});expect(imported.timeline.tracks[0].surfaceFadeOutRatio).toBeUndefined();
  expect((imported.provenance!.original as {timeline:{fadeOutRatio:number}[]}).timeline[0].fadeOutRatio).toBe(.1);
  for(const to of [' mesh ','\u00a0MESH\u00a0','']){const s=scene({...raw,timeline:[{...raw.timeline[0],to}]});expect(s.timeline.tracks[0].surfaceMode).toBe(to===' mesh '?'mesh':'points');}
 });
 it('migrates mesh-only saved files once, preserving edits instead of reconstructing from provenance',()=>{
  const s=scene(source('MESH'));s.timeline.tracks=[];s.surfaceSource!.mesh.fillOpacity=.123;
  const old=JSON.parse(serializeScene(s));old.surfaceSourceMesh=old.surfaceSource;delete old.surfaceSource;old.settings.surfaceGeometryVersion='mathart-1.7.8-mesh-v1';
  const migrated=parseScene(JSON.stringify(old));expect(migrated.surfaceSource!.mesh.fillOpacity).toBe(.123);
  expect(serializeScene(migrated)).not.toContain('surfaceSourceMesh');expect(output(migrated,0).topology).toBe('mesh');
  expect(()=>parseScene(JSON.stringify({...old,surfaceSource:s.surfaceSource}))).toThrow('冲突');
 });
 it('uses canonical fields even when unused legacy controls disagree and invalidates the timeline cache on mode changes',()=>{
  const s=scene();s.settings.renderMode='mesh';s.settings.uSegments=-99;
  const reopened=parseScene(serializeScene(s));expect(output(reopened,0).topology).toBe('points');
  const first=sceneAtTime(s,0);expect(first.surfaceSource!.mode).toBe('points');s.surfaceSource!.mode='mesh';
  expect(sceneAtTime(s,0).surfaceSource!.mode).toBe('mesh');expect(output(s,0).sourceSurfaceOverlayAlpha).toBe(0);
 });
 it('admits every reachable mode before playback and leaves disabled transitions inert',()=>{
  const raw=source('MESH');raw.settings.u_segments=0;
  expect(()=>scene(raw)).toThrow('1–512');
  const disabled={...raw,timeline:raw.timeline.map(t=>({...t,enabled:false}))};const imported=parseProjectFile(JSON.stringify(disabled)).scene;
  expect(imported.surfaceSource!.points.uSegments).toBe(0);expect(output(imported,0).topology).toBe('mesh');
 });
});
