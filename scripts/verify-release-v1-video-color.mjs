// Real shared export service + FFmpeg. No browser, original app, or JVM.
// Deliberately reports measured lossy RGB errors; it does not invent a native
// equivalence or visual-quality acceptance threshold.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {createExportServer} from '../server/index.mjs';
import {findFFmpeg} from '../desktop/host.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),exec=promisify(execFile);
const option=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
if(process.argv.includes('--help')){console.log('node scripts/verify-release-v1-video-color.mjs [--ffmpeg=/absolute/ffmpeg] [--ffprobe=/absolute/ffprobe]');process.exit(0);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sources=['server/index.mjs','desktop/host.mjs','scripts/verify-release-v1-video-color.mjs'];
const snapshots=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await readFile(path.join(root,p)))])));
await mkdir(path.join(root,'.cache'),{recursive:true});
const directory=await mkdtemp(path.join(root,'.cache/release-v1-video-color-'));
const before=await snapshots(),started=performance.now(),report={createdAt:new Date().toISOString(),scope:'Real production createExportServer MP4, RGB bars, neutral gray levels, and one/two/four-pixel fine lines. Exact input PNG bytes; decoded RGB error measurements. No original runtime comparison, no quality-threshold certification.',sourceBefore:before,checks:{},measurements:[],limitations:['MP4 libx264 production defaults only; WebM/GIF and live capture are outside this measurement.','RGB errors include the real FFmpeg RGB-to-YUV, 4:2:0 subsampling, lossy encode and decode pipeline. No color-managed display measurement.','CPU/process-family RSS are left to the external measurement runner; VRAM and token usage are not measured.']};
let service,origin,primaryError;
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(type,data){const b=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const v of b)crc=crcTable[(crc^v)&255]^(crc>>>8);const head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([head,b,tail]);}
function png(rgb,w,h){const header=Buffer.alloc(13);header.writeUInt32BE(w);header.writeUInt32BE(h,4);header[8]=8;header[9]=2;const scan=Buffer.alloc(h*(w*3+1));for(let y=0;y<h;y++)rgb.copy(scan,y*(w*3+1)+1,y*w*3,(y+1)*w*3);return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);}
function metric(expected,actual,indices){const errors=[],channels=[{sum:0,max:0},{sum:0,max:0},{sum:0,max:0}];let square=0,signed=0;for(const i of indices){const e=Math.abs(actual[i]-expected[i]);errors.push(e);square+=e*e;signed+=actual[i]-expected[i];channels[i%3].sum+=e;channels[i%3].max=Math.max(channels[i%3].max,e);}errors.sort((a,b)=>a-b);const count=errors.length,mae=errors.reduce((a,b)=>a+b,0)/count,mse=square/count;return{channels:count,meanAbsoluteError:mae,rootMeanSquareError:Math.sqrt(mse),maxAbsoluteError:errors.at(-1),p95AbsoluteError:errors[Math.floor((count-1)*.95)],signedMeanError:signed/count,psnrDb:mse===0?null:10*Math.log10(255**2/mse),exact:mse===0,perChannel:channels.map(c=>({mae:c.sum/(count/3),max:c.max}))};}
const width=256,height=192,frames=3,fps=12,colors=[[255,255,255],[255,255,0],[0,255,255],[0,255,0],[255,0,255],[255,0,0],[0,0,255],[0,0,0]];
const fixtures=['rgb-bars','gray-ramp','fine-lines'].map((name,frame)=>{const rgb=Buffer.alloc(width*height*3);for(let y=0;y<height;y++)for(let x=0;x<width;x++){let c;if(frame===0)c=colors[Math.floor(x/32)];else if(frame===1){const v=Math.round(Math.floor(x/16)*255/15);c=[v,v,v];}else{const pitch=y<64?1:y<128?2:4,bright=Math.floor(x/pitch)%2===0;c=y%64<32?(bright?[255,255,255]:[0,0,0]):(bright?[255,0,0]:[0,0,255]);}rgb.set(c,(y*width+x)*3);}return{name,rgb,png:png(rgb,width,height)};});
async function request(route,options={},status=200){const response=await fetch(origin+route,{...options,signal:AbortSignal.timeout(90000)});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
try{
 const ffmpeg=await findFFmpeg(option('ffmpeg')),ffprobe=option('ffprobe')??(path.isAbsolute(ffmpeg)?path.join(path.dirname(ffmpeg),'ffprobe'):'ffprobe');
 report.executables={ffmpeg,ffprobe};report.ffmpegVersion=(await exec(ffmpeg,['-version'],{timeout:10000,maxBuffer:1024**2})).stdout.split('\n')[0];
 service=await createExportServer({root:path.join(directory,'service'),ffmpegPath:ffmpeg});const address=await service.listen(0);origin=`http://127.0.0.1:${address.port}`;report.origin=origin;
 report.health=await request('/api/health');assert.equal(report.health.ffmpeg,true);
 const job=await request('/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width,height,fps,frames,format:'mp4'})},201);report.session=job.id;
 for(const [i,f]of fixtures.entries()){await writeFile(path.join(directory,f.name+'.png'),f.png);assert.equal((await request(`/api/exports/${job.id}/frames?index=${i}`,{method:'POST',headers:{'content-type':'image/png'},body:f.png})).frames,i+1);}
 const result=await request(`/api/exports/${job.id}/finish`,{method:'POST'});assert.equal(result.frames,frames);const video=path.join(directory,'service',job.id+'.mp4');
 const downloaded=Buffer.from(await(await fetch(origin+result.url,{signal:AbortSignal.timeout(15000)})).arrayBuffer());assert.deepEqual(downloaded,await readFile(video));report.checks.downloadExact={bytes:downloaded.length,sha256:hash(downloaded)};
 const probe=JSON.parse((await exec(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=codec_name,width,height,nb_read_frames,r_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries','-of','json',video],{timeout:30000,maxBuffer:1024**2})).stdout).streams[0];
 assert.equal(probe.codec_name,'h264');assert.equal(probe.width,width);assert.equal(probe.height,height);assert.equal(Number(probe.nb_read_frames),frames);assert.equal(probe.r_frame_rate,`${fps}/1`);report.checks.video=probe;
 const raw=(await exec(ffmpeg,['-v','error','-i',video,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{timeout:60000,encoding:'buffer',maxBuffer:width*height*3*frames+1024**2})).stdout;assert.equal(raw.length,width*height*3*frames);await writeFile(path.join(directory,'decoded.rgb24'),raw);
 for(const [i,f]of fixtures.entries()){const actual=raw.subarray(i*f.rgb.length,(i+1)*f.rgb.length),all=Array.from({length:f.rgb.length},(_,j)=>j),interior=[];for(let y=4;y<height-4;y++)for(let x=4;x<width-4;x++)if(i===2||x%(i===0?32:16)>=4&&x%(i===0?32:16)<(i===0?28:12))for(let c=0;c<3;c++)interior.push((y*width+x)*3+c);report.measurements.push({name:f.name,inputPngSha256:hash(f.png),inputRgbSha256:hash(f.rgb),decodedRgbSha256:hash(actual),wholeFrame:metric(f.rgb,actual,all),interior:metric(f.rgb,actual,interior)});}
 assert.equal(new Set(report.measurements.map(x=>x.decodedRgbSha256)).size,3);report.checks.threeDistinctDecodedFrames=true;report.status='passed';report.qualityDecision='Measured only; numerical color acceptance remains a reviewer decision.';
}catch(error){primaryError=error;report.status='failed';report.error=error.stack??String(error);}
finally{try{if(service){await service.close();report.cleanup={ownedProcessCount:service.ownedProcessCount,serviceClosed:true};assert.equal(service.ownedProcessCount,0);}}catch(error){report.status='failed';report.cleanupError=error.stack??String(error);primaryError??=error;}
 report.sourceAfter=await snapshots();report.sourceStable=JSON.stringify(before)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';primaryError??=new Error('Source changed during verification');}
 report.elapsedMs=performance.now()-started;await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(path.join(directory,'report.json'));}
if(primaryError)throw primaryError;
