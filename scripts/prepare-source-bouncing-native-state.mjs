import {createServer} from 'vite';
import {launchRendererPage} from './headless-renderer-page.mjs';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export async function prepareBouncingState(out,source='../.cache/mathart-investigation/MathArt.app/Contents/app/resources/data/Bouncing/bouncing1.json'){
 await mkdir(out,{recursive:true});const bytes=await readFile(source),raw=JSON.parse(bytes),expectedSeedBytes=raw.settings.particle_count*16;
 if(!Number.isSafeInteger(expectedSeedBytes)||expectedSeedBytes<=0||expectedSeedBytes>80_000_000)throw Error('Reference preparation supports up to the pinned 5M preset');
 let server,browser,seedFile,packet,uploaded=0;const sha=b=>createHash('sha256').update(b).digest('hex'),seedHash=createHash('sha256');
 try{
  seedFile=await open(out+'/seeds.f32','wx');
  server=await createServer({plugins:[{name:'owned-bouncing-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
   if(req.url==='/fixture'){res.setHeader('content-type','text/html');res.end('<!doctype html>');return;}
   if(req.method!=='POST'||!['/prepared-frame','/seed-chunk'].includes(new URL(req.url,'http://localhost').pathname))return next();
   try{
    const url=new URL(req.url,'http://localhost'),seed=url.pathname==='/seed-chunk';
    if(seed&&Number(url.searchParams.get('offset'))!==uploaded)throw Error('Seed chunk out of sequence');
    const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>4*1024*1024)throw Error('Preparation chunk capacity');chunks.push(chunk);}const body=Buffer.concat(chunks);
    if(seed){
     if(!length||length%16||uploaded+length>expectedSeedBytes)throw Error('Seed chunk dimensions');
     let at=0;while(at<body.length){const {bytesWritten}=await seedFile.write(body,at,body.length-at,uploaded+at);if(!bytesWritten)throw Error('Seed file write made no progress');at+=bytesWritten;}
     seedHash.update(body);uploaded+=length;
    }else{if(packet||uploaded!==expectedSeedBytes)throw Error('Metadata before seeds or duplicate metadata');packet=body;}
    res.end('ok');
   }catch(error){res.statusCode=500;res.end(String(error));}
  });}}],server:{host:'127.0.0.1',port:5173,strictPort:true,hmr:false},logLevel:'error'});await server.listen();browser=await launchRendererPage();const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'fixture');
  const prepared=await page.evaluate(async raw=>{
   const{importSourceBouncingDocument,sourceBouncingCameraInput}=await import('/src/engine/sourceBouncingDocument.ts'),{prepareSourceCamera}=await import('/src/engine/sourceCamera.ts'),{generateSourceBouncingSeeds}=await import('/src/engine/sourceBouncingSeeds.ts'),{prepareSourceBouncingDrawing,sourceBouncingDrawingFrame}=await import('/src/engine/sourceBouncingDrawing.ts'),{sourceBouncingProgramBytes}=await import('/src/engine/sourceBouncingOperation.ts'),{encodeSourceDrawingFrame}=await import('/src/engine/sourceDrawingFrame.ts'),shaders=await import('/src/engine/sourceBouncingGpuShader.ts');
   // Preparation only needs CPU seeds and pure draw metadata, never WebGL.
   for(const prototype of [HTMLCanvasElement.prototype,OffscreenCanvas.prototype]){const original=prototype.getContext;prototype.getContext=function(kind,...args){if(kind==='webgl'||kind==='webgl2')throw Error('Unexpected browser GPU during reference preparation');return original.call(this,kind,...args);};}
   const unwrap=r=>{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},payload=unwrap(importSourceBouncingDocument(raw)).payload,seeds=unwrap(generateSourceBouncingSeeds(payload.configuration)),camera=unwrap(prepareSourceCamera(sourceBouncingCameraInput(payload),{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'}));if(camera.kind!=='known')throw Error('Camera unknown');
   const programs={quad:shaders.sourceBouncingNativeQuad,update:shaders.sourceBouncingNativeUpdateFragment,vertex:shaders.sourceBouncingNativeTextureVertex,fragment:shaders.sourceBouncingNativeFragment};
   const upload=async(url,body)=>{const response=await fetch(url,{method:'POST',body});if(!response.ok)throw Error(await response.text());};
   const data=new Uint8Array(seeds.state.buffer,seeds.state.byteOffset,seeds.state.byteLength);
   for(let offset=0;offset<data.length;offset+=4*1024*1024)await upload('/seed-chunk?offset='+offset,data.subarray(offset,Math.min(offset+4*1024*1024,data.length)));
   const drawing=sourceBouncingDrawingFrame(prepareSourceBouncingDrawing(payload.configuration.particleCount,{width:500,height:600,cameraPlan:camera.plan,visualConfiguration:payload.visual,initialSpeed:payload.configuration.initialSpeed,boundary:seeds.update.boundary}),{generation:1,sequence:1},{kind:'retained',operation:{kind:'draw',resource:crypto.randomUUID().replaceAll('-',''),particleCount:payload.configuration.particleCount,programBytes:sourceBouncingProgramBytes(programs),from:0,to:0,update:seeds.update}});
   const packet=unwrap(encodeSourceDrawingFrame(drawing,{retainedBytes:data.byteLength}));await upload('/prepared-frame',packet);
   return{update:seeds.update,count:payload.configuration.particleCount,camera:{projection:Array.from(camera.plan.projection.columnMajor),modelview:Array.from(camera.plan.modelView.columnMajor)},shaders:programs,browserGpuContexts:0};
  },raw);
  if(!packet||uploaded!==prepared.count*16)throw Error('Incomplete preparation');await seedFile.close();seedFile=undefined;
  const seedSha256=seedHash.digest('hex');await writeFile(out+'/initial-frame.bin',packet);await writeFile(out+'/prepared.json',JSON.stringify({...prepared,source,sourceSha256:sha(bytes),packetSha256:sha(packet),seedSha256,seedBytes:uploaded},null,2)+'\n');return{out,packetBytes:packet.length,seedBytes:uploaded,count:prepared.count,browserGpuContexts:0};
 }finally{const cleanup=await Promise.allSettled([browser?.close(),server?.close(),seedFile?.close()]);const failures=cleanup.filter(r=>r.status==='rejected');if(failures.length)throw new AggregateError(failures.map(r=>r.reason),'Preparation cleanup failed');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await prepareBouncingState(process.argv[2]??'.cache/bouncing-retained-state-20261024',process.argv[3])));
