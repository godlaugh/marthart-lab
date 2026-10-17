import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
export async function runSmoke({window,host,userData,phase}){
 const deadline=Date.now()+30000;let state;
 do{state=await window.webContents.executeJavaScript(`({title:document.title,ready:document.querySelector('.status-bar')?.textContent,canvas:!!document.querySelector('[data-testid="art-canvas"]'),error:document.querySelector('.error-card')?.textContent,nodeType:typeof require,processType:typeof process})`);if(state.canvas&&state.ready?.includes('就绪')&&!state.ready.includes('—'))break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
 assert.equal(state.canvas,true);assert.ok(state.ready?.includes('就绪')&&!state.ready.includes('—'),JSON.stringify(state));assert.equal(state.error,undefined);assert.equal(state.nodeType,'undefined');assert.equal(state.processType,'undefined');
 const preferences=window.webContents.getLastWebPreferences();assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.sandbox,true);
 let storage;
 do{storage=await window.webContents.executeJavaScript(`JSON.parse(localStorage.getItem('mathart-lab-v1'))`);if(storage?.drafts&&Object.keys(storage.drafts).length)break;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);
 assert.ok(storage?.drafts&&Object.keys(storage.drafts).length>0,'workspace draft must be autosaved');
 const marker='desktop-persistence-check';
 if(phase==='restore')assert.equal(storage.drafts[storage.active].name,marker,'random port restart must preserve stored workspace');
 const desktopPreferences=await window.webContents.executeJavaScript(`window.mathartDesktop.preferences()`);
 assert.equal(desktopPreferences.outputDirectory,path.join(userData,'downloads'));
 const health=await (await fetch(host.origin+'/api/health')).json();
 const image=await window.webContents.executeJavaScript(`(async()=>{const canvas=document.querySelector('[data-testid="art-canvas"]');const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));const response=await fetch('/api/images',{method:'POST',headers:{'content-type':'image/png'},body:blob});return {status:response.status,width:canvas.width,height:canvas.height,...await response.json()};})()`);
 assert.equal(image.status,201);const file=path.join(userData,'exports',path.basename(image.url));assert.equal((await stat(file)).size,image.bytes);assert.deepEqual(await readFile(file),Buffer.from(await (await fetch(host.origin+image.url)).arrayBuffer()));
 const externalBlocked=await window.webContents.executeJavaScript(`fetch('https://example.com/').then(()=>false,()=>true)`);assert.equal(externalBlocked,true);
 let activeExport;
 if(health.ffmpeg){const response=await fetch(host.origin+'/api/exports',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({width:32,height:32,fps:6,frames:2,format:'mp4'})});assert.equal(response.status,201);activeExport=await response.json();assert.equal(host.api.ownedProcessCount,1);}
 const screenshot=await window.webContents.capturePage();await writeFile(path.join(userData,`desktop-${phase}.png`),screenshot.toPNG());
 return {status:'passed',phase,origin:host.origin,port:host.port,apiPort:host.apiPort,userData,checks:['built UI loaded','canvas generation completed','Node unavailable in renderer','context isolation and sandbox enabled','desktop preferences bridge available','PNG persisted under userData','external network blocked',phase==='restore'?'workspace restored across random ports':'workspace autosaved',...(activeExport?['active encoder left for shutdown cleanup']:[])],health,image,activeExport,state,desktopPreferences};
}
