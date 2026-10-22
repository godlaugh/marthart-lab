import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import fixture from './fixtures/source-implicit-presentation/native.json';
import oracle from './fixtures/source-implicit-presentation/retained-lines.json';
import {parseLegacyScene} from '../src/engine/legacyImport';
import {prepareImplicitJob} from '../src/engine/implicitSurface';
import {transformFor} from '../src/scenes/geometry';
import {sourceImplicitSliceLines,sourceImplicitHeightColor} from '../src/engine/sourceImplicitPresentation';
import {sourceConfigPackedColor} from '../src/engine/sourceConfigColor';
import {writeSourcePackedColor} from '../src/engine/sourceProcessingGeometry';
import {createSourceProcessingLines} from '../src/engine/sourceProcessingLineRenderer';
import {sourceProcessingRetainedLineInstances} from '../src/engine/sourceProcessingRetainedLine';
import {prepareSourceCamera} from '../src/engine/sourceCamera';
const hash=(a:Float32Array|Uint32Array)=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const uniform=(name:string)=>oracle.uniforms.find(u=>u.name===name)!.floatQueryValues[0].map(Math.fround);
const camera=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'});
if(!camera.ok||camera.value.kind!=='known')throw Error('camera fixture');
const matrix=(name:string)=>{const columnMajor=Float32Array.from(uniform(name));return{columnMajor,rowMajor:Array.from({length:16},(_,i)=>columnMajor[(i%4)*4+Math.floor(i/4)])};};
const plan={...camera.value.plan,modelView:{...camera.value.plan.modelView,...matrix('modelviewMatrix')},projection:{...camera.value.plan.projection,...matrix('projectionMatrix')}};
describe('original retained PShape LINES renderer boundary',()=>{
 it('matches all original vertices, directions, colors and cache-normalized triangle indices',()=>{
  const scene=parseLegacyScene(JSON.stringify(fixture.cases[0].input)).scene,context={time:0,width:500,height:600,quality:'export' as const},job=prepareImplicitJob(scene,context,transformFor(scene.settings)),wire=sourceImplicitSliceLines(job,context);
  const rgb=new Float32Array(wire.positions.length),alphas=new Float32Array(wire.positions.length/3),rgba=new Float32Array(4),palette=scene.palette.stops.map(sourceConfigPackedColor);
  for(let i=0;i<rgb.length;i+=3){writeSourcePackedColor(sourceImplicitHeightColor(palette,wire.positions[i+2],-120,240),rgba,0);rgb.set(rgba.subarray(0,3),i);alphas[i/3]=rgba[3];}
  const mesh=createSourceProcessingLines({mode:'retained',positions:wire.positions,lineWidth:oracle.strokeWeight,color:{kind:'vertices',rgb,alphas}},plan),g=mesh.geometry as THREE.InstancedBufferGeometry;
  const positions=new Float32Array(oracle.vertices*4),directions=new Float32Array(oracle.vertices*4),colors=new Float32Array(oracle.vertices*4),indices=new Uint32Array(oracle.indices);
  for(let pair=0;pair<g.instanceCount;pair++){
   for(let v=0;v<4;v++)for(let c=0;c<4;c++){
    const endpoint=v<2?'A':'B',o=(pair*4+v)*4+c;
    positions[o]=g.getAttribute('endpoint'+endpoint).getComponent(pair,c);
    directions[o]=g.getAttribute('direction'+endpoint).getComponent(pair,c)*(c===3&&(v===1||v===2)?-1:1);
    colors[o]=g.getAttribute('color'+endpoint).getComponent(pair,c);
   }
   for(let i=0;i<6;i++)indices[pair*6+i]=pair*4+g.index!.getX(i);
  }
  expect(hash(positions)).toBe(oracle.positionSha256);expect(hash(directions)).toBe(oracle.directionSha256);expect(hash(colors)).toBe(oracle.colorRgbaSha256);expect(hash(indices)).toBe(oracle.globalIndexSha256);
  const u=mesh.material.uniforms;expect(u.lineModelview.value.elements).toEqual(uniform('modelviewMatrix'));expect(u.projection.value.elements).toEqual(uniform('projectionMatrix'));
  expect(u.viewport.value.toArray()).toEqual(uniform('viewport'));expect(u.scale.value.toArray()).toEqual(uniform('scale'));expect(u.perspective.value).toBe(uniform('perspective')[0]);
  mesh.geometry.dispose();mesh.material.dispose();
 });
 it('rejects malformed, out-of-range, cancelled and over-capacity retained inputs before allocation',()=>{
  const positions=new Float32Array([0,0,0,1,2,3]);
  expect(()=>sourceProcessingRetainedLineInstances({positions,lineWidth:1,indices:new Uint32Array([0,2])})).toThrow('索引');
  expect(()=>sourceProcessingRetainedLineInstances({positions:positions.subarray(0,3),lineWidth:1})).toThrow('计数');
  expect(()=>sourceProcessingRetainedLineInstances({positions,lineWidth:1,isCancelled:()=>true})).toThrow('取消');
  const oversizedBacking=new ArrayBuffer(256*1024*1024);
  expect(()=>createSourceProcessingLines({mode:'retained',positions,lineWidth:1,color:{kind:'vertices',rgb:new Float32Array(oversizedBacking,0,6),alphas:new Float32Array(2)}},plan)).toThrow('容量');
  expect(()=>createSourceProcessingLines({mode:'retained',positions,lineWidth:1,color:{kind:'packed',packed:0xffffffff},isCancelled:()=>true},plan)).toThrow('取消');
  expect(()=>sourceProcessingRetainedLineInstances({positions:new Float32Array(oversizedBacking,0,6),lineWidth:1})).toThrow('容量');
 });
});
