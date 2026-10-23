import http from 'node:http';
import path from 'node:path';
import {stat,access} from 'node:fs/promises';
import {createReadStream,constants} from 'node:fs';
import {createExportServer} from '../server/index.mjs';

const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.ico':'image/x-icon'};
const policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export async function findFFmpeg(explicit){
 if(explicit){if(!path.isAbsolute(explicit))throw new Error('MATHART_FFMPEG 必须是绝对路径');await access(explicit,constants.X_OK);return explicit;}
 const names=(process.env.PATH??'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,process.platform==='win32'?'ffmpeg.exe':'ffmpeg'));
 if(process.platform==='darwin')names.push('/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg');
 for(const candidate of new Set(names)){try{await access(candidate,constants.X_OK);return candidate;}catch{}}
 return 'ffmpeg'; // Health endpoint reports unavailable; images and the editor remain usable.
}
export async function createDesktopHost({dist,exportRoot,ffmpegPath,sourceRendererBackend}){
 dist=path.resolve(dist);await access(path.join(dist,'index.html'));
 const api=await createExportServer({root:exportRoot,ffmpegPath,sourceRendererBackend,allowedOrigins:[]});
 let address,closing=false;const sockets=new Set();
 const server=http.createServer(async(req,res)=>{
  const finish=(status,text)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8','x-content-type-options':'nosniff'});res.end(text);};
  if(closing)return finish(503,'应用正在关闭');
  const authority=`127.0.0.1:${address?.port}`;
  if(req.headers.host!==authority||(req.headers.origin&&req.headers.origin!==`http://${authority}`)||req.headers['sec-fetch-site']==='cross-site')return finish(403,'仅接受此应用的本机请求');
  if(req.url.startsWith('/api/')){
   const upstream=http.request({host:'127.0.0.1',port:api.server.address().port,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode??502,response.headers);response.pipe(res);});
   upstream.on('error',()=>{if(!res.headersSent)finish(502,'本机导出服务不可用');else res.destroy();});
   req.once('aborted',()=>upstream.destroy());res.once('close',()=>{if(!res.writableEnded)upstream.destroy();});req.pipe(upstream);return;
  }
  if(!['GET','HEAD'].includes(req.method))return finish(405,'不支持此方法');
  try{
   const pathname=decodeURIComponent(new URL(req.url,`http://${authority}`).pathname);
   if(pathname.includes('\0')||pathname.includes('\\'))return finish(400,'无效路径');
   let file=path.resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));
   if(!file.startsWith(dist+path.sep))return finish(403,'禁止访问');
   let info=await stat(file).catch(()=>null);
   if(!info?.isFile()&&!path.extname(pathname)){file=path.join(dist,'index.html');info=await stat(file);}
   if(!info?.isFile())return finish(404,'资源不存在');
   res.writeHead(200,{'content-type':types[path.extname(file)]??'application/octet-stream','content-length':info.size,'content-security-policy':policy,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store'});
   if(req.method==='HEAD')return res.end();
   const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.once('close',()=>stream.destroy());stream.pipe(res);
  }catch(error){if(!res.headersSent)finish(error instanceof URIError?400:500,'本机资源读取失败');else res.destroy();}
 });
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 try{await api.listen(0);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});address=server.address();}catch(error){await api.close();throw error;}
 let closePromise;
 return {origin:`http://127.0.0.1:${address.port}`,port:address.port,apiPort:api.server.address().port,api,
  close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{const stopped=new Promise(resolve=>server.close(resolve));try{await api.close();}finally{for(const socket of sockets)socket.destroy();await stopped;}})().catch(error=>{closePromise=undefined;throw error;});return closePromise;}
 };
}
