import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcp} from 'node:net';
import {createServer} from 'vite';
import {createExportServer} from '../../server/index.mjs';
/** Explicit --native-backend is optional; configuration identity is verified
 * before any service starts. Omission keeps existing WebGL verification. */
export async function sourceVerificationBackend(){
 const i=process.argv.indexOf('--native-backend');if(i<0)return undefined;
 const path=process.argv[i+1];assert(path&&!path.startsWith('--'),'--native-backend needs a sealed JSON path');
 const backend=JSON.parse(await readFile(path,'utf8'));
 assert.equal(createHash('sha256').update(await readFile(backend.executablePath)).digest('hex'),backend.executableSha256);return backend;
}
/** A verifier opts into an explicit sealed local executable. No search/build,
 * installation or fallback; absence retains the WebGL verification route. */
export async function sourceNativeVerificationServer(directory,backendFile){
 let service,server,address;const native=!!backendFile;
 try{
  const port=await new Promise((resolve,reject)=>{const s=tcp();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(e=>e?reject(e):resolve(port));});});
  let backend;if(native){backend=JSON.parse(await readFile(backendFile,'utf8'));assert.equal(createHash('sha256').update(await readFile(backend.executablePath)).digest('hex'),backend.executableSha256);service=await createExportServer({root:directory+'/service',allowedOrigins:[`http://127.0.0.1:${port}`],sourceRendererBackend:backend});address=await service.listen(0);}
  server=await createServer({optimizeDeps:{entries:['index.html','src/engine/formulaSvg.ts']},define:{'import.meta.env.VITE_SOURCE_RENDERER':JSON.stringify(native?'native':'webgl')},server:{host:'127.0.0.1',port,strictPort:true,hmr:false,...(service?{proxy:{'/api':`http://127.0.0.1:${address.port}`}}:{})},logLevel:'error'});await server.listen();
  return{server,service,backend,native,origin:`http://127.0.0.1:${port}/`,async close(){await server.close();await service?.close();assert.equal(service?.ownedProcessCount??0,0);}};
 }catch(error){await server?.close();await service?.close();throw error;}
}

/** Disabled Vite HMR and a missing default favicon can log Chrome errors.
 * Keep those exact ancillary development surfaces separately; all application errors
 * remain fatal. Redact the websocket authentication token in saved evidence. */
export function recordSourceVerifierConsole(message,origin,errors,developmentErrors){
 if(message.type()!=='error')return;
 const raw=message.text(),location=message.location(),base=new URL(origin);
 const text=raw.replace(/(wss?:\/\/127\.0\.0\.1:[0-9]+\/\?token=)[^'\s&]+/g,'$1[redacted]');
 let client=false,favicon=false;try{const url=new URL(location.url);client=url.origin===base.origin&&url.pathname==='/@vite/client';favicon=url.origin===base.origin&&url.pathname==='/favicon.ico';}catch{}
 const websocket=raw.startsWith(`WebSocket connection to 'ws://${base.host}/?token=`)&&raw.includes('ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS');
 if(client&&(websocket||raw.startsWith('[vite] failed to connect to websocket.')))developmentErrors.push({kind:'disabled-vite-hmr',text,location});
 else if(favicon&&raw==='Failed to load resource: the server responded with a status of 404 (Not Found)')developmentErrors.push({kind:'absent-default-favicon',text,location});
 else errors.push({text,location});
}
