import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {launchRendererPage} from './headless-renderer-page.mjs';

test('real renderer CDP: navigation, browser fetch, errors, in-flight close and repeated cleanup',async()=>{
 const server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/value'?'application/json':'text/html');res.end(req.url==='/value'?'[4,9]':'<!doctype html><title>Renderer fixture</title>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');let browser;
 try{
  browser=await launchRendererPage();assert.match(browser.version(),/^Chrome\//);
  const page=await browser.newPage(),messages=[];page.on('console',message=>messages.push(message.text()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  assert.deepEqual(await page.evaluate(async extra=>{console.log('fixture ready');return{title:document.title,values:await(await fetch('/value')).json(),extra};},{n:3}),{title:'Renderer fixture',values:[4,9],extra:{n:3}});
  assert.ok(messages.includes('fixture ready'));
  await assert.rejects(page.evaluate(()=>{throw Error('owned runtime failure');}),/owned runtime failure/);
  assert.equal(await page.evaluate(()=>7),7);
  // Closing must reject a pending evaluation rather than leave its deadline alive.
  const pending=assert.rejects(page.evaluate(()=>new Promise(()=>{})),/closed|disconnected|destroyed/i);
  await browser.close();await pending;await browser.close();
 }finally{await browser?.close();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
