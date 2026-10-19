import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,mkdtemp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {inflateSync} from 'node:zlib';
import {createServer as createTcpServer} from 'node:net';
import {createExportServer} from '../server/index.mjs';

const transitions=process.argv.includes('--transitions'),gpuPoints=process.argv.includes('--gpu-points');
if(transitions&&gpuPoints)throw Error('Choose one acceptance scenario');
const video=transitions||gpuPoints;
const prefix=gpuPoints?'.cache/v2-source-surface-gpu-points-export':transitions?'.cache/v2-source-surface-transition-export':'.cache/v2-source-surface-mesh-export';
const check=(value,message)=>{if(!value)throw Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
// Independently parse the delivered PNG in Node. Canvas decode/re-encode would
// premultiply alpha and could hide the exact loss this check must detect.
function decodePng(bytes){
 check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'not a PNG');
 let width=0,height=0,ended=false;const compressed=[];
 for(let at=8;at<bytes.length;){
  check(at+12<=bytes.length,'truncated PNG chunk');const length=bytes.readUInt32BE(at),end=at+length+12;
  check(end<=bytes.length,'truncated PNG payload');const type=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,end-4);
  let crc=-1;for(const value of bytes.subarray(at+4,end-4)){crc^=value;for(let bit=0;bit<8;bit++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
  check(((crc^-1)>>>0)===bytes.readUInt32BE(end-4),'PNG CRC mismatch');
  if(type==='IHDR'){check(length===13&&!width,'invalid PNG header');width=data.readUInt32BE(0);height=data.readUInt32BE(4);check(data.subarray(8).equals(Buffer.from([8,6,0,0,0])),'expected non-interlaced RGBA8 PNG');}
  else if(type==='IDAT')compressed.push(data);
  else if(type==='IEND'){check(length===0&&end===bytes.length,'invalid PNG end');ended=true;}
  at=end;
 }
 check(width>0&&height>0&&ended&&compressed.length,'incomplete PNG');const stride=width*4,raw=inflateSync(Buffer.concat(compressed));check(raw.length===(stride+1)*height,'invalid PNG row length');const rgba=Buffer.alloc(stride*height);
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
 for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];check(filter<=4,'invalid PNG row filter');for(let x=0;x<stride;x++){const a=x>=4?rgba[y*stride+x-4]:0,b=y?rgba[(y-1)*stride+x]:0,c=y&&x>=4?rgba[(y-1)*stride+x-4]:0;rgba[y*stride+x]=(raw[y*(stride+1)+1+x]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
 return{width,height,rgba};
}

// Hash the complete production surface, not just the files expected to change.
const hashes=async()=>{
 const paths=(await Promise.all(['src','server'].map(async root=>(await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>`${e.parentPath}/${e.name}`)))).flat();
 paths.push('scripts/verify-source-surface-mesh-export.mjs');paths.sort();
 return Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(p))])));
};
const before=await hashes(),directory=await mkdtemp('.cache/mesh-export-service-');
const port=await new Promise((resolve,reject)=>{
 const listener=createTcpServer();listener.once('error',reject);listener.listen(0,'127.0.0.1',()=>{const port=listener.address().port;listener.close(error=>error?reject(error):resolve(port));});
});
const report={at:new Date().toISOString(),scope:'Actual App original CPU MESH import, canonical UI edits and save/reload, parameter/tracking/gradient timeline seeks, coupled and decoupled PNG through production service, compared against fresh Worker/ArtRenderer. Optional --transitions also covers POINTS/MESH replacement, fades, timeline authoring and full MP4 export. Local integration consistency only; no original JVM/JOGL framebuffer comparison.',directory,transitions,gpuPoints};
if(gpuPoints)report.scope='Actual App source GPU POINTS import, canonical point edits/save/reload, parameter uniform and frozen tint checks, GPU transitions converted to holds, forward/reverse seeks, PNG complete RGBA readback and every MP4 frame compared to uploaded PNG. No CPU position fallback; local integration consistency, not native JVM/JOGL parity.';
let page,browser,server,exportServer;
const errors=[],consoleErrors=[];
try{
 exportServer=await createExportServer({root:directory,allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await exportServer.listen(0);
 server=await createServer({server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});
 page=await browser.newPage({viewport:{width:1360,height:920},deviceScaleFactor:1,acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 await page.addInitScript(()=>{
  const Native=window.Worker;window.__meshAudit={nextWorker:0,requests:[],completed:[],errors:[]};
  window.Worker=class extends Native{
   constructor(...args){super(...args);this.auditId=++window.__meshAudit.nextWorker;this.addEventListener('message',({data})=>{
    if(data.operation==='generate'&&data.output){const o=data.output;window.__meshAudit.completed.push({worker:this.auditId,id:data.id,frame:o.sourceCameraFrame,topology:o.topology,backend:o.backend,gpu:o.sourceGpuPoints?{...o.sourceGpuPoints,seeds:Array.from(o.sourceGpuPoints.seeds),tint:Array.from(o.sourceGpuPoints.tint),parameters:Array.from(o.sourceGpuPoints.parameters)}:undefined,overlayAlpha:o.sourceSurfaceOverlayAlpha,pointAppearance:o.sourcePointAppearance,positions:Array.from(o.positions??[]),indices:Array.from(o.indices??[]),packedColors:Array.from(o.sourceMeshColors??[]),appearance:o.sourceMeshAppearance,wire:o.sourceMeshWireframe?{...o.sourceMeshWireframe,positions:Array.from(o.sourceMeshWireframe.positions)}:undefined});}
    if(data.error)window.__meshAudit.errors.push(data.error);
   });}
   postMessage(message,...args){if(message.operation==='generate')window.__meshAudit.requests.push({...structuredClone(message),worker:this.auditId});return super.postMessage(message,...args);}
  };
 });
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<html></html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const scene=createScene(definition('surface'));Object.assign(scene.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});
 await page.goto(origin);
 const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
 const settled=()=>page.waitForFunction(()=>{const r=window.__meshAudit.requests.at(-1);return r&&window.__meshAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);});
 const canonical=async(group,key,value)=>{await page.waitForFunction(({group,key,value})=>{const r=window.__meshAudit.requests.at(-1),configuration=r?.scene.surfaceSource;return configuration&&(group?configuration[group]?.[key]:configuration[key])===value&&window.__meshAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);},{group,key,value});await ready();};
 const snapshot=()=>page.evaluate(()=>{const r=window.__meshAudit.requests.at(-1),c=window.__meshAudit.completed.findLast(c=>c.worker===r.worker&&c.id===r.id);return{request:r,output:c};});
 const seek=async time=>{
  const actual=await page.getByRole('slider',{name:'Time position',exact:true}).evaluate((element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));return Number(element.value);},time);
  await page.waitForFunction(value=>{const r=window.__meshAudit.requests.at(-1);return Math.abs(r?.context.time-value)<1e-6&&window.__meshAudit.completed.some(c=>c.worker===r.worker&&c.id===r.id);},actual);await ready();return snapshot();
 };
 await ready();
 const source={config_version:'1.0.0',type:'SURFACE',name:'CPU Mesh Public Export',parameters:{a:0},equations:{x:'u',y:'v',z:'u*v/10+a'},camera:{phi:0,theta:0,gamma:0},palette:['#FFEF6F32','#FF246FFF'],settings:{surface_mode:'MESH',render_mode:'CPU',u_segments:4,v_segments:3,mesh_u_segments:6,mesh_v_segments:5,u_min:0,u_max:6,v_min:0,v_max:4,scale_x:20,scale_y:20,scale_z:20,speed_u:.25,speed_v:-.125,mesh_fill:true,mesh_wireframe:true,mesh_fill_opacity:.8,mesh_line_weight:2,mesh_wireframe_color:'#FFDDEEFF',wireframe_u_segments:4,wireframe_v_segments:3,show_trails:false},timeline:[{type:'animate',duration:.25,easing:'LINEAR',actions:[{method:'track',args:[7]},{method:'gradientStart',args:{mode:'HUE_ROTATE',interpolation:'LINEAR',speed:90}},{method:'paramStart',args:{parameters:{a:{min:-2,max:2,step:.125}}}}]},{type:'wait',duration:1},{type:'animate',duration:.25,easing:'LINEAR',actions:[{method:'paramStop',args:{parameters:{a:{}}}}]},{type:'wait',duration:1}]};
 if(gpuPoints){source.name='GPU Points Public Export';source.settings.surface_mode='POINTS';source.settings.render_mode='GPU';source.settings.dot_size=5;source.equations.z='u*v/10+a*u/3';source.timeline.push({type:'surface_mode_transition',to:'MESH',duration:1,easing:'LINEAR'},{type:'wait',duration:.5},{type:'surface_mode_transition',to:'POINTS',duration:1,easing:'LINEAR'},{type:'wait',duration:.5});}
 if(transitions){source.settings.surface_mode='POINTS';source.timeline.push({type:'surface_mode_transition',to:'MESH',duration:1,easing:'LINEAR'},{type:'wait',duration:.5},{type:'surface_mode_transition',to:'POINTS',duration:1,easing:'LINEAR'},{type:'wait',duration:.5});}
 await page.locator('input[type=file]').setInputFiles({name:'source-mesh.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
 const controls=page.getByTestId('source-surface-mesh-controls');await controls.waitFor();await ready();await settled();
 let imported=await snapshot();check(imported.request.scene.settings.surfaceGeometryVersion==='mathart-1.7.8-surface-v1','mesh source identity was not imported');check(imported.request.scene.surfaceSource?.mode===(transitions||gpuPoints?'points':'mesh'),'canonical mesh configuration missing');
 if(!transitions&&!gpuPoints)check(imported.output.positions.length===6*5*3&&imported.output.packedColors.length===6*5&&imported.output.wire?.positions.length>0,'public mesh geometry/color/wire missing');
 if(transitions){
  const mode=page.getByRole('combobox',{name:'Initial surface mode',exact:true});
  await mode.selectOption('mesh');await canonical(null,'mode','mesh');check((await snapshot()).request.scene.surfaceSource.mode==='mesh','initial mode edit failed');
  await mode.selectOption('points');await canonical(null,'mode','points');
  await controls.locator('summary').filter({hasText:'Surface points'}).click();
  const points=page.getByTestId('source-points-uSegments');await points.fill('5');await points.blur();await canonical('points','uSegments',5);
  check((await snapshot()).request.scene.surfaceSource.points.uSegments===5,'point samples edit failed');
 }
 const assertGpu=output=>{check(output.backend==='webgl2'&&output.topology==='points'&&output.gpu?.model==='surface-gpu-points-1.7.8','GPU source output or backend missing');check(output.positions.length===0&&!output.appearance&&!output.wire,'GPU points silently fell back to CPU geometry');check(output.gpu.seeds.length===output.gpu.tint.length&&output.gpu.parameters.length===32,'GPU seed/tint/uniform buffers missing');};
 if(gpuPoints){
  assertGpu(imported.output);check(imported.request.scene.surfaceSource.nativeBackend==='gpu','GPU backend lost on import');
  const holds=imported.request.scene.timeline.tracks.filter(t=>t.label==='surface_mode_transition');check(holds.length===2&&holds.every(t=>t.type==='wait'&&t.duration===1),'GPU native transitions were not converted to same-duration holds');
  check(!imported.request.scene.timeline.tracks.some(t=>t.type==='surface_mode_transition'),'unsupported GPU mode switch survived import');
  report.gpuHolds=holds.map(({type,duration,label})=>({type,duration,label}));
  check(!await page.getByRole('combobox',{name:'New clip type',exact:true}).locator('option[value=surface_mode_transition]').count(),'GPU UI advertises unsupported mode switching');
  const detail=controls.locator('details').filter({has:page.getByTestId('source-points-uSegments')});if(!await detail.evaluate(e=>e.open))await detail.locator('summary').click();
 }
 const sampleId=gpuPoints?'source-points-uSegments':'source-mesh-uSegments',samples=page.getByTestId(sampleId),retained=gpuPoints?4:6;
 await samples.fill('513');await samples.blur();await ready();
 await page.waitForFunction(({id,retained})=>document.querySelector(`[data-testid="${id}"]`)?.value===String(retained),{id:sampleId,retained});
 check((await snapshot()).request.scene.surfaceSource[gpuPoints?'points':'mesh'].uSegments===retained,'capacity rejection changed retained configuration');
 report.capacityRejection={attempted:513,retained,noClamping:true};
 if(gpuPoints){await samples.fill('5');await samples.blur();await canonical('points','uSegments',5);}
 const editId=gpuPoints?'source-points-dotRadius':'source-mesh-fillOpacity',editValue=gpuPoints?6:.65,edited=page.getByTestId(editId);
 await edited.fill(String(editValue));await edited.blur();await canonical(gpuPoints?'points':'mesh',gpuPoints?'dotRadius':'fillOpacity',editValue);
 const background=page.getByTestId('source-mesh-backgroundColor');await background.fill('#804080C0');await background.blur();await canonical(null,'backgroundColor',0x804080c0);
 const savedMatches=scene=>scene?.surfaceSource?.backgroundColor===0x804080c0&&(gpuPoints?scene.surfaceSource.points.dotRadius===6&&scene.surfaceSource.points.uSegments===5:scene.surfaceSource.mesh.fillOpacity===.65);
 await page.getByRole('button',{name:'Save',exact:true}).click();
 await page.waitForFunction(gpu=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1')),s=w.scenes?.find(s=>s.id===w.active)?.surfaceSource;return s?.backgroundColor===0x804080c0&&(gpu?s.points.dotRadius===6&&s.points.uSegments===5:s.mesh.fillOpacity===.65);},gpuPoints);
 await page.reload();await ready();await controls.waitFor();await settled();check(await edited.inputValue()===String(editValue),'canonical appearance lost on reload');
 check(savedMatches((await snapshot()).request.scene),'saved authored configuration was replaced by legacy settings');
 check(await background.inputValue()==='#804080C0','canonical ARGB background lost on reload');
 report.editing={...(gpuPoints?{dotRadius:6,uSegments:5}:{fillOpacity:.65}),background:'#804080C0',saved:true,reloaded:true};
 const frames=[];
 for(const time of (transitions?[2.65,3.1,3.65,4.1,4.6,5.25,2.65]:[.25,.75,1.6,1.8,.25])){
  const {request,output}=await seek(time);frames.push({time:request.context.time,positions:output.positions,gpu:output.gpu,backend:output.backend,colors:output.packedColors,wire:output.wire,mode:output.topology,overlayAlpha:output.overlayAlpha,camera:output.frame.camera});
 }
 if(gpuPoints){
 for(const frame of frames)assertGpu({backend:frame.backend,topology:frame.mode,gpu:frame.gpu,positions:frame.positions});
 check(JSON.stringify(frames[0].gpu.parameters)!==JSON.stringify(frames[1].gpu.parameters),'GPU parameter animation did not reach uniforms');
 check(JSON.stringify(frames[2].gpu.parameters)===JSON.stringify(frames[3].gpu.parameters),'stopped GPU parameter keeps changing');
 check(frames.every(f=>JSON.stringify(f.gpu.tint)===JSON.stringify(frames[0].gpu.tint)),'gradient incorrectly rebuilt GPU shape tint');
 check(JSON.stringify(frames[0].camera.center)!==JSON.stringify(frames[1].camera.center),'GPU CPU-tracked target did not move camera');
 report.gpuHoldSeeks=[];for(const time of [2.65,3.1,3.65,4.1,4.6,5.25]){const {request,output}=await seek(time);assertGpu(output);check((output.overlayAlpha??0)===0,'GPU hold created a fade overlay');report.gpuHoldSeeks.push({time:request.context.time,backend:output.backend,mode:output.topology,overlayAlpha:output.overlayAlpha??0,parameters:output.gpu.parameters});}
 }else if(!transitions){
 check(JSON.stringify(frames[0].positions)!==JSON.stringify(frames[1].positions),'parameter animation did not change mesh vertices');
 check(JSON.stringify(frames[2].positions)===JSON.stringify(frames[3].positions),'stopped parameter keeps changing mesh vertices');
 check(frames.every(f=>f.positions.every(Number.isFinite)&&f.wire.positions.length>0),'mesh seek output missing or nonfinite');
 check(frames.every(f=>JSON.stringify(f.colors)===JSON.stringify(frames[0].colors)),'CPU mesh incorrectly advanced gradientStart during update');
 check(JSON.stringify(frames[0].camera.center)!==JSON.stringify(frames[1].camera.center),'source track did not move camera');
 }else{
  check(frames.some(f=>f.mode==='points')&&frames.some(f=>f.mode==='mesh'),'both modes not reached');
  check(frames.some(f=>f.overlayAlpha>0)&&frames.some(f=>f.overlayAlpha===0),'fade or completion not reached');
  check(frames.every(f=>f.positions.every(Number.isFinite)),'nonfinite transition geometry');
 }
 check(JSON.stringify(frames[0])===JSON.stringify(frames.at(-1)),'reverse seek changed mesh/gradient/tracking state');
 report.seeks=frames;report.gradientObservation=gpuPoints?'GPU particle PShape tint stays at construction-time palette while uniforms and tracked CPU camera advance.':transitions?'Actions remain bound to the initial point object across both replacements.':'HUE_ROTATE remains visually unchanged on CPU MeshSurface because its update does not advance gradient runtime; geometry and tracked camera still change.';
 report.exports=[];
 for(const task of (gpuPoints?[.25,.75,3.1].map(time=>({time,decoupled:false})):transitions?[2.65,3.1,3.65,4.1,4.6,5.25].map(time=>({time,decoupled:false})):[{time:.75,decoupled:false},{time:.75,decoupled:true}])){
  const {time,decoupled}=task;
  if(decoupled){await page.getByTestId('source-mesh-wireframeDecoupled').check();await ready();await settled();await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.scenes?.some(s=>s.id===w.active&&s.surfaceSource?.mesh.wireframeDecoupled===true);});await page.reload();await ready();await controls.waitFor();check(await page.getByTestId('source-mesh-wireframeDecoupled').isChecked(),'decoupled mesh state lost on reload');}
  const preview=await seek(time);if(!transitions&&!gpuPoints)check(preview.output.wire.mode===(decoupled?'decoupled':'coupled'),'wireframe mode not applied');
  const healthResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health');await page.getByRole('button',{name:'Export artwork',exact:true}).click();const response=await healthResponse;check(response.ok(),'owned image service health failed');const health=await response.json();
  await page.getByRole('button',{name:'Animation video',exact:true}).click();
  if(health.ffmpeg)await page.waitForFunction(()=>document.querySelector('.export-modal .primary-button')?.disabled===false);
  else await page.getByText('The video encoding service is unavailable. Run npm run server in the studio directory and make sure FFmpeg is available locally.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Still image',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('257');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('193');
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await pending,path=`${prefix}-${gpuPoints?'gpu-'+time:transitions?'transition-'+time:decoupled?'decoupled':'coupled'}.png`;await download.saveAs(path);
  const actual=await page.evaluate(()=>{const r=window.__meshAudit.requests.findLast(r=>r.context.quality==='export'),c=window.__meshAudit.completed.findLast(c=>c.worker===r.worker&&c.id===r.id);return{request:r,output:c};});
  check(actual.request.context.sourceViewport.referenceLogicalHeight===preview.output.frame.viewport.logicalHeight,'preview reference height lost at export');check(actual.output.frame.viewport.target==='offscreen','export viewport does not use source offscreen plan');
  const oracle=await page.evaluate(async request=>{
   const{Generator}=await import('/src/engine/client.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts'),{sceneAtTime}=await import('/src/engine/timeline.ts');
   const generator=new Generator(),renderer=new ArtRenderer(document.createElement('canvas'));const cleanup={generator:false,renderer:false,context:false};let result;
   try{const output=await generator.generate(request.scene,request.context);renderer.setSize(request.context.width,request.context.height,1);renderer.setOutput(output,sceneAtTime(request.scene,output.sourceCameraFrame.time),false);const styles=[];renderer.scene.traverse(o=>{if(o.userData.sourceSurfaceMeshFill||o.userData.sourceSurfaceMeshLines||o.userData.sourceSurfacePoints)styles.push({points:!!o.userData.sourceSurfacePoints,gpuPoints:!!o.userData.sourceSurfaceGpuPoints,blending:o.material.blending,blendSrcAlpha:o.material.blendSrcAlpha,blendDstAlpha:o.material.blendDstAlpha,fill:!!o.userData.sourceSurfaceMeshFill,wire:!!o.userData.sourceSurfaceMeshLines,visible:o.visible,depthTest:o.material.depthTest,depthWrite:o.material.depthWrite,renderOrder:o.renderOrder});});const gl=renderer.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,raw=new Uint8Array(width*height*4),topDown=new Uint8Array(raw.length);renderer.render();gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,raw);if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw Error('cold renderer raw readback failed');for(let y=0;y<height;y++)topDown.set(raw.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');const rawSha=await digest(topDown);const blob=await renderer.blob('image/png');result={sha:await digest(await blob.arrayBuffer()),rawSha,styles,cleanup};}
   finally{generator.dispose();cleanup.generator=true;renderer.dispose();cleanup.renderer=true;renderer.renderer.forceContextLoss();cleanup.context=true;}return result;
  },actual.request);
  const png=await readFile(path),digest=sha(png),decoded=decodePng(png);check(decoded.width===257&&decoded.height===193,'wrong exported PNG dimensions');check(digest===oracle.sha,'actual service download differs from fresh Worker/Renderer');const rgbaSha=sha(decoded.rgba);check(rgbaSha===oracle.rawSha,'decoded service PNG differs from complete cold raw framebuffer');const corners=[0,decoded.width-1,(decoded.height-1)*decoded.width,decoded.width*decoded.height-1].map(i=>Array.from(decoded.rgba.subarray(i*4,i*4+4)));const alpha=actual.output.overlayAlpha??0;check(alpha===(preview.output.overlayAlpha??0),'export overlay differs from preview');
  const expectedCorner=[64,128,192].map(v=>Math.round(v*(1-alpha/255))).concat(Math.min(255,128+alpha));
  check(corners.every(c=>c.every((v,i)=>Math.abs(v-expectedCorner[i])<=(alpha?1:0))),'source background or overlay blend changed');
  check(actual.output.topology===preview.output.topology,'export mode differs from preview');
  if(actual.output.topology==='mesh')check(oracle.styles.filter(s=>s.fill&&s.visible).length===1&&oracle.styles.filter(s=>s.wire&&s.visible).length===1,'dedicated source fill and wire renderer not active');
  else check(oracle.styles.some(s=>s.points&&s.visible),'dedicated source point renderer not active');
  if(gpuPoints){assertGpu(actual.output);check(oracle.styles.some(s=>s.gpuPoints&&s.visible&&s.blendSrcAlpha===201&&s.blendDstAlpha===201),'GPU point shader or source alpha blending not active');let drawn=0;for(let i=3;i<decoded.rgba.length;i+=4)if(decoded.rgba[i]>128)drawn++;check(drawn>10,'GPU export contains only background or no additive point alpha');report.gpuDrawnPixels??=[];report.gpuDrawnPixels.push({time:actual.request.context.time,pixels:drawn});}
  report.exports.push({decoupled,mode:actual.output.topology,overlayAlpha:actual.output.overlayAlpha,expectedCorner,time:actual.request.context.time,path,sha:digest,bytes:png.length,width:257,height:193,rgbaSha,rawFramebufferMatches:true,cornerRgba:corners,styles:oracle.styles,cleanup:oracle.cleanup,coldRendererMatches:true,viewport:actual.output.frame.viewport,configuration:actual.request.scene.surfaceSource});
  await page.getByRole('button',{name:'Close export',exact:true}).click();
 }
 if(video){
  const videoRequestStart=await page.evaluate(()=>window.__meshAudit.requests.length);
  const uploads=[];
  const capture=request=>{const url=new URL(request.url());if(request.method()==='POST'&&/^\/api\/exports\/[^/]+\/frames$/.test(url.pathname))uploads.push({index:Number(url.searchParams.get('index')),png:request.postDataBuffer()});};page.on('request',capture);
  const healthResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/health');await page.getByRole('button',{name:'Export artwork',exact:true}).click();check((await(await healthResponse).json()).ffmpeg,'FFmpeg unavailable for transition video acceptance');
  await page.getByRole('button',{name:'Animation video',exact:true}).click();await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
  await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('256');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('192');
  await page.getByRole('spinbutton',{name:'Export frame rate',exact:true}).fill('6');await page.getByRole('spinbutton',{name:'Export duration',exact:true}).fill('5.5');
  const pending=page.waitForEvent('download',{timeout:120000});await page.getByRole('button',{name:'Start export',exact:true}).click();const download=await pending,path=`${prefix}.mp4`;await download.saveAs(path);page.off('request',capture);
  const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,r_frame_rate','-of','json',path],{encoding:'utf8'})).streams[0];
  check(metadata.width===256&&metadata.height===192&&Number(metadata.nb_read_frames)===33&&metadata.r_frame_rate==='6/1','encoded transition frame count/dimensions/FPS mismatch');
  check(uploads.length===33&&uploads.every((u,i)=>u.index===i),'video input frames missing or out of order');
  const rgb=execFileSync('ffmpeg',['-v','error','-i',path,'-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:32*1024*1024}),stride=256*192*3;
  check(rgb.length===33*stride,'decoded video length mismatch');const frameComparisons=[];
  for(let i=0;i<uploads.length;i++){const decoded=decodePng(uploads[i].png);check(decoded.width===256&&decoded.height===192,'uploaded video dimensions mismatch');let total=0,max=0;for(let j=0;j<stride;j++){const d=Math.abs(rgb[i*stride+j]-decoded.rgba[Math.floor(j/3)*4+j%3]);total+=d;max=Math.max(max,d);}const mean=total/stride;check(mean<6,'encoded frame differs beyond lossy-codec allowance at '+i+': '+mean);frameComparisons.push({index:i,inputSha:sha(uploads[i].png),encodedRgbSha:sha(rgb.subarray(i*stride,(i+1)*stride)),meanAbsoluteRgbError:mean,maxAbsoluteRgbError:max,cornerRgba:Array.from(decoded.rgba.subarray(0,4))});}
  check(new Set(frameComparisons.map(f=>f.inputSha)).size>20,'video frames did not evolve');
  report.video={path,sha:sha(await readFile(path)),metadata,frames:frameComparisons,comparison:'Every decoded MP4 RGB frame compared to its actual uploaded PNG; mean absolute RGB error <6 for lossy H.264, not native-original pixel parity.'};
  await page.getByRole('button',{name:'Close export',exact:true}).click();
  if(gpuPoints){report.video.gpuFrames=await page.evaluate(start=>window.__meshAudit.requests.slice(start).filter(r=>r.context.quality==='export').map(r=>({time:r.context.time,output:window.__meshAudit.completed.findLast(c=>c.worker===r.worker&&c.id===r.id)})),videoRequestStart);check(report.video.gpuFrames.length===33,'GPU video did not generate all frames');for(const f of report.video.gpuFrames)assertGpu(f.output);check(new Set(report.video.gpuFrames.map(f=>JSON.stringify(f.output.gpu.parameters))).size>2,'video GPU parameters did not evolve');}
  if(transitions){
  const before=(await snapshot()).request.scene.timeline.tracks.length;
  await page.getByRole('combobox',{name:'New clip type',exact:true}).selectOption('surface_mode_transition');await page.getByRole('button',{name:'Add animation',exact:true}).click();await ready();await settled();
  await page.getByRole('combobox',{name:'Surface transition target',exact:true}).selectOption('mesh');await ready();await settled();
  await page.getByRole('spinbutton',{name:'Clip duration',exact:true}).fill('0.5');await ready();await settled();await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.waitForFunction(count=>{const w=JSON.parse(localStorage.getItem('mathart-lab-v1'));return w.scenes?.find(s=>s.id===w.active)?.timeline.tracks.length===count;},before+1);
  await page.reload();await ready();await settled();const authored=(await snapshot()).request.scene.timeline.tracks.at(-1);check(authored.type==='surface_mode_transition'&&authored.surfaceMode==='mesh'&&authored.duration===.5,'authored transition lost on reload');report.authoredTransition={saved:true,reloaded:true,type:authored.type,target:authored.surfaceMode,duration:authored.duration};
  }
 }
 // Dispose a live pending Worker, prove the promise terminates, then verify a
 // fresh request succeeds. This does not assert native target cancellation.
 report.cancellation=await page.evaluate(async()=>{
  const {Generator}=await import('/src/engine/client.ts'),request=window.__meshAudit.requests.findLast(r=>r.context.quality==='export')??window.__meshAudit.requests.at(-1);const cancelled=new Generator();const promise=cancelled.generate(request.scene,request.context).then(()=>({rejected:false}),error=>({rejected:true,message:String(error)}));cancelled.dispose();const outcome=await promise;const recovery=new Generator();try{const out=await recovery.generate(request.scene,request.context);return{...outcome,recovery:!!(out.sourceMeshAppearance||out.sourcePointAppearance)&&(out.positions.length>0||out.sourceGpuPoints?.seeds.length>0),disposed:true};}finally{recovery.dispose();}
 });check(report.cancellation.rejected&&report.cancellation.recovery,'pending Worker cancellation or fresh recovery failed');
 const allStored=await readdir(directory),stored=allStored.filter(p=>p.endsWith('.png'));check(allStored.length===report.exports.length+(video?1:0),'unexpected service files');if(video)check(allStored.some(p=>p.endsWith('.mp4')),'video missing from service');check(stored.length===report.exports.length&&stored.every(p=>p.endsWith('.png')),'production service image count mismatch');const serviceHashes=await Promise.all(stored.map(async name=>({name,sha:sha(await readFile(`${directory}/${name}`))})));
 for(const image of report.exports)check(serviceHashes.some(s=>s.sha===image.sha),'download bytes differ from stored service image');check(report.exports[0].sha!==report.exports[1].sha,'distinct export states produced identical pixels');report.serviceImages=serviceHashes;
 const workerErrors=await page.evaluate(()=>window.__meshAudit.errors);check(!errors.length&&!workerErrors.length&&!consoleErrors.length,'App, Worker or console reported error');
 await page.screenshot({path:`${prefix}-ui.png`});const after=await hashes();check(JSON.stringify(before)===JSON.stringify(after),'production source changed during test');Object.assign(report,{status:'passed',sourceStable:true,sources:after,pageErrors:errors,workerErrors,consoleErrors});
}catch(error){Object.assign(report,{status:'failed',error:String(error),stack:error.stack,pageErrors:errors,consoleErrors});if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);await page.screenshot({path:`${prefix}-failed.png`}).catch(()=>{});}process.exitCode=1;}
finally{
 const closed=await Promise.allSettled([browser?.close(),server?.close(),exportServer?.close()]);report.cleanup=closed.map((result,i)=>({resource:['browser','vite','export-server'][i],status:result.status,...(result.status==='rejected'?{error:String(result.reason)}:{})}));if(closed.some(r=>r.status==='rejected')){report.status='failed';process.exitCode=1;}await writeFile(`${prefix}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error}));
}
