import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
/** Independent raw RGBA input using the retained MathArt high-quality argv.
 * This checks content/order/scaling through the PNG service against raw input;
 * it is not an independent H.264 implementation or original scene rendering. */
export function verifyRecordingVideo(file,settings,expectedFrames,referenceFile){
 const {width,height,inputWidth,inputHeight,fps}=settings;
 assert.equal(settings.profile,'mathart');assert.equal(settings.quality,'high');assert.equal(settings.format,'mp4');
 assert.ok(expectedFrames.length>0&&expectedFrames.length<=128);
 const inputBytes=inputWidth*inputHeight*4,outputBytes=width*height*3;
 assert.ok(Number.isSafeInteger(inputBytes)&&inputBytes>0&&inputBytes*expectedFrames.length<=96*1024**2);
 assert.ok(Number.isSafeInteger(outputBytes)&&outputBytes>0&&outputBytes*expectedFrames.length<=32*1024**2);
 for(const pixels of expectedFrames)assert.equal(pixels.length,inputBytes);
 const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate,duration,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',file],{encoding:'utf8',timeout:30000})).streams[0];
 assert.equal(metadata.width,width);assert.equal(metadata.height,height);assert.equal(Number(metadata.nb_read_frames),expectedFrames.length);assert.equal(metadata.r_frame_rate,`${fps}/1`);
 assert.ok(['yuv444p','yuvj444p'].includes(metadata.pix_fmt));assert.equal(metadata.color_range,'pc');assert.equal(metadata.color_space,'bt709');
 assert.ok(Math.abs(Number(metadata.duration)-expectedFrames.length/fps)<=0.000001,'Video duration differs');
 const args=['-v','error','-nostdin','-y','-f','rawvideo','-pix_fmt','rgba','-s',`${inputWidth}x${inputHeight}`,'-framerate',String(fps),'-threads','2','-i','pipe:0','-an','-filter_threads','2','-filter_complex_threads','2'];
 if(inputWidth!==width||inputHeight!==height)args.push('-vf',`scale=${width}:${height}:flags=lanczos`);
 args.push('-c:v','libx264','-pix_fmt','yuv444p','-color_range','pc','-colorspace','bt709','-color_primaries','bt709','-color_trc','iec61966-2-1','-movflags','+faststart+write_colr','-preset','slow','-crf','18','-tune','animation','-threads','2',referenceFile);
 execFileSync('ffmpeg',args,{input:Buffer.concat(expectedFrames),timeout:30000,maxBuffer:4*1024**2});
 const decode=path=>execFileSync('ffmpeg',['-v','error','-nostdin','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:30000,maxBuffer:32*1024**2});
 const actual=decode(file),expected=decode(referenceFile);assert.equal(actual.length,outputBytes*expectedFrames.length);assert.equal(expected.length,actual.length);
 const colors=new Set();for(let i=0;i<actual.length&&colors.size<=8;i+=3)colors.add(actual.subarray(i,i+3).toString('hex'));
 assert.ok(colors.size>8,'Encoded video is empty or uniform');
 const rows=[];for(let i=0;i<expectedFrames.length;i++){
  const a=actual.subarray(i*outputBytes,(i+1)*outputBytes),b=expected.subarray(i*outputBytes,(i+1)*outputBytes);let differentChannels=0,maxAbs=0;
  for(let j=0;j<a.length;j++){const d=Math.abs(a[j]-b[j]);if(d)differentChannels++;maxAbs=Math.max(maxAbs,d);}
  rows.push({index:i,inputRgbaSha256:sha(expectedFrames[i]),decodedSha256:sha(a),referenceSha256:sha(b),differentChannels,maxAbs});
 }
 assert.ok(rows.every(r=>r.differentChannels===0),'Decoded video content/order differs from raw RGBA reference');
 const distinctFrames=new Set(rows.map(r=>r.decodedSha256)).size;
 // Content equality must reject both reordered and repeated images when the
 // actual scene supplies a distinguishable pair; no synthetic test pixels.
 const pair=rows.findIndex(r=>r.decodedSha256!==rows[0].decodedSha256);
 if(pair>0){assert.notDeepEqual(actual.subarray(0,outputBytes),expected.subarray(pair*outputBytes,(pair+1)*outputBytes));assert.notDeepEqual(actual.subarray(pair*outputBytes,(pair+1)*outputBytes),expected.subarray(0,outputBytes));}
 return{metadata,rows,distinctFrames,nonUniform:true,decodedSha256:sha(actual),referenceDecodedSha256:sha(expected),referenceFile,referenceArguments:args,sequenceSensitivity:pair>0?{swappedDistinctPairRejected:[0,pair],repeatedFirstFrameRejectedAt:pair}:null,colorMetadataLimit:'Missing transfer or primaries fields remain unknown.',scope:'Every decoded RGB channel equals independent raw-input FFmpeg encoding; lossy H.264 is not expected to equal uncompressed input RGB.'};
}
