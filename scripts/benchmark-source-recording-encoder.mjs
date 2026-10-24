/** Equivalent completed HTTP export tasks against an explicitly retained old
 * server bundle and current server. All source frames come from real original
 * VideoRecorder evidence; each encoder is a fresh owned process. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createExportServer} from '../server/index.mjs';
import {measureFamily} from './browser-process-cost.mjs';
const [reference,out,baseline]=process.argv.slice(2);assert.ok(reference&&out&&baseline,'Reference, new output and retained baseline server bundle required');await mkdir(out);
const execute=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
const files=['server/index.mjs','scripts/benchmark-source-recording-encoder.mjs','scripts/browser-process-cost.mjs',baseline];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async path=>[path,sha(await readFile(path))])));
const report={status:'running',at:new Date().toISOString(),sourceBefore:await hashes(),runs:[],scope:'Same complete original PNG sequence, size, FPS, high profile and FFmpeg. Before/after two export sessions each. Fresh encoder process on every run; repeated inputs may be OS-cache warm. No controlled OS-cold, GPU or token cost measurement. Sampled process-family CPU/RSS include HTTP input hashing/transport and encoding, exclude later output validation.'};
try{
 const run=JSON.parse(await readFile(reference+'/run.json')),frames=JSON.parse(await readFile(reference+'/frames.json')),encoder=JSON.parse(await readFile(reference+'/encoder.json'));assert.equal(run.captureStatus,'passed');assert.equal(encoder.exit,0);assert.equal(sha(await readFile(encoder.command)),run.ffmpeg.sha256);
 const rates=encoder.arguments.flatMap((v,i)=>v==='-r'?[encoder.arguments[i+1]]:[]);assert.equal(rates.length,1);const fps=Number(rates[0]);assert.ok(Number.isSafeInteger(fps)&&fps>=1&&fps<=120);
 const inputs=frames.slice(1).map(frame=>reference+'/frame-'+frame.frame+'/final.png'),inputHashes={};for(const file of inputs)inputHashes[file]=sha(await readFile(file));report.inputs=inputHashes;
 const ffprobe=join(dirname(encoder.command),'ffprobe'),metadata=async path=>JSON.parse((await execute(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,pix_fmt,color_range,color_space','-of','json',path],{timeout:180000})).stdout).streams[0];
 const rgbHash=async path=>(await execute(encoder.command,['-v','error','-i',path,'-map','0:v:0','-c:v','rawvideo','-pix_fmt','rgb24','-f','hash','-hash','sha256','pipe:1'],{timeout:180000})).stdout.trim();
 const originalVideo=reference+'/original.mp4',originalMetadata=await metadata(originalVideo),originalRgb=await rgbHash(originalVideo);assert.equal(Number(originalMetadata.nb_read_frames),inputs.length);assert.match(originalRgb,/^SHA256=[a-f0-9]{64}$/);
 report.original={path:originalVideo,sha256:sha(await readFile(originalVideo)),metadata:originalMetadata,decodedRgbHash:originalRgb,ffmpeg:run.ffmpeg};
 const before=(await import(pathToFileURL(resolve(baseline)))).createExportServer;
 for(const [label,create] of [['before',before],['after',createExportServer]])for(let iteration=1;iteration<=2;iteration++){
  let service;const directory=out+'/'+label+'-'+iteration;await mkdir(directory);const start=performance.now();
  const measured=await measureFamily(process.pid,async()=>{
   try{
    service=await create({root:directory+'/service',ffmpegPath:encoder.command});const address=await service.listen(0);
    const request=async(path,body,headers={'content-type':'application/json'})=>{const response=await fetch('http://127.0.0.1:'+address.port+path,{method:'POST',headers,body:headers['content-type']==='application/json'?JSON.stringify(body):body}),data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;};
    const {id}=await request('/api/exports',{width:originalMetadata.width,height:originalMetadata.height,inputWidth:frames[0].width,inputHeight:frames[0].height,fps,frames:inputs.length,format:'mp4',profile:'mathart',quality:'high'});
    let bytes=0;for(let i=0;i<inputs.length;i++){const png=await readFile(inputs[i]);assert.equal(sha(png),inputHashes[inputs[i]]);bytes+=png.length;await request('/api/exports/'+id+'/frames?index='+i,png,{'content-type':'image/png'});}
    await request('/api/exports/'+id+'/finish',{});return{path:directory+'/service/'+id+'.mp4',uploadedBytes:bytes};
   }finally{if(service){await service.close();assert.equal(service.ownedProcessCount,0);}}
  });
  const elapsedMs=performance.now()-start,actualMetadata=await metadata(measured.path),actualRgb=await rgbHash(measured.path),video=await readFile(measured.path);assert.deepEqual(actualMetadata,originalMetadata);
  const options=video.toString('latin1').match(/x264 - core [\x20-\x7e]{1,2200}/)?.[0];assert.ok(options,'Missing actual x264 options');
  const result={label,iteration,cacheState:iteration===1?'first measured session; OS cache not controlled':'repeat session/input; fresh encoder process',elapsedMs,...measured,metadata:actualMetadata,decodedRgbHash:actualRgb,exactOriginalRgb:actualRgb===originalRgb,sha256:sha(video),x264Options:options,remainingProcesses:service.ownedProcessCount};report.runs.push(result);console.log(JSON.stringify({label,iteration,elapsedMs,exactOriginalRgb:result.exactOriginalRgb,processFamily:result.processFamily}));if(label==='after')assert.equal(result.exactOriginalRgb,true);
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)report.status='failed';await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,report:out+'/report.json'}));if(report.status!=='passed')process.exitCode=1;}
