import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createWorkspaceStore,validateStorage} from './storage.mjs';
import {createDesktopHost} from './host.mjs';
import {createDesktopPreferences} from './preferences.mjs';

test('workspace snapshots survive reopen, recover a malformed file, and preserve malformed evidence',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mathart-store-'));
 try{
  const store=await createWorkspaceStore(dir);
  await store.save({'mathart-lab-v1':'first'});
  await Promise.all([store.save({'mathart-lab-v1':'second'}),store.save({'mathart-lab-v1':'latest'})]);
  assert.deepEqual((await createWorkspaceStore(dir)).read(),{'mathart-lab-v1':'latest'});
  await writeFile(path.join(dir,'workspace-storage.json'),'malformed data');
  const recovered=await createWorkspaceStore(dir);assert.deepEqual(recovered.read(),{'mathart-lab-v1':'second'});
  await recovered.save({'mathart-lab-v1':'repaired'});
  const recovery=(await readdir(dir)).find(n=>n.includes('.recovery-'));assert.equal(await readFile(path.join(dir,recovery),'utf8'),'malformed data');
  assert.throws(()=>validateStorage({arbitrary:'value'}));assert.throws(()=>validateStorage({'mathart-lab-v1':42}));
  assert.equal((await readdir(dir)).some(n=>n.endsWith('.tmp')),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('desktop serves built assets and API only through its local origin, then closes both listeners',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mathart-host-'));let host;
 try{
  const dist=path.join(dir,'dist');await mkdir(dist);await writeFile(path.join(dist,'index.html'),'<h1>local application</h1>');
  host=await createDesktopHost({dist,exportRoot:path.join(dir,'exports'),ffmpegPath:'/missing/ffmpeg'});
  const page=await fetch(host.origin);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);assert.match(await page.text(),/local application/);
  const csp=new Map(page.headers.get('content-security-policy').split(';').map(directive=>{const [name,...sources]=directive.trim().split(/\s+/);return[name,sources];}));
  assert.deepEqual(csp.get('media-src'),["'self'",'blob:']); // MediaRecorder previews use an owned blob URL.
  for(const directive of ['default-src','script-src','connect-src'])assert.deepEqual(csp.get(directive),["'self'"]);
  assert.equal((await fetch(host.origin,{headers:{origin:'https://example.com'}})).status,403);
  assert.equal((await fetch(host.origin,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await fetch(host.origin+'/%00')).status,400);
  assert.equal((await fetch(host.origin+'/missing.js')).status,404);
  const health=await (await fetch(host.origin+'/api/health')).json();assert.equal(health.ffmpeg,false);
  const port=host.apiPort;await host.close();await host.close();assert.equal(host.api.ownedProcessCount,0);
  await assert.rejects(fetch(host.origin));await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
 }finally{await host?.close();await rm(dir,{recursive:true,force:true});}
});

test('desktop path preferences preserve choices and recover last valid backup',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'mathart-preferences-'));
 try{
  const output=path.join(dir,'chosen-output');await mkdir(output);
  const prefs=await createDesktopPreferences(dir);assert.equal(prefs.read().outputDirectory,path.join(dir,'downloads'));
  await prefs.save({outputDirectory:output});assert.equal((await createDesktopPreferences(dir)).read().outputDirectory,output);
  assert.throws(()=>prefs.save({outputDirectory:'relative'}));
  await assert.rejects(prefs.save({outputDirectory:path.join(dir,'missing')}));
  await assert.rejects(prefs.save({ffmpegPath:output}));
  const executable=path.join(dir,'ffmpeg');await writeFile(executable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  await prefs.save({ffmpegPath:executable});await prefs.flush();assert.equal(prefs.read().ffmpegPath,executable);
  await writeFile(path.join(dir,'desktop-preferences.json'),'{damaged');
  const reopened=await createDesktopPreferences(dir);assert.equal(reopened.read().outputDirectory,output);assert.equal(reopened.read().ffmpegPath,undefined);
  await reopened.save({ffmpegPath:executable});assert.equal((await readdir(dir)).filter(name=>name.startsWith('desktop-preferences.json.recovery-')).length,1);
  assert.equal((await readdir(dir)).some(name=>name.endsWith('.tmp')),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
