/** Actual App controls → GenerationQueue → Worker → canvas, no native UI oracle. */
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodePng} from './lib/verify-png.mjs';
const directory=process.argv[2]??`.cache/surface-ui-${Date.now()}`;await mkdir(directory,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex'),check=(value,message)=>{if(!value)throw Error(message);};
async function files(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())out.push(...await files(p));else if(e.isFile())out.push(p);}return out;}
async function hashes(){return Object.fromEntries(await Promise.all([...(await files('src')),'scripts/verify-source-surface-ui.mjs','scripts/lib/verify-png.mjs'].sort().map(async p=>[p,sha(await readFile(p))])));}
const report={at:new Date().toISOString(),status:'running',scope:'Actual App import, playback, parameter commit, current PNG download and Apply through the unmodified production queue and worker.',limits:['No original GUI/JOGL or full-window parity.','Original PNG pixels, viewport gestures and recording lifecycle remain pending.'],cases:[],sourceBefore:await hashes()};
function audit(){
 const Native=window.Worker,a=window.__surfaceAudit={sequence:0,requests:[],responses:[],errors:[]};
 window.Worker=class extends Native{
  sent=new Map();constructor(...args){super(...args);this.addEventListener('message',({data})=>{const sent=this.sent.get(data.id);if(!sent||data.operation!==sent.operation)return;const o=data.output,row={...sent,response:{operation:data.operation,error:data.error,paused:data.paused},capture:data.result?.capture?.surfaceLive,preview:data.result?.preview?.surfaceLive,live:o?.surfaceLive,value:o?.sourceGpuPoints?.parameters[0]??o?.sourceGpuMesh?.parameters[0]??o?.positions?.[0]};if(data.error)a.errors.push(row);a.responses.push(row);this.sent.delete(data.id);});}
  postMessage(data,...args){const row={sequence:++a.sequence,operation:data.operation,id:data.id,revision:data.context?.surfaceLive?.revision,actualFrameRate:data.context?.surfaceLive?.actualFrameRate,parameterName:data.name,parameterValue:data.value};a.requests.push(row);this.sent.set(data.id,row);return super.postMessage(data,...args);}
 };
}
let server,browser;const started=performance.now();
try{
 server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error'});await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}/`;browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 for(const backend of ['CPU','GPU'])for(const mode of ['POINTS','MESH']){
  const row={backend,mode,status:'running',steps:[]};report.cases.push(row);const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);await page.addInitScript(audit);
  const ready=()=>page.waitForFunction(()=>document.querySelector('.status-bar')?.textContent.includes('Ready')&&!document.querySelector('.rendering-badge')&&!document.querySelector('.error-card'));
  const last=()=>page.evaluate(()=>window.__surfaceAudit.responses.findLast(r=>r.live));
  const sequence=()=>page.evaluate(()=>window.__surfaceAudit.sequence);
  const next=async seq=>{await page.waitForFunction(seq=>window.__surfaceAudit.responses.some(r=>r.sequence>seq&&r.live),seq);await ready();return last();};
  const pixels=async()=>sha(await page.getByTestId('art-canvas').screenshot());
  try{
   await page.route('**/surface-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'}));await page.goto(origin+'surface-fixture');
   await page.evaluate(async()=>{const {createScene,saveWorkspace}=await import('/src/engine/document.ts'),{definition}=await import('/src/scenes/index.ts');const initial=createScene(definition('surface'));Object.assign(initial.settings,{uSegments:3,vSegments:3,showTrails:false});saveWorkspace(localStorage,{scenes:[initial],active:initial.id,theme:'dark',language:'en',render:{quality:'low',frameRate:20}});});
   const project={config_version:'1.0.0',type:'SURFACE',name:`Surface UI ${backend} ${mode}`,parameters:{a:.25},equations:{x:'a+u',y:'v',z:'0'},camera:{phi:0,theta:0,gamma:0},settings:{render_mode:backend,surface_mode:mode,u_segments:10,v_segments:10,mesh_u_segments:10,mesh_v_segments:10,u_min:-1,u_max:1,v_min:-1,v_max:1,scale_x:60,scale_y:60,scale_z:60,speed_u:0,speed_v:0,show_trails:false,mesh_wireframe:false},timeline:[{type:'animate',duration:30,easing:'LINEAR',actions:[{method:'paramStart',args:{parameters:{a:{step:.1,min:-1,max:1}}}},{method:'ambient',args:[.1,.2,.3]}]}]};
   await page.goto(origin);await ready();await page.locator('input[type=file]').setInputFiles({name:'surface.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});let current=await next(0);check(current.live.paused&&current.live.frame.sceneTime===0,'import not paused at origin');row.steps.push({name:'import',frame:current});
   await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>window.__surfaceAudit.responses.some(r=>r.live?.frame.sceneTime>.2&&!r.live.paused));
   let seq=await sequence();await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(seq=>window.__surfaceAudit.responses.some(r=>r.sequence>seq&&r.operation==='surface-playback'&&r.response.paused),seq);await ready();current=await last();const before=current.live,oldPixels=await pixels();row.steps.push({name:'play-pause',frame:current});
   await page.getByRole('button',{name:'Save',exact:true}).click();await ready();row.steps.push({name:'save-before-edit'});
   seq=await sequence();await page.locator('#param-a').fill('-.6');await page.locator('#param-a').press('Enter');current=await next(seq);check(current.live.revision===before.revision&&current.live.constructions===before.constructions&&JSON.stringify(current.live.frame)===JSON.stringify(before.frame),'parameter edit rebuilt or advanced');const editPixels=await pixels();check(backend==='CPU'&&mode==='POINTS'?editPixels===oldPixels:editPixels!==oldPixels,'paused edit pixels wrong');row.steps.push({name:'parameter',frame:current,pixels:editPixels});
   await page.getByRole('button',{name:'Export artwork',exact:true}).click();
   check(await page.getByRole('combobox',{name:'Surface image source',exact:true}).inputValue()==='current','capture is not the default');
   await page.getByRole('combobox',{name:'Export resolution',exact:true}).selectOption('custom');
   await page.getByRole('spinbutton',{name:'Export width',exact:true}).fill('65');await page.getByRole('spinbutton',{name:'Export height',exact:true}).fill('49');
   await page.getByRole('combobox',{name:'PNG upscale',exact:true}).selectOption('3');
   const captures=[];
   for(let repeat=0;repeat<2;repeat++){
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Start export',exact:true}).click();
    const png=await download,path=`${directory}/${backend}-${mode}-current-${repeat}.png`;await png.saveAs(path);const decoded=decodePng(await readFile(path));
    check(decoded.width===195&&decoded.height===147,'PNG dimensions');const capture=await page.evaluate(()=>window.__surfaceAudit.responses.findLast(r=>r.capture));
    check(capture&&JSON.stringify(capture.capture.frame)===JSON.stringify(current.live.frame)&&JSON.stringify(capture.preview.frame)===JSON.stringify(current.live.frame),'PNG advanced scene');
    captures.push({width:decoded.width,height:decoded.height,pixels:sha(decoded.rgba),capture});
   }
   check(captures[0].pixels===captures[1].pixels,'repeated PNG pixels changed');
   await page.getByRole('button',{name:'Close export',exact:true}).click();await ready();check(await pixels()===editPixels,'PNG changed the primary preview');row.steps.push({name:'current-png',captures,primaryStable:true});
   seq=await sequence();await page.getByTestId('surface-apply').click();current=await next(seq);check(current.live.paused&&current.live.frame.sceneTime===0&&current.live.revision>before.revision&&current.live.constructions===before.constructions+1,'paused Apply lifecycle');row.steps.push({name:'paused-apply',frame:current,pixels:await pixels()});
   await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(rev=>window.__surfaceAudit.responses.some(r=>r.live?.revision===rev&&r.live.frame.sceneTime>.15),current.live.revision);
   seq=await sequence();await page.getByTestId('surface-apply').click();await page.waitForFunction(seq=>window.__surfaceAudit.responses.some(r=>r.sequence>seq&&r.live&&!r.live.paused&&r.live.frame.sceneTime===0),seq);
   const apply=await page.evaluate(seq=>window.__surfaceAudit.responses.find(r=>r.sequence>seq&&r.live&&r.live.frame.sceneTime===0),seq);check(apply.live.constructions===current.live.constructions+1,'running Apply did not replace owner');row.steps.push({name:'running-apply',frame:apply});
   seq=await sequence();await page.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(seq=>window.__surfaceAudit.responses.some(r=>r.sequence>seq&&r.operation==='surface-playback'&&r.response.paused),seq);await ready();
   await page.screenshot({path:`${directory}/${backend}-${mode}.png`});row.audit=await page.evaluate(()=>window.__surfaceAudit);check(!errors.length&&!row.audit.errors.length,'runtime errors');row.status='passed';
  }catch(error){row.status='failed';row.error=String(error.stack??error);row.audit=await page.evaluate(()=>window.__surfaceAudit).catch(()=>undefined);await page.screenshot({path:`${directory}/${backend}-${mode}-failure.png`}).catch(()=>{});}
  finally{row.pageErrors=errors;await page.close();console.log(`${backend} ${mode}: ${row.status}${row.error?' '+row.error:''}`);}
 }
 report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';
}catch(error){report.status='failed';report.error=String(error.stack??error);}
finally{await browser?.close();await server?.close();report.sourceAfter=await hashes();report.sourceStable=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);if(!report.sourceStable)report.status='failed';report.elapsedMs=performance.now()-started;await writeFile(`${directory}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,elapsedMs:report.elapsedMs,report:`${directory}/report.json`}));if(report.status!=='passed')process.exitCode=1;}
