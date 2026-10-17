import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import baseline from './fixtures/spirograph/local-1803.json';
import {parseSpirographVersion,prepareSpirographProjection} from '../src/engine/spirographModel';
import {createDefaultSpirographLayer,prepareSpirograph,samplePreparedSpirographLayer,generateLayeredSpirograph,estimateSpirographCompletion,spirographVisualCompletion} from '../src/scenes/spirograph';
import {definitions} from '../src/scenes/particles';
import type {SceneDocument,Settings} from '../src/types';
const l=(extra={})=>({...createDefaultSpirographLayer(),statorRadius:24,rotors:[{radius:8,mode:'inside' as const}],penDistance:5,speed:6,showGuides:false,...extra});
const settings=(layers=[l()],extra:Settings={}):Settings=>({spirographVersion:'mathart-1.7.8-v1',layers:JSON.stringify(layers),spiroView:'native',count:800,transparentBackground:true,animate:true,...extra});
const scene=(s=settings()):SceneDocument=>({...baseline.base,settings:s} as unknown as SceneDocument);
const raster=(s:Settings,time:number,more:Partial<SceneDocument>={})=>{const out=generateLayeredSpirograph({...scene(s),...more},{width:161,height:121,time,quality:'preview'});if(out.type!=='raster')throw Error('Expected raster');return out.pixels;};
const alpha=(p:Uint8ClampedArray)=>p.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);
const close=(a:readonly number[],b:readonly number[],digits=9)=>a.forEach((v,i)=>expect(v).toBeCloseTo(b[i],digits));
describe('versioned Spirograph ownership',()=>{
 it('keeps 24 pre-change local rasters, sampling and draw ordering exactly',()=>{
  for(const row of baseline.rows){const doc={...baseline.base,settings:{...baseline.base.settings,...row.settings}} as unknown as SceneDocument;
   for(const version of [undefined,'local-v1']){const out=generateLayeredSpirograph({...doc,settings:{...doc.settings,...(version===undefined?{}:{spirographVersion:version})}},{width:83,height:67,time:row.time,quality:'preview'});if(out.type!=='raster')throw Error('raster');expect(createHash('sha256').update(out.pixels).digest('hex')).toBe(row.sha256);expect(out.stats.samples).toBe(row.samples);expect(out.stats.generated).toBe(row.generated);}
  }
 });
 it('does not reinterpret omission, unknown versions or source single-chain input',()=>{
  expect(parseSpirographVersion(undefined)).toBe('local-v1');for(const value of [null,'native','',1])expect(()=>parseSpirographVersion(value)).toThrow();
  const def=definitions.find(x=>x.kind==='spirograph')!;expect(()=>def.generate(scene({spirographVersion:'mathart-1.7.8-v1',layers:''}),{width:50,height:50,time:0,quality:'preview'})).toThrow('图层');
 });
 it('caches structural facts without mutation or dynamic-transform keys',()=>{
  const s=settings(),a=prepareSpirograph(s);expect(prepareSpirograph({...s,rotation:90,offsetY:30})).toBe(a);expect(()=>{a.layers[0].layer.speed=99;}).toThrow();expect(prepareSpirograph(settings([l({speed:7})]))).not.toBe(a);
 });
});
describe('native recurrence and one coordinate conversion',()=>{
 it('matches independent inside/outside/mixed cumulative-double coordinates',()=>{
  for(const rotors of [[{radius:8,mode:'inside' as const}],[{radius:8,mode:'outside' as const}],[{radius:8,mode:'outside' as const},{radius:3,mode:'inside' as const},{radius:2,mode:'outside' as const}]]){
   const layer=l({rotors}),plan=prepareSpirograph(settings([layer])),theta=.713;let parent=24,previousSpin=0,previousMode='inside',direction=1,draw=0,spin=0,x=0,y=0,last=0;
   for(let i=0;i<rotors.length;i++){const r=rotors[i],inside=r.mode==='inside',pitch=parent/r.radius+(inside?-1:1),step=i===0?1:previousSpin;direction=i===0?1:previousMode==='inside'?direction:-direction;const center=(step+draw)*direction;draw+=step;last=(pitch+spin)*direction*(inside?-1:1);spin+=pitch;const radius=parent+(inside?-r.radius:r.radius);x+=radius*Math.cos(theta*center);y-=radius*Math.sin(theta*center);parent=r.radius;previousSpin=pitch;previousMode=r.mode;}
   x+=5*Math.cos(theta*last);y-=5*Math.sin(theta*last);const raw=samplePreparedSpirographLayer(plan.layers[0],theta).pen;close([raw[0],-raw[1]],[x,y]);
  }
 });
 it('uses native pixels, down-positive offsets and clockwise degrees independently of phase',()=>{
  const p=(extra:Settings={})=>prepareSpirographProjection(scene(settings([l()],extra)),0,200,100,50).project;
  close(p()([10,20]),[110,30]);close(p({offsetX:7,offsetY:9})([10,20]),[117,39]);close(p({rotation:90})([10,0]),[100,60],5);close(p({rotation:90,scale:2,offsetX:7,offsetY:9})([10,0]),[107,79],5);
 });
 it('takes evaluated rotation as an increment overriding rate×time and preserves base degrees',()=>{
  const s=settings([l()],{rotation:30,rotationSpeed:4}),doc=scene(s),a=prepareSpirographProjection({...doc,evaluatedSpirographRotationRadians:.7},5,200,100,50).project([20,0]),b=prepareSpirographProjection({...doc,settings:{...s,rotationSpeed:0},evaluatedSpirographRotationRadians:.7},99,200,100,50).project([20,0]);close(a,b);expect(s.rotation).toBe(30);expect(()=>prepareSpirographProjection({...doc,evaluatedSpirographRotationRadians:Infinity},0,200,100,50)).toThrow();
 });
 it('preserves denominator closure even for zero-amplitude and stationary chains',()=>{
  expect(prepareSpirograph(settings([l({statorRadius:8,penDistance:0})])).layers[0].closureTurns).toBe(1);expect(prepareSpirograph(settings([l({statorRadius:100,rotors:[{radius:23.5,mode:'inside'}],penDistance:0})])).layers[0].closureTurns).toBe(47);expect(prepareSpirograph(settings([l({rotors:[{radius:Math.SQRT2,mode:'inside'}]})])).layers[0].closureTurns).toBeGreaterThan(0);
 });
});
describe('one source replay clock for phase, guides and waits',()=>{
 it('advances one layer per frame without carrying leftover dt',()=>{
  const plan=prepareSpirograph(settings([l({id:'a',speed:1000}),l({id:'b',speed:1000})])),first=plan.sourceMotion!.sample(1/60);expect(first.phases).toEqual([360,0]);expect(first.endSeconds).toEqual([1/60,null]);const second=plan.sourceMotion!.sample(2/60);expect(second.phases).toEqual([360,360]);expect(second.startSeconds).toEqual([0,1/60]);expect(second.geometrySeconds).toBe(2/60);
 });
 it('keeps queries/backseek deterministic and source dt rounded once to float',()=>{
  const plan=prepareSpirograph(settings([l({autoStopOnClosure:false,speed:.7})])),at=plan.sourceMotion!.sample(.5);expect(at.phases[0]).toBeCloseTo(.7*60*Math.fround(1/60)*30,12);plan.sourceMotion!.sample(5);expect(plan.sourceMotion!.sample(.5)).toEqual(at);expect(plan.sourceMotion!.sample(.509).phases).toEqual(at.phases);
 });
 it('uses adaptive duration and staged float SINE rather than the local easeDuration',()=>{
  const s=settings([l({autoStopOnClosure:false,speed:1.65})],{startEaseEnabled:true,endEaseEnabled:true,easeDuration:0}),plan=prepareSpirograph(s),dt=Math.fround(1/60),q=Math.fround(dt/.85),angle=Math.fround(Math.fround(q*Math.fround(Math.PI))/2),scale=Math.fround(1-Math.fround(Math.cos(angle)));
  expect(plan.sourceMotion!.sample(1/60).phases[0]).toBe((1.65*60)*dt*scale);expect(prepareSpirograph({...s,easeDuration:9}).sourceMotion!.sample(1/60).phases[0]).toBe(plan.sourceMotion!.sample(1/60).phases[0]);
 });
 it('uses a global guide fade, including visible disabled and future layers',()=>{
  const s=settings([l({id:'a',showGuides:true,speed:1000}),l({id:'b',speed:1000}),l({id:'disabled',enabled:false,showGuides:true})],{fadeOutStatorsOnFinish:true}),plan=prepareSpirograph(s);expect(plan.sourceMotion!.sample(1/60).guideOpacity).toBe(1);expect(plan.sourceMotion!.sample(2/60).guideOpacity).toBeLessThan(1);const done=plan.sourceMotion!.sample(1);expect(done.geometrySeconds).toBe(2/60);expect(done.visualSeconds).toBe(37/60);expect(done.guideOpacity).toBe(0);expect(spirographVisualCompletion(s,.5)).toBeNull();expect(spirographVisualCompletion(s,1)).toBe(done.visualSeconds);expect(estimateSpirographCompletion(s,1).totalSeconds).toBe(done.visualSeconds);
 });
 it('bounds non-closing/paused waits and distinguishes cancellation from capacity',()=>{
  for(const extra of [{autoStopOnClosure:false},{speed:0}])expect(spirographVisualCompletion(settings([l(extra)]),1200)).toBeNull();const motion=prepareSpirograph(settings([l({autoStopOnClosure:false})])).sourceMotion!;expect(()=>motion.sample(86401)).toThrow('容量');try{motion.sample(2000,()=>true);throw Error('must cancel');}catch(e){expect((e as Error).name).toBe('AbortError');}
 });
 it('does not migrate historical local guide-padding wait estimates',()=>{
  const s=settings([l({id:'a',showGuides:true}),l({id:'b'})],{spirographVersion:'local-v1',fadeOutStatorsOnFinish:true});expect(estimateSpirographCompletion(s).totalSeconds).toBe(2.6);
 });
 it('replays a persisted finish event, snaps only finite enabled layers and retains the global fade',()=>{
  const s=settings([l({id:'a'}),l({id:'b'}),l({id:'disabled',enabled:false,showGuides:true})],{traceFinishTime:.201,fadeOutStatorsOnFinish:true}),motion=prepareSpirograph(s).sourceMotion!;
  expect(motion.sample(.2).phases[0]).toBeLessThan(360);const at=motion.sample(.201);expect(at.phases).toEqual([360,360,0]);expect(at.geometrySeconds).toBe(.201);expect(at.guideOpacity).toBe(1);expect(at.visualSeconds).toBeNull();const done=motion.sample(1);expect(done.visualSeconds).toBe(.8);expect(motion.sample(.201)).toEqual(at);expect(spirographVisualCompletion(s,.5)).toBeNull();expect(spirographVisualCompletion(s,1)).toBe(.8);
  expect(raster(s,.201)).not.toEqual(raster(s,.2));expect(raster(s,1)).toEqual(raster(s,2));
 });
 it('holds infinite motion after a finish event without pretending it closed, and restart supersedes the event',()=>{
  const s=settings([l({autoStopOnClosure:false,showGuides:true})],{traceFinishTime:.2,fadeOutStatorsOnFinish:true}),motion=prepareSpirograph(s).sourceMotion!,at=motion.sample(.2);expect(motion.sample(10).phases).toEqual(at.phases);expect(motion.sample(10).geometrySeconds).toBeNull();expect(spirographVisualCompletion(s,1200)).toBeNull();
  const restarted={...s,traceStartTime:2};expect(raster(restarted,2.2)).toEqual(raster(settings([l({autoStopOnClosure:false,showGuides:true})],{fadeOutStatorsOnFinish:true}),.2));
 });
 it('treats legacy preview overrides as immediately complete without labeling them a native finish event',()=>{
  for(const override of [{finishTrace:true},{animate:false}] as Settings[]){const s=settings([l({autoStopOnClosure:false})],override);expect(spirographVisualCompletion(s,0)).toBe(0);expect(estimateSpirographCompletion(s,0).totalSeconds).toBe(0);expect(alpha(raster(s,0))).toBeGreaterThan(0);}
 });
});
describe('production raster consumes source phase and projection',()=>{
 it('moves down-positive and rotates a line 90 degrees through its center',()=>{
  const liner=l({statorRadius:30,rotors:[{radius:15,mode:'inside'}],penDistance:15,strokeColor:'#ff0000'}),s=settings([liner],{animate:false});const bounds=(p:Uint8ClampedArray)=>{const xs:number[]=[],ys:number[]=[];for(let i=3;i<p.length;i+=4)if(p[i]){xs.push(((i-3)/4)%161);ys.push(Math.floor((i-3)/4/161));}return{minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};};const a=bounds(raster(s,0)),down=bounds(raster({...s,offsetY:7},0)),turn=bounds(raster({...s,rotation:90},0));expect(down.minY-a.minY).toBe(7);expect(a.maxX-a.minX).toBeGreaterThan(50);expect(a.maxY-a.minY).toBeLessThan(3);expect(turn.maxY-turn.minY).toBeGreaterThan(50);expect(turn.maxX-turn.minX).toBeLessThan(3);
 });
 it('renders disabled/future guides immediately and fades after all geometry ends',()=>{
  const s=settings([l({id:'a',speed:1000,showGuides:true}),l({id:'b',speed:1000,statorRadius:16})],{showTrace:false,fadeOutStatorsOnFinish:true});expect(alpha(raster(s,0))).toBeGreaterThan(0);expect(alpha(raster(s,1/60))).toBeGreaterThan(0);expect(alpha(raster(s,37/60))).toBe(0);expect(raster(s,37/60)).toEqual(raster(s,2));expect(alpha(raster(settings([l({enabled:false,showGuides:true})],{showTrace:false}),0))).toBeGreaterThan(0);
 });
 it('starts with no ink and produces identical backseek/restart frames',()=>{
  const s=settings();expect(alpha(raster(s,0))).toBe(0);expect(alpha(raster(s,.2))).toBeGreaterThan(0);const before=raster(s,.2);raster(s,10);expect(raster(s,.2)).toEqual(before);expect(raster({...s,traceStartTime:2},2.2)).toEqual(before);
 });
 it('retains the same phase and future frames when a fixed clear query follows every render',()=>{
  const s=settings([l({autoStopOnClosure:false,showGuides:true})]),cleared={...s,traceClearTime:.5};
  for(const t of [1,1.1,1.2,.25,2])expect(raster({...cleared,showTrace:false},t)).toEqual(raster({...s,showTrace:false},t));
  expect(raster(cleared,.25)).toEqual(raster(s,.25));expect(raster(cleared,1)).not.toEqual(raster(s,1));const frame=raster(cleared,1.2);raster(cleared,8);expect(raster(cleared,1.2)).toEqual(frame);
 });
});
