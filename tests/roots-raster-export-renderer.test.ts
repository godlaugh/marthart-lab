import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {inflateSync} from 'node:zlib';
import {ArtRenderer} from '../src/engine/renderer';
import {createScene} from '../src/engine/document';
import {definition} from '../src/scenes';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import type {SceneOutput} from '../src/types';
import type * as THREE from 'three';
const h=vi.hoisted(()=>({render:vi.fn(),composite:vi.fn(),base:vi.fn()}));
// Real ArtRenderer/Three scene objects and PNG encoder; only the GPU and glyph
// compositor are doubled. Checks pixel ownership, not a shader parity claim.
vi.mock('three',async load=>{const actual=await load<typeof import('three')>();return{...actual,WebGLRenderer:class{
 domElement:HTMLCanvasElement;debug={};ratio=1;render=h.render;setClearColor(){}dispose(){}setPixelRatio(n:number){this.ratio=n;}
 constructor(options:{canvas:HTMLCanvasElement}){this.domElement=options.canvas;}
 setSize(w:number,h:number){this.domElement.width=w*this.ratio;this.domElement.height=h*this.ratio;}
 getContext(){return{drawingBufferWidth:this.domElement.width,drawingBufferHeight:this.domElement.height};}
}};});
vi.mock('three/addons/controls/OrbitControls.js',async()=>{const {Vector3}=await import('three');return{OrbitControls:class{target=new Vector3();addEventListener(){}dispose(){}update(){}}};});
vi.mock('../src/engine/sourceFormulaCompositor',async load=>({...await load<object>(),compositeSourceFormulaPixels:h.composite,formulaBasePixels:h.base}));
function frame(backend:'native'|'webgl2'):Extract<SceneOutput,{type:'raster'}>{
 return{type:'raster',backend,cameraResolved:true,width:2,height:1,pixels:new Uint8ClampedArray([213,7,91,0,17,99,241,1]),stats:{samples:2,generated:2,invalid:0,elapsedMs:0},
 formulaPresentation:{layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[]},
 rootsPresentation:{model:'mathart-1.7.8-v1',mode:'point-cloud',clockPolicy:'local-fixed-sample-clock-v1',streamPolicy:'global-ordinal',presentationAlpha:'opaque-framebuffer-rgb',instance:1,restartReason:null,attemptedSamples:2,newSamples:0,newRawPoints:0,totalRawPoints:2,physicalSize:[2,1],logicalSize:[2,1],referenceLogicalHeight:486,target:'offscreen'}};
}
function owner(){
 const canvas={width:0,height:0,toBlob:vi.fn((cb:(blob:Blob)=>void)=>cb(new Blob(['canvas'],{type:'image/png'})))} as unknown as HTMLCanvasElement;
 const renderer=new ArtRenderer(canvas);renderer.setSize(2,1,1);
 const scene=createScene(definition('roots'));scene.rootsPresentation=defaultRootsPresentationConfiguration();return{renderer,scene,canvas};
}
async function pngRgba(blob:Blob){const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),chunks:Uint8Array[]=[];for(let at=8;at<bytes.length;){const size=view.getUint32(at);if(String.fromCharCode(...bytes.subarray(at+4,at+8))==='IDAT')chunks.push(bytes.subarray(at+8,at+8+size));at+=size+12;}return inflateSync(Buffer.concat(chunks)).subarray(1);}
beforeEach(()=>{vi.stubGlobal('devicePixelRatio',1);h.render.mockReset();h.base.mockReset().mockImplementation(()=>{throw Error('Opaque display canvas must not replace Roots RGBA');});h.composite.mockReset().mockImplementation(async(pixels:Uint8ClampedArray)=>pixels);});
afterEach(()=>vi.unstubAllGlobals());
describe('completed Roots framebuffer remains separate from opaque preview',()=>{
 it.each(['native','webgl2'] as const)('%s displays opaque RGB but writes original low-alpha bytes to PNG without another copy',async backend=>{
  const {renderer,scene,canvas}=owner(),output=frame(backend),before=output.pixels.slice();
  try{
   renderer.setOutput(output,scene);
   const rendered=h.render.mock.calls.at(-1)![0] as THREE.Scene;let material:THREE.MeshBasicMaterial|undefined;
   rendered.traverse(object=>{if((object as THREE.Mesh).isMesh)material=(object as THREE.Mesh).material as THREE.MeshBasicMaterial;});
   expect(material?.transparent).toBe(false);expect(material?.map?.image.data).toBe(output.pixels);
   expect(await pngRgba(await renderer.blob())).toEqual(Buffer.from(before));expect(canvas.toBlob).not.toHaveBeenCalled();expect(output.pixels).toEqual(before);expect(h.base).not.toHaveBeenCalled();
  }finally{renderer.dispose();}
 });
 it('composes source formulas on delivered RGBA rather than the opaque display canvas',async()=>{
  const {renderer,scene}=owner(),output=frame('native');output.formulaPresentation={layout:'source-surface-centered-v1',primaryLogicalHeight:486,labels:[{id:'main',latex:'x',visible:true,anchor:'center',x:0,y:0,scale:1,color:'#ffffff'}]};
  const marked=output.pixels.slice();marked[0]=55;h.composite.mockResolvedValue(marked);
  try{renderer.setOutput(output,scene);expect(await pngRgba(await renderer.blob())).toEqual(Buffer.from(marked));expect(h.composite.mock.calls[0][0]).toBe(output.pixels);expect(h.composite.mock.calls[0][3]).toBe(output.formulaPresentation);expect(h.base).not.toHaveBeenCalled();expect(output.pixels[0]).toBe(213);}finally{renderer.dispose();}
 });
 it('refuses to scale an old completed framebuffer and drops it when a local frame replaces it',async()=>{
  const {renderer,scene,canvas}=owner(),output=frame('native');
  try{
   renderer.setOutput(output,scene);renderer.setSize(3,1,1);await expect(renderer.blob()).rejects.toThrow('尺寸');
   renderer.setSize(2,1,1);const local={...output,rootsPresentation:undefined,formulaPresentation:{referenceWidth:2,referenceHeight:1,labels:[]}};renderer.setOutput(local,createScene(definition('fractal')));
   expect(await(await renderer.blob()).text()).toBe('canvas');expect(canvas.toBlob).toHaveBeenCalledOnce();
  }finally{renderer.dispose();}
 });
});
