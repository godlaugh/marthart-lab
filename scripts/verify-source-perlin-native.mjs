/** Original actual-draw mathematical layers through production import ->
 * Generator -> Worker -> page broker -> CGL -> retained target -> RGBA output.
 * No original execution, private source-field patch or visible window. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {sourceNativeVerificationServer} from './lib/source-native-verification-server.mjs';
import {measureFamily} from './browser-process-cost.mjs';
const [directory,backendFile,resourceRoot,originalDirectory]=process.argv.slice(2);
const webglBaseline=backendFile==='webgl';
assert(directory&&backendFile&&resourceRoot&&originalDirectory,'Supply fresh output, sealed backend JSON, original data resource root, and actual-draw capture directory');
await mkdir(directory,{recursive:true});const sha=b=>createHash('sha256').update(b).digest('hex');
const fixture=JSON.parse(await readFile('tests/fixtures/source-perlin/native-mathematical-20261026.json','utf8'));
async function files(d){const r=[];for(const e of await readdir(d,{withFileTypes:true})){const p=d+'/'+e.name;if(e.isDirectory())r.push(...await files(p));else if(e.isFile())r.push(p);}return r;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),...(await files('server'))].sort().map(async p=>[p,sha(await readFile(p))])));}
// Remove bootstrap interception before timing: leaving any Playwright route active
// sends unrelated native POST requests through CDP and distorts frame latency.
const packets=[];let host,browser;const report={at:new Date().toISOString(),status:'running',scope:fixture.scope,comparisonMode:webglBaseline?'same-task WebGL baseline; nonzero pixel differences retained':'native exact parity',sourceBefore:await hashes(),cases:[],errors:[]},started=performance.now();
try{
 host=await sourceNativeVerificationServer(directory,webglBaseline?undefined:backendFile);report.backend=host.backend;
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-angle-features=disableProgramCaching']});report.browser=browser.version();const page=await browser.newPage();page.on('pageerror',e=>report.errors.push(String(e)));if(process.argv.includes('--capture-packets'))page.on('request',request=>{if(request.url().endsWith('/api/source-renderer/frames'))packets.push(writeFile(directory+'/packet-'+packets.length+'.bin',request.postDataBuffer()));});
 await page.route('**/native-perlin-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(host.origin+'native-perlin-verifier');await page.unroute('**/native-perlin-verifier');
 for(const spec of fixture.cases){
  const config=await readFile(resourceRoot+'/'+spec.resource,'utf8');assert.equal(sha(config),spec.configSha256);
  const result=await measureFamily(process.pid,()=>page.evaluate(async ({config,spec})=>{
   const {Generator}=await import('/src/engine/client.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts');
   const generator=new Generator(),scene=parseProjectFile(config).scene,frames=[];
   try{for(const expected of spec.frames){const begin=performance.now(),output=await generator.generate(scene,{time:expected.uiTime,quality:'export',width:500,height:600,sourceViewport:{logicalWidth:250,logicalHeight:300,referenceLogicalHeight:486,target:'offscreen',projectionPass:'scene-fade-orthographic'},sourcePointPixelDensity:2,sourcePerlinViewport:{width:406,height:486,pixelDensity:2}});
    const elapsedMs=performance.now()-begin;const {pixels,...facts}=output;let binary='';for(let i=0;i<pixels.length;i+=16384)binary+=String.fromCharCode(...pixels.subarray(i,i+16384));frames.push({step:expected.step,elapsedMs,facts,pixels:btoa(binary)});
   }return{frames};}finally{generator.dispose();}
  },{config,spec}));
  const row={name:spec.name,processFamily:result.processFamily,frames:[]};report.cases.push(row);
  for(const frame of result.frames){const expected=spec.frames.find(f=>f.step===frame.step),pixels=Buffer.from(frame.pixels,'base64');assert.equal(pixels.length,500*600*4);
   const raw=await readFile(originalDirectory+'/native-'+spec.name+'/math-step-'+frame.step+'.rgba');assert.equal(sha(raw),expected.rgbaBottomUpSha256);const reference=Buffer.alloc(raw.length);for(let y=0;y<600;y++)raw.copy(reference,y*2000,(599-y)*2000,(600-y)*2000);
   let changed=0,components=0,max=0;for(let i=0;i<pixels.length;i+=4){let bad=false;for(let k=0;k<4;k++){const d=Math.abs(pixels[i+k]-reference[i+k]);if(d){components++;bad=true;max=Math.max(max,d);}}if(bad)changed++;}
   await writeFile(directory+'/'+spec.name+'-'+frame.step+'.rgba',pixels);const {pixels:unused,...facts}=frame;row.frames.push({...facts,rgbaSha256:sha(pixels),comparison:{pixels:300000,changed,components,max}});
   if(webglBaseline)assert.equal(frame.facts.backend,'webgl2');else{assert.equal(frame.facts.sourcePixelRenderer?.backend,'native');assert.match(frame.facts.sourcePixelRenderer.identity,/^[a-f0-9]{64}$/);}assert.equal(frame.facts.sourcePerlinFrame.updates,expected.step);
   const bits=new Uint32Array(new Float32Array([frame.facts.sourcePerlinFrame.sceneTime]).buffer)[0];assert.equal(bits,expected.timeBits);if(!webglBaseline)assert.equal(changed,0,spec.name+' step '+frame.step);
  }
 }
 assert.equal(report.errors.length,0);report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{await Promise.all(packets);await browser?.close();await host?.close();report.remainingServiceProcesses=host?.service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable){report.status='failed';process.exitCode=1;}report.elapsedMs=performance.now()-started;await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,sourceStable:report.sourceStable,cases:report.cases.length,error:report.error,remainingServiceProcesses:report.remainingServiceProcesses}));}
