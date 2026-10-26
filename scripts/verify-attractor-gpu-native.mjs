// 原版 JVM/JOGL 分阶段比较的产品接收端。只调用生产 importer / session / GPU
// owner；不提供第二套 RK4、种子、着色器或相机实现作为 expected。
// --preflight 不创建浏览器、GL 或 JVM。--capture 必须持有协调后的唯一 GPU 窗口。
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile, writeFile, mkdir, readdir} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2), mode=args.shift(), outputArg=args.shift();
const captureAll=args.includes('--capture-all');if(captureAll)args.splice(args.indexOf('--capture-all'),1);
assert(['--preflight','--capture'].includes(mode),'Usage: node scripts/verify-attractor-gpu-native.mjs --preflight|--capture OUTPUT CONFIG...');
assert(outputArg,'显式提供新的输出目录');const output=resolve(outputArg);
assert(args.length>0,'至少显式提供一个配置文件');
const root=process.cwd(), sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async(path,value)=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(value,null,2)+'\n');};
const pins=async()=>Object.fromEntries(await Promise.all((await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json)$/.test(p)).map(p=>'src/'+p).concat(['scripts/verify-attractor-gpu-native.mjs','scripts/compare-attractor-gpu-native.mjs']).sort().map(async p=>[p,sha(await readFile(p))])));
const inputs=new Map();
const entry=`
 export {parseProjectFile} from './src/engine/legacyImport';
 export {prepareSourceAttractorScene} from './src/engine/sourceAttractorDocument';
 export {sourceAttractorGpuLayout,sourceAttractorGpuDisplayLayout,prepareSourceAttractorGpuWork,SourceAttractorGpu} from './src/engine/sourceAttractorGpu';
 export {createSourceAttractorSeedStream} from './src/engine/sourceAttractorSeeds';
 export {replaySourceAttractorGpu} from './src/engine/sourceAttractorGpuReplay';
 export {prepareOrdinarySourceFrame} from './src/engine/ordinarySourceCamera';
 export {SOURCE_CAMERA_MODEL} from './src/engine/sourceCamera';
 export {OrdinarySourceCameraTimelineSession} from './src/engine/ordinarySourceCameraTimeline';
 export {SourceAttractorSession} from './src/scenes/sourceAttractor';
 export * from './src/engine/sourceAttractorGpuShaders';
`;
await mkdir(dirname(output),{recursive:true});await mkdir(output);
const report={at:new Date().toISOString(),mode,captureAll,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 scope:'未改诊断配置 → 生产 importer/SourceAttractorSession；另用相同导入事实的 SourceAttractorGpu 观察尚无 update 的初始暂停状态。完整 float32 位与 RGBA8，不用容差，也不把旧同浏览器 oracle 当原版。',
 limitations:['不执行原版、不对品牌水印/公式作数学层等价断言','GPU 工作仅在 --capture；CPU preflight 的种子是生产预备事实，不能冒充实际 GL 上传','生产浏览器 ES300/ANGLE 与原版桌面 GLSL/JOGL 的差异按首个分歧阶段报告','未测 CPU 时间与进程族 RSS'],cases:[],cleanup:{},sourcesBefore:await pins()};
const bundle=resolve(output,'production.mjs');
await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'browser',format:'esm',outfile:bundle});
report.bundle={file:bundle,sha256:sha(await readFile(bundle))};
// The emitted production modules do no GL work during import.
const api=await import(pathToFileURL(bundle).href);
for(const file of args){
 const raw=await readFile(file), authored=JSON.parse(raw), imported=api.parseProjectFile(raw.toString()),scene=imported.scene;
 inputs.set(resolve(file),raw);
 const prepared=api.prepareSourceAttractorScene(scene);assert.equal(prepared.backend,'gpu');
 assert.deepEqual(scene.equations,authored.equations);assert.deepEqual(scene.parameters,authored.parameters);
 assert.equal(prepared.configuration.particleCountGPU,authored.settings.particle_count_gpu);
 assert.equal(prepared.configuration.particleCountCPU,authored.settings.particle_count_cpu);
 assert.equal(scene.timeline.fps,30,'该原版采集约定 30 fps，不能静默修改导入器');
 const name=authored.name.includes('warmup')?'warmup-queue':'baseline',dir=resolve(output,name);
 await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'input.json'),raw);await json(resolve(dir,'scene.json'),scene);
 const layout=api.sourceAttractorGpuLayout(prepared.configuration.particleCountGPU),display=api.sourceAttractorGpuDisplayLayout(500,600);
 const seeds=api.createSourceAttractorSeedStream(prepared.configuration);assert(seeds.ok);
 const data=new Float32Array(layout.texels*4);for(let i=0;i<layout.count;i++){const value=seeds.value.next();assert(value.ok&&value.value);data.set(value.value.raw,i*4);data[i*4+3]=value.value.dt;}
 assert.equal(seeds.value.next().value,null);await writeFile(resolve(dir,'preflight-seed.f32le'),new Uint8Array(data.buffer));
 const frames=[],limit=name==='baseline'?16:64;let completedAt;
 for(let activeOrdinal=1;activeOrdinal<=limit;activeOrdinal++){
  const replay=api.replaySourceAttractorGpu({...prepared,tracks:scene.timeline.tracks,fps:scene.timeline.fps,time:(activeOrdinal-1)/30});
  frames.push({activeOrdinal,requestTime:(activeOrdinal-1)/30,updates:replay.updates,...replay.frame});
  if(replay.frame.queueComplete&&completedAt===undefined)completedAt=activeOrdinal;
  if(completedAt!==undefined&&activeOrdinal>=completedAt+1)break;
 }
 assert(completedAt!==undefined,'有界预检未抵达实际 queueComplete');
 const selected=captureAll||name==='baseline'?frames.map(f=>f.activeOrdinal):[...new Set([1,2,16,completedAt,completedAt+1,...frames.filter((f,i)=>i===0||f.queueIndex!==frames[i-1].queueIndex).flatMap(f=>[f.activeOrdinal-1,f.activeOrdinal])])].filter(n=>n>0&&n<=frames.length).sort((a,b)=>a-b);
 const item={name,file:resolve(file),inputSha256:sha(raw),dir,layout,display,prepared,formulas:scene.formulas,tracks:scene.timeline.tracks,frames,selected,completedAt,
  work:api.prepareSourceAttractorGpuWork(prepared.configuration,prepared.shader.operations,frames.at(-1).updates),seedSha256:sha(new Uint8Array(data.buffer)),primary:[405,486,2],target:[250,300,500,600,2]};
 await json(resolve(dir,'preflight.json'),item);report.cases.push(item);
 await writeFile(resolve(dir,'update.frag'),api.sourceAttractorUpdate.replace('// %ATTRACTOR_FUNCTION_BODY%',prepared.shader.code));
}
let browser,server;
try{
 if(mode==='--capture'){
  const [{chromium},{createServer}]=await Promise.all([import('@playwright/test'),import('vite')]);
  server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});report.browserVersion=browser.version();
  const page=await browser.newPage({viewport:{width:405,height:486},deviceScaleFactor:2});report.pageErrors=[];page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.route('**/product-gpu.mjs',route=>route.fulfill({contentType:'text/javascript',path:bundle}));
  await page.route('**/gpu-receiver',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Headless GPU receiver</title>'}));
  await page.goto(server.resolvedUrls.local[0]+'gpu-receiver');
  // Deadline closes our own browser, interrupting an outstanding page evaluation.
  const deadline=setTimeout(()=>void browser.close().catch(()=>{}),240_000);
  try{
   await page.evaluate(async()=>{
    const api=await import('/product-gpu.mjs'),proto=api.SourceAttractorGpu.prototype,glProto=WebGL2RenderingContext.prototype;
    const state=window.__receiver={api,owner:null,files:{},draws:[],serial:0,enabled:false,frame:null,uploads:[],resources:new Map(),restore:[],contexts:new Map(),timelineFacts:[]};
    const encode=values=>{const bytes=new Uint8Array(values.buffer,values.byteOffset,values.byteLength);let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);};
    const save=(name,values)=>{state.files[name]=encode(values);};state.save=save;
    const read=(gl,width,height,float)=>{
     const fbo=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),readBuffer=gl.getParameter(gl.READ_BUFFER),pack=gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
     const stores=[gl.PACK_ALIGNMENT,gl.PACK_ROW_LENGTH,gl.PACK_SKIP_PIXELS,gl.PACK_SKIP_ROWS].map(key=>[key,gl.getParameter(key)]);
     try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING));gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);for(const [key]of stores)gl.pixelStorei(key,key===gl.PACK_ALIGNMENT?1:0);
      const values=float?new Float32Array(width*height*4):new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,float?gl.FLOAT:gl.UNSIGNED_BYTE,values);return values;
     }finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,fbo);gl.readBuffer(readBuffer);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,pack);for(const [key,value]of stores)gl.pixelStorei(key,value);}
    };
    const contextFacts=gl=>{if(!state.contexts.has(gl)){const debug=gl.getExtension('WEBGL_debug_renderer_info');state.contexts.set(gl,{contextOrdinal:state.contexts.size+1,vendor:gl.getParameter(gl.VENDOR),renderer:gl.getParameter(gl.RENDERER),version:gl.getParameter(gl.VERSION),shadingLanguageVersion:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),aliasedPointSizeRange:Array.from(gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)),attributes:gl.getContextAttributes(),unmaskedVendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):null,unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null});}return state.contexts.get(gl);};state.contextFacts=contextFacts;
    for(const name of ['initialize','advance','render']){const fn=proto[name];proto[name]=function(...args){const prior=state.owner;state.owner=this;try{const result=fn.apply(this,args);if(this.gl)contextFacts(this.gl);return result;}finally{state.owner=prior;}};state.restore.push(()=>proto[name]=fn);}
    const timelineProto=api.OrdinarySourceCameraTimelineSession.prototype,evaluate=timelineProto.evaluate;
    timelineProto.evaluate=function(...args){const value=evaluate.apply(this,args);state.timelineFacts.push({requestArguments:args,returned:structuredClone(value)});return value;};state.restore.push(()=>timelineProto.evaluate=evaluate);
    for(const kind of ['Program','Shader','Buffer','Texture','Framebuffer','VertexArray'])for(const operation of ['create','delete']){
     const name=operation+kind,fn=glProto[name];glProto[name]=function(...args){const result=fn.apply(this,args);if(!state.resources.has(this))state.resources.set(this,new Map());const owned=state.resources.get(this);if(operation==='create'&&result)owned.set(result,kind);else if(operation==='delete')owned.delete(args[0]);return result;};state.restore.push(()=>glProto[name]=fn);
    }
    const draw=glProto.drawArrays;glProto.drawArrays=function(...args){
     const result=draw.apply(this,args),owner=state.owner;if(!state.enabled||!owner||owner.gl!==this)return result;
     const program=this.getParameter(this.CURRENT_PROGRAM),stage=program===owner.updateProgram?.program?'update':program===owner.accumulateProgram?.program?'splat':program===owner.presentProgram?.program?'present':'unknown';
     const viewport=Array.from(this.getParameter(this.VIEWPORT)),uniforms={};for(let i=0;i<this.getProgramParameter(program,this.ACTIVE_UNIFORMS);i++){const info=this.getActiveUniform(program,i),v=this.getUniform(program,this.getUniformLocation(program,info.name));uniforms[info.name]=ArrayBuffer.isView(v)?Array.from(v):v;}
     const record={draw:++state.serial,stage,args,viewport,uniforms,blend:this.isEnabled(this.BLEND),depth:this.isEnabled(this.DEPTH_TEST),dither:this.isEnabled(this.DITHER),samples:this.getParameter(this.SAMPLES),rowOrder:'bottom-up'};state.draws.push(record);
     if(stage==='update')save(`draw-${record.draw}-state.f32le`,read(this,viewport[2],viewport[3],true));
     if(state.frame?.selected&&stage==='splat')save('accum.f32le',read(this,viewport[2],viewport[3],true));
     if(state.frame?.selected&&stage==='present')save('math.rgba',read(this,viewport[2],viewport[3],false));
     return result;
    };state.restore.push(()=>glProto.drawArrays=draw);
    for(const name of ['texImage2D','bufferData','shaderSource']){const fn=glProto[name];glProto[name]=function(...args){const result=fn.apply(this,args);if(state.enabled&&state.owner?.gl===this){const values=args.findLast(v=>ArrayBuffer.isView(v));if(values){const file=`upload-${state.uploads.length}-${name}.bin`;save(file,values);state.uploads.push({file,call:name,length:values.length,byteLength:values.byteLength,scalarType:values.constructor.name,args:args.filter(v=>typeof v==='number')});}else if(name==='shaderSource'){state.uploads.push({call:name,source:args[1]});}}return result;};state.restore.push(()=>glProto[name]=fn);}
    state.snapshot=owner=>{const gl=owner.gl,readFbo=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),drawFbo=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);try{const data=owner.readState();save('gpu-state.f32le',data);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,readFbo);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,drawFbo);}};
   });
   for(const item of report.cases){
    const raw=inputs.get(item.file).toString(),runs=[];
    // Observer-disabled control reruns the same production requests from a fresh owner.
    for(const observed of [true,false]){
     const variant=observed?'observed':'control',dir=resolve(item.dir,variant);await mkdir(dir,{recursive:true});
     await page.evaluate(({raw,observed})=>{const s=window.__receiver;s.enabled=observed;s.scene=s.api.parseProjectFile(raw).scene;s.prepared=s.api.prepareSourceAttractorScene(s.scene);s.session=new s.api.SourceAttractorSession();s.serial=0;s.uploads=[];}, {raw,observed});
     const requestList=[{activeOrdinal:0,selected:true,paused:true},...item.frames.map(f=>({activeOrdinal:f.activeOrdinal,selected:item.selected.includes(f.activeOrdinal),paused:false})),{activeOrdinal:item.frames.length,selected:true,paused:true}];
     const captured=[];
     try{for(const request of requestList){
      const value=await page.evaluate(request=>{
       const s=window.__receiver,{api}=s;s.files={};s.draws=[];s.uploads=[];s.timelineFacts=[];s.frame=request;
       const viewport={logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'perspective'};
       let output,owner,extra;
       if(request.activeOrdinal===0){owner=new api.SourceAttractorGpu(s.prepared);try{const cameraPlan=api.prepareOrdinarySourceFrame({model:api.SOURCE_CAMERA_MODEL,time:0,frameIndex:0,camera:s.prepared.camera,viewport});output=owner.render({width:500,height:600,cameraPlan,backgroundColor:s.prepared.backgroundColor});if(s.enabled)s.snapshot(owner);extra={camera:s.prepared.camera,pausedBeforeFirstUpdate:true,diagnostics:owner.diagnostics(),gpuContext:s.contextFacts(owner.gl)};}finally{owner.dispose();}}
       else{const time=(request.activeOrdinal-1)/30;output=s.session.generate(s.scene,{time,width:500,height:600,quality:'export',sourceViewport:viewport});owner=s.session.gpu.engine;if(s.enabled||request.paused)s.snapshot(owner);extra={camera:output.sourceCameraFrame,formulaPresentation:output.formulaPresentation,temporal:output.temporal,diagnostics:s.session.diagnostics(),gpuContext:s.contextFacts(owner.gl)};}
       extra.timelineFacts=s.timelineFacts;
       s.save('output-top-down.rgba',output.pixels);
       return{files:s.files,draws:s.draws,uploads:s.uploads,extra};
      },request);
      const label=request.activeOrdinal===0?'paused-initial':request.paused?'paused-final':`step-${request.activeOrdinal}`,frameDir=resolve(dir,label);await mkdir(frameDir,{recursive:true});
      const files={};for(const [name,base64]of Object.entries(value.files)){const data=Buffer.from(base64,'base64');files[name]={bytes:data.length,sha256:sha(data)};await writeFile(resolve(frameDir,name),data);}
      await writeFile(resolve(frameDir,'draws.jsonl'),value.draws.map(v=>JSON.stringify(v)).join('\n')+'\n');
      const frame={...request,label,...value.extra,files,uploads:value.uploads};await json(resolve(frameDir,'state.json'),frame);captured.push(frame);
     }}finally{await page.evaluate(()=>window.__receiver.session.reset());}
     runs.push({variant,frames:captured});
    }
    item.runs=runs;item.observerControl=runs[0].frames.map((frame,i)=>{const other=runs[1].frames[i];assert.equal(frame.label,other.label);assert.equal(frame.files['output-top-down.rgba'].sha256,other.files['output-top-down.rgba'].sha256,`observer changed ${item.name}/${frame.label}`);return{label:frame.label,sha256:frame.files['output-top-down.rgba'].sha256,equal:true};});
    item.terminalStateControl={observed:runs[0].frames.at(-1).files['gpu-state.f32le'].sha256,control:runs[1].frames.at(-1).files['gpu-state.f32le'].sha256};assert.equal(item.terminalStateControl.observed,item.terminalStateControl.control);
   }
   report.cleanup.glObjects=await page.evaluate(()=>{const s=window.__receiver,n=[...s.resources.values()].reduce((sum,m)=>sum+m.size,0);for(const restore of s.restore.reverse())restore();return n;});assert.equal(report.cleanup.glObjects,0);assert.deepEqual(report.pageErrors,[]);
  }finally{clearTimeout(deadline);}
 }
 report.ok=true;
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 for(const [name,owner]of [['browser',browser],['server',server]])if(owner){try{await owner.close();report.cleanup[name]='closed';}catch(error){report.cleanup[name]=error.message;report.ok=false;process.exitCode=1;}}
 report.sourcesAfter=await pins();report.sourceStable=JSON.stringify(report.sourcesBefore)===JSON.stringify(report.sourcesAfter);if(!report.sourceStable)process.exitCode=1;
 report.inputsAfter=Object.fromEntries(await Promise.all([...inputs].map(async([file])=>[file,sha(await readFile(file))])));report.inputStable=[...inputs].every(([file,raw])=>report.inputsAfter[file]===sha(raw));
 report.ok=report.ok===true&&report.sourceStable&&report.inputStable&&process.exitCode!==1;if(!report.ok)process.exitCode=1;
 await json(resolve(output,'report.json'),report);console.log(JSON.stringify({ok:report.ok??false,mode,cases:report.cases.map(c=>({name:c.name,count:c.layout.count,padding:c.layout.texels-c.layout.count,completedAt:c.completedAt,selected:c.selected})),cleanup:report.cleanup,sourceStable:report.sourceStable,report:resolve(output,'report.json')}));
}
