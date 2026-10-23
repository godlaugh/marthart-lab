import {createServer} from 'vite';
import {launchRendererPage} from './headless-renderer-page.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export async function prepareBouncingState(out){
const source='../.cache/mathart-investigation/MathArt.app/Contents/app/resources/data/Bouncing/bouncing1.json';
await mkdir(out,{recursive:true});let server,browser;const sha=b=>createHash('sha256').update(b).digest('hex');
try{
 let packet;
 server=await createServer({plugins:[{name:'owned-bouncing-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url==='/fixture'){res.setHeader('content-type','text/html');res.end('<!doctype html>');return;}
  if(req.url==='/prepared-frame'&&req.method==='POST'){try{const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>64*1024*1024)throw Error('Packet capacity');chunks.push(chunk);}if(packet)throw Error('Duplicate packet');packet=Buffer.concat(chunks);res.end('ok');}catch(e){res.statusCode=500;res.end(String(e));}return;}
  next();
 });}}],server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false},logLevel:'error'});await server.listen();browser=await launchRendererPage();const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'fixture');
 const bytes=await readFile(source),prepared=await page.evaluate(async raw=>{
  const{importSourceBouncingDocument,sourceBouncingCameraInput}=await import('/src/engine/sourceBouncingDocument.ts'),{prepareSourceCamera}=await import('/src/engine/sourceCamera.ts'),{generateSourceBouncingSeeds}=await import('/src/engine/sourceBouncingSeeds.ts'),{SourceBouncingGpu}=await import('/src/engine/sourceBouncingGpu.ts'),{encodeSourceDrawingFrame}=await import('/src/engine/sourceDrawingFrame.ts'),shaders=await import('/src/engine/sourceBouncingGpuShader.ts');
  const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},payload=unwrap(importSourceBouncingDocument(raw)).payload,seeds=unwrap(generateSourceBouncingSeeds(payload.configuration)),camera=unwrap(prepareSourceCamera(sourceBouncingCameraInput(payload),{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'}));if(camera.kind!=='known')throw Error('Camera unknown');const gpu=SourceBouncingGpu.takeState(seeds.state);
  try{const drawing=gpu.drawingFrame({width:500,height:600,cameraPlan:camera.plan,visualConfiguration:payload.visual,initialSpeed:payload.configuration.initialSpeed,boundary:seeds.update.boundary},{generation:1,sequence:1});const packet=unwrap(encodeSourceDrawingFrame(drawing,{retainedBytes:gpu.diagnostics().retainedBytes}));const response=await fetch('/prepared-frame',{method:'POST',body:packet});if(!response.ok)throw Error(await response.text());return{update:seeds.update,count:payload.configuration.particleCount,camera:{projection:Array.from(camera.plan.projection.columnMajor),modelview:Array.from(camera.plan.modelView.columnMajor)},shaders:{quad:shaders.sourceBouncingNativeQuad,update:shaders.sourceBouncingNativeUpdateFragment,vertex:shaders.sourceBouncingNativeTextureVertex,fragment:shaders.sourceBouncingNativeFragment}};}finally{gpu.dispose();}
 },JSON.parse(bytes));if(!packet)throw Error('No packet');await writeFile(out+'/initial-frame.bin',packet);await writeFile(out+'/prepared.json',JSON.stringify({...prepared,source,sourceSha256:sha(bytes),packetSha256:sha(packet)},null,2)+'\n');return{out,packetBytes:packet.length,count:prepared.count};
}finally{const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);const failures=cleanup.filter(r=>r.status==='rejected');if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'Preparation cleanup failed');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await prepareBouncingState(process.argv[2]??'.cache/bouncing-retained-state-20261024')));
