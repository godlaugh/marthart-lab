/** Authored fixture adapter shared by Node admission preflight and the browser
 * verifier. It maps independent clip inputs into the public saved schema only;
 * no replay/easing/phase result is computed here. */
export function spirographClockFixture(base,c){
 const scene=structuredClone(base);scene.id='clock-'+c.id;
 const layers=c.layers.map(({closureDegrees,...authored})=>authored);
 Object.assign(scene.settings,{spirographVersion:'mathart-1.7.8-v1',spirographClock:'source-frame-v1',spirographSimulationFps:c.input.clock.fps??60,
  layers:JSON.stringify(layers),spiroView:'native',scale:1,scaleX:1,scaleY:1,offsetX:0,offsetY:0,rotation:0,rotationSpeed:c.input.initialRate??0,
  background:'#000000',backgroundColor:'#000000',count:1800,animate:true,finishTrace:false,traceStartTime:0,
  startEaseEnabled:false,endEaseEnabled:false,fadeInStatorsOnStart:false,fadeOutStatorsOnFinish:false,...c.input.settings});
 scene.spirographFrameEvents=c.input.events??[];
 scene.timeline={...scene.timeline,schedule:'spirograph-sequence-v1',duration:5,tracks:c.input.clips.map((clip,i)=>({
  id:'clip-'+i,type:clip.kind==='rotate'?'animate':clip.kind==='finish-wait'?'spirograph_finish_wait':'wait',enabled:true,
  target:'camera.actions',from:0,to:0,start:0,duration:clip.duration,easing:clip.easing??'linear',
  ...(clip.kind==='finish-wait'?{spirographWait:'visual-or-deadline-v1'}:{}),
  ...(clip.kind==='rotate'?{actions:clip.targetRate===undefined?[]:[{id:'rotation-'+i,method:'spirographRotate',enabled:true,args:{speed:clip.targetRate}}]}:{})
 }))};return scene;
}
