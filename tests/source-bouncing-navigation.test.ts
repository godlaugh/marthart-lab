import {describe,it,expect} from 'vitest';
import {SOURCE_BOUNCING_VIEW_MODEL,initialSourceBouncingNavigation,parseSourceBouncingView,sourceBouncingViewFromCamera,sourceBouncingViewInput,sourceBouncingViewMatches,sourceBouncingViewsEqual,setSourceBouncingPaused,editSourceBouncingAngles,navigateSourceBouncing,type SourceBouncingView,type SourceBouncingNavigationEvent,type SourceBouncingNavigationState} from '../src/engine/sourceBouncingNavigation';
import type {SourceBouncingResult} from '../src/engine/sourceBouncingConfig';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
const F=Math.fround;
function value<T>(r:SourceBouncingResult<T>):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
const initial=()=>value(initialSourceBouncingNavigation({phi:0,theta:0,gamma:0}));
const camera=(view=initial().view)=>({phi:view.phi,theta:view.theta,gamma:view.gamma,zoom:view.zoom,center:[0,0,0],focalDistance:20});
const kind=(r:SourceBouncingResult<unknown>)=>r.ok?'success':r.error.kind;
describe('source Bouncing temporary camera owner',()=>{
 it('detaches and freezes validated author angles, state and view without changing author data',()=>{
  const author={phi:F(.1),theta:-0,gamma:2},before={...author},state=value(initialSourceBouncingNavigation(author));
  expect(state).toEqual({view:{model:SOURCE_BOUNCING_VIEW_MODEL,...before,zoom:1},paused:true,savedAngles:before});
  expect(state.savedAngles).not.toBe(author);for(const item of [state,state.view,state.savedAngles])expect(Object.isFrozen(item)).toBe(true);
  author.phi=99;expect(state.view.phi).toBe(before.phi);expect(Object.is(state.view.theta,-0)).toBe(true);
  const detached=value(parseSourceBouncingView(state.view));expect(detached).toEqual(state.view);expect(detached).not.toBe(state.view);
 });
 it('uses source staged Float32 drag operations and leaves gamma unchanged',()=>{
  const start=value(initialSourceBouncingNavigation({phi:F(.12345678),theta:F(123456.789),gamma:F(.7)}));
  // Independent Python struct binary32 evaluation of retained PC717..739.
  const moved=value(navigateSourceBouncing(start,{kind:'drag',dx:16777217,dy:.123456789}));
  expect(moved.view.theta).toBe(-44315.3671875);expect(moved.view.phi).toBe(0.12469135224819183);expect(moved.view.gamma).toBe(start.view.gamma);expect(moved.savedAngles).toEqual(start.savedAngles);
  const another=value(navigateSourceBouncing(start,{kind:'drag',dx:1,dy:-3}));expect(another.view.theta).toBe(123456.78125);expect(another.view.phi).toBe(0.09345678240060806);
 });
 it('accumulates each event rather than evaluating the total drag delta',()=>{
  const start=value(initialSourceBouncingNavigation({phi:0,theta:1,gamma:0}));let current=start;
  for(let i=0;i<100;i++)current=value(navigateSourceBouncing(current,{kind:'drag',dx:1,dy:0}));
  expect(current.view.theta).toBe(6.705522537231445e-7);
  expect(value(navigateSourceBouncing(start,{kind:'drag',dx:100,dy:0})).view.theta).toBe(0);
 });
 it.each([[1,1,0.9523810148239136],[1,-1,1.0499999523162842],[F(.1234567),2.7,0.10821902751922607],[F(123.456),-.25,124.97108459472656]])('widens zoom and 1.05f before pow/product: zoom=%s count=%s',(zoom,count,expected)=>{
  const state={...initial(),view:{...initial().view,zoom}};
  expect(value(navigateSourceBouncing(state,{kind:'wheel',count})).view.zoom).toBe(expected);
 });
 it('clamps native intermediate infinity/underflow and rejects nonfinite input events',()=>{
  expect(value(navigateSourceBouncing(initial(),{kind:'wheel',count:-3e38})).view.zoom).toBe(1000);
  expect(value(navigateSourceBouncing(initial(),{kind:'wheel',count:3e38})).view.zoom).toBe(F(.01));
  for(const count of [Infinity,-Infinity,NaN,1e300])expect(kind(navigateSourceBouncing(initial(),{kind:'wheel',count}))).toBe('nonfinite');
  for(const dx of [Infinity,NaN,1e300])expect(kind(navigateSourceBouncing(initial(),{kind:'drag',dx,dy:0}))).toBe('nonfinite');
  const huge=value(initialSourceBouncingNavigation({phi:F(3.4028234663852886e38),theta:0,gamma:0}));
  expect(kind(navigateSourceBouncing(huge,{kind:'drag',dx:0,dy:3e38}))).toBe('nonfinite');
 });
 it('restores pre-pause angles while retaining zoom; repeated pause is idempotent',()=>{
  let state=initial();const firstView=state.view;
  state=setSourceBouncingPaused(state,false);expect(state.view).toBe(firstView);
  state=value(editSourceBouncingAngles(state,{phi:1,theta:2,gamma:3}));state=setSourceBouncingPaused(state,true);
  expect(state.savedAngles).toEqual({phi:1,theta:2,gamma:3});
  state=value(navigateSourceBouncing(state,{kind:'drag',dx:40,dy:60}));state=value(navigateSourceBouncing(state,{kind:'wheel',count:-2}));
  const zoom=state.view.zoom,pausedAgain=setSourceBouncingPaused(state,true);expect(pausedAgain).toBe(state);
  const resumed=setSourceBouncingPaused(pausedAgain,false);expect(resumed.view).toMatchObject({phi:1,theta:2,gamma:3,zoom});expect(setSourceBouncingPaused(resumed,false)).toBe(resumed);
  expect(kind(navigateSourceBouncing(resumed,{kind:'drag',dx:1,dy:1}))).toBe('input');
 });
 it('paused author angle edits change current view but do not overwrite the native pause snapshot',()=>{
  const state=initial(),author={phi:1,theta:2,gamma:3};
  const edited=value(editSourceBouncingAngles(state,author));expect(edited.view).toMatchObject(author);expect(edited.savedAngles).toEqual(state.savedAngles);
  expect(setSourceBouncingPaused(edited,false).view).toMatchObject({phi:0,theta:0,gamma:0});
  expect(value(initialSourceBouncingNavigation(author)).view).toMatchObject(author);expect(author).toEqual({phi:1,theta:2,gamma:3});
 });
 it('roundtrips complete baseline camera facts without accepting lossy center/focal conversions',()=>{
  const view=value(navigateSourceBouncing(initial(),{kind:'drag',dx:23,dy:37})).view;
  const input=sourceBouncingViewInput(view),prepared=prepareSourceCamera(input,{logicalWidth:320,logicalHeight:240,referenceLogicalHeight:240,target:'primary',projectionPass:'perspective'});
  if(!prepared.ok||prepared.value.kind!=='known')throw Error('camera');
  expect(value(sourceBouncingViewFromCamera(prepared.value.plan.camera.value))).toEqual(view);
  expect(sourceBouncingViewMatches(prepared.value.plan.camera.value,view)).toBe(true);
  for(const raw of [{...camera(),center:[1,0,0]},{...camera(),center:[-0,0,0]},{...camera(),center:new Array(3)},{...camera(),center:[0,0]},{...camera(),focalDistance:21},{...camera(),extra:1}]){
   expect(kind(sourceBouncingViewFromCamera(raw))).toBe('input');expect(sourceBouncingViewMatches(raw,view)).toBe(false);
  }
 });
 it('uses exact view equality including model and signed zero for delivered-frame gates',()=>{
  const view=initial().view;
  expect(sourceBouncingViewsEqual(view,{...view})).toBe(true);
  expect(sourceBouncingViewsEqual(view,{...view,phi:-0})).toBe(false);
  expect(sourceBouncingViewsEqual(view,{...view,model:'other'} as unknown as SourceBouncingView)).toBe(false);
  expect(sourceBouncingViewMatches(camera({...view,zoom:2}),view)).toBe(false);
 });
 it('strictly rejects malformed, non-Float32 and unknown view/state/event facts',()=>{
  const view=initial().view;
  for(const raw of [null,[],{}, {...view,extra:0},{...view,model:'other'},{...view,phi:.1},{...view,zoom:.01},{...view,zoom:0},{...view,zoom:1001}])expect(kind(parseSourceBouncingView(raw))).toBe('input');
  for(const phi of [NaN,Infinity,1e300])expect(kind(parseSourceBouncingView({...view,phi}))).toBe('nonfinite');
  expect(kind(initialSourceBouncingNavigation({...camera(),phi:0}))).toBe('input');
  expect(kind(editSourceBouncingAngles(initial(),{phi:.1,theta:0,gamma:0}))).toBe('input');
  for(const event of [null,{}, {kind:'drag',dx:0,dy:0,extra:1},{kind:'wheel',count:1,dx:2},{kind:'pan',dx:0,dy:0}])expect(kind(navigateSourceBouncing(initial(),event as unknown as SourceBouncingNavigationEvent))).toBe('input');
  expect(kind(navigateSourceBouncing({...initial(),extra:1} as unknown as SourceBouncingNavigationState,{kind:'wheel',count:1}))).toBe('input');
 });
});
