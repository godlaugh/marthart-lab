// Pure file comparison. Exit 0 = complete and matched; 1 = complete but different;
// 2 = invalid/incomplete evidence. Float32 equality includes -0 and NaN payloads.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,dirname,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const [nativeArg,productArg,outArg]=process.argv.slice(2);
assert(nativeArg&&productArg&&outArg,'Usage: node scripts/compare-attractor-gpu-native.mjs NATIVE_CASE PRODUCT_CASE NEW_OUTPUT.json');
const native=resolve(nativeArg),product=resolve(productArg),output=resolve(outArg),sha=v=>createHash('sha256').update(v).digest('hex');
const inputPins=new Map(),maxBufferBytes=32*1024*1024;
const result={at:new Date().toISOString(),native,product,comparisonComplete:false,matched:false,status:'incomplete',
 scope:'Original-authored input → complete state including padding, every update pass, submitted point VBOs, camera projection scalars, draw uniforms/viewports, RGBA32F accumulation and full mathematical RGBA8. Raw bits; no tolerance.',
 exitCodes:{matched:0,different:1,invalidOrIncomplete:2},frames:[],limitations:[
  'Branding/formula overlays and original primary-paused drawing are excluded from this offscreen mathematical comparison.',
  'Uniform JSON is restored to float32; binary framebuffer/VBO data never goes through JSON.',
  'Runtime timeline facts are compared only when exported by the receiver; missing observations are explicitly excluded. Tracking object identity is not exported.',
  'This finite nonblank-image contract does not establish blank/offscreen cases or arbitrary-driver equivalence.',
 ]};
async function read(file){file=resolve(file);const value=await readFile(file),digest=sha(value);assert(!inputPins.has(file)||inputPins.get(file)===digest,`input changed while reading: ${file}`);inputPins.set(file,digest);return value;}
const load=async file=>JSON.parse(await read(file));
const lines=async file=>(await read(file)).toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
function local(root,name){assert(typeof name==='string'&&name.length>0);const path=resolve(root,name),rel=relative(root,path);assert(rel&&!rel.startsWith('..'+sep)&&rel!=='..'&&!rel.startsWith(sep),'artifact must stay within its capture');return path;}
function integer(value,min,max,name){assert(Number.isSafeInteger(value)&&value>=min&&value<=max,`invalid ${name}: ${value}`);return value;}
function bytesCompare(a,b,float,expectedBytes){
 if(expectedBytes!==undefined){integer(expectedBytes,1,maxBufferBytes,'buffer bytes');assert.equal(a.length,expectedBytes,'native buffer length');assert.equal(b.length,expectedBytes,'product buffer length');}
 assert(a.length>0&&b.length>0,'empty buffers are not evidence');if(float)assert(a.length%4===0&&b.length%4===0,'unaligned float32 buffer');
 const value={nativeBytes:a.length,productBytes:b.length,nativeSha256:sha(a),productSha256:sha(b),equal:a.equals(b)};
 if(a.length!==b.length)return{...value,sizeMismatch:true};
 let different=0,first=null,maxAbsolute=0,maxUlp=0,nonfinitePairs=0;const differentTexels=new Set();
 for(let i=0;i<a.length;i+=float?4:1){const av=float?a.readUInt32LE(i):a[i],bv=float?b.readUInt32LE(i):b[i];if(av===bv)continue;different++;differentTexels.add(Math.floor(i/(float?16:4)));
  const af=float?a.readFloatLE(i):av,bf=float?b.readFloatLE(i):bv;
  if(first===null)first={channel:i/(float?4:1),texel:Math.floor(i/(float?16:4)),component:'RGBA'[(i/(float?4:1))%4],nativeWord:float?'0x'+av.toString(16).padStart(8,'0'):av,productWord:float?'0x'+bv.toString(16).padStart(8,'0'):bv,nativeValue:String(af),productValue:String(bf)};
  if(Number.isFinite(af)&&Number.isFinite(bf)){maxAbsolute=Math.max(maxAbsolute,Math.abs(af-bf));if(float){const order=v=>(v&0x80000000)?0xffffffff-v:v+0x80000000;maxUlp=Math.max(maxUlp,Math.abs(order(av)-order(bv)));}}else nonfinitePairs++;
 }
 return{...value,differentChannels:different,differentTexels:differentTexels.size,first,maxAbsolute,maxUlp:float?maxUlp:undefined,nonfinitePairs:float?nonfinitePairs:undefined};
}
function floatBytes(values){assert(Array.isArray(values)&&values.length>0&&values.every(v=>typeof v==='number'&&Number.isFinite(v)),'missing/nonfinite JSON float facts');const out=Buffer.alloc(values.length*4);values.forEach((v,i)=>out.writeFloatLE(v,i*4));return out;}
function uniformCompare(n,p){
 assert(Array.isArray(n.uniforms)&&n.uniforms.length>0&&p.uniforms&&typeof p.uniforms==='object','missing active uniforms');const findings=[],names=new Set();
 for(const u of n.uniforms){assert(typeof u.name==='string'&&!names.has(u.name),'duplicate/malformed uniform');names.add(u.name);assert.equal(u.size,1,'receiver currently supports scalar/vector/matrix uniforms, not arrays');
  if(!Object.hasOwn(p.uniforms,u.name)){findings.push({name:u.name,equal:false,missing:true});continue;}
  let a=Array.isArray(u.value)?u.value:[u.value],actual=p.uniforms[u.name],b=Array.isArray(actual)?actual:[actual];
  if(u.type===35670){assert(a.length===1&&a.every(v=>v===0||v===1));assert(b.length===1&&b.every(v=>typeof v==='boolean'));a=a.map(v=>v===1);}
  const integerType=[5124,35678,35670].includes(u.type),components=({5126:1,35664:2,35665:3,35666:4,35676:16})[u.type];assert(integerType||components,'unsupported uniform type');
  if(integerType){assert.equal(a.length,1);assert.equal(b.length,1);if(u.type!==35670)assert([...a,...b].every(Number.isInteger),'malformed integer uniform');}
  else{assert.equal(a.length,components);assert.equal(b.length,components);}
  findings.push({name:u.name,type:u.type,...(integerType?{equal:JSON.stringify(a)===JSON.stringify(b),native:a,product:b}:bytesCompare(floatBytes(a),floatBytes(b),true))});
 }
 for(const name of Object.keys(p.uniforms))if(!names.has(name))findings.push({name,equal:false,productOnly:true});
 return{equal:findings.every(f=>f.equal),fields:findings};
}
function cameraValues(c){assert(c&&Array.isArray(c.center)&&c.center.length===3,'camera facts missing');return ['phi','theta','gamma','zoom','focalDistance'].map(k=>c[k]).concat(c.center);}
function foreground(bytes,draw){const u=draw.uniforms.find(u=>u.name==='backgroundRgb');assert(u&&Array.isArray(u.value)&&u.value.length===3,'missing actual background uniform');const background=u.value.map(v=>{assert(Number.isFinite(v)&&v>=0&&v<=1);return Math.round(v*255);});let changedRGBPixels=0;for(let i=0;i<bytes.length;i+=4)if(background.some((v,k)=>bytes[i+k]!==v))changedRGBPixels++;return{backgroundRgb8:background,changedRGBPixels,pixels:bytes.length/4};}
function nativeUniform(draw,name){const value=draw.uniforms.find(u=>u.name===name);assert(value,`missing native ${name}`);return Array.isArray(value.value)?value.value[0]:value.value;}
function timelineCompare(ns,ps,ordinal){
 assert(Array.isArray(ps.timelineFacts),'missing actual timeline facts');
 if(ordinal===0){assert.equal(ps.timelineFacts.length,0,'initial paused draw must not evaluate timeline');return{status:'not-evaluated-in-product-initial-paused-owner',notIncludedInMatched:true};}
 assert.equal(ps.timelineFacts.length,1,'expected exactly one actual evaluate');const call=ps.timelineFacts[0],f=call.returned;
 assert.deepEqual(call.requestArguments,[ps.temporal.time]);assert.equal(f.time,ps.temporal.time);assert.equal(f.frameIndex,ordinal-1);assert(Array.isArray(f.diagnostics));
 const queueIndexObserved=Number.isSafeInteger(ns.queueIndex)&&Number.isSafeInteger(ns.queueSize);
 if(queueIndexObserved)integer(ns.queueIndex,0,ns.queueSize,'original queue index');integer(f.queueIndex,0,queueIndexObserved?ns.queueSize:10000,'product queue index');assert.equal(typeof f.queueComplete,'boolean');
 // Source frameDeltaTime is host dt, not the manager's consumed/clamped interval.
 // No captured original activeDt exists; do not infer it from time or queue completion.
 const floats=bytesCompare(floatBytes([ns.sceneTime,...['phiRate','thetaRate','gammaRate'].map(k=>ns.camera[k])]),floatBytes([f.sceneTime,...f.rates]),true,16);
 const queue={native:{index:ns.queueIndex,complete:ns.managerFinished},product:{index:f.queueIndex,complete:f.queueComplete},indexStatus:queueIndexObserved?'observed':'original-index-not-observed',indexNotIncludedInMatched:!queueIndexObserved,equal:(!queueIndexObserved||ns.queueIndex===f.queueIndex)&&ns.managerFinished===f.queueComplete};
 const camera=bytesCompare(floatBytes(cameraValues(ns.camera)),floatBytes(cameraValues(f.camera)),true,32);
 const rawDt=ns.pausedFrame?{status:'retained-last-dt-not-host-paused-dt',notIncludedInMatched:true}:bytesCompare(floatBytes([ns.frameDeltaTime]),floatBytes([f.rawDt]),true,4);
 return{status:'observed-evaluate-return',equal:floats.equal&&queue.equal&&camera.equal&&rawDt.equal!==false,floats,queue,camera,rawDt,activeDt:{status:'original-manager-consumed-dt-not-observed',notIncludedInMatched:true,product:f.activeDt,originalHostDeltaTime:ns.frameDeltaTime}};
}
async function compare(){
 const preflight=await load(resolve(product,'preflight.json')),capture=await load(resolve(dirname(product),'report.json'));
 assert(capture.ok===true&&capture.mode==='--capture'&&capture.sourceStable===true&&capture.inputStable===true,'product capture did not complete stably');
 assert.deepEqual(capture.pageErrors,[]);assert.deepEqual(capture.cleanup,{glObjects:0,browser:'closed',server:'closed'},'product cleanup incomplete');
 assert.deepEqual(capture.sourcesBefore,capture.sourcesAfter,'product capture source pins changed');
 const capturedCase=capture.cases.filter(c=>resolve(c.dir)===product);assert.equal(capturedCase.length,1,'case missing/duplicate in capture report');const owner=capturedCase[0];
 const observed=owner.runs.filter(r=>r.variant==='observed');assert.equal(observed.length,1);const recordedFrames=new Map(observed[0].frames.map(f=>[f.label,f]));assert.equal(recordedFrames.size,observed[0].frames.length,'duplicate product frame');
 const nativeRun=await load(resolve(native,'run.json')),nativePlan=await load(resolve(native,'plan.json'));
 assert(nativeRun.exit===0&&!nativeRun.timedOut&&nativeRun.reaped===true&&nativeRun.processGroupExists===false,'original process did not close successfully');
 for(const key of ['sourceUnchanged','originalSourceUnchanged','jarUnchanged','normalSettingsUnchanged'])assert.equal(nativeRun[key],true,`original ${key}`);
 assert(nativeRun.stdout.includes('rendered=true')&&nativeRun.stdout.includes('drawableDestroyed=true')&&nativeRun.stdout.includes('gl=resourcesDisposed:0'),'original lifecycle incomplete');
 assert.equal(nativePlan.observer,true,'need observed original capture');assert.deepEqual(nativeRun.plan,nativePlan);
 result.capture={product:{ok:true,cleanup:capture.cleanup,commit:capture.commit},original:{exit:0,reaped:true,processGroupExists:false,stderr:nativeRun.stderr,sourceUnchanged:true},cameraRates:{status:'not-observed-in-product-runtime',notIncludedInMatched:true}};
 const nativeInput=await read(resolve(native,'source.json')),productInput=await read(resolve(product,'input.json'));
 assert.equal(sha(nativeInput),nativePlan.sourceSha256,'original input pin');assert.equal(sha(productInput),preflight.inputSha256,'product input pin');assert.equal(sha(productInput),owner.inputSha256);
 assert.deepEqual(JSON.parse(nativeInput),JSON.parse(productInput),'original/product authored inputs differ');result.inputs={nativeSha256:sha(nativeInput),productSha256:sha(productInput),semanticExact:true};
 assert.deepEqual(preflight.frames,owner.frames);assert.equal(preflight.completedAt,owner.completedAt);
 const currentSourcePins={};for(const [file,digest]of Object.entries(capture.sourcesBefore)){if(file.startsWith('src/')){currentSourcePins[file]=sha(await read(resolve(file)));assert.equal(currentSourcePins[file],digest,`captured product source changed: ${file}`);}}
 assert(Object.keys(currentSourcePins).length>0,'no product source pins');result.productSourcePins=currentSourcePins;result.capturedVerifierPins=Object.fromEntries(Object.entries(capture.sourcesBefore).filter(([p])=>p.startsWith('scripts/')));
 assert.equal(sha(await read(capture.bundle.file)),capture.bundle.sha256,'production bundle pin');
 const nativeData=async(label,file,bytes)=>{const name=label+'/'+file,value=await read(local(native,name));assert.equal(sha(value),nativeRun.outputs[name],`missing/changed original output pin: ${name}`);if(bytes!==undefined)assert.equal(value.length,bytes,`native ${name} byte length`);return value;};
 const productData=async(label,file,bytes)=>{const f=recordedFrames.get(label)?.files?.[file];assert(f,'missing product artifact manifest: '+label+'/'+file);const value=await read(local(resolve(product,'observed',label),file));assert.equal(value.length,f.bytes);assert.equal(sha(value),f.sha256,`product output pin: ${label}/${file}`);if(bytes!==undefined)assert.equal(value.length,bytes,`product ${label}/${file} byte length`);return value;};
 // Historical original runner pins binary outputs, not JSON/JSONL; pin metadata now
 // without claiming a capture-time metadata digest that the runner never recorded.
 result.limitations.push('Original JSON/JSONL metadata is comparison-time pinned and reread for stability; original runner output hashes cover binary/shader artifacts only.');
 const nativeJson=async(label,file)=>load(local(native,label+'/'+file)),nativeDraws=async label=>lines(local(native,label+'/draws.jsonl'));
 const post=await nativeJson('post-complete','state.json'),final=await nativeJson('paused-final','state.json');
 const completion=integer(post.activeOrdinal,2,10000,'original post-completion ordinal')-1;
 assert(post.pausedFrame===false&&post.managerFinished===true);assert(final.pausedFrame===true&&final.managerFinished===true);assert.equal(final.activeOrdinal,post.activeOrdinal);assert.equal(final.sceneTime,post.sceneTime);assert.equal(final.frameDeltaTime,0);
 const labels=['paused-initial',...Array.from({length:completion},(_,i)=>`step-${i+1}`),'post-complete','paused-final'];
 const listed=(await readdir(native,{withFileTypes:true})).filter(e=>e.isDirectory()&&/^(paused-initial|paused-final|post-complete|step-\d+)$/.test(e.name)).map(e=>e.name);
 assert.deepEqual(listed.sort(),[...labels].sort(),'original frame coverage');
 const productLabels=['paused-initial',...Array.from({length:completion+1},(_,i)=>`step-${i+1}`),'paused-final'];assert.deepEqual([...recordedFrames.keys()].sort(),[...productLabels].sort(),'product manifest frame coverage');
 assert.deepEqual((await readdir(resolve(product,'observed'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort(),[...productLabels].sort(),'product directory frame coverage');
 const count=integer(JSON.parse(nativeInput).settings.particle_count_gpu,1,10000000,'authored GPU count');
 const sparse=nativePlan.case==='warmup';assert(sparse?count===65&&completion===32:count===17&&completion===6,'unsupported finite capture contract');
 const imageLabels=sparse?['paused-initial','step-1','step-2','step-8','step-16','step-24','step-32','post-complete','paused-final']:labels;
 if(sparse)assert.equal(capture.captureAll,true,'65 contract requires all product stages');
 const timelineAvailable=[...recordedFrames.values()].every(f=>Array.isArray(f.timelineFacts));assert(!sparse||timelineAvailable,'65 requires actual timeline observations');
 result.capture.cameraRates={status:timelineAvailable?'observed-evaluate-return':'not-observed-in-product-runtime',notIncludedInMatched:!timelineAvailable};
 result.capture.tracking={status:'original tracking/trackingTarget observed; product evaluate exposes camera only',notIncludedInMatched:true};
 result.capture.managerConsumedDt={status:'not-observed-in-original; host frameDeltaTime is a distinct value',notIncludedInMatched:true};
 result.coverage={profile:sparse?'65-warmup-queue-sparse-original-images':'17-baseline-all-images',originalCompletionOrdinal:completion,expectedFrames:labels.length,frameOrder:labels,imageLabels,originalImageFrames:imageLabels.length,productImageFrames:0,productPreflightCompletion:{value:preflight.completedAt,equal:preflight.completedAt===completion},initialUploadOwners:[],nonBlankReferenceFrames:0,updateDraws:0,warmupOriginalPasses:0,warmupProductPasses:0,normalOriginalPasses:0,normalProductPasses:0,actualTimelineFrames:0};
 const initial=await nativeJson('initialized-no-draw','state.json');assert.equal(initial.activeOrdinal,0);assert.equal(initial.particleCount,count);
 const raw=await nativeData('initialized-no-draw','raw-position.f32le',count*12),dt=await nativeData('initialized-no-draw','dt.f32le',count*4);
 const size=integer(preflight.layout.size,1,4096,'state texture size');assert.equal(preflight.layout.count,count);assert(count<=size*size);
 // Layout conversion only: observed original xyz/dt words, followed by original zero padding.
 // No product seed generator or calculated reference state enters this expected upload.
 let expectedSeed=Buffer.alloc(size*size*16);for(let i=0;i<count;i++){raw.copy(expectedSeed,i*16,i*12,i*12+12);dt.copy(expectedSeed,i*16+12,i*4,i*4+4);}
 if(sparse){const actualUpload=await read(resolve(native,'initial-upload.f32le'));assert.equal(sha(actualUpload),nativeRun.outputs['initial-upload.f32le'],'actual original seed upload pin');assert.equal(actualUpload.length,size*size*16);assert(actualUpload.equals(expectedSeed),'original upload differs from initialized raw xyz/dt or zero padding');expectedSeed=actualUpload;}
 const primaryGpu=await nativeJson('primary-paused','gpu.json'),primaryDraws=await nativeDraws('primary-paused');
 assert(primaryGpu.observer===true&&primaryGpu.shaderLoaded===true&&primaryGpu.useCPURender===false);assert.deepEqual(primaryGpu.observerErrors,[]);
 const warmup=primaryDraws.filter(d=>d.stage==='update');assert.equal(warmup.length,sparse?2:0,'original warmup pass coverage');assert.equal(primaryGpu.observedUpdates,warmup.length);
 for(const d of warmup){assert.equal(d.updatePhase,'warmup');assert.equal(nativeUniform(d,'isWarmup'),1);assert.deepEqual(d.viewport,[0,0,size,size]);assert.equal(d.rowOrder,'bottom-up');await nativeData('primary-paused',d.rgbaFile,size*size*16);}
 if(sparse)assert.deepEqual(warmup.map(d=>[nativeUniform(d,'currentStepBase'),nativeUniform(d,'steps')]),[[0,100],[100,8]],'declared 101+stagger7 warmup must have both passes');
 result.coverage.warmupOriginalPasses=warmup.length;
 result.primaryWarmup={scope:'primary drawing is excluded; all source warmup update states/uniforms are required',passes:warmup.length,finalStateToPaused:bytesCompare(await nativeData('primary-paused','gpu-state.f32le',size*size*16),await nativeData('paused-initial','gpu-state.f32le',size*size*16),true,size*size*16)};
 let retainedUploads,retainedSeed,contextOrdinal;let priorQueueIndex=0;
 for(const label of labels){
  const productLabel=label==='post-complete'?`step-${post.activeOrdinal}`:label,p=resolve(product,'observed',productLabel);
  const ns=await nativeJson(label,'state.json'),ps=await load(resolve(p,'state.json')),gpu=await nativeJson(label,'gpu.json');
  assert.deepEqual(ps,recordedFrames.get(productLabel),'product frame metadata differs from capture report');
  const ordinal=label==='paused-initial'?0:label.startsWith('step-')?Number(label.slice(5)):post.activeOrdinal;
  assert.equal(ns.activeOrdinal,ordinal);assert.equal(ps.activeOrdinal,ordinal);assert.equal(ns.pausedFrame,label.startsWith('paused-'));assert.equal(ps.paused,ns.pausedFrame);
  if(label.startsWith('step-'))assert.equal(ns.managerFinished,ordinal===completion,'original completion boundary');
  assert(gpu.observer===true&&gpu.shaderLoaded===true&&gpu.useCPURender===false&&ns.useCPURender===false,'original GPU fallback');assert.deepEqual(gpu.observerErrors,[]);assert.equal(gpu.texSize,size);
  const capturedImage=imageLabels.includes(label);if(sparse){integer(ns.queueSize,1,10000,'original queue size');integer(ns.queueIndex,0,ns.queueSize,'original queue index');assert.equal(ns.capturedImage,capturedImage,'declared original image coverage');if(label.startsWith('step-')){assert.equal(capturedImage,ordinal===1||ordinal===2||ordinal===16||ns.queueIndex!==priorQueueIndex||ns.managerFinished,'source boundary-image selection');priorQueueIndex=ns.queueIndex;}}
  const width=integer(ns.target[2],1,16384,'target width'),height=integer(ns.target[3],1,16384,'target height'),aw=integer(gpu.accumWidth,1,16384,'accumulation width'),ah=integer(gpu.accumHeight,1,16384,'accumulation height');
  assert.deepEqual(ns.target,preflight.target);assert.deepEqual(ns.primary,preflight.primary);assert.equal(aw,preflight.display.accumWidth);assert.equal(ah,preflight.display.accumHeight);
  const nd=await nativeDraws(label),pd=await lines(resolve(p,'draws.jsonl'));
  assert.deepEqual(nd.map(d=>d.draw),Array.from({length:nd.length},(_,i)=>i+1),'native draw indices');assert.equal(new Set(pd.map(d=>d.draw)).size,pd.length,'duplicate product draw');
  for(const d of pd)assert(['update','splat','present'].includes(d.stage),'unclassified product draw');
  const frame={label,productLabel,activeOrdinal:ordinal,nativeSceneTime:ns.sceneTime,productRequestTime:ps.temporal?.time,capturedImage,stages:{},draws:[],initialUploads:{}};
  const uploaded=ps.uploads.filter(u=>u.call==='bufferData'),seeds=ps.uploads.filter(u=>u.call==='texImage2D'),newOwner=label==='paused-initial'||label==='step-1';
  assert.equal(uploaded.length,newOwner?2:0,'unexpected/missing actual point VBO uploads');assert.equal(seeds.length,newOwner?1:0,'unexpected/missing actual seed upload');
  if(newOwner){
   retainedUploads=await Promise.all(uploaded.map(async(u,i)=>({owner:productLabel,file:u.file,bytes:await productData(productLabel,u.file,count*(i===0?8:16))})));
   assert.deepEqual(seeds[0].args,[3553,0,34836,size,size,0,6408,5126]);retainedSeed={owner:productLabel,file:seeds[0].file,bytes:await productData(productLabel,seeds[0].file,size*size*16)};
   result.coverage.initialUploadOwners.push(productLabel);
  }
  assert(retainedUploads&&retainedSeed);for(const [i,file]of ['tex-index.f32le','color.f32le'].entries())frame.initialUploads[file]={productOwner:retainedUploads[i].owner,productFile:retainedUploads[i].file,...bytesCompare(await nativeData(label,file,count*(i===0?8:16)),retainedUploads[i].bytes,true,count*(i===0?8:16))};
  frame.initialUploads.seed={productOwner:retainedSeed.owner,productFile:retainedSeed.file,source:sparse?'actual original initial-upload.f32le; independently bound to initialized raw xyz/dt and padding':'initialized-no-draw raw-position/dt words plus zero padding',...bytesCompare(expectedSeed,retainedSeed.bytes,true,size*size*16)};
  if(timelineAvailable){
   frame.timeline=timelineCompare(ns,ps,ordinal);if(ordinal>0)result.coverage.actualTimelineFrames++;
   assert(ps.gpuContext&&typeof ps.gpuContext.unmaskedRenderer==='string'&&ps.gpuContext.unmaskedRenderer.length>0,'missing actual context identity');
   if(label==='paused-initial')contextOrdinal=ps.gpuContext.contextOrdinal;
   else if(label==='step-1'){assert.notEqual(ps.gpuContext.contextOrdinal,contextOrdinal,'independent paused owner was reused');contextOrdinal=ps.gpuContext.contextOrdinal;}
   else assert.equal(ps.gpuContext.contextOrdinal,contextOrdinal,'unexpected product context replacement');
   frame.productContext=ps.gpuContext;
  }
  frame.camera=bytesCompare(floatBytes(cameraValues(ns.camera)),floatBytes(cameraValues(ps.camera?.camera??ps.camera)),true,32);
  frame.nativeCameraUncompared={tracking:ns.camera.tracking,trackingTarget:ns.camera.trackingTarget,...(!timelineAvailable?{rates:['phiRate','thetaRate','gammaRate'].map(k=>ns.camera[k])}:{})};
  for(const [stage,file,float,bytes]of [['state','gpu-state.f32le',true,size*size*16],['accumulation','accum.f32le',true,aw*ah*16],['present','math.rgba',false,width*height*4]]){
   const b=await productData(productLabel,file,bytes);
   if(stage!=='state'&&!capturedImage){assert(!Object.hasOwn(nativeRun.outputs,`${label}/${file}`),'unexpected undeclared original image');frame.stages[stage]={status:'original-not-captured',notIncludedInMatched:true,productBytes:b.length,productSha256:sha(b)};continue;}
   const a=await nativeData(label,file,bytes);frame.stages[stage]=bytesCompare(a,b,float,bytes);
   if(stage==='present'){const present=nd.filter(d=>d.stage==='present');assert.equal(present.length,1);frame.foreground={native:foreground(a,present[0]),product:foreground(b,present[0])};assert(frame.foreground.native.changedRGBPixels>0,'blank original mathematical frame needs a separately declared blank-case contract');result.coverage.nonBlankReferenceFrames++;}
  }
  const bottom=await productData(productLabel,'math.rgba',width*height*4),top=await productData(productLabel,'output-top-down.rgba',width*height*4);
  for(let y=0;y<height;y++)assert(bottom.subarray(y*width*4,(y+1)*width*4).equals(top.subarray((height-y-1)*width*4,(height-y)*width*4)),'product delivered pixels are not exact top-down presentation');
  frame.productOutput={rowOrder:'top-down',bytes:top.length,sha256:sha(top),matchesStageRowFlip:true};
  result.coverage.productImageFrames++;
  const nativeUpdates=nd.filter(d=>d.stage==='update'),productUpdates=pd.filter(d=>d.stage==='update');
  const productWarmup=productUpdates.filter(d=>d.uniforms.isWarmup===true),productNormal=productUpdates.filter(d=>d.uniforms.isWarmup===false);
  assert.equal(productWarmup.length+productNormal.length,productUpdates.length,'untyped product update phase');assert.equal(productWarmup.length,newOwner?warmup.length:0,'product warmup owner/pass coverage');
  const expectedNormal=ordinal>0&&ordinal<=completion&&!ns.pausedFrame?1:0;assert.equal(nativeUpdates.length,expectedNormal,'source normal-pass coverage');assert.equal(productNormal.length,expectedNormal,'product normal-pass coverage');
  result.coverage.updateDraws+=nativeUpdates.length;result.coverage.normalOriginalPasses+=nativeUpdates.length;result.coverage.normalProductPasses+=productNormal.length;result.coverage.warmupProductPasses+=productWarmup.length;
  for(let i=0;i<productWarmup.length;i++){
   const a=warmup[i],b=productWarmup[i];assert.deepEqual(b.viewport,[0,0,size,size]);assert.equal(b.rowOrder,'bottom-up');
   frame.draws.push({stage:'warmup',index:i,sourceFrame:'primary-paused',productOwner:productLabel,uniforms:uniformCompare(a,b),state:bytesCompare(await nativeData('primary-paused',a.rgbaFile,size*size*16),await productData(productLabel,`draw-${b.draw}-state.f32le`,size*size*16),true,size*size*16)});
  }
  for(const stage of ['update','splat','present']){
   const na=nd.filter(d=>d.stage===stage),pa=stage==='update'?productNormal:pd.filter(d=>d.stage===stage);assert.equal(gpu[{update:'observedUpdates',splat:'observedSplats',present:'observedPresents'}[stage]],na.length,'original stage receipt');
   if(stage!=='update'){assert.equal(na.length,1,'original full layer must have one draw');assert.equal(pa.length,1,'product full layer must have one draw');}
   const expected=stage==='update'?[0,0,size,size]:stage==='splat'?[0,0,aw,ah]:[0,0,width,height];
   for(const d of na){assert.deepEqual(d.viewport,expected,'native stage viewport');if(stage==='update'||capturedImage)assert.equal(d.rowOrder,'bottom-up','native stage row direction');}
   for(const d of pa){assert.deepEqual(d.viewport,expected,'product stage viewport');assert.equal(d.rowOrder,'bottom-up','product stage row direction');}
   for(let i=0;i<na.length;i++){
    const a=na[i],b=pa[i],draw={stage,index:i,viewportEqual:true,uniforms:uniformCompare(a,b)};
    if(stage==='update')for(const field of draw.uniforms.fields)if(!field.equal&&['currentStepBase','warmupBase','staggerMin','staggerRange'].includes(field.name))field.sourceUse='warmup-only control; actual differing values retained; isWarmup=false';
    if(stage==='update'){assert.equal(nativeUniform(a,'isWarmup'),0);if(sparse)assert.equal(a.updatePhase,'normal');draw.state=bytesCompare(await nativeData(label,a.rgbaFile,size*size*16),await productData(productLabel,`draw-${b.draw}-state.f32le`,size*size*16),true,size*size*16);}
    frame.draws.push(draw);
   }
  }
  result.frames.push(frame);
 }
 assert.equal(result.coverage.normalOriginalPasses,completion);assert.equal(result.coverage.normalProductPasses,completion);assert.equal(result.coverage.warmupProductPasses,warmup.length*2);assert.equal(result.coverage.nonBlankReferenceFrames,imageLabels.length);
 result.totals=Object.fromEntries(['state','accumulation','present'].map(stage=>{const compared=result.frames.filter(f=>typeof f.stages[stage].equal==='boolean');return[stage,{compared:compared.length,equal:compared.filter(f=>f.stages[stage].equal).length,differentChannels:compared.reduce((n,f)=>n+(f.stages[stage].differentChannels??0),0),notCaptured:result.frames.length-compared.length}];}));
 result.totals.timeline={compared:result.coverage.actualTimelineFrames,equal:result.frames.filter(f=>f.timeline?.equal===true).length};
 result.firstDifferentStage=['initialUploads','state','camera','timeline','uniforms','accumulation','present'].find(stage=>result.frames.some(f=>stage==='initialUploads'?Object.values(f.initialUploads).some(v=>!v.equal):stage==='state'?!f.stages.state.equal||f.draws.some(d=>d.state&&!d.state.equal):stage==='camera'?!f.camera.equal:stage==='timeline'?f.timeline?.equal===false:stage==='uniforms'?f.draws.some(d=>d.equal===false||d.uniforms?.equal===false):f.stages[stage].equal===false))??(!result.primaryWarmup.finalStateToPaused.equal?'state':null);
 result.firstDifferentImageStage=['accumulation','present'].find(stage=>result.frames.some(f=>f.stages[stage].equal===false))??null;
 result.comparisonComplete=true;result.matched=result.firstDifferentStage===null&&result.coverage.productPreflightCompletion.equal;result.status=result.matched?'matched':'different';
}
try{await read(fileURLToPath(import.meta.url));await compare();}
catch(error){result.error={name:error.name,message:error.message};result.comparisonComplete=false;result.matched=false;result.status='invalid-or-incomplete';}
try{result.inputPins=Object.fromEntries(inputPins);result.inputsStable=true;for(const [file,digest]of inputPins)if(sha(await readFile(file))!==digest){result.inputsStable=false;result.changedInput=file;break;}if(!result.inputsStable){result.comparisonComplete=false;result.matched=false;result.status='invalid-or-incomplete';}}
catch(error){result.inputsStable=false;result.error={name:error.name,message:error.message};result.comparisonComplete=false;result.matched=false;result.status='invalid-or-incomplete';}
process.exitCode=result.comparisonComplete?(result.matched?0:1):2;
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,status:result.status,comparisonComplete:result.comparisonComplete,matched:result.matched,totals:result.totals,firstDifferentStage:result.firstDifferentStage,error:result.error,inputsStable:result.inputsStable}));
