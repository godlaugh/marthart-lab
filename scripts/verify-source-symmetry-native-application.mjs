// Compare complete original primary artistic frames against the public native Generator.
// Usage: node scripts/verify-source-symmetry-native-application.mjs reference-directory new-output-directory
// Requires macOS arm64 and Xcode command-line tools. Never launches the original app.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'vite';
import {spawnSync} from 'node:child_process';
import {createExportServer} from '../server/index.mjs';
const [referenceArg,outArg]=process.argv.slice(2);assert(referenceArg&&outArg);const reference=resolve(referenceArg),out=resolve(outArg);await mkdir(out,{recursive:false});
const sha=b=>createHash('sha256').update(b).digest('hex'),report={status:'running',reference,sources:{},inputs:{},frames:[],limits:['Full Scene artistic RGBA at the captured present boundary, before source overlays; no whole-window or original EXPORT claim.','Only documented bottom-up to top-down row-order conversion; every RGBA byte is compared.','Scene source and external timestamps/viewport are inputs; recorded seed, matrices, uniforms, update pass counts and pixels never drive the local renderer.']};
const pin=async(p,g=report.inputs)=>{const b=await readFile(p);g[p]=sha(b);return b;};const ref=async p=>JSON.parse(await pin(reference+'/'+p));
function flipped(bytes,w,h){assert.equal(bytes.length,w*h*4);const out=Buffer.alloc(bytes.length);for(let y=0;y<h;y++)bytes.copy(out,y*w*4,(h-y-1)*w*4,(h-y)*w*4);return out;}
const originalFetch=globalThis.fetch,started=performance.now();let vite,app,g;
try{
 const manifest=await ref('outputs.json'),descriptor=await ref('descriptor.json'),auth=await ref('authorization.json'),run=await ref('run.json'),dimensions=await ref('dimensions.json'),complete=await ref('complete.json');
 assert.equal(complete.observed,true);assert.ok(Number.isSafeInteger(complete.frames)&&complete.frames>0);assert.ok(Array.isArray(descriptor.frames));assert.equal(descriptor.frames.length,complete.frames);descriptor.frames.forEach((f,i)=>assert.equal(f.index,i));assert.equal(Object.keys(manifest).filter(name=>/^frame-\d+\/core\.rgba$/.test(name)).length,complete.frames);report.expectedFrames=complete.frames;
 for(const name of ['descriptor.json','authorization.json','run.json','dimensions.json','complete.json','source.json'])assert.equal(sha(await pin(reference+'/'+name)),manifest[name],`Reference metadata manifest mismatch: ${name}`);
 assert.equal(run.status,'observed');assert.equal(auth.VIEW,true);assert.equal(auth.RUN,true);assert.equal(descriptor.output.rowOrder,'bottom-up');assert.equal(descriptor.output.byteOrder,'RGBA8');
 const source=await pin(reference+'/source.json');assert.equal(sha(source),descriptor.inputSha256);report.sourceSha256=sha(source);report.referenceScope=run.scope;report.referenceAuthorization=auth;
 const referenceFile=async name=>{const bytes=await pin(reference+'/'+name);assert.equal(sha(bytes),manifest[name],`Reference manifest mismatch: ${name}`);return bytes;};
 const files=(await readdir('src',{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>e.parentPath+'/'+e.name);for(const p of files)await pin(p,report.sources);for(const p of (await readdir('server/render')).filter(p=>/\.(m|h)$/.test(p)))await pin('server/render/'+p,report.sources);await pin('server/source-renderer.mjs',report.sources);await pin('server/index.mjs',report.sources);await pin(new URL(import.meta.url).pathname,report.sources);
 const executablePath=out+'/source-cgl-renderer',compiled=spawnSync('/usr/bin/xcrun',['clang','-fobjc-arc','-fblocks','-O2','-Wall','-Wextra','-Werror','-framework','Foundation','-framework','OpenGL','server/render/SourceCglRenderer.m','-o',executablePath],{encoding:'utf8',timeout:30000,maxBuffer:65536});
 await writeFile(out+'/compile.log',(compiled.stdout??'')+(compiled.stderr??''));assert.equal(compiled.status,0,compiled.stderr);assert.equal(compiled.stderr,'');const executableSha256=sha(await pin(executablePath,report.sources));
 app=await createExportServer({root:out+'/workspace',sourceRendererBackend:{executablePath,executableSha256}});const address=await app.listen(0),origin=`http://127.0.0.1:${address.port}`;globalThis.fetch=(input,init)=>originalFetch(new URL(String(input),origin),init);
 process.env.VITE_SOURCE_RENDERER='native';vite=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error'});
 const {Generator}=await vite.ssrLoadModule('/src/engine/client.ts'),{parseProjectFile}=await vite.ssrLoadModule('/src/engine/legacyImport.ts');const scene=parseProjectFile(source.toString()).scene;g=new Generator();
 const width=descriptor.output.width,height=descriptor.output.height;assert.equal(width,dimensions.pixelWidth);assert.equal(height,dimensions.pixelHeight);let generation=0;
 for(const frame of descriptor.frames){
  if(frame.reinitializeScene)generation++;
  const context={time:0,width,height,quality:'preview',sourceViewport:descriptor.sourceViewport,sourcePointPixelDensity:descriptor.sourcePointPixelDensity,sourceSymmetryToneReference:descriptor.sourceSymmetryToneReference,symmetryLive:{sessionId:'original-full-image-'+generation,renderFps:60,clock:{paused:false,timestampMs:frame.timestampMs},replayRevision:0}};
  const start=performance.now(),image=await g.generate(scene,context);assert.equal(image.backend,'native');assert.equal(image.width,width);assert.equal(image.height,height);assert.equal(image.symmetryLive.rawDt,frame.rawDt);assert.equal(image.symmetryLive.clockSource,'injected');
  const actual=Buffer.from(image.pixels),expected=flipped(await referenceFile(`frame-${frame.index}/core.rgba`),width,height);assert.equal(actual.length,width*height*4,'Public output must cover every RGBA byte');assert.equal(actual.length,expected.length);let changedChannels=0,changedPixels=0,maxAbsoluteDifference=0;const channels=[0,0,0,0],examples=[];
  for(let at=0;at<expected.length;at+=4){let changed=false;for(let c=0;c<4;c++){const delta=Math.abs(actual[at+c]-expected[at+c]);if(delta){changed=true;changedChannels++;channels[c]++;maxAbsoluteDifference=Math.max(maxAbsoluteDifference,delta);}}if(changed){changedPixels++;if(examples.length<5)examples.push({x:(at/4)%width,y:Math.floor(at/4/width),actual:[...actual.subarray(at,at+4)],expected:[...expected.subarray(at,at+4)]});}}
  const {pixels,...output}=image;await writeFile(out+`/frame-${frame.index}.rgba`,actual);report.frames.push({index:frame.index,request:context,output,bytes:actual.length,actualSha256:sha(actual),expectedSha256:sha(expected),changedPixels,changedChannels,channels,maxAbsoluteDifference,examples,milliseconds:performance.now()-start});
 }
 assert.equal(report.frames.length,complete.frames);report.status=report.frames.some(f=>f.changedChannels)?'differences':'passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{
 try{g?.dispose();await g?.settledNativeCleanup();report.publicCleanup=true;}catch(e){report.status='cleanup-failed';report.cleanupError=String(e);}
 const cleanup=await Promise.allSettled([Promise.resolve().then(()=>vite?.close()),Promise.resolve().then(()=>app?.close())]);report.servicesCleanup=cleanup.map((r,i)=>({service:i===0?'vite':'native-http',ok:r.status==='fulfilled',...(r.status==='rejected'?{error:String(r.reason)}:{})}));if(cleanup.some(r=>r.status==='rejected'))report.status='cleanup-failed';globalThis.fetch=originalFetch;report.ownedProcessesAfterClose=app?.ownedProcessCount;report.stable=true;for(const group of [report.sources,report.inputs])for(const [p,digest]of Object.entries(group)){try{if(sha(await readFile(p))!==digest)report.stable=false;}catch{report.stable=false;}}
 if(!report.stable||report.ownedProcessesAfterClose!==0)report.status='failed';report.seconds=(performance.now()-started)/1000;await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,frames:report.frames.length,changedChannels:report.frames.reduce((a,f)=>a+f.changedChannels,0),error:report.error,seconds:report.seconds,report:out+'/report.json'}));process.exitCode=report.status==='passed'?0:1;
}
