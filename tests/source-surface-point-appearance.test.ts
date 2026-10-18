import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {sourceSurfacePointAppearance,sourceSurfacePointSprite} from '../src/engine/sourceSurfacePointAppearance';
import {createSourceSurfacePoints} from '../src/engine/sourceSurfacePointRenderer';
import {prepareSourceCamera,type SourceCameraPlan} from '../src/engine/sourceCamera';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene,serializeScene} from '../src/engine/document';
import {generateScene} from '../src/engine/temporal';
import {ordinarySourceViewport} from '../src/engine/ordinarySourceCamera';
import golden from './fixtures/source-surface-points/sprite.json';
const F=Math.fround;
function plan(target:'primary'|'offscreen'='primary',height=100):SourceCameraPlan{
 const r=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:100,logicalHeight:height,referenceLogicalHeight:100,target,projectionPass:'perspective'});
 if(!r.ok||r.value.kind!=='known')throw Error('plan');return{...r.value.plan,optics:{...r.value.plan.optics,fov:F(Math.PI/2)}};
}
function imported(settings?:unknown){return parseProjectFile(JSON.stringify({config_version:'1.0.0',type:'SURFACE',name:'Point appearance',equations:{x:'u',y:'v',z:'0'},...(settings===undefined?{}:{settings}),timeline:[{type:'trails'},{type:'wait',duration:1}]}));}
describe('source CPU point appearance ownership',()=>{
 it('matches independently transcribed full 64×64 sprite bytes including the outer transparent black ring',()=>{
  const a=sourceSurfacePointSprite();expect(createHash('sha256').update(a).digest('hex')).toBe(golden.sha256);
  for(const {xy:[x,y],value} of golden.rgba)expect(Array.from(a.slice((y*64+x)*4,(y*64+x)*4+4))).toEqual(value);
  a.fill(0);expect(sourceSurfacePointSprite()[(32*64+32)*4]).toBe(255);
 });
 it('uses primary line scale one regardless of density and retains signed radius',()=>{
  expect(sourceSurfacePointAppearance(2,plan(),2)).toMatchObject({radius:F(1.6),focalLength:50,displayScale:1,referencePixelDensity:2,densityOrigin:'request'});
  expect(sourceSurfacePointAppearance(-2,plan()).radius).toBe(F(-1.6));expect(sourceSurfacePointAppearance(0,plan()).radius).toBe(0);
  expect(sourceSurfacePointAppearance(2,plan(),17).referencePixelDensity).toBe(17);
 });
 it.each(golden.scales)('matches independently derived export scale for density=$density ratio=$ratio',({density,ratio,scale,radiusForTwo})=>{
  expect(sourceSurfacePointAppearance(2,plan('offscreen',ratio*100),density)).toMatchObject({displayScale:scale,radius:radiusForTwo});
 });
 it.each([0,-1,NaN,Infinity,-Infinity])('rejects invalid local density %s',density=>expect(()=>sourceSurfacePointAppearance(2,plan(),density)).toThrow('像素密度'));
 it('labels legacy density omission and rejects nonfinite scalar expansion',()=>{
  expect(sourceSurfacePointAppearance(2,plan())).toMatchObject({referencePixelDensity:1,densityOrigin:'legacy-default-1'});
  for(const size of [NaN,Infinity,1e40,'2'])expect(()=>sourceSurfacePointAppearance(size,plan())).toThrow('半径');
 });
 it('distinguishes absent settings defaults and accepts original numeric conversion without local size clamps',()=>{
  expect(imported().scene.settings.pointSize).toBe(F(1.68));expect(imported({}).scene.settings.pointSize).toBe(2);
  for(const v of ['garbage',false,null])expect(imported({dot_size:v}).scene.settings.pointSize).toBe(2);
  for(const v of [-2,'-2',2000,'0x1.4p2'])expect(imported({dot_size:v}).scene.settings.pointSize).toBe(typeof v==='string'&&v.startsWith('0x')?5:Number(v));
  expect(()=>imported({dot_size:'Infinity'})).toThrow('非有限');
 });
 it('retains authored dot_size numeric tokens and local save/reopen values',()=>{
  const result=imported({dot_size:-2});expect(result.scene.provenance?.sourceNumberTokens).toContainEqual({path:['settings','dot_size'],token:'-2'});
  expect(parseScene(serializeScene(result.scene)).settings.pointSize).toBe(-2);
 });
 it('rejects invalid preview density before replaying an expensive timeline',()=>{
  const s=imported({u_segments:512,v_segments:512,show_trails:false}).scene;
  s.timeline.duration=1200;
  expect(()=>generateScene(s,{time:1200,width:100,height:100,quality:'preview',sourceViewport:ordinarySourceViewport(s,100,100,'primary',100),sourcePointPixelDensity:0})).toThrow('像素密度');
 });
 it('delivers owned appearance and borrows exact particle buffers into bounded instances with owned texture disposal',()=>{
  const s=imported({u_segments:2,v_segments:2,show_trails:false}).scene;
  const out=generateScene(s,{time:0,width:100,height:100,quality:'preview',sourceViewport:ordinarySourceViewport(s,100,100,'primary',100),sourcePointPixelDensity:2});
  if(out.type!=='geometry')throw Error('geometry');expect(out.sourcePointAppearance).toMatchObject({referencePixelDensity:2,densityOrigin:'request'});
  const mesh=createSourceSurfacePoints(out,plan(),1),g=mesh.geometry,m=mesh.material;
  expect(g.instanceCount).toBe(4);expect(g.getAttribute('particlePosition').array).toBe(out.positions);expect(g.getAttribute('particleAlpha').array).toBe(out.pointAlphas);expect(g.index!.count).toBe(6);
  expect(mesh.frustumCulled).toBe(false);expect(m.uniforms.lightDir.value.toArray()).toEqual([0,0,0]);expect(m.uniforms.materialShininess.value).toBe(0);
  let disposed=0;m.uniforms.sprite.value.addEventListener('dispose',()=>disposed++);m.dispose();g.dispose();expect(disposed).toBe(1);
  expect(()=>createSourceSurfacePoints({...out,pointAlphas:new Float32Array([NaN])},plan(),1)).toThrow('缓冲');
 });
});
