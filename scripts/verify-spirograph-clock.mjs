import {chromium} from 'playwright/test';
import {createServer} from 'vite';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourceLayer,sourcePoint,sourcePixel} from './spirograph-source-oracle.mjs';

// Independent expected frame values were produced by the retained-bytecode
// Python transcription, never by importing production replay/evaluation.
const mode=process.env.SPIROGRAPH_CLOCK_MODE??'functional';
if(!['functional','old-performance','current-performance'].includes(mode))throw Error('Unknown clock verification mode');
const output=process.env.SPIROGRAPH_CLOCK_REPORT;
if(!output)throw Error('An explicit new SPIROGRAPH_CLOCK_REPORT path is required');
try{await stat(output);throw Error('Refusing to overwrite existing report '+output);}catch(e){if(e.code!=='ENOENT')throw e;}
const baseline='.cache/spirograph-source-baseline-1871';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifestBytes=await readFile(baseline+'/manifest.json'),manifest=JSON.parse(manifestBytes);
for(const [path,hash] of Object.entries(manifest.sourceManifest)){
 if(digest(await readFile(baseline+'/'+path.replace(/^studio\//,'')))!==hash)throw Error('Frozen 1871 baseline changed: '+path);
}
const fixtureText=await readFile('tests/fixtures/spirograph/source-clock-1.7.8.json','utf8'),vectors=JSON.parse(fixtureText);
const paths=['scripts/verify-spirograph-clock.mjs','scripts/spirograph-clock-fixtures.mjs','scripts/spirograph-source-oracle.mjs','.cache/spirograph-clock-oracle.py',
 '.cache/spirograph-clock-next-audit.json','.cache/spirograph-clock-static-excerpts.json','.cache/spirograph-easings-complete/build-fixture.py',
 'tests/fixtures/spirograph/source-clock-1.7.8.json','tests/fixtures/spirograph/source-easing-1.7.8.json',
 'src/engine/sourceEasing.ts','src/engine/spirographReplay.ts','src/engine/spirographModel.ts',
 'src/engine/spirographFramePlan.ts','src/engine/spirographFrameConfig.ts','src/engine/spirographAuthoring.ts',
 'src/scenes/spirograph.ts','src/scenes/particles.ts','src/scenes/spirographExamples.generated.ts','src/scenes/spirographExamples.recipes.json',
 'src/engine/temporal.ts','src/engine/timeline.ts','src/engine/simulationClock.ts','src/engine/scenePlayback.ts',
 'src/engine/document.ts','src/engine/legacyImport.ts','src/engine/generationProtocol.ts','src/engine/client.ts','src/engine/generate.worker.ts',
 'src/engine/renderer.ts','src/engine/sceneCamera.ts','src/engine/outputBuffers.ts','src/types.ts'];
const snapshot=()=>Promise.all(paths.map(async path=>({path,sha256:digest(await readFile(path))})));
const cases=vectors.cases.map(c=>{
 const layers=c.input.layers.map((l,i)=>sourceLayer('layer-'+i,{...l,statorRadius:60,rotors:[{radius:20,mode:'inside'}],penDistance:27,strokeColor:'#ffffff',palette:['#ffffff']}));
 // Probe final trace endpoint independently. Rendering uses source pixel units.
 const probes=c.expected.map(want=>{
  if(layers.length!==1||!layers[0].visible||!layers[0].enabled||want.phases[0]===0||want.phases[0]===want.clearedPhases[0])return null;
  return sourcePixel(sourcePoint(layers[0],want.phases[0]).pen,{scale:1,rotation:0,offsetX:0,offsetY:0},257,193,want.rotationRadians);
 });
 return {...c,layers,probes};
});
const report={startedAt:new Date().toISOString(),mode,sourceStart:await snapshot(),
 baseline:{path:baseline,sha256:digest(manifestBytes),verifiedFiles:Object.keys(manifest.sourceManifest).length},
 limits:[...vectors.limits,
  'No original app/JVM/class execution. Oracle expected values are independent Python static transcriptions, not captured production results.',
  'Retained-millis trace is tested directly at the core boundary; public saved scene/Worker currently advertises deterministic offline-fixed simulation.',
  'Worker image bounds/endpoints derive from independent source mathematics; full original Processing raster/antialias/DPI equivalence is not claimed.',
  'Old/new complete images are local 1871 compatibility, not evidence of native raster parity.',
  'Completed task timing includes actual Generator request. completedWithRendererMs additionally includes fresh renderer/context, finish/readback, SHA and disposal. Cold/warm mean new/same worker; OS/browser caches are not cleared.',
  'Process-family CPU and sampled RSS come from the separate supervisor. VRAM, token use, tool fees, unsampled short-lived processes and absolute native runtime performance are unmeasured.',
  'Numerical JSON transport treats signed zeros as equal here; signed-zero assertions are retained in the raw-text independent unit fixture.']};
let browser,server,page;
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();
 const origin=server.resolvedUrls.local[0];browser=await chromium.launch({channel:'chrome',headless:true});
 page=await browser.newPage({viewport:{width:700,height:500},deviceScaleFactor:1});
 await page.route(origin,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Independent Spirograph source clock verification</title><body style="margin:0;background:#222"></body>'}));
 await page.goto(origin);
 report.result=await page.evaluate(async({cases,fixtureText,mode,baseline})=>{
  const {Generator}=await import('/src/engine/client.ts');
  const {createScene,parseScene,persistentScene}=await import('/src/engine/document.ts');
  const {definition}=await import('/src/scenes/index.ts');
  const {spirographClockFixture}=await import('/scripts/spirograph-clock-fixtures.mjs');
  const {prepareSpirographReplay}=await import('/src/engine/spirographReplay.ts');
  const {withSpirographReplayFrame}=await import('/src/engine/spirographFramePlan.ts');
  const {ArtRenderer}=await import('/src/engine/renderer.ts');
  const old=await import('/'+baseline+'/src/engine/client.ts');
  const oldDocument=await import('/'+baseline+'/src/engine/document.ts');
  const oldScenes=await import('/'+baseline+'/src/scenes/index.ts');
  const oldRenderer=await import('/'+baseline+'/src/engine/renderer.ts');
  const rawVectors=JSON.parse(fixtureText);
  const result=globalThis.__clockResult={oracle:[],worker:[],recording:[],compatibility:[],costs:[],boundaries:[]};
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const signature=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const bytes=out=>out.type==='raster'?out.pixels:new Uint8Array(out.positions.buffer,out.positions.byteOffset,out.positions.byteLength);
  function assertFrame(actual,want,label){
   check(actual,label+' missing delivered source frame');
   for(const [key,value] of Object.entries(want)){
    const got=actual[key];
    if(Array.isArray(value)){check(Array.isArray(got)&&got.length===value.length,label+' '+key+' length');value.forEach((v,i)=>{
     if(typeof v==='number')check(Number.isFinite(got[i])&&Math.abs(got[i]-v)<=1e-9,label+' '+key+'['+i+'] '+got[i]+' != '+v);
     else check(got[i]===v,label+' '+key+'['+i+']');
    });}else if(typeof value==='number')check(got===value,label+' '+key+' '+got+' != '+value);
    else check(got===value,label+' '+key);
   }
  }
  const make=c=>parseScene(JSON.stringify(persistentScene(spirographClockFixture(createScene(definition('spirograph')),c))));
  const NativeWorker=globalThis.Worker;let active=0,created=0;
  globalThis.Worker=class extends NativeWorker{constructor(...args){super(...args);this.owned=true;active++;created++;}terminate(){if(this.owned){this.owned=false;active--;}return super.terminate();}};
  const render=async(out,scene,Renderer=ArtRenderer,width=257,height=193)=>{
   const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=new Renderer(canvas);let gl;
   try{
    renderer.setSize(width,height,1);renderer.setOutput(out,out.spirographFrame?withSpirographReplayFrame(scene,out.spirographFrame):scene,true);renderer.render();
    gl=renderer.renderer.getContext();gl.finish();const rgba=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);check(gl.getError()===gl.NO_ERROR,'renderer GL error');
    return{sha256:await signature(rgba),bytes:rgba.length};
   }finally{renderer.dispose();renderer.renderer.forceContextLoss();canvas.remove();}
  };
  try{
   if(mode==='functional'){
    for(const vector of rawVectors.cases){
     const plan=prepareSpirographReplay(vector.input);
     try{
      vector.expected.forEach((want,frame)=>assertFrame(plan.sample(frame),want,vector.id+' core '+frame));
      for(const frame of [3,1,0,vector.expected.length-1])assertFrame(plan.sample(frame),vector.expected[frame],vector.id+' seek '+frame);
      if(vector.fork){const f=vector.fork,p=plan.forkRecording(f.at,f.fps);try{f.expected.forEach((want,frame)=>assertFrame(p.sample(frame),want,vector.id+' fork '+frame));}finally{p.dispose();}}
      result.oracle.push({id:vector.id,frames:vector.expected.length,recordingFrames:vector.fork?.expected.length??0});
     }finally{plan.dispose();check(plan.diagnostics().disposed,vector.id+' disposed');}
    }
    // Direct core cancellation is deterministic; public cancellation below also
    // proves termination/recovery of the actual owned Worker.
    const p=prepareSpirographReplay(rawVectors.cases[0].input);let abort;
    try{p.sample(1000,()=>true);}catch(e){abort=e.name;}finally{p.dispose();}check(abort==='AbortError','core cancellation');result.boundaries.push({id:'core-cancel',error:abort});
    const selected=cases.filter(c=>c.input.clock.kind==='offline-fixed'&&!c.input.recording&&(!c.id.startsWith('easing-')||['easing-back-out','easing-not-quite-there','easing-there-and-back','easing-running-start','easing-wiggle'].includes(c.id)));
    for(const c of selected){
     const scene=make(c),saved=JSON.stringify(persistentScene(scene)),g=new Generator(),seen=new Map();
     const frames=[...new Set([0,1,2,7,Math.min(c.through,13),Math.min(c.through,31),c.through])];frames.push(2,c.through);
     try{
      for(let n=0;n<frames.length;n++){
       const frame=frames[n],request={time:frame/(c.input.clock.fps??60),width:257,height:193,quality:'export',spirographFrame:{frame}};
       const start=performance.now(),out=await g.generate(n===frames.length-1?parseScene(saved):scene,request),elapsedMs=performance.now()-start;
       assertFrame(out.spirographFrame,c.expected[frame],c.id+' worker '+frame);check(out.type==='raster'&&out.width===257&&out.height===193,c.id+' full raster');
       const mathHash=await signature(bytes(out));if(seen.has(frame))check(seen.get(frame)===mathHash,c.id+' warm/backseek exact');seen.set(frame,mathHash);
       const probe=c.probes[frame];if(probe){let lit=false;for(let y=Math.floor(probe[1])-3;y<=Math.ceil(probe[1])+3;y++)for(let x=Math.floor(probe[0])-3;x<=Math.ceil(probe[0])+3;x++)if(x>=0&&x<257&&y>=0&&y<193){const k=4*(y*257+x);lit ||=out.pixels[k]+out.pixels[k+1]+out.pixels[k+2]>25;}check(lit,c.id+' independently projected pen pixel');}
       const presentation=await render(out,scene);result.worker.push({id:c.id,frame,request,condition:n===0?'cold-new-worker':n===frames.length-1?'saved-reload-same-worker':'warm-same-worker',elapsedMs,mathHash,imageHash:presentation.sha256,probe:probe??null,facts:out.spirographFrame});
      }
      const last=c.through,cold=new Generator();try{const start=performance.now(),out=await cold.generate(parseScene(saved),{time:0,width:257,height:193,quality:'export',spirographFrame:{frame:last}});assertFrame(out.spirographFrame,c.expected[last],c.id+' cold');check(await signature(bytes(out))===seen.get(last),c.id+' cold exact');result.worker.push({id:c.id,frame:last,condition:'saved-reload-cold-worker',elapsedMs:performance.now()-start,mathHash:await signature(bytes(out)),facts:out.spirographFrame});}finally{cold.dispose();}
     }finally{g.dispose();}
    }
    const c=cases.find(c=>c.id==='current-recording'),scene=make(c),g=new Generator();
    try{
     const plan=await g.planSpirographRecording(scene,c.fork.at,c.fork.fps);
     const terminal=c.fork.expected.at(-1);
     check(terminal.recordingFinished&&plan.firstEncodedUpdate===2&&plan.finished&&plan.encodedFrames===terminal.encodedFrames&&plan.updates===terminal.frame,'record plan independent terminal');
     for(const frame of [0,1,2,3,9,15,terminal.frame,80,2]){
      const start=performance.now(),out=await g.generate(scene,{time:0,width:257,height:193,quality:'export',spirographFrame:{frame,recording:{startFrame:c.fork.at,fps:c.fork.fps}}});
      assertFrame(out.spirographFrame,c.fork.expected[frame],'current recording '+frame);const presentation=await render(out,scene);
      result.recording.push({kind:'current-state',frame,elapsedMs:performance.now()-start,mathHash:await signature(bytes(out)),imageHash:presentation.sha256,facts:out.spirographFrame});
     }
     result.recording.push({kind:'plan',...plan});
     const empty=cases.find(c=>c.id==='recording-empty-warmup'),emptyPlan=await g.planSpirographRecording(make(empty),0,60);
     const expectedEmpty=empty.expected.at(-1);check(emptyPlan.finished&&emptyPlan.encodedFrames===0&&emptyPlan.firstEncodedUpdate===null&&emptyPlan.updates===expectedEmpty.frame,'zero-frame recording warmup');
     result.recording.push({kind:'empty-plan',...emptyPlan});
    }finally{g.dispose();}
    const cancelled=new Generator();let error;
    try{const work=cancelled.generate(scene,{time:100,width:257,height:193,quality:'export',spirographFrame:{frame:6000}});cancelled.cancel();try{await work;}catch(e){error=e.name;}check(error==='AbortError','worker cancellation');
     const recovery=await cancelled.generate(scene,{time:0,width:257,height:193,quality:'export',spirographFrame:{frame:2}});assertFrame(recovery.spirographFrame,c.expected[2],'worker recovery');result.boundaries.push({id:'worker-cancel-recover',error,mathHash:await signature(bytes(recovery))});
    }finally{cancelled.dispose();}
    for(const preset of oldScenes.definition('spirograph').presets){
     const original=oldDocument.createScene(oldScenes.definition('spirograph'),preset);delete original.settings.spirographClock;
     const next=parseScene(JSON.stringify(oldDocument.persistentScene(original))),a=new old.Generator(),b=new Generator();
     try{for(const time of [0,.25,2]){
      const request={time,width:257,height:193,quality:'export'};const before=await a.generate(original,request),after=await b.generate(next,request);
      const first=await signature(bytes(before)),second=await signature(bytes(after));check(first===second,'1871 math '+preset.id+' '+time);
      const oldImage=await render(before,original,oldRenderer.ArtRenderer),newImage=await render(after,next);check(oldImage.sha256===newImage.sha256,'1871 image '+preset.id+' '+time);
      result.compatibility.push({preset:preset.id,time,mathHash:first,imageHash:oldImage.sha256,explicitClock:false});
     }}finally{a.dispose();b.dispose();}
    }
   }else{
    const side=mode.startsWith('old')?'old':'current',Constructor=side==='old'?old.Generator:Generator,Renderer=side==='old'?oldRenderer.ArtRenderer:ArtRenderer;
    const base=oldDocument.createScene(oldScenes.definition('spirograph'),oldScenes.definition('spirograph').presets.find(p=>p.id==='hypotrochoid'));base.settings.count=18000;delete base.settings.spirographClock;
    const candidates=[{id:'unchanged-clock-omitted',scene:base,time:2},...(side==='current'?[{id:'new-source-frame',scene:make(cases.find(c=>c.id==='fps-60')),time:2,frame:120}]:[])];
    for(const candidate of candidates)for(let repeat=0;repeat<3;repeat++){
     const g=new Constructor();try{for(const condition of ['cold-new-worker','warm-same-worker']){
      const request={time:candidate.time,width:640,height:360,quality:'export',...(candidate.frame===undefined?{}:{spirographFrame:{frame:candidate.frame}})};
      const start=performance.now(),out=await g.generate(candidate.scene,request),elapsedMs=performance.now()-start;
      const presentation=await render(out,candidate.scene,Renderer,640,360);result.costs.push({side,id:candidate.id,repeat,condition,request,elapsedMs,completedWithRendererMs:performance.now()-start,producerElapsedMs:out.stats.elapsedMs,mathHash:await signature(bytes(out)),imageHash:presentation.sha256,sourceFrame:out.spirographFrame??null});
     }}finally{g.dispose();}
    }
   }
  }finally{globalThis.Worker=NativeWorker;result.ownedWorkers={created,active};}
  check(active===0,'owned workers not terminated');return result;
 },{cases,fixtureText,mode,baseline});
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error?.stack??error);try{report.partial=await page?.evaluate(()=>globalThis.__clockResult);}catch{}throw error;}
finally{
 await browser?.close();await server?.close();report.sourceEnd=await snapshot();
 report.sourceStable=report.sourceStart.every((x,i)=>x.sha256===report.sourceEnd[i].sha256);report.finishedAt=new Date().toISOString();
 await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,sourceStable:report.sourceStable,output,mode,counts:report.result&&Object.fromEntries(Object.entries(report.result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))}));
}
