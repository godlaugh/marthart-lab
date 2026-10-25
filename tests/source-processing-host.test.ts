import {describe,expect,it} from 'vitest';
import {SourceProcessingHost} from '../src/engine/sourceProcessingHost';
import {prepareSourceCamera,SOURCE_CAMERA_MODEL} from '../src/engine/sourceCamera';

const value=<T>(r:{ok:true;value:T}|{ok:false;error:Error}):T=>{if(!r.ok)throw r.error;return r.value;};
function plan(target:'primary'|'offscreen'='primary',width=405,height=486,projectionPass:'perspective'|'scene-fade-orthographic'='perspective'){
 const r=value(prepareSourceCamera({model:SOURCE_CAMERA_MODEL,configuration:{kind:'angles',family:'symmetry',phi:.25,theta:.5,gamma:-.1},frame:{center:[2,3,4],zoom:1.3}},{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:486,target,projectionPass}));
 if(r.kind!=='known')throw Error(r.reason);return r.plan;
}
function host(){const h=value(SourceProcessingHost.create(405,486));value(h.apply({kind:'begin-primary',width:405,height:486}));value(h.apply({kind:'initialize-scene'}));value(h.apply({kind:'end-primary'}));return h;}
const begin=(h:SourceProcessingHost)=>value(h.apply({kind:'begin-primary',width:405,height:486}));
const render=(h:SourceProcessingHost,target:'primary'|'offscreen'='primary',width=405,height=486)=>value(h.apply({kind:'begin-render',plan:plan(target,width,height)}));
const end=(h:SourceProcessingHost,screenOverlay=true)=>value(h.apply({kind:'end-render',screenOverlay}));

describe('source host graphics, selector and lazy compute binding have distinct lifetimes',()=>{
 it('rejects every snapshot after partial rendering fails, retaining the graphics until explicit disposal',()=>{
  const h=host();begin(h);const p=plan();
  expect(h.apply({kind:'begin-render',plan:{...p,optics:{...p.optics,cameraZ:0}}})).toMatchObject({ok:false,error:{kind:'arithmetic'}});
  expect(h.diagnostics()).toMatchObject({failed:true,retainedGraphics:1});expect(h.bindCompute()).toMatchObject({ok:false,error:{kind:'state'}});expect(h.snapshot('primary')).toMatchObject({ok:false,error:{kind:'state'}});expect(h.apply({kind:'reset-mobject'})).toMatchObject({ok:false,error:{kind:'state'}});h.dispose();expect(h.diagnostics().retainedGraphics).toBe(0);
 });
 it('also invalidates partially changed state if an unexpected exception escapes the event producer',()=>{
  const h=host();begin(h);const p={...plan(),camera:undefined} as unknown as ReturnType<typeof plan>;
  expect(()=>h.apply({kind:'begin-render',plan:p})).toThrow(TypeError);expect(h.diagnostics().failed).toBe(true);expect(h.bindCompute()).toMatchObject({ok:false,error:{kind:'state'}});expect(h.snapshot('current')).toMatchObject({ok:false,error:{kind:'state'}});h.dispose();
 });
 it('takes ordinary updates before the world camera and replay from the same bound primary in world space',()=>{
  const h=host();try{begin(h);const update=value(h.bindCompute());render(h);const replay=value(h.bindCompute());expect(replay.transform).toEqual(Array.from(plan().transform.columnMajor));expect(update.transform).not.toEqual(replay.transform);expect(update.modelview).toEqual([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);end(h);value(h.apply({kind:'end-primary'}));expect(h.diagnostics()).toMatchObject({current:'none',shaderOwner:'primary'});expect(value(h.bindCompute())).toEqual(value(h.snapshot('primary')));}finally{h.dispose();}
 });
 it('lazily binds a paused first offscreen display, retaining that object after buffer replacement',()=>{
  const h=host();try{
   begin(h);render(h,'offscreen',257,193);const first=value(h.bindCompute());expect(first.viewport).toEqual([0,0,257,193]);end(h);const retained=value(h.bindCompute());
   render(h,'offscreen',200,150);expect(value(h.bindCompute())).toEqual(retained);expect(value(h.snapshot('current')).viewport).toEqual([0,0,200,150]);expect(h.diagnostics()).toMatchObject({shaderOwner:'retired-offscreen',retainedGraphics:3});end(h);
   // Replacing more slots must not accumulate every previous graphics object.
   render(h,'offscreen',201,151);expect(value(h.bindCompute())).toEqual(retained);expect(h.diagnostics().retainedGraphics).toBe(3);end(h);
   value(h.apply({kind:'reset-mobject'}));expect(h.diagnostics()).toMatchObject({shaderOwner:'unbound',retainedGraphics:2});render(h,'offscreen',201,151);expect(value(h.bindCompute()).viewport).toEqual([0,0,201,151]);end(h);value(h.apply({kind:'end-primary'}));
  }finally{h.dispose();expect(h.diagnostics().retainedGraphics).toBe(0);}
 });
 it('keeps a primary binding while offscreen is current and returns the selector to primary at endDraw',()=>{
  const h=host();try{begin(h);const primary=value(h.bindCompute());render(h,'offscreen',257,193);expect(value(h.bindCompute())).toEqual(primary);expect(h.diagnostics().current).toBe('offscreen');end(h);expect(h.diagnostics().current).toBe('primary');expect(value(h.bindCompute())).toEqual(primary);value(h.apply({kind:'end-primary'}));expect(h.diagnostics().current).toBe('none');}finally{h.dispose();}
 });
 it('performs capture then restored primary rendering within one primary frame, without an implicit update',()=>{
  const h=host();try{begin(h);render(h);value(h.bindCompute());end(h);value(h.apply({kind:'end-primary'}));begin(h);const before=value(h.snapshot('primary'));render(h,'offscreen',257,193);expect(value(h.bindCompute())).toEqual(before);end(h);render(h);expect(value(h.bindCompute()).transform).toEqual(Array.from(plan().transform.columnMajor));end(h);value(h.apply({kind:'end-primary'}));}finally{h.dispose();}
 });
 it('leaves primary preview-copy projection for the next recording update while restoring matrices',()=>{
  const h=host();try{begin(h);const before=value(h.bindCompute());render(h,'offscreen',257,193);end(h);value(h.apply({kind:'preview-copy'}));const copied=value(h.bindCompute());expect(copied.modelview).toEqual(before.modelview);expect(copied.projection).not.toEqual(before.projection);value(h.apply({kind:'end-primary'}));begin(h);expect(value(h.bindCompute())).toEqual(copied);value(h.apply({kind:'end-primary'}));}finally{h.dispose();}
 });
 it.each([true,false])('preserves explicit post-world overlay=%s into the next beginDraw',screenOverlay=>{
  const h=host();try{begin(h);render(h);const world=value(h.bindCompute());end(h,screenOverlay);const after=value(h.bindCompute());if(screenOverlay)expect(after.projection).not.toEqual(world.projection);else expect(after.projection).toEqual(world.projection);value(h.apply({kind:'end-primary'}));begin(h);expect(value(h.bindCompute()).projection).toEqual(after.projection);value(h.apply({kind:'end-primary'}));}finally{h.dispose();}
 });
 it('applies fade before world transforms and retains graphics when only the mobject resets',()=>{
  const h=host();try{begin(h);const p=plan('primary',405,486,'scene-fade-orthographic');value(h.apply({kind:'begin-render',plan:p}));expect(value(h.bindCompute()).transform).toEqual(Array.from(p.transform.columnMajor));end(h);const before=value(h.snapshot('primary'));value(h.apply({kind:'reset-mobject'}));expect(value(h.bindCompute())).toEqual(before);value(h.apply({kind:'initialize-scene'}));expect(value(h.bindCompute()).projection).not.toEqual(before.projection);value(h.apply({kind:'end-primary'}));}finally{h.dispose();}
 });
 it('resizes the existing primary identity but never accepts a mismatched camera or missing lifecycle',()=>{
  const h=host();try{expect(h.bindCompute()).toMatchObject({ok:false,error:{kind:'input'}});begin(h);value(h.bindCompute());expect(h.apply({kind:'begin-primary',width:405,height:486})).toMatchObject({ok:false,error:{kind:'state'}});expect(h.apply({kind:'begin-render',plan:plan('primary',40,30)})).toMatchObject({ok:false,error:{kind:'state'}});value(h.apply({kind:'end-primary'}));value(h.apply({kind:'begin-primary',width:40,height:30}));expect(value(h.bindCompute()).viewport).toEqual([0,0,40,30]);expect(h.diagnostics().shaderOwner).toBe('primary');value(h.apply({kind:'end-primary'}));}finally{h.dispose();}expect(h.bindCompute()).toMatchObject({ok:false,error:{kind:'state'}});
 });
});
