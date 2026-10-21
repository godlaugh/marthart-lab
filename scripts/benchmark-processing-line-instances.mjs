import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {configureDesktopGraphics} from '../desktop/graphics.mjs';
const directory=process.argv[2],expanded=process.argv.includes('--expanded');if(!directory)throw Error('Report directory required');await mkdir(directory,{recursive:true});
const sha=v=>createHash('sha256').update(v).digest('hex');
const paths=['src/engine/sourceProcessingStroke.ts','src/engine/sourceProcessingLineRenderer.ts','scripts/benchmark-processing-line-instances.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
const report={status:'running',expanded,sourceBefore:await hashes(),limits:['Same retained expanded representation versus production instanced representation in one pinned source tree. Complete mesh creation/draw/readback/disposal tasks; not full video performance.','Cold means new WebGL owner, not cleared OS caches. CPU/RSS require external process sampler; GPU memory and agent tokens unmeasured.']};let browser,vite;
try{
 vite=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await vite.listen();const switches=new Map();configureDesktopGraphics({getSwitchValue:k=>switches.get(k)??'',appendSwitch:(k,v)=>switches.set(k,v)});
 browser=await chromium.launch({channel:'chrome',headless:true,args:[...switches].map(([k,v])=>`--${k}=${v}`)});const page=await browser.newPage();await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(vite.resolvedUrls.local[0]+'fixture');
 report.rows=await page.evaluate(async expanded=>{
  const THREE=await import('/node_modules/three/build/three.module.js'),{prepareSourceCamera}=await import('/src/engine/sourceCamera.ts'),{sourceProcessingLineBuffers,sourceProcessingLineVertex,sourceProcessingLineFragment,sourceProcessingLineDisplay}=await import('/src/engine/sourceProcessingStroke.ts'),{createSourceProcessingLines}=await import('/src/engine/sourceProcessingLineRenderer.ts');
  const prepared=prepareSourceCamera({model:'mathart-1.7.8-v1',configuration:{kind:'absent'}},{logicalWidth:640,logicalHeight:480,referenceLogicalHeight:480,target:'primary',projectionPass:'perspective'});if(!prepared.ok||prepared.value.kind!=='known')throw Error('camera');const plan=prepared.value.plan,display=sourceProcessingLineDisplay(plan);
  const count=100000,positions=new Float32Array(count*6),rgb=new Float32Array(count*6),alphas=new Float32Array(count*2);
  for(let i=0;i<count;i++){const x=(i%400-200)*.9,y=(Math.floor(i/400)-125)*.9;positions.set([x,y,0,x+1,y+.5,0],i*6);rgb.set([.1,.7,.9,.9,.2,.1],i*6);alphas.set([.3,.7],i*2);}
  const renderer=new THREE.WebGLRenderer({canvas:document.createElement('canvas'),antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setSize(640,480,false);renderer.outputColorSpace=THREE.LinearSRGBColorSpace;renderer.setClearColor(0x101319,1);const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),rows=[];
  try{for(let round=0;round<3;round++){
   const started=performance.now();let mesh;
   if(expanded){
    sourceProcessingLineDisplay(plan);
    if(!(positions instanceof Float32Array)||!(rgb instanceof Float32Array)||!(alphas instanceof Float32Array)||rgb.length!==positions.length||alphas.length!==positions.length/3)throw Error('colors');
    for(const values of [rgb,alphas])for(const value of values)if(!Number.isFinite(value)||value<0||value>1)throw Error('color range');
    const b=sourceProcessingLineBuffers(positions,1.2,plan),colors=new Float32Array(count*16);for(let pair=0;pair<count;pair++)for(let v=0;v<4;v++){const index=pair*2+(v<2?0:1);const o=pair*16+v*4;colors[o]=rgb[index*3];colors[o+1]=rgb[index*3+1];colors[o+2]=rgb[index*3+2];colors[o+3]=Math.fround(alphas[index]);}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(b.positions,4));geometry.setAttribute('direction',new THREE.BufferAttribute(b.directions,4));geometry.setAttribute('color',new THREE.BufferAttribute(colors,4));geometry.setIndex(new THREE.BufferAttribute(b.indices,1));geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),0);
    const material=new THREE.RawShaderMaterial({glslVersion:THREE.GLSL3,vertexShader:sourceProcessingLineVertex,fragmentShader:sourceProcessingLineFragment,side:THREE.DoubleSide,forceSinglePass:true,transparent:true,depthTest:false,depthWrite:false,depthFunc:THREE.LessEqualDepth,toneMapped:false,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneMinusSrcAlphaFactor,blendEquationAlpha:THREE.AddEquation,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneFactor,uniforms:{lineModelview:{value:new THREE.Matrix4()},projection:{value:new THREE.Matrix4().fromArray(plan.projection.columnMajor)},viewport:{value:new THREE.Vector4(...display.viewport)},perspective:{value:display.perspective},scale:{value:new THREE.Vector3(...display.scale)}}});mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=1;
   }else mesh=createSourceProcessingLines({positions,lineWidth:1.2,color:{kind:'vertices',rgb,alphas}},plan,1,true);
   let bytes=0;const arrays=new Set();for(const a of Object.values(mesh.geometry.attributes)){const array=a.isInterleavedBufferAttribute?a.data.array:a.array;arrays.add(array);}arrays.add(mesh.geometry.index.array);for(const a of arrays)bytes+=a.byteLength;
   const raw=new Uint8Array(640*480*4);try{scene.add(mesh);renderer.render(scene,camera);const gl=renderer.getContext();gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,raw);if(gl.getError())throw Error('readback');}finally{scene.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
   const elapsedMs=performance.now()-started,digest=await crypto.subtle.digest('SHA-256',raw);let changed=0;for(let i=4;i<raw.length;i+=4)if(raw[i]!==raw[0]||raw[i+1]!==raw[1]||raw[i+2]!==raw[2])changed++;if(changed<100)throw Error('Blank rendering');
   rows.push({temperature:round===0?'cold-owner':'warm-owner',count,elapsedMs,bufferBytes:bytes,changedPixels:changed,rgbaSha:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('')});
  }return rows;}finally{renderer.dispose();renderer.forceContextLoss();}
 },expanded);if(!report.rows.every(r=>r.rgbaSha===report.rows[0].rgbaSha))throw Error('Repeated image changed');report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),vite?.close()])).map(r=>r.status);report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.cleanup.includes('rejected')){report.status='failed';process.exitCode=1;}await writeFile(directory+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
