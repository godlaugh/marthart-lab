import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createWorkspaceStore} from '../desktop/storage.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const packaged=process.argv.find(a=>a.startsWith('--packaged='))?.slice('--packaged='.length);
const executable=packaged?path.resolve(packaged):require('electron');
const baseArgs=packaged?[]:[path.join(root,'desktop/main.mjs')];
await mkdir(path.join(root,'.cache'),{recursive:true});const directory=await mkdtemp(path.join(root,'.cache','desktop-smoke-')),userData=path.join(directory,'data');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
async function closed(port){await new Promise((resolve,reject)=>{const socket=net.createConnection({port,host:'127.0.0.1'});socket.setTimeout(1500,()=>{socket.destroy();reject(new Error(`Port ${port} timed out`));});socket.once('connect',()=>{socket.destroy();reject(new Error(`Port ${port} still listening`));});socket.once('error',error=>error.code==='ECONNREFUSED'?resolve():reject(error));});}
const reports=[];
for(const phase of ['initial','restore']){
 const reportPath=path.join(directory,phase+'.json');
 const started=performance.now();
 const code=await new Promise((resolve,reject)=>{
  const child=spawn(executable,[...baseArgs,`--mathart-smoke-report=${reportPath}`,`--mathart-user-data=${userData}`,`--mathart-smoke-phase=${phase}`],{cwd:root,env,stdio:'inherit'});
  const terminate=()=>child.kill('SIGTERM');process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
  let force;const timer=setTimeout(()=>{terminate();force=setTimeout(()=>child.kill('SIGKILL'),8000);},60000);
  const done=()=>{clearTimeout(timer);clearTimeout(force);process.off('SIGTERM',terminate);process.off('SIGINT',terminate);};
  child.once('error',error=>{done();reject(error);});child.once('exit',(code,signal)=>{done();resolve(code??(signal?1:0));});
 });
 const report=JSON.parse(await readFile(reportPath,'utf8'));report.elapsedMs=Math.round(performance.now()-started);reports.push(report);
 assert.equal(code,0,JSON.stringify(report));assert.equal(report.status,'passed',JSON.stringify(report));assert.equal(report.shutdown.ownedProcessCount,0);assert.equal(report.shutdown.servicesClosed,true);
 await closed(report.port);await closed(report.apiPort);report.closedPortsVerified=true;
 if(phase==='initial'){
  // Change the saved fixture after its owning app has exited. Writing the live
  // localStorage behind React's back races its normal autosave and tests no UI.
  const store=await createWorkspaceStore(userData),values=store.read(),workspace=JSON.parse(values['mathart-lab-v1']);
  assert.ok(workspace.drafts?.[workspace.active],'the first app must persist its active draft');
  workspace.drafts[workspace.active].name='desktop-persistence-check';
  await store.save({...values,'mathart-lab-v1':JSON.stringify(workspace)});await store.flush();
 }
}
assert.notEqual(reports[0].origin,reports[1].origin,'restart should exercise a new loopback origin');
await writeFile(path.join(directory,'report.json'),JSON.stringify({executable,reports},null,2)+'\n');console.log(`Desktop smoke passed: ${directory}/report.json`);
