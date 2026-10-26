import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createServer as tcp} from 'node:net';
import {createServer} from 'vite';
import {createExportServer} from '../../server/index.mjs';
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
