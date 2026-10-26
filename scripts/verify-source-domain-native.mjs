/** Explicit saved original oracle + public production native render. No original
 * window, license override or instrumentation is performed by this verifier. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {sourceNativeVerificationServer} from './lib/source-native-verification-server.mjs';
import {verifyDomainNativeUi} from './domain-native-production-ui.mjs';
import {measureFamily} from './browser-process-cost.mjs';
const [directory,backendFile,referenceDirectory,configPath]=process.argv.slice(2);
assert(directory&&backendFile&&referenceDirectory&&configPath,'Supply output directory, sealed backend JSON, saved original native-domain directory, and original config path');
const sha=b=>createHash('sha256').update(b).digest('hex');await mkdir(directory,{recursive:true});
const sources=async(dir)=>{const all=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())all.push(...await sources(p));else if(e.isFile())all.push(p);}return all;};
const sourceHashes=async()=>Object.fromEntries(await Promise.all([...(await sources('src')),...(await sources('server'))].sort().map(async p=>[p,sha(await readFile(p))])));
const config=await readFile(configPath,'utf8'),reference=await readFile(referenceDirectory+'/color8.rgba');
assert.equal(sha(reference),'c458603efe6ec25009c9bc40d15ccb1f0b188911a7565513667e19812768e597');
assert.equal(sha(await readFile(referenceDirectory+'/actual-fragment.glsl')),'1710b9457b7a6d9ed7bd00dc16d50cab9a7359b4d05dc48d76c84d40db837421');
const report={at:new Date().toISOString(),status:'running',scope:'Original saved 500x600 mathematical layer versus legacy import + production model/shader + native CGL pixels. Source formula overlays, watermark and original window timing are outside this oracle.',config:{path:configPath,sha256:sha(config)},reference:{directory:referenceDirectory,rgbaSha256:sha(reference),rowOrder:'bottom-up'},sourceBefore:await sourceHashes()};
let host,browser;const started=performance.now(),errors=[];
try{
 host=await sourceNativeVerificationServer(directory,backendFile);report.backend=host.backend;
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const page=await browser.newPage();page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/native-domain-verifier',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(host.origin+'native-domain-verifier');
 const run=await measureFamily(process.pid,()=>page.evaluate(async config=>{
  const{generateDomainAsync}=await import('/src/engine/domain.ts'),{parseProjectFile}=await import('/src/engine/legacyImport.ts');
  const scene=parseProjectFile(config).scene,output=await generateDomainAsync(scene,{width:500,height:600,time:0,quality:'export',domainTarget:{logicalWidth:250,logicalHeight:300,pixelDensity:2}});
  return{...output,pixels:Array.from(output.pixels)};
 },config));
 const{pixels,...facts}=run,actual=Buffer.from(pixels);assert.equal(actual.length,reference.length);await writeFile(directory+'/product.rgba',actual);
 let changed=0,components=0,max=0;for(let y=0;y<600;y++)for(let x=0;x<500;x++){const a=(y*500+x)*4,b=((599-y)*500+x)*4;let bad=false;for(let k=0;k<4;k++){const d=Math.abs(actual[a+k]-reference[b+k]);if(d){bad=true;components++;max=Math.max(max,d);}}if(bad)changed++;}
 report.mathematicalLayer={pixels:300000,changed,components,max,rgbaSha256:sha(actual),facts};assert.equal(facts.backend,'native');assert.equal(changed,0);assert.equal(errors.length,0);
 await page.close();
 report.ui=await measureFamily(process.pid,()=>verifyDomainNativeUi(browser,host.origin,directory,JSON.parse(config)));
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;}
finally{
 await browser?.close();await host?.close();report.remainingProcesses=host?.service?.ownedProcessCount??0;report.sourceAfter=await sourceHashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.errors=errors;report.elapsedMs=performance.now()-started;if(!report.sourceStable){report.status='failed';process.exitCode=1;}
 await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,changed:report.mathematicalLayer?.changed,sourceStable:report.sourceStable,error:report.error,report:directory+'/report.json'}));
}
