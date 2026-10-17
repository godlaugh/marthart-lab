import {describe,it,expect} from 'vitest';
import type {AnimationTrack,SceneDocument} from '../src/types';
import {sceneAtTime,timelineWarnings} from '../src/engine/timeline';

function rotate(start:number,duration:number,speed:number,easing='linear'):AnimationTrack {
  return{id:crypto.randomUUID(),type:'animate',target:'camera.actions',from:0,to:0,start,duration,easing,pingPong:false,enabled:true,actions:[{id:crypto.randomUUID(),method:'domainRotate',args:{speed}}]};
}
function scene(version:string|undefined,tracks:AnimationTrack[]):SceneDocument {
  return{version:1,id:'domain-rate-test',name:'Domain rate',kind:'domain',equations:{f:'z',next:''},parameters:{},settings:{rotation:0,scale:2.5,...(version?{domainViewportVersion:version}:{})},palette:{name:'test',stops:['#000000','#ffffff'],offset:0,cycles:1,mode:'linear'},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:20,fps:30,loop:false,tracks},favorite:false};
}
const angle=(document:SceneDocument,time:number)=>Number(sceneAtTime(document,time).settings.rotation);
const rate=(document:SceneDocument,time:number)=>(angle(document,time+1e-5)-angle(document,time-1e-5))/2e-5;

describe('source Domain rotation target-rate transitions',()=>{
  it.each(['mathart-1.7.8-cpu','mathart-1.7.8-gpu'])('%s decelerates from the existing rate instead of freezing at target zero',version=>{
    const document=scene(version,[rotate(0,2,2),rotate(4,2,0)]);
    for(const [time,expected] of [[0,0],[1,.5],[2,2],[4,6],[5,7.5],[6,8],[12,8]])expect(angle(document,time)).toBeCloseTo(expected,10);
    expect(rate(document,5)).toBeCloseTo(1,8);
  });
  it('inherits a negative rate and crosses zero continuously',()=>{
    const document=scene('mathart-1.7.8-cpu',[rotate(0,0,-2),rotate(1,2,2)]);
    for(const [time,expected] of [[1,-2],[2,-3],[3,-2],[4,0]])expect(angle(document,time)).toBeCloseTo(expected,10);
    expect(rate(document,1+1e-4)).toBeCloseTo(-1.9998,6);
  });
  it('keeps the existing stable later-start takeover for locally overlapping clips',()=>{
    const document=scene('mathart-1.7.8-gpu',[rotate(0,2,2),rotate(1,2,3)]);
    expect(angle(document,1)).toBeCloseTo(.5,10);
    expect(angle(document,2)).toBeCloseTo(2,10);
    expect(angle(document,3)).toBeCloseTo(4.5,10);
    expect(rate(document,1-1e-4)).toBeCloseTo(.9999,6);
    expect(rate(document,1+1e-4)).toBeCloseTo(1.0001,6);
  });
  it('uses the last enabled target in one source clip, without intermediate target mutation',()=>{
    const clip=rotate(0,0,4,'not-quite-there');
    clip.actions!.push({id:'last',method:'domainRotate',args:{speed:2}},{id:'disabled',enabled:false,method:'domainRotate',args:{speed:100}});
    expect(angle(scene('mathart-1.7.8-cpu',[clip]),1)).toBeCloseTo(1.4,12);
  });
  it('preserves source easing overshoot rather than clamping the speed gain',()=>{
    const document=scene('mathart-1.7.8-cpu',[rotate(0,1,1,'back-out')]);
    // Analytic integral of 1 + 2.70158*(t-1)^3 + 1.70158*(t-1)^2.
    expect(angle(document,1)).toBeCloseTo(1-2.70158/4+1.70158/3,12);
    expect(rate(document,.8)).toBeGreaterThan(1);
    expect(angle(document,2)-angle(document,1)).toBeCloseTo(1,12);
  });
  it('retains the eased endpoint rate when onFinish does not force the target',()=>{
    const document=scene('mathart-1.7.8-gpu',[rotate(0,0,1),rotate(1,2,3,'there-and-back')]);
    expect(angle(document,3)).toBeCloseTo(5,10);
    expect(angle(document,4)-angle(document,3)).toBeCloseTo(1,12);
    const partial=scene('mathart-1.7.8-cpu',[rotate(0,1,2,'not-quite-there')]);
    expect(angle(partial,2)-angle(partial,1)).toBeCloseTo(1.4,12);
  });
  it('retains the local instant convention for a zero-duration rate change',()=>{
    const document=scene('mathart-1.7.8-cpu',[rotate(1,0,2),rotate(3,0,0)]);
    expect(angle(document,1)).toBe(0);expect(angle(document,2)).toBe(2);expect(angle(document,3)).toBe(4);expect(angle(document,10)).toBe(4);
  });
  it('converts authored speed to the source float target without changing stored input',()=>{
    const speed=1.00000006,document=scene('mathart-1.7.8-cpu',[rotate(0,0,speed)]);
    expect(angle(document,1)).toBe(Math.fround(speed));
    expect(document.timeline.tracks[0].actions![0].args!.speed).toBe(speed);
    expect(angle(scene('local-v1',[rotate(0,0,speed)]),1)).toBe(speed);
  });
  it('rejects a finite authored speed that overflows the source float target',()=>{
    expect(()=>angle(scene('mathart-1.7.8-gpu',[rotate(0,1,1e100)]),1)).toThrow('源域旋转速率 必须是有限数值');
  });
  it('does not let a generic camera stopAmbient stop the source mathematical plane',()=>{
    const stop=rotate(2,1,0);stop.actions=[{id:'stop',method:'stopAmbient',args:{}}];
    const document=scene('mathart-1.7.8-cpu',[rotate(0,0,2),stop]);
    expect(angle(document,4)).toBe(8);expect(timelineWarnings(document).some(w=>w.includes('通用相机动作'))).toBe(true);
  });
  it('is independent of query order and survives document serialization without runtime state',()=>{
    const document=scene('mathart-1.7.8-gpu',[rotate(0,2,2,'quad-in'),rotate(3,2,-1,'sine-in-out'),rotate(7,1,0)]),copy=JSON.stringify(document);
    const times=[10,.1,4,0,2.5,7.8,3,10];
    const first=times.map(t=>angle(document,t));
    const cold=JSON.parse(copy) as SceneDocument;
    expect(times.map(t=>angle(cold,t))).toEqual(first);
    expect(times.slice().reverse().map(t=>angle(document,t))).toEqual(first.slice().reverse());
    expect(JSON.stringify(document)).toBe(copy);
  });
  it.each([undefined,'local-v1'])('preserves old local zero-target behavior for %s',version=>{
    const document=scene(version,[rotate(0,2,2),rotate(4,2,0)]);
    expect(angle(document,4)).toBeCloseTo(6,12);expect(angle(document,5)).toBeCloseTo(6,12);expect(angle(document,12)).toBeCloseTo(6,12);
  });
});
