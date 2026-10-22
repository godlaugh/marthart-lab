/** Surface recording owner → actual CPU/GPU geometry renderer. No worker/UI/encoder. */
import {measureFamily} from './browser-process-cost.mjs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/surface-recording-${Date.now()}`;await mkdir(directory,{recursive:true});
const sha=v=>createHash('sha256').update(v).digest('hex');
async function files(dir){const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())result.push(...await files(p));else if(e.isFile())result.push(p);}return result;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-surface-recording.mjs','tests/fixtures/source-surface-scene/recording-native.json'].sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',scope:'Retained Surface numerical recording with real browser geometry rendering.',limits:['Worker/client/App recording and video encoding are not connected in this owner verifier.','Original fixture executes CPU numerical scene methods, not original shaders or GUI pixels.','GPU local comparisons reuse CPU numerical oracle; no native GPU parity claim.','Fixture actual FPS is injected, not measured from a native window.','First pass includes module initialization; second pass reuses modules/browser with fresh owners, not a full App cold/warm comparison.','Process-family CPU/RSS are sampled estimates and may miss short-lived children; VRAM and complete token cost are unmeasured. No equivalent pre-change recording path exists.'],sourceBefore:await hashes()};
let server,browser;const started=performance.now(),errors=[];
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/surface-recording',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Surface recording verification</title>'}));await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/surface-recording`);
 const measured=await measureFamily(process.pid,async()=>({cases:await page.evaluate(async fixture=>{
  const {SourceSurfaceLiveSession}=await import('/src/engine/sourceSurfaceLiveSession.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts'),{ordinarySourceViewport}=await import('/src/engine/ordinarySourceCamera.ts'),{ArtRenderer}=await import('/src/engine/renderer.ts');
  const check=(v,m)=>{if(!v)throw Error(m);},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');const rows=[];
  for(let repeat=0;repeat<2;repeat++)for(const backend of ['CPU','GPU'])for(const density of [1,2])for(const trace of fixture.actual.cases.filter(c=>backend==='CPU'||['animated-points','animated-mesh'].includes(c.input.name))){
   const project=structuredClone(trace.input.project);Object.assign(project.settings,{render_mode:backend,scale_x:12,scale_y:12,scale_z:12});
   const scene=parseProjectFile(JSON.stringify(project)).scene,owner=new SourceSurfaceLiveSession(),renderer=new ArtRenderer(document.createElement('canvas'));
   const c={time:0,quality:'preview',width:64*density,height:48*density,sourcePointPixelDensity:density,sourceViewport:ordinarySourceViewport(scene,64,48,'primary',48),surfaceLive:{sessionId:backend+density+trace.input.name,revision:0,clock:{paused:true,timestampMs:1000},actualFrameRate:29}};
   const render=async(output,source)=>{
    const v=output.sourceCameraFrame.viewport;renderer.setSize(v.logicalWidth,v.logicalHeight,density);renderer.setOutput(output,{...source,evaluatedSourceCamera:output.sourceCameraFrame},false);renderer.render();
    const gl=renderer.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    check(!gl.isContextLost()&&gl.getError()===0,'GL failure');const visible=pixels.some((p,i)=>i%4!==3&&p!==pixels[i%4]),covered=output.sourceSurfaceOverlayAlpha===255;
    check(covered?!visible:visible,`unexpected visibility: ${backend}/${density}/${trace.input.name}/${output.surfaceLive.frame.frameIndex}, overlay=${output.sourceSurfaceOverlayAlpha}`);return{width,height,visible,overlayAlpha:output.sourceSurfaceOverlayAlpha??0,pixels:await digest(pixels)};
   };
   try{
    owner.generate(scene,c);owner.updateParameter(scene,c,'a',.9);owner.navigatePaused(scene,c,{kind:'wheel',count:-3});
    const draft=structuredClone(scene);draft.equations.x='(';draft.name='kept draft';
    const beginAt=performance.now(),start=owner.beginRecording(draft,c,{width:17,height:13,simulationFps:4,actualFrameRate:37}),beginMs=performance.now()-beginAt,frames=[];
    check(start.clock.updates===trace.frames.length&&start.clock.encodedFrames===trace.frames.length-1,'planned completion');
    for(const [index,row]of trace.frames.entries()){
     const before=performance.now(),output=index===0?start.warmup:owner.nextRecordingFrame(start.handle,index,trace.input.steps[index].actualFrameRate),f=output.surfaceLive.frame,e=row.state;
     check(f.sceneTime===e.sceneTime&&f.rawDt===e.rawDt&&f.queueIndex===e.queueIndex&&f.queueComplete===row.autoComplete,'original numerical clock mismatch');
     check(['phi','theta','gamma','zoom','focalDistance'].every(k=>f.camera[k]===e.camera[k]),'original camera mismatch');
     check((output.sourceSurfaceOverlayAlpha??0)===Math.round(e.overlayAlpha*255),'original transition overlay mismatch');
     check(output.surfaceLive.recording.actualFrameRate===trace.input.steps[index].actualFrameRate&&output.surfaceLive.recording.warmup===(index===0),'observed FPS/warmup changed');
     const pixels=await render(output,start.scene);check(pixels.width===Math.floor(51/density+.5)*density&&pixels.height===Math.floor(39/density+.5)*density,'3x/density dimensions');
     frames.push({index,sceneTime:f.sceneTime,actualFrameRate:output.surfaceLive.recording.actualFrameRate,complete:f.queueComplete,...pixels,elapsedMs:performance.now()-before});
    }
    const before=owner.diagnostics().frame,stop=owner.finishRecording(start.handle,2000),primary=await render(stop.preview,start.scene);check(same(stop.preview.surfaceLive.frame,before)&&stop.scene.equations.x==='('&&stop.scene.name==='kept draft','stop changed frame/draft');
    const retry=owner.finishRecording(start.handle,9000),again=await render(retry.preview,start.scene);check(same(primary,again),'stop retry changed pixels');
    const resumed=owner.generate(stop.scene,{...stop.context,surfaceLive:{...stop.context.surfaceLive,clock:{paused:false,timestampMs:2250},actualFrameRate:43}});check(resumed.surfaceLive.frame.rawDt===.25&&resumed.surfaceLive.frame.frameIndex===trace.frames.length,'stop reset clock twice or resumed incorrectly');await render(resumed,start.scene);
    owner.reset();rows.push({repeat,temperature:repeat===0?'first-pass-after-module-load':'warm-runtime-fresh-owner',backend,density,name:trace.input.name,clock:start.clock,beginMs,frames,fullApplyAnchor:true,draftPreserved:true,stopNoAdvance:true,stopRetryStable:true,resumePassed:true});
   }finally{renderer.dispose();renderer.renderer.forceContextLoss();}
  }
  return rows;
 },JSON.parse(await readFile('tests/fixtures/source-surface-scene/recording-native.json','utf8')))}));report.cases=measured.cases;report.processFamily=measured.processFamily;
 if(errors.length)throw Error(errors.join('\n'));report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{await browser?.close();await server?.close();report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.errors=errors;report.elapsedMs=performance.now()-started;if(!report.sourceStable)report.status='failed';await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,cases:report.cases?.length,elapsedMs:report.elapsedMs}));if(report.status!=='passed')process.exitCode=1;}
