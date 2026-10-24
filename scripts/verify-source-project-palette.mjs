/** Actual App file import, render input, save/reload and export. Original
 * ProjectState parity is established separately by the pinned JVM fixture. */
import assert from 'node:assert/strict';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcpServer} from 'node:net';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {createExportServer} from '../server/index.mjs';
import {measureFamily} from './browser-process-cost.mjs';
const out=process.argv[2];assert.ok(out&&!out.startsWith('--'));await mkdir(out);
const sha=v=>createHash('sha256').update(v).digest('hex');
const expected=['#FC6255','#FF862F','#FFFF00','#59743E','#83C167','#1D4A81','#9A72AC'];
const extras={
 SURFACE:{equations:{x:'u',y:'v',z:'u*v/10'},settings:{surface_mode:'MESH',render_mode:'CPU',u_segments:4,v_segments:4,mesh_u_segments:8,mesh_v_segments:8,scale_x:35,scale_y:35,scale_z:35,u_min:-3,u_max:3,v_min:-3,v_max:3,show_trails:false}},
 ATTRACTOR:{equations:{dx:'10*(y-x)',dy:'x*(28-z)-y',dz:'x*y-8/3*z'},settings:{particle_count_cpu:128,sub_steps:5,scale_x:6,scale_y:6,scale_z:6,offset_z:-150,show_trails:false},initialization:{warmup_steps:200}},
 FRACTAL:{fractal:{formula_id:'mandelbrot',iterations:32}},
 IMPLICIT:{equation:{f:'x*x+y*y+z*z-1'},settings:{x_segments:8,y_segments:8,z_segments:8,x_min:-2,x_max:2,y_min:-2,y_max:2,z_min:-2,z_max:2,render_mode:'SOLID',mesh_mode:'CPU'}},
 DOMAIN_COLORING:{domainColoring:{formula:'z'}},
 COMPLEX_ROOTS:{polynomial:{variable:'z',coefficients:{2:'1',0:'-1'}},sampling:{sample_count:256,batch_size:256,seed:1},settings:{worker_count:1}},
 PERLIN:{settings:{particle_count:64}},
 SYMMETRY_CHAOS:{settings:{batch_size:256}},
 SAMILA:{settings:{batch_size:256}},
};
function palette(s){switch(s.kind){case'surface':return s.surfaceSourcePalette?.colors;case'attractor':return s.attractorSource?.visual.palette.colors;case'fractal':return s.fractalSourceColor?.palette.colors;case'domain':return s.domainSourcePalette?.colors;case'roots':return s.rootsSourcePalette?.colors;case'perlin':return s.perlinSource?.palette;default:return s.palette.stops;}}
const report={status:'running',at:new Date().toISOString(),checks:[],cases:[],pageErrors:[],scope:'Nine actual App source-file imports with omitted palette; observed renderer inputs, save/reload, project export; Surface/Attractor generator count and restoration. Headless Chrome/WebGL; no original GUI or whole-image parity claim.'};
const check=(v,label)=>{assert.ok(v,label);report.checks.push(label);};
async function hashes(){const paths=(await readdir('src',{recursive:true})).filter(p=>/\.(ts|tsx|json|css)$/.test(p)).map(p=>'src/'+p);paths.push('scripts/verify-source-project-palette.mjs','scripts/browser-process-cost.mjs','server/index.mjs');return Object.fromEntries(await Promise.all(paths.sort().map(async p=>[p,sha(await readFile(p))])));}
report.sourceBefore=await hashes();let browser,server,service,page,phase='setup';
try{
 const port=await new Promise((resolve,reject)=>{const s=tcpServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
 service=await createExportServer({root:out+'/service',allowedOrigins:[`http://127.0.0.1:${port}`]});const address=await service.listen(0);
 server=await createServer({mode:'preview-v2',define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify('webgl')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,proxy:{'/api':`http://127.0.0.1:${address.port}`}},logLevel:'error'});await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();const context=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1});page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 await page.addInitScript(()=>{window.__paletteAudit=[];});
 await context.route('**/src/engine/client.ts',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst paletteAuditGenerate=Generator.prototype.generate;Generator.prototype.generate=async function(scene,input,...args){const entry={scene:structuredClone(scene),input:structuredClone(input)};window.__paletteAudit.push(entry);try{const o=await paletteAuditGenerate.call(this,scene,input,...args);entry.output={type:o.type,backend:o.sourcePixelRenderer?.backend??o.backend,width:o.width,height:o.height};return o;}catch(e){entry.error=String(e);throw e;}};`});});
 const origin=server.resolvedUrls.local[0];await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html></html>'}));await page.goto(origin+'fixture');
 await page.evaluate(async()=>{const{definitions}=await import('/src/scenes/index.ts'),{createScene,saveWorkspace}=await import('/src/engine/document.ts');const scene=createScene(definitions.find(d=>d.kind==='spirograph'));saveWorkspace(localStorage,{scenes:[scene],active:scene.id,theme:'dark',language:'en',render:{quality:'low',frameRate:30}});});await page.goto(origin);
 const ready=async name=>{await page.waitForFunction(name=>{const c=window.__paletteAudit.at(-1);return c?.scene.name===name&&c.output&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');},name);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));return page.evaluate(()=>window.__paletteAudit.at(-1));};
 const button=name=>page.getByRole('button',{name,exact:true});
 report.measurements=await measureFamily(process.pid,async()=>{const start=performance.now();
  for(const[type,extra]of Object.entries(extras)){
   const source={config_version:'1.0.0',name:'Project palette '+type,type,...extra,timeline:[]};phase=type+':import';
   await page.locator('input[type="file"][accept=".json"]').setInputFiles({name:type+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(source))});
   let state=await ready(source.name);const colors=type==='PERLIN'?expected.map(c=>(0xff000000|parseInt(c.slice(1),16))>>>0):['SAMILA','SYMMETRY_CHAOS'].includes(type)?expected.map(c=>c.toLowerCase()):expected;
   assert.deepEqual(palette(state.scene),colors);check(true,type+': file import delivers seven project colors to renderer');assert.deepEqual(state.scene.provenance.original,source);check(!Object.hasOwn(state.scene.provenance.original,'palette'),type+': original omission retained');
   if(type==='FRACTAL')check(state.scene.fractalSourceColor.palette.useCosine===false,type+': project starts Manual');
   if(['SURFACE','ATTRACTOR'].includes(type)){
    phase=type+':generator';await page.locator('.inspector-tabs button').nth(1).click();const mode=page.getByRole('combobox',{name:'Source palette generation mode',exact:true});await mode.selectOption('cosine');state=await ready(source.name);check(await page.getByTestId('source-bouncing-generator-count').inputValue()==='7',type+': initial generator count reads seven project colors');check(palette(state.scene).length===7,type+': generated palette reaches renderer');await mode.selectOption('manual');state=await ready(source.name);assert.deepEqual(palette(state.scene),colors);check(true,type+': Manual restores project defaults');
   }
   phase=type+':save';await button('Save').click();await page.reload();state=await ready(source.name);assert.deepEqual(palette(state.scene),colors);check(true,type+': saved colors survive App reload');
   const pending=page.waitForEvent('download');await page.getByTitle('Export project JSON',{exact:true}).click();await(await pending).saveAs(out+'/'+type+'.json');const exported=JSON.parse(await readFile(out+'/'+type+'.json','utf8'));assert.deepEqual(palette(exported),colors);assert.deepEqual(exported.provenance.original,source);check(true,type+': exported project retains colors and original input');
   if(['SURFACE','ATTRACTOR','FRACTAL'].includes(type))await page.screenshot({path:out+'/'+type+'.png'});
   report.cases.push({type,renderer:state.output,colors});
  }
  return{elapsedMs:performance.now()-start};
 });
 check(report.pageErrors.length===0,'No unhandled page errors');await browser.close();browser=undefined;report.status='passed';
}catch(error){report.status='failed';report.phase=phase;report.error=String(error.stack??error);process.exitCode=1;if(page){report.body=await page.locator('body').innerText().catch(()=>undefined);report.last=await page.evaluate(()=>window.__paletteAudit.slice(-2)).catch(()=>undefined);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{report.cleanup=(await Promise.allSettled([browser?.close(),server?.close(),service?.close()])).map(r=>r.status);report.remainingProcesses=service?.ownedProcessCount??0;report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable||report.remainingProcesses||report.cleanup.includes('rejected')){report.status='failed';process.exitCode=1;}await writeFile(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,checks:report.checks.length,phase:report.phase,error:report.error,report:out+'/report.json'}));}
