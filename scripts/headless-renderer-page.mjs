/** Renderer-only CDP driver. Never enables Network or retains request bodies. */
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

function deadline(promise,ms,message){
 let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));
}
export async function launchRendererPage(){
 const profile=await mkdtemp(path.join(tmpdir(),'mathart-renderer-cdp-'));
 const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[
  '--headless=new','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1',
  '--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',
  '--disable-background-networking','--enable-angle-features=disableProgramCaching','about:blank',
 ],{stdio:['ignore','ignore','pipe']});
 let socket,exited=false,stderr='',nextId=0,sessionId,closePromise;
 const pending=new Map(),listeners=new Map();
 const closed=new Promise(resolve=>child.once('close',()=>{exited=true;resolve();}));
 const launchError=new Promise((_,reject)=>child.once('error',reject));
 // The launch failure is also observed by endpoint discovery below.
 launchError.catch(()=>{});
 function rejectPending(error){for(const item of pending.values())item.reject(error);pending.clear();}
 function emit(name,value){for(const listener of listeners.get(name)??[])listener(value);}
 function on(name,listener){let list=listeners.get(name);if(!list)listeners.set(name,list=new Set());list.add(listener);return()=>list.delete(listener);}
 function send(method,params={},target=sessionId,timeout=30000){
  const id=++nextId;
  const response=new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});try{socket.send(JSON.stringify({id,method,params,...(target?{sessionId:target}:{})}));}catch(error){pending.delete(id);reject(error);}});
  return deadline(response,timeout,'CDP timed out: '+method).finally(()=>pending.delete(id));
 }
 async function close(){
  if(closePromise)return closePromise;
  closePromise=(async()=>{
   if(socket?.readyState===WebSocket.OPEN&&!exited)await send('Browser.close',{},null,3000).catch(()=>{});
   socket?.close();rejectPending(Error('Browser closed'));
   try{await deadline(closed,5000,'Browser close timeout');}catch{
    if(!exited)child.kill('SIGTERM');
    try{await deadline(closed,3000,'Browser terminate timeout');}catch{
     if(!exited)child.kill('SIGKILL');
     await deadline(closed,5000,'Owned browser did not exit; profile retained at '+profile);
    }
   }
   await rm(profile,{recursive:true,force:true});
  })();
  // Retain the process/profile owner after cleanup failure and permit retry.
  closePromise.catch(()=>{closePromise=undefined;});
  return closePromise;
 }
 try{
  const endpoint=await deadline(Promise.race([new Promise((resolve,reject)=>{
   child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-32768);const match=/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/.exec(stderr);if(match)resolve(match[1]);});
   closed.then(()=>reject(Error('Chrome exited during launch: '+stderr)));
  }),launchError]),15000,'Chrome debugging endpoint unavailable');
  socket=new WebSocket(endpoint);
  await deadline(new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',()=>reject(Error('CDP connection failed')),{once:true});}),10000,'CDP connection timeout');
  socket.addEventListener('message',event=>{
   let message;try{message=JSON.parse(event.data);}catch{rejectPending(Error('Invalid CDP response'));return;}
   if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}
   else if(message.sessionId===sessionId)emit(message.method,message.params);
  });
  socket.addEventListener('close',()=>rejectPending(Error('CDP disconnected')));
  const version=await send('Browser.getVersion',{},null);
  const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);
  ({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));
  await send('Runtime.enable');await send('Page.enable');
  return{
   version:()=>version.product,
   async newPage(){return{
    on(name,listener){
     if(name==='pageerror')return on('Runtime.exceptionThrown',({exceptionDetails:d})=>listener({message:d.exception?.description??d.text}));
     if(name==='console')return on('Runtime.consoleAPICalled',event=>listener({text:()=>event.args.map(a=>a.value??a.description??'').join(' ')}));
     throw Error('Unsupported renderer event '+name);
    },
    async goto(url){
     let remove;const loaded=new Promise(resolve=>{remove=on('Page.loadEventFired',resolve);});
     try{const result=await send('Page.navigate',{url});if(result.errorText)throw Error(result.errorText);await deadline(loaded,30000,'Renderer page load timeout');}finally{remove();}
    },
    async evaluate(fn,args){
     const result=await send('Runtime.evaluate',{expression:`(${fn.toString()})(${JSON.stringify(args)})`,awaitPromise:true,returnByValue:true},sessionId,240000);
     if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);
     return result.result.value;
    },
   };},
   close,
  };
 }catch(error){try{await close();}catch(cleanupError){throw new AggregateError([error,cleanupError],'Browser launch and cleanup failed');}throw error;}
}
