/** Public creation entry points, never an original MathArt pixel oracle. */
import {chromium} from '@playwright/test';
import {createServer,preview} from 'vite';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory=process.argv[2]??`.cache/v2-creation-ui-${Date.now()}`,built=process.argv.includes('--built');
await mkdir(directory,{recursive:true});
const check=(ok,message)=>{if(!ok)throw Error(message);},sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(dir){const paths=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())paths.push(...await files(p));else if(e.isFile())paths.push(p);}return paths;}
const hashes=async()=>Object.fromEntries(await Promise.all([...(await files('src')),...(built?await files('dist-v2'):[]),'package.json','vite.config.ts','scripts/verify-v2-creation-ui.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',built,scope:'Actual 2.0 preview template selection, new scenes, render, Save, JSON export, workspace reload and My artworks entry. Existing local template semantics are preserved.',limits:['No original application/GPU/image equivalence.','One representative template and default new document per family; not every preset or export format.','Source-compatible imported projects retain their own semantics; exposing local templates does not convert them to source projects.','No desktop packaging or installed application update.'],sourceBefore:await hashes(),cases:[]};
let server,staticServer,browser,page;const started=performance.now();
function installAudit(){const Native=window.Worker,a=window.__creationAudit={requests:[],completed:[],errors:[]};window.Worker=class extends Native{sent=new Map();constructor(...args){super(...args);this.addEventListener('message',({data})=>{const request=this.sent.get(data.id);if(!request||data.operation!==request.operation)return;if(data.error)a.errors.push({request,error:data.error});if(data.output)a.completed.push({request,type:data.output.type,stats:data.output.stats,temporal:data.output.temporal});});}postMessage(data,...args){const request={id:data.id,operation:data.operation,kind:data.scene?.kind,name:data.scene?.name};this.sent.set(data.id,request);a.requests.push(request);return super.postMessage(data,...args);}};}
try{
 server=await createServer({mode:'preview-v2',server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});
 const {definitions}=await server.ssrLoadModule('/src/scenes/index.ts');const catalog=definitions.map(d=>({kind:d.kind,name:d.name,presets:d.presets.length}));report.catalog=catalog;
 let origin;if(built){staticServer=await preview({build:{outDir:'dist-v2'},preview:{host:'127.0.0.1',port:0,strictPort:true},logLevel:'error'});origin=`http://127.0.0.1:${staticServer.httpServer.address().port}/`;}else{await server.listen();origin=`http://127.0.0.1:${server.httpServer.address().port}/`;}
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 for(const item of catalog){
  const row={kind:item.kind,status:'running'};report.cases.push(row);const errors=[];page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(installAudit);
  const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('就绪')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
  try{
   await page.goto(origin);await ready();await page.getByTestId('creation-preview-note').waitFor();check(await page.locator('.category-grid button').count()===12,'not all scene categories are discoverable');
   await page.locator('.category-grid').getByRole('button',{name:item.name,exact:true}).click();check(await page.locator('.preset-card').count()===item.presets,'template count differs');
   if(item.presets){await page.locator('.preset-card').first().click();await page.waitForFunction(kind=>window.__creationAudit.completed.some(r=>r.request.kind===kind),item.kind);await ready();row.template=await page.evaluate(()=>window.__creationAudit.completed.at(-1));}
   await page.getByRole('button',{name:'新建场景',exact:true}).click();check(await page.locator('.new-menu button').count()===12,'new scene menu incomplete');
   await page.locator('.new-menu').getByRole('button',{name:item.name,exact:true}).click();
   const name='2.0 验收 '+item.kind;await page.getByRole('textbox',{name:'新场景名称',exact:true}).fill(name);await page.getByRole('button',{name:'确定',exact:true}).click();
   await page.waitForFunction(name=>window.__creationAudit.completed.some(r=>r.request.name===name),name);await ready();
   row.created=await page.evaluate(name=>window.__creationAudit.completed.findLast(r=>r.request.name===name),name);
   const png=await page.getByTestId('art-canvas').screenshot();
   const visibleColors=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,colors=new Set();for(let i=0;i<pixels.length;i+=4){colors.add(pixels[i]+','+pixels[i+1]+','+pixels[i+2]);if(colors.size>16)break;}canvas.width=canvas.height=0;return colors.size;},Array.from(png));
   check(visibleColors>4,'new scene has no visible artwork');row.visibleColorsAtLeast=visibleColors;await writeFile(`${directory}/${item.kind}-canvas.png`,png);
   await page.getByRole('button',{name:'保存',exact:true}).click();await ready();
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出项目 JSON',exact:true}).click();const file=await download,path=`${directory}/${item.kind}.json`;await file.saveAs(path);const saved=JSON.parse(await readFile(path,'utf8'));check(saved.kind===item.kind&&saved.name===name,'saved author document identity differs');row.documentSha256=sha(await readFile(path));
   await page.reload();await ready();check((await page.locator('body').innerText()).includes(name),'workspace reload lost active document');await page.getByTestId('creation-preview-note').waitFor();
   await page.getByRole('button',{name:'我的作品',exact:true}).click();check(await page.locator('.artwork-open').filter({hasText:name}).count()===1,'saved work missing');
   const newButton=page.getByRole('button',{name:'在此创建场景',exact:true});
   // My artworks has its own creation chooser, fed by the same catalog owner.
   await newButton.click();check(await page.locator('.library-actions').getByRole('button').count()===12,'My artworks creation chooser incomplete');
   row.audit=await page.evaluate(()=>window.__creationAudit);check(!row.audit.errors.length&&!errors.length,'runtime errors');row.savedReloaded=true;row.status='passed';await page.screenshot({path:`${directory}/${item.kind}-workspace.png`});
  }catch(error){row.status='failed';row.error=String(error.stack??error);row.audit=await page.evaluate(()=>window.__creationAudit).catch(()=>undefined);row.body=await page.locator('body').innerText().catch(()=>undefined);await page.screenshot({path:`${directory}/${item.kind}-failure.png`}).catch(()=>{});}
  finally{row.pageErrors=errors;await page.close();page=undefined;console.log(item.kind+': '+row.status+(row.error?' '+row.error:''));await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');}
  if(row.status!=='passed')break;
 }
 report.status=report.cases.length===catalog.length&&report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{await page?.close();const cleanup=await Promise.allSettled([browser?.close(),server?.close(),staticServer?new Promise((resolve,reject)=>staticServer.httpServer.close(e=>e?reject(e):resolve())):undefined]);report.cleanup=cleanup.map(r=>r.status);report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);report.elapsedMs=performance.now()-started;if(!report.sourceStable||cleanup.some(r=>r.status==='rejected'))report.status='failed';await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,elapsedMs:report.elapsedMs,report:`${directory}/report.json`}));if(report.status!=='passed')process.exitCode=1;}
