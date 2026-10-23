/** Mounted English/Chinese source inspectors; no original-renderer parity claim. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/source-controls-i18n-${Date.now()}`;
await mkdir(directory,{recursive:true});
const check=(v,m)=>{if(!v)throw Error(m);},sha=b=>createHash('sha256').update(b).digest('hex');
async function files(dir){return(await Promise.all((await readdir(dir,{withFileTypes:true})).map(e=>e.isDirectory()?files(dir+'/'+e.name):[dir+'/'+e.name]))).flat();}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-controls-i18n.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));}
const cases=[
 {id:'fractal',type:'FRACTAL',fractal:{formula_id:'mandelbrot',iterations:16},timeline:[{type:'animate',duration:1,actions:[{method:'center',args:[.1,.2]}]}],selector:'[data-testid="source-fractal-controls"]'},
 {id:'bouncing',type:'BOUNCING_PARTICLES',settings:{particle_count:32},selector:'[data-testid="source-bouncing-controls"],[data-testid="source-bouncing-transport"]'},
 ...['CPU','GPU'].map(mode=>({id:'perlin-'+mode,type:'PERLIN',settings:{render_mode:mode,particle_count:16,curve_count:4},selector:`[data-testid="source-perlin-${mode.toLowerCase()}-controls"]`})),
 ...['CPU','GPU'].map(mode=>({id:'surface-'+mode,type:'SURFACE',equations:{x:'u',y:'v',z:'sin(u)'},settings:{render_mode:mode,surface_mode:mode==='CPU'?'MESH':'POINTS',mesh_u_segments:6,mesh_v_segments:6},selector:'[data-testid="source-surface-mesh-controls"],[data-testid="source-surface-palette"]'})),
];
const report={at:new Date().toISOString(),status:'running',scope:'Actual preview-v2 App with default WebGL renderer; public file import, English/Chinese inspector switching, dynamic Fractal clip labels, JSON export, and author-name preservation.',limits:['Six representative imported configurations, not all scene input combinations.','No original pixels, native renderer, video export or desktop package validation.','Engine diagnostic messages and arbitrary source warnings are not declared fully translated.'],sourceBefore:await hashes(),cases:[]};
let server,browser,page;const start=performance.now();
function installAudit(){const Native=window.Worker,audit=window.__localeAudit={requests:0,completed:[],errors:[]};window.Worker=class extends Native{sent=new Map();constructor(...args){super(...args);this.addEventListener('message',({data})=>{const request=this.sent.get(data.id);if(!request||data.operation!==request.operation)return;if(data.error)audit.errors.push({request,error:data.error});if(data.output)audit.completed.push({request,type:data.output.type});});}postMessage(data,...args){audit.requests++;this.sent.set(data.id,{id:data.id,operation:data.operation,name:data.scene?.name,kind:data.scene?.kind});return super.postMessage(data,...args);}};}
// Opening the clip editor resizes the viewport and can enqueue a later render.
// Require readiness and stable delivery/layout together, not one stale Ready label.
const ready=()=>page.waitForFunction(()=>{
 const canvas=document.querySelector('[data-testid="art-canvas"]'),audit=window.__localeAudit;
 const ready=document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card');
 const signature=JSON.stringify([audit.requests,audit.completed.length,canvas?.clientWidth,canvas?.clientHeight]);
 if(!ready||window.__localeStable?.signature!==signature){window.__localeStable={signature,since:performance.now()};return false;}
 return performance.now()-window.__localeStable.since>=500;
});
async function locale(language,current){await page.getByTitle(current==='zh'?'工作区设置':'Workspace settings',{exact:true}).click();await page.getByRole('combobox',{name:current==='zh'?'界面语言':'Language',exact:true}).selectOption(language);await page.getByRole('button',{name:language==='zh'?'关闭设置':'Close settings',exact:true}).click();await page.waitForFunction(lang=>document.documentElement.lang===lang,language==='zh'?'zh-CN':'en');}
async function inspect(selector){
 const target=page.locator(selector);await target.first().waitFor();
 const facts=await target.evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,labels:[...node.querySelectorAll('[aria-label],[title]')].flatMap(e=>[e.getAttribute('aria-label'),e.getAttribute('title')]).filter(Boolean)})));
 check(facts.some(f=>f.text.trim()),'empty inspector');
 const untranslated=facts.flatMap(f=>[f.text,...f.labels]).filter(s=>/[\u3400-\u9fff]/.test(s));check(!untranslated.length,'Untranslated inspector: '+untranslated.join('\n').slice(0,1200));return facts;
}
try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}/`;
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 for(const c of cases){
  const row={id:c.id,status:'running',pageErrors:[]};report.cases.push(row);page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>row.pageErrors.push(e.message));
  await page.addInitScript(installAudit);await page.goto(origin);await page.getByTestId('creation-preview-note').waitFor();await locale('en','zh');
  const {id,selector,...config}=c,input={config_version:'1.0.0',name:'用户作品 '+id,...config};await page.locator('input[type=file]').setInputFiles({name:id+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(input))});
  await page.waitForFunction(name=>window.__localeAudit.completed.some(r=>r.request.name===name),input.name);await ready();
  row.geometry=await inspect(selector);
  if(id==='fractal'){
   await page.locator('.track-labels button').first().click();row.clip=await inspect('[data-testid="source-fractal-clip-editor"]');check(await page.getByRole('checkbox',{name:'Change Center',exact:true}).isChecked(),'dynamic center label/state missing');
   check(await page.getByRole('combobox',{name:'Compute backend',exact:true}).inputValue()==='auto','backend ID changed by translation');
  }
  await page.locator('.inspector-tabs').getByRole('button',{name:'Appearance',exact:true}).click();row.appearance=await inspect(selector);
  await ready();await page.screenshot({path:directory+'/'+id+'-english.png'});
  await locale('zh','en');row.chineseRestored=(await page.locator(selector).allTextContents()).some(s=>/[\u3400-\u9fff]/.test(s));check(row.chineseRestored,'Chinese labels not restored');await locale('en','zh');await inspect(selector);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export project JSON',exact:true}).click();const file=await download,path=directory+'/'+id+'.json';await file.saveAs(path);const saved=JSON.parse(await readFile(path,'utf8'));check(saved.name===input.name,'author name changed');check(JSON.stringify(saved.provenance.original)===JSON.stringify(input),'source provenance changed');row.exportedName=saved.name;row.sourcePreserved=true;row.audit=await page.evaluate(()=>window.__localeAudit);check(!row.pageErrors.length&&!row.audit.errors.length,'runtime errors');row.status='passed';await page.close();page=undefined;console.log(id+': passed');
 }
 report.status='passed';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.body=await page.locator('body').innerText().catch(()=>null);await page.screenshot({path:directory+'/failure.png'}).catch(()=>{});}}
finally{
 const cleanup=await Promise.allSettled([browser?.close(),server?.close()]);report.cleanup=cleanup.map(r=>r.status);report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-start;if(!report.sourceStable||cleanup.some(r=>r.status==='rejected'))report.status='failed';await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,elapsedMs:report.elapsedMs,report:directory+'/report.json',error:report.error}));if(report.status!=='passed')process.exitCode=1;
}
