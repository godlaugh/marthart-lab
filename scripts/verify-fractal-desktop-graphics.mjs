// Run after: node scripts/verify-fractal-source-color.mjs --prepare-only
// Usage: node scripts/verify-fractal-desktop-graphics.mjs <prepared-directory>
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {hash,createColorOracle} from './fractal-source-color-oracle.mjs';
const require=createRequire(import.meta.url),prepared=process.argv[2];
assert.ok(prepared,'Pass the prepared-directory reported by --prepare-only');
const manifest=JSON.parse(await readFile(resolve(prepared,'report.json'),'utf8'));
assert.equal(manifest.status,'prepared-not-executed');
const artifacts={};for(const name of ['oracle.frag','oracle.vert','inputs.json']){
 const fact=manifest.artifacts[name],bytes=await readFile(fact.path);assert.equal(hash(bytes),fact.sha256,`Changed prepared ${name}`);artifacts[name]=bytes.toString();
}
const sources=['desktop/graphics.mjs','scripts/fractal-source-color-oracle.mjs','scripts/verify-fractal-desktop-graphics.mjs'];
const snapshot=async()=>Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await readFile(p))])));
await mkdir('.cache',{recursive:true});const directory=await mkdtemp(resolve('.cache/fractal-desktop-graphics-')),entry=directory+'/entry.mjs',profile=directory+'/profile',sourceBefore=await snapshot();
async function compare({factory,fragment,vertex,inputs}){
 const make=(0,eval)('('+factory+')'),difference=(a,b)=>{let changedChannels=0,maxAbsoluteDifference=0;for(let i=0;i<a.length;i++){if(a[i]!==b[i])changedChannels++;maxAbsoluteDifference=Math.max(maxAbsoluteDifference,Math.abs(a[i]-b[i]));}return{changedChannels,maxAbsoluteDifference};};
 let warm,cold;const result={rows:[],cleanup:{}};
 try{
  warm=make(fragment,vertex);result.graphics=warm.info();const images=new Map();for(const input of inputs)images.set(input.name,warm.run(input));cold=make(fragment,vertex);
  for(const name of ['outside-smooth_mandelbrot','trap-mix-0.0011']){const input=inputs.find(i=>i.name===name),a=images.get(name),b=cold.run(input),repeat=warm.run(input);result.rows.push({name,difference:difference(a,b),repeat:difference(a,repeat),warmPixels:Array.from(a),coldPixels:Array.from(b)});}
 }finally{if(cold)result.cleanup.cold=cold.dispose();if(warm)result.cleanup.warm=warm.dispose();}return result;
}
const payload={factory:createColorOracle.toString(),fragment:artifacts['oracle.frag'],vertex:artifacts['oracle.vert'],inputs:JSON.parse(artifacts['inputs.json'])};
const code=`import {app,BrowserWindow} from 'electron';import {writeFile} from 'node:fs/promises';import {configureDesktopGraphics} from ${JSON.stringify(pathToFileURL(resolve('desktop/graphics.mjs')).href)};
app.setPath('userData',app.commandLine.getSwitchValue('probe-user-data'));
if(app.commandLine.getSwitchValue('probe-policy')==='apply'){configureDesktopGraphics(app.commandLine);configureDesktopGraphics(app.commandLine);}
async function run(){await app.whenReady();let win;try{win=new BrowserWindow({show:false,width:64,height:64,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await win.loadURL('data:text/html,<!doctype html><title>Owned fractal diagnostic</title>');const result=await win.webContents.executeJavaScript(${JSON.stringify('('+compare.toString()+')('+JSON.stringify(payload)+')')});await writeFile(app.commandLine.getSwitchValue('probe-report'),JSON.stringify({versions:{electron:process.versions.electron,chrome:process.versions.chrome},features:app.commandLine.getSwitchValue('enable-angle-features'),result}));win.destroy();app.quit();}catch(error){console.error(error);win?.destroy();app.exit(1);}}void run();`;
await writeFile(entry,code);
const report={scope:'Installed Electron, isolated hidden window, retained shader and exact prepared inputs. Shares production desktop graphics policy. Not original MathArt/JVM execution or full product UI.',prepared:resolve(prepared),sourceBefore,rows:[],status:'running'};
try{
 for(const variant of ['baseline','policy','policy-restart']){
  const started=performance.now(),output=directory+'/'+variant+'.json',args=[entry,'--probe-user-data='+profile,'--probe-report='+output,'--probe-policy='+(variant==='baseline'?'skip':'apply')],env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const exit=await new Promise((done,reject)=>{
   const child=spawn(require('electron'),args,{env,stdio:['ignore','pipe','pipe']});let stderr='',force;
   child.stderr.on('data',d=>{stderr=(stderr+d).slice(-3000);});child.stdout.on('data',()=>{});
   const timer=setTimeout(()=>{child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),5000);},60000);
   const clear=()=>{clearTimeout(timer);clearTimeout(force);};child.once('error',e=>{clear();reject(e);});child.once('exit',(code,signal)=>{clear();done({code,signal,stderr});});
  });
  assert.equal(exit.code,0,JSON.stringify(exit));const row={variant,elapsedMs:performance.now()-started,reusedProfile:variant!=='baseline',exit,...JSON.parse(await readFile(output,'utf8'))};
  for(const r of row.result.rows){r.warmSha256=hash(Uint8Array.from(r.warmPixels));r.coldSha256=hash(Uint8Array.from(r.coldPixels));delete r.warmPixels;delete r.coldPixels;assert.equal(r.repeat.changedChannels,0);}
  report.rows.push(row);
  if(variant!=='baseline'){
   if(process.platform==='darwin')assert.equal(row.features.split(',').filter(x=>x==='disableProgramCaching').length,1,'production policy missing or not idempotent');
   for(const r of row.result.rows){assert.equal(r.difference.changedChannels,0,`${variant}: ${r.name}`);assert.equal(r.warmSha256,report.rows[0].result.rows.find(x=>x.name===r.name).warmSha256,'Changed the independently compiled baseline image');}
  }
 }
 report.sourceAfter=await snapshot();assert.deepEqual(report.sourceAfter,sourceBefore);report.status='passed';
}catch(error){report.status='failed';report.error=String(error);process.exitCode=1;}
finally{await writeFile(directory+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:directory+'/report.json',status:report.status,rows:report.rows.map(r=>({variant:r.variant,versions:r.versions,features:r.features,cases:r.result.rows}))},null,2));}
