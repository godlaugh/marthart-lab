import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access,constants,open,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const MAX_PNG=32*1024**2,MAX_VIDEO=2*1024**3,MAX_PIXELS=1920*1080;
async function hashFile(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');}
async function executable(name){
 for(const directory of (process.env.PATH??'').split(path.delimiter)){
  const candidate=path.resolve(directory||'.',name);try{await access(candidate,constants.X_OK);if((await stat(candidate)).isFile())return await realpath(candidate);}catch{}
 }
 throw Error(`Required executable unavailable: ${name}`);
}
function rgbaInspection(frameBytes,rows,facts){
 let hash=createHash('sha256'),used=0,first,changedPixels=0,carryLength=0;const carry=Buffer.alloc(4);
 const pixel=(bytes,at)=>{if(!first)first=[bytes[at],bytes[at+1],bytes[at+2]];else if(bytes[at]!==first[0]||bytes[at+1]!==first[1]||bytes[at+2]!==first[2])changedPixels++;};
 return new Transform({transform(chunk,_encoding,done){
  for(let at=0;at<chunk.length;){const length=Math.min(frameBytes-used,chunk.length-at);hash.update(chunk.subarray(at,at+length));
   let cursor=at;const end=at+length;
   if(carryLength){const take=Math.min(4-carryLength,end-cursor);chunk.copy(carry,carryLength,cursor,cursor+take);cursor+=take;carryLength+=take;if(carryLength===4){pixel(carry,0);carryLength=0;}}
   if(!first&&cursor+4<=end){pixel(chunk,cursor);cursor+=4;}
   for(;cursor+4<=end;cursor+=4)if(chunk[cursor]!==first[0]||chunk[cursor+1]!==first[1]||chunk[cursor+2]!==first[2])changedPixels++;
   if(cursor<end){carryLength=end-cursor;chunk.copy(carry,0,cursor,end);}
   used+=length;at+=length;
   if(used===frameBytes){rows.push({index:rows.length,inputRgbaSha256:hash.digest('hex'),changedPixels,backgroundRgb:first});facts.nonUniform||=changedPixels>0;hash=createHash('sha256');used=0;first=undefined;changedPixels=0;}}
  done(null,chunk);
 },flush(done){done(used?Error(`PNG decode produced an incomplete RGBA frame (${used} bytes)`):undefined);}});
}
async function* frames(stream,frameBytes){
 let frame=Buffer.allocUnsafe(frameBytes),used=0;
 for await(const chunk of stream){for(let at=0;at<chunk.length;){const length=Math.min(frameBytes-used,chunk.length-at);chunk.copy(frame,used,at,at+length);used+=length;at+=length;
  if(used===frameBytes){yield frame;frame=Buffer.allocUnsafe(frameBytes);used=0;}}}
 assert.equal(used,0,'Incomplete decoded RGB frame');
}
/** Finite HQ oracle: accepted PNG bytes -> independent raw RGBA input -> the
 * generic production H.264 settings. This is not an independent H.264 codec
 * or an original-scene oracle. No complete raw video is retained in memory. */
export async function verifyHQVideo({file,uploads,width,height,fps,referenceFile}){
 const start=performance.now(),owned=new Set(),processes=[],inputRows=[];
 const result={status:'running',stage:'admission',file,referenceFile,width,height,fps,rows:[],processes:{started:0,closed:0,ownedRemaining:0,children:processes}};
 let timeout=false,termination;
 const terminate=()=>termination??=(async()=>{
  const children=[...owned];for(const child of children)child.kill('SIGTERM');
  const force=setTimeout(()=>{for(const child of children)if(owned.has(child))child.kill('SIGKILL');},1000);force.unref();
  try{await Promise.all(children.map(child=>child.closed));}finally{clearTimeout(force);}
 })();
 const timer=setTimeout(()=>{timeout=true;void terminate();},15*60*1000);timer.unref();
 const launch=(command,args,label,{input=false,output=true}={})=>{
  assert.ok(!timeout,'HQ video verification timed out');assert.ok(!termination,'Child launch after verification failure');
  const facts={label,command,args,pid:null,closed:false,code:null,signal:null,stderr:''};processes.push(facts);
  const child=spawn(command,args,{stdio:[input?'pipe':'ignore',output?'pipe':'ignore','pipe','pipe']});owned.add(child);facts.pid=child.pid??null;
  child.stdin?.on('error',()=>{});child.stdout?.on('error',()=>{});
  child.stdio[3].on('error',()=>{});child.stdio[3].resume();
  child.stderr.on('data',bytes=>{if(facts.stderr.length<65536)facts.stderr+=bytes.toString('utf8').slice(0,65536-facts.stderr.length);});
  child.closed=new Promise(resolve=>{child.once('error',error=>{facts.spawnError=error.message;});child.once('close',(code,signal)=>{Object.assign(facts,{closed:true,code,signal});owned.delete(child);resolve(facts);});});
  return child;
 };
 const closed=async child=>{const facts=await child.closed;assert.ok(!timeout,'HQ video verification timed out');assert.equal(facts.spawnError,undefined,`${facts.label}: ${facts.spawnError}`);assert.equal(facts.code,0,`${facts.label} failed (${facts.signal??facts.code}): ${facts.stderr}`);return facts;};
 const capture=async(command,args,label)=>{
  const child=launch(command,args,label);let text='',bytes=0;
  for await(const chunk of child.stdout){bytes+=chunk.length;assert.ok(bytes<=1024**2,`${label} output too large`);text+=chunk.toString('utf8');}
  await closed(child);return text;
 };
 try{
  assert.ok(Number.isSafeInteger(width)&&width>0&&width<=4096&&width%2===0,'Invalid H.264 width');
  assert.ok(Number.isSafeInteger(height)&&height>0&&height<=4096&&height%2===0,'Invalid H.264 height');
  assert.ok(width*height<=MAX_PIXELS,'HQ verification exceeds 1080p pixel capacity');
  assert.ok(Number.isSafeInteger(fps)&&fps>=1&&fps<=120,'Invalid FPS');
  assert.ok(Array.isArray(uploads)&&uploads.length>=2&&uploads.length<=300,'HQ verification requires 2–300 frames');
  assert.equal(typeof file,'string');assert.equal(typeof referenceFile,'string');assert.notEqual(path.resolve(file),path.resolve(referenceFile));
  const actualStat=await stat(file);assert.ok(actualStat.isFile()&&actualStat.size>0&&actualStat.size<=MAX_VIDEO,'Invalid actual video');
  // Exclusive creation prevents clobbering evidence. A failed new reference is
  // deliberately retained, with its failure report, rather than silently reused.
  const reservation=await open(referenceFile,'wx');await reservation.close();
  let inputBytes=0;
  const inputs=[];
  for(let index=0;index<uploads.length;index++){
   const upload=uploads[index];assert.equal(upload.index,index,'Non-contiguous upload index');assert.equal(upload.accepted,true,'Unaccepted upload');
   assert.equal(typeof upload.path,'string');assert.match(upload.pngSha,/^[a-f0-9]{64}$/);
   const source=await stat(upload.path);assert.ok(source.isFile()&&source.size>=33&&source.size<=MAX_PNG,'Invalid PNG file size');inputBytes+=source.size;assert.ok(inputBytes<=MAX_VIDEO,'PNG sequence exceeds 2 GiB encoded input capacity');
   const handle=await open(upload.path,'r');const header=Buffer.alloc(33);try{assert.equal((await handle.read(header,0,33,0)).bytesRead,33);}finally{await handle.close();}
   assert.equal(header.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(header.readUInt32BE(8),13);assert.equal(header.toString('ascii',12,16),'IHDR');
   assert.equal(header.readUInt32BE(16),width);assert.equal(header.readUInt32BE(20),height);assert.equal(header[24],8);assert.equal(header[25],6,'Expected source RGBA PNG');assert.equal(header[26],0);assert.equal(header[27],0);assert.equal(header[28],0);
   assert.equal(await hashFile(upload.path),upload.pngSha,`PNG hash mismatch ${index}`);
   inputs.push(Object.freeze({index,path:upload.path,pngSha256:upload.pngSha,bytes:source.size}));
  }
  result.frameCount=inputs.length;result.inputPngBytes=inputBytes;
  const ffmpeg=await executable('ffmpeg'),ffprobe=await executable('ffprobe');
  result.tools={ffmpeg:{path:ffmpeg,sha256:await hashFile(ffmpeg),version:(await capture(ffmpeg,['-version'],'ffmpeg-version')).split('\n')[0]},ffprobe:{path:ffprobe,sha256:await hashFile(ffprobe),version:(await capture(ffprobe,['-version'],'ffprobe-version')).split('\n')[0]}};
  const probe=async(video,label)=>{
   const parsed=JSON.parse(await capture(ffprobe,['-v','error','-count_frames','-show_entries','stream=index,codec_type,codec_name,width,height,nb_read_frames,r_frame_rate,avg_frame_rate,duration,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',video],label));
   assert.equal(parsed.streams?.length,1,'Expected exactly one video stream');const metadata=parsed.streams[0];
   assert.equal(metadata.codec_type,'video');assert.equal(metadata.codec_name,'h264');assert.equal(metadata.width,width);assert.equal(metadata.height,height);assert.equal(metadata.pix_fmt,'yuv420p');assert.equal(Number(metadata.nb_read_frames),inputs.length);
   for(const key of ['r_frame_rate','avg_frame_rate']){const [n,d]=metadata[key].split('/').map(Number);assert.ok(n>0&&d>0&&n===fps*d,`Unexpected ${key}`);}
   assert.ok(Math.abs(Number(metadata.duration)-inputs.length/fps)<=0.000001,'Unexpected video duration');return metadata;
  };
  result.stage='probe-actual';result.metadata=await probe(file,'probe-actual');
  result.stage='raw-input-reference';
  const decodeArguments=['-hide_banner','-loglevel','error','-nostdin','-f','image2pipe','-vcodec','png','-framerate',String(fps),'-threads','2','-i','pipe:0','-an','-filter_threads','2','-filter_complex_threads','2','-f','rawvideo','-pix_fmt','rgba','-threads','2','pipe:1'];
  const referenceArguments=['-hide_banner','-loglevel','error','-nostdin','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-threads','2','-i','pipe:0','-an','-filter_threads','2','-filter_complex_threads','2','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart','-threads','2','-fs',String(MAX_VIDEO),'-progress','pipe:3','-nostats',referenceFile];
  result.inputDecodeArguments=decodeArguments;result.referenceArguments=referenceArguments;
  const decoder=launch(ffmpeg,decodeArguments,'png-to-rgba',{input:true}),encoder=launch(ffmpeg,referenceArguments,'raw-reference',{input:true,output:false}),inputFacts={nonUniform:false};
  async function* pngs(){for(const input of inputs){const hash=createHash('sha256');let size=0;for await(const chunk of createReadStream(input.path)){size+=chunk.length;assert.ok(size<=input.bytes,'PNG grew during read');hash.update(chunk);yield chunk;}assert.equal(size,input.bytes);assert.equal(hash.digest('hex'),input.pngSha256,`PNG changed during reference encoding ${input.index}`);}}
  const guard=promise=>promise.catch(async error=>{await terminate();throw error;});
  const encoded=await Promise.allSettled([guard(pipeline(Readable.from(pngs()),decoder.stdin)),guard(pipeline(decoder.stdout,rgbaInspection(width*height*4,inputRows,inputFacts),encoder.stdin)),guard(closed(decoder)),guard(closed(encoder))]);
  for(const entry of encoded)if(entry.status==='rejected')throw entry.reason;
  assert.equal(inputRows.length,inputs.length,'PNG decode frame count differs');
  result.inputNonUniform=inputFacts.nonUniform;result.distinctInputFrames=new Set(inputRows.map(row=>row.inputRgbaSha256)).size;
  result.minChangedPixels=Math.min(...inputRows.map(row=>row.changedPixels));result.minimumDistinctFrames=Math.ceil(inputs.length*.95);
  assert.ok(result.minChangedPixels>100,'Every source PNG must contain more than 100 non-background RGB pixels');assert.ok(result.distinctInputFrames>=result.minimumDistinctFrames,'Fewer than 95% of source PNG frames differ');
  result.referenceMetadata=await probe(referenceFile,'probe-reference');
  result.stage='compare-decoded-rgb';
  const decodeVideo=(video,label)=>launch(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-threads','2','-i',video,'-an','-filter_threads','2','-filter_complex_threads','2','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-threads','2','pipe:1'],label);
  const actual=decodeVideo(file,'decode-actual'),reference=decodeVideo(referenceFile,'decode-reference');
  const actualFrames=frames(actual.stdout,width*height*3),referenceFrames=frames(reference.stdout,width*height*3);
  const actualHash=createHash('sha256'),referenceHash=createHash('sha256');let nonUniform=false;
  for(let index=0;;index++){
   const [a,b]=await Promise.all([actualFrames.next(),referenceFrames.next()]);assert.equal(a.done,b.done,'Decoded video lengths differ');if(a.done)break;
   assert.ok(index<inputs.length,'Unexpected extra decoded frame');actualHash.update(a.value);referenceHash.update(b.value);
   const decodedSha256=sha(a.value),referenceDecodedSha256=sha(b.value);
   if(!nonUniform)for(let at=3;at<a.value.length;at+=3)if(a.value[at]!==a.value[0]||a.value[at+1]!==a.value[1]||a.value[at+2]!==a.value[2]){nonUniform=true;break;}
   const row={...inputs[index],...inputRows[index],decodedSha256,referenceDecodedSha256,equal:decodedSha256===referenceDecodedSha256};result.rows.push(row);
   assert.ok(row.equal,`Decoded RGB SHA differs at frame ${index}`);
  }
  await Promise.all([closed(actual),closed(reference)]);assert.equal(result.rows.length,inputs.length);assert.ok(nonUniform,'Video is empty/uniform');
  const distinctFrames=new Set(result.rows.map(row=>row.decodedSha256)).size;assert.ok(distinctFrames>=result.minimumDistinctFrames,'Fewer than 95% of decoded video frames differ');
  const pair=result.rows.findIndex(row=>row.decodedSha256!==result.rows[0].decodedSha256);
  result.nonUniform=nonUniform;result.distinctFrames=distinctFrames;result.sequenceSensitivity={distinctPair:[0,pair],swappedDistinctPairRejected:true,repeatedFirstFrameRejectedAt:pair};
  result.decodedSha256=actualHash.digest('hex');result.referenceDecodedSha256=referenceHash.digest('hex');result.fileSha256=await hashFile(file);result.referenceFileSha256=await hashFile(referenceFile);
  result.scope='All decoded RGB frames equal independent PNG-to-raw-input generic FFmpeg encoding. This verifies delivery/order/encoder settings, not lossless source PNG fidelity or original scene parity. PNG decoder emits full RGBA; raw RGBA uses the same full-range RGB format without adding output color metadata.';
  result.status='passed';result.stage='complete';return result;
 }catch(error){result.status='failed';result.error=error instanceof Error?error.message:String(error);const failure=error instanceof Error?error:Error(String(error));failure.verification=result;throw failure;
 }finally{
  clearTimeout(timer);await terminate();result.elapsedMs=performance.now()-start;
  Object.assign(result.processes,{started:processes.length,closed:processes.filter(child=>child.closed).length,ownedRemaining:owned.size});
 }
}
