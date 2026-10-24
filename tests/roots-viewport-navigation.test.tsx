import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {isValidElement,type ComponentProps,type ReactElement,type ReactNode} from 'react';
import {Viewport} from '../src/components/Viewport';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {captureRootsRuntimeNavigation,withRootsPresentation} from '../src/engine/rootsPresentationAuthoring';
import {RootsSceneClock} from '../src/engine/rootsSceneClock';
import type {RootsLiveFacts} from '../src/engine/rootsLive';
import type {SceneOutput} from '../src/types';

// Execute the production Viewport event handlers and retain hook slots across
// rerenders. DOM and renderer are narrow doubles; real canvas/Worker acceptance
// belongs to the separate App verifier, not this event-ownership regression.
const hooks=vi.hoisted(()=>({slots:[] as any[],index:0,effects:[] as (()=>void)[]}));
vi.mock('react',async load=>({...await load<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.slots))hooks.slots[i]=typeof initial==='function'?initial():initial;return[hooks.slots[i],(v:unknown)=>{hooks.slots[i]=typeof v==='function'?v(hooks.slots[i]):v;}];},
 useRef:(initial:unknown)=>{const i=hooks.index++;if(!(i in hooks.slots))hooks.slots[i]={current:initial};return hooks.slots[i];},
 useImperativeHandle:()=>{hooks.index++;},
 useEffect:(effect:()=>void|(()=>void),deps:unknown[])=>{const i=hooks.index++,previous=hooks.slots[i];if(!previous||deps.some((v,j)=>!Object.is(v,previous.deps[j]))){hooks.effects.push(()=>{previous?.cleanup?.();hooks.slots[i]={deps,cleanup:effect()};});}},
}));
vi.mock('../src/i18n',()=>({useI18n:()=>({t:(s:string)=>s})}));
vi.mock('../src/engine/renderer',()=>({ArtRenderer:class{
 onCamera(){}setOutput(){}setInteractive(){}dispose(){}
 cameraState(){return{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1,autoFit:false};}
}}));
vi.mock('../src/engine/sourceNativeViewport',()=>({usesNativeSourceViewport:()=>false,SourceNativeViewport:class{}}));
type Props=ComponentProps<typeof Viewport>;
class Canvas {
 clientWidth=200;clientHeight=100;style={display:''};parentElement={};
 listeners=new Map<string,(event:any)=>void>();
 addEventListener(name:string,handler:(event:any)=>void){this.listeners.set(name,handler);}
 removeEventListener(name:string){this.listeners.delete(name);}
 setPointerCapture(){}
 fire(name:string,values:Record<string,unknown>={}){this.listeners.get(name)?.({pointerId:1,button:0,clientX:0,clientY:0,deltaY:0,deltaMode:0,preventDefault:()=>{},...values});}
}
const camera={phi:.25,theta:.5,gamma:.75,zoom:2};
function output():Extract<SceneOutput,{type:'raster'}>{
 const presentation=defaultRootsPresentationConfiguration();presentation.previewMode='live-worker-arrival-v1';presentation.camera={...presentation.camera,phi:-7,theta:-8,gamma:-9,zoom:9};
 return{type:'raster',width:200,height:100,pixels:new Uint8ClampedArray(200*100*4),stats:{samples:0,generated:0,invalid:0,elapsedMs:0},
  rootsPresentation:{model:'mathart-1.7.8-v1',mode:'density',clockPolicy:'source-live-clock-v1',streamPolicy:'worker-arrival',presentationAlpha:'opaque-framebuffer-rgb',instance:1,restartReason:null,attemptedSamples:0,newSamples:0,newRawPoints:0,totalRawPoints:0,physicalSize:[200,100],logicalSize:[200,100],referenceLogicalHeight:100,target:'primary'},
  // Unused sampler/record-completion fields are deliberately not simulated.
  rootsLive:{sessionId:'running-roots',paused:true,presentation,frame:new RootsSceneClock(camera,[]).snapshot()} as RootsLiveFacts,
 };
}
function author(){const scene=withRootsPresentation(createScene(definition('roots')),defaultRootsPresentationConfiguration());scene.rootsPresentation!.previewMode='live-worker-arrival-v1';scene.rootsPresentation!.camera={...scene.rootsPresentation!.camera,phi:90,theta:80,gamma:70,zoom:60};return scene;}
function attach(node:ReactNode,canvas:Canvas,native:Canvas):void{
 if(Array.isArray(node)){node.forEach(n=>attach(n,canvas,native));return;}if(!isValidElement(node))return;
 const element=node as ReactElement<Record<string,any>>;if(element.type==='canvas')element.props.ref.current=element.props['data-testid']==='art-canvas'?canvas:native;attach(element.props.children,canvas,native);
}
function mount(patch:Partial<Props>={}){
 const canvas=new Canvas(),native=new Canvas();let props:Props={scene:author(),output:output(),playing:false,planeFrameReady:true,time:0,rootsInteractionEpoch:4,onRootsNavigate:vi.fn(()=>true),onRootsPresentation:vi.fn(()=>undefined),...patch};
 const rerender=(changes:Partial<Props>={})=>{props={...props,...changes};hooks.index=0;const tree=(Viewport as unknown as {render:(props:Props,ref:null)=>ReactNode}).render(props,null);attach(tree,canvas,native);for(const effect of hooks.effects.splice(0))effect();};
 rerender();return{canvas,rerender,get props(){return props;}};
}
beforeEach(()=>{hooks.index=0;hooks.slots=[];hooks.effects=[];vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});vi.spyOn(performance,'now').mockReturnValue(1000);});
afterEach(()=>{for(const slot of hooks.slots)slot?.cleanup?.();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('Roots live viewport owns runtime camera gestures separately from the author',()=>{
 it('captures the actual frame camera and copies the runtime configuration without touching the author',()=>{
  const delivered=output(),before=structuredClone(delivered),captured=captureRootsRuntimeNavigation(delivered)!;
  expect(captured.sessionId).toBe('running-roots');expect(captured.view.camera).toMatchObject(camera);
  captured.view.camera.phi=12;expect(delivered).toEqual(before);
 });
 it('accumulates accepted drag deltas while a Worker frame is pending, and emits only narrow runtime camera',()=>{
  const mounted=mount(),{canvas}=mounted,before=structuredClone(mounted.props.scene),callback=vi.mocked(mounted.props.onRootsNavigate!);
  canvas.fire('pointerdown',{clientX:10,clientY:20});canvas.fire('pointermove',{clientX:20,clientY:25});
  mounted.rerender({renderPending:true,planeFrameReady:false});canvas.fire('pointermove',{clientX:30,clientY:35});
  expect(callback).toHaveBeenCalledTimes(2);expect(callback.mock.calls[0]).toEqual([mounted.props.scene,'running-roots',{phi:.25+Math.PI*.05,theta:.5-Math.PI*.1,gamma:.75,zoom:2},4]);
  expect(callback.mock.calls[1][2].phi).toBeCloseTo(.25+Math.PI*.15,14);expect(callback.mock.calls[1][2].theta).toBeCloseTo(.5-Math.PI*.2,14);
  expect(Object.keys(callback.mock.calls[1][2]).sort()).toEqual(['gamma','phi','theta','zoom']);expect(mounted.props.scene).toEqual(before);expect(mounted.props.onRootsPresentation).not.toHaveBeenCalled();
 });
 it('accumulates wheel deltas against the accepted view instead of a stale output or staged camera',()=>{
  const mounted=mount(),callback=vi.mocked(mounted.props.onRootsNavigate!);
  mounted.canvas.fire('wheel',{deltaY:100});mounted.rerender({renderPending:true,planeFrameReady:false});mounted.canvas.fire('wheel',{deltaY:50});
  expect(callback).toHaveBeenCalledTimes(2);expect(callback.mock.calls[1][2]).toEqual({...camera,zoom:2*Math.exp(-.1)*Math.exp(-.05)});expect(mounted.props.onRootsPresentation).not.toHaveBeenCalled();
 });
 it.each(['epoch','author','session','playing','rejected'] as const)('ends a continuing gesture when %s invalidates its accepted state',kind=>{
  const mounted=mount(),callback=vi.mocked(mounted.props.onRootsNavigate!);mounted.canvas.fire('pointerdown');mounted.canvas.fire('pointermove',{clientX:10});
  if(kind==='epoch')mounted.rerender({rootsInteractionEpoch:5});
  if(kind==='author')mounted.rerender({scene:{...mounted.props.scene},outputScene:mounted.props.scene});
  if(kind==='session'){const next=output();next.rootsLive!.sessionId='new-roots';mounted.rerender({output:next});}
  if(kind==='playing')mounted.rerender({playing:true});
  if(kind==='rejected')callback.mockReturnValue(false);
  mounted.canvas.fire('pointermove',{clientX:20});mounted.canvas.fire('pointermove',{clientX:30});expect(callback).toHaveBeenCalledTimes(kind==='rejected'?2:1);expect(mounted.props.onRootsPresentation).not.toHaveBeenCalled();
 });
 it.each(['pending','not-ready','unpaused','offscreen','no-presentation','old-author','no-runtime-callback'] as const)('does not start runtime navigation from %s display',kind=>{
  const delivered=output(),scene=author(),patch:Partial<Props>={scene,output:delivered};
  if(kind==='pending')patch.renderPending=true;if(kind==='not-ready')patch.planeFrameReady=false;
  if(kind==='unpaused')delivered.rootsLive!.paused=false;if(kind==='offscreen')delivered.rootsPresentation!.target='offscreen';
  if(kind==='no-presentation')delete delivered.rootsLive!.presentation;if(kind==='old-author')patch.outputScene={...scene};if(kind==='no-runtime-callback')patch.onRootsNavigate=undefined;
  const mounted=mount(patch);mounted.canvas.fire('pointerdown');mounted.canvas.fire('pointermove',{clientX:10});mounted.canvas.fire('wheel',{deltaY:20});
  if(mounted.props.onRootsNavigate)expect(mounted.props.onRootsNavigate).not.toHaveBeenCalled();expect(mounted.props.onRootsPresentation).not.toHaveBeenCalled();
 });
 it('keeps ordinal navigation on its existing authored presentation callback',()=>{
  const scene=author();delete scene.rootsPresentation!.previewMode;const delivered=output();delete delivered.rootsLive;
  const callback=vi.fn<NonNullable<Props['onRootsPresentation']>>(()=>scene),mounted=mount({scene,output:delivered,onRootsPresentation:callback});
  mounted.canvas.fire('pointerdown');mounted.canvas.fire('pointermove',{clientX:20,clientY:10});
  expect(callback).toHaveBeenCalledOnce();expect(callback.mock.calls[0][1].camera.phi).toBeCloseTo(90+Math.PI*.1,14);expect(mounted.props.onRootsNavigate).not.toHaveBeenCalled();
 });
});
