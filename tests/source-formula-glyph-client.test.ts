import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
const A='a'.repeat(64),B='b'.repeat(64);
const health=(identity=A)=>new Response(JSON.stringify({available:true,rendererIdentity:identity,fontSize:50,format:'straight-rgba8'}),{headers:{'content-type':'application/json'}});
function glyph(identity=A,bytes:BodyInit|ReadableStream<Uint8Array>=new Uint8Array([255,255,255,127]),headers:Record<string,string>={}){return new Response(bytes,{headers:{'content-type':'application/octet-stream','content-length':'4','x-glyph-width':'1','x-glyph-height':'1','x-glyph-font-size':'50','x-glyph-format':'straight-rgba8','x-glyph-renderer':identity,...headers}});}
const client=()=>import('../src/engine/sourceFormulaGlyphClient');
const abort=()=>new DOMException('aborted','AbortError');
beforeEach(()=>{vi.resetModules();});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.restoreAllMocks();});
describe('source formula glyph browser boundary',()=>{
 it('uses real HTTP, serializes labels against a single-worker backend, and checks health before a borrowed cache hit',async()=>{
  const nativeFetch=globalThis.fetch;let active=0,maxActive=0,posts=0,healthCalls=0;const received:unknown[]=[];
  const server=createServer((req:IncomingMessage,res:ServerResponse)=>{void(async()=>{
   if(req.method==='GET'){healthCalls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({available:true,rendererIdentity:A,fontSize:50,format:'straight-rgba8'}));return;}
   active++;maxActive=Math.max(active,maxActive);posts++;let body='';for await(const chunk of req)body+=chunk;received.push(JSON.parse(body));
   await new Promise(resolve=>setTimeout(resolve,10));const response=glyph();res.writeHead(200,Object.fromEntries(response.headers));res.end(Buffer.from([255,255,255,127]));active--;
  })().catch(error=>{res.writeHead(500);res.end(String(error));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('port');
  vi.stubGlobal('fetch',(url:string,init:RequestInit)=>nativeFetch(`http://127.0.0.1:${address.port}${url}`,init));
  try{
   const {sourceFormulaGlyph}=await client(),values=await Promise.all(['x','y','z'].map(text=>sourceFormulaGlyph(text,'#ffffff')));
   expect(maxActive).toBe(1);expect(posts).toBe(3);expect(received).toEqual(['x','y','z'].map(latex=>({latex,color:'#ffffff'})));
   expect(await sourceFormulaGlyph('x','#ffffff')).toBe(values[0]);expect(healthCalls).toBe(4);expect(posts).toBe(3);
   expect(values[0].pixels).toEqual(new Uint8Array([255,255,255,127]));expect(Object.isFrozen(values[0])).toBe(true);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
 });
 it('replaces cached pixels when fresh backend identity changes and never uses cache while unavailable',async()=>{
  let identity=A,available=true,posts=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.endsWith('health'))return available?health(identity):new Response('{"available":false}',{headers:{'content-type':'application/json'}});posts++;return glyph(identity,new Uint8Array([posts,0,0,255]));}));
  const {sourceFormulaGlyph}=await client();const first=await sourceFormulaGlyph('x','#ffffff');identity=B;const second=await sourceFormulaGlyph('x','#ffffff');
  expect(second.rendererIdentity).toBe(B);expect(second.pixels[0]).toBe(2);expect(first.pixels[0]).toBe(1);available=false;
  await expect(sourceFormulaGlyph('x','#ffffff')).rejects.toMatchObject({kind:'unavailable'});expect(posts).toBe(2);available=true;
  expect((await sourceFormulaGlyph('x','#ffffff')).pixels[0]).toBe(3);
 });
 it('does not let one subscriber cancel another shared request; the final subscriber aborts transport',async()=>{
  let postSignal:AbortSignal|undefined,finish:((r:Response)=>void)|undefined,posts=0;
  vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>url.endsWith('health')?Promise.resolve(health()):new Promise<Response>((resolve,reject)=>{posts++;postSignal=init.signal!;finish=resolve;postSignal.addEventListener('abort',()=>reject(abort()),{once:true});})));
  const {sourceFormulaGlyph}=await client(),a=new AbortController(),b=new AbortController();
  const pa=sourceFormulaGlyph('x','#ffffff',a.signal),pb=sourceFormulaGlyph('x','#ffffff',b.signal);const rejected=expect(pa).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(postSignal).toBeDefined());a.abort();await rejected;expect(postSignal!.aborted).toBe(false);finish!(glyph());await expect(pb).resolves.toMatchObject({width:1});expect(posts).toBe(1);
  const c=new AbortController(),pc=sourceFormulaGlyph('y','#ffffff',c.signal),last=expect(pc).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(posts).toBe(2));c.abort();await last;expect(postSignal!.aborted).toBe(true);
 });
 it('shares only unfinished health checks and isolates their caller cancellation',async()=>{
  let finish:((r:Response)=>void)|undefined,requestSignal:AbortSignal|undefined;
  const fetch=vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((resolve,reject)=>{finish=resolve;requestSignal=init.signal!;requestSignal.addEventListener('abort',()=>reject(abort()),{once:true});}));vi.stubGlobal('fetch',fetch);
  const {sourceFormulaRendererIdentity}=await client(),a=new AbortController();const pa=sourceFormulaRendererIdentity(a.signal),pb=sourceFormulaRendererIdentity();const cancelled=expect(pa).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(finish).toBeDefined());a.abort();await cancelled;expect(requestSignal!.aborted).toBe(false);finish!(health());expect(await pb).toBe(A);expect(fetch).toHaveBeenCalledTimes(1);
  const pc=sourceFormulaRendererIdentity();await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));finish!(health(B));expect(await pc).toBe(B);
 });
 it('removes an abandoned queued label without submitting it to the backend',async()=>{
  let finish:((r:Response)=>void)|undefined;const texts:string[]=[];
  vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>{if(url.endsWith('health'))return Promise.resolve(health());texts.push(JSON.parse(String(init.body)).latex);return texts.length===1?new Promise<Response>(resolve=>{finish=resolve;}):Promise.resolve(glyph());}));
  const {sourceFormulaGlyph}=await client();const first=sourceFormulaGlyph('first','#ffffff'),controller=new AbortController(),second=sourceFormulaGlyph('cancelled','#ffffff',controller.signal),cancelled=expect(second).rejects.toMatchObject({name:'AbortError'}),third=sourceFormulaGlyph('third','#ffffff');
  await vi.waitFor(()=>expect(finish).toBeDefined());controller.abort();await cancelled;finish!(glyph());await Promise.all([first,third]);expect(texts).toEqual(['first','third']);
 });
 it.each([
  {'x-glyph-width':'0'}, {'x-glyph-height':'16385'}, {'x-glyph-font-size':'20'}, {'x-glyph-format':'premultiplied-rgba8'}, {'x-glyph-renderer':B}, {'content-length':'8'}, {'content-type':'image/png'}, {'content-encoding':'gzip'}, {'x-glyph-width':'4001','x-glyph-height':'4000','content-length':'64016000'},
 ] as Record<string,string>[])('rejects incompatible headers before reading image bytes: %j',async headers=>{
  let cancelled=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('health')?health():glyph(A,new ReadableStream<Uint8Array>({cancel(){cancelled=true;}}),headers)));
  const {sourceFormulaGlyph}=await client();await expect(sourceFormulaGlyph('x','#ffffff')).rejects.toMatchObject({kind:'protocol'});expect(cancelled).toBe(true);
 });
 it.each([3,5])('rejects a body of %i bytes that disagrees with the four declared bytes',async length=>{
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('health')?health():glyph(A,new Uint8Array(length))));
  await expect((await client()).sourceFormulaGlyph('x','#ffffff')).rejects.toMatchObject({kind:'protocol'});
 });
 it('bounds streamed health JSON even with no Content-Length',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(4097),{headers:{'content-type':'application/json'}})));
  await expect((await client()).sourceFormulaRendererIdentity()).rejects.toMatchObject({kind:'protocol'});
 });
 it('reports unsupported LaTeX and capacity failures without caching or fallback',async()=>{
  let status=422,posts=0;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.endsWith('health'))return health();posts++;return new Response(JSON.stringify({error:'unsupported command',kind:'unsupported'}),{status,headers:{'content-type':'application/json'}});}));
  const {sourceFormulaGlyph}=await client();await expect(sourceFormulaGlyph('x','#ffffff')).rejects.toThrow('HTTP 422：unsupported command');status=429;await expect(sourceFormulaGlyph('x','#ffffff')).rejects.toMatchObject({kind:'capacity'});expect(posts).toBe(2);
 });
 it('rejects malformed Unicode and overlong requests before network activity',async()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const {sourceFormulaGlyph}=await client();
  for(const [latex,color]of [['\ud800','#ffffff'],['x'.repeat(8193),'#ffffff'],['x','white']])await expect(sourceFormulaGlyph(latex,color)).rejects.toMatchObject({kind:'input'});expect(fetch).not.toHaveBeenCalled();
 });
 it('bounds outstanding requests while allowing subscribers to share the same label',async()=>{
  vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(abort()),{once:true}))));
  const {sourceFormulaGlyph}=await client(),stop=new AbortController();const pending=Array.from({length:66},(_,i)=>sourceFormulaGlyph(`x${i}`,'#ffffff',stop.signal));const settled=Promise.allSettled(pending);
  await expect(sourceFormulaGlyph('overflow','#ffffff')).rejects.toMatchObject({kind:'capacity'});const shared=sourceFormulaGlyph('x0','#ffffff',stop.signal),sharedDone=Promise.allSettled([shared]);stop.abort();await settled;await sharedDone;
 });
 it('enforces the cache entry bound without retaining old identities',async()=>{
  let posts=0;vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('health')?health():(posts++,glyph())));
  const {sourceFormulaGlyph}=await client();for(let i=0;i<67;i++)await sourceFormulaGlyph(`x${i}`,'#ffffff');await sourceFormulaGlyph('x0','#ffffff');expect(posts).toBe(68);
 });
 it('bounds cached pixel bytes independently of the entry count',async()=>{
  let posts=0;const bytes=new Uint8Array(3000*3000*4);
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('health')?health():(posts++,glyph(A,bytes,{'x-glyph-width':'3000','x-glyph-height':'3000','content-length':String(bytes.byteLength)}))));
  const {sourceFormulaGlyph}=await client();await sourceFormulaGlyph('first','#ffffff');await sourceFormulaGlyph('second','#ffffff');await sourceFormulaGlyph('first','#ffffff');expect(posts).toBe(3);
 });
 it('cancels a streaming body when its final consumer leaves',async()=>{
  let bodyStarted=false,bodyCancelled=false;
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.endsWith('health')?health():glyph(A,new ReadableStream<Uint8Array>({pull(controller){if(!bodyStarted){bodyStarted=true;controller.enqueue(new Uint8Array(2));}},cancel(){bodyCancelled=true;}}))));
  const {sourceFormulaGlyph}=await client(),stop=new AbortController(),pending=sourceFormulaGlyph('x','#ffffff',stop.signal),cancelled=expect(pending).rejects.toMatchObject({name:'AbortError'});
  await vi.waitFor(()=>expect(bodyStarted).toBe(true));stop.abort();await cancelled;await vi.waitFor(()=>expect(bodyCancelled).toBe(true));
 });
 it('has a finite deadline for a health request that never returns',async()=>{
  vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn((_url:string,init:RequestInit)=>new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(abort()),{once:true}))));
  const {sourceFormulaRendererIdentity}=await client(),pending=sourceFormulaRendererIdentity(),failed=expect(pending).rejects.toMatchObject({kind:'timeout'});
  await vi.advanceTimersByTimeAsync(15001);await failed;
 });
 it('does not invalidate an active glyph when an unrelated health subscriber cancels',async()=>{
  let healthCount=0,postFinish:((r:Response)=>void)|undefined,secondHealthSignal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn((url:string,init:RequestInit)=>{
   if(!url.endsWith('health'))return new Promise<Response>(resolve=>{postFinish=resolve;});
   if(++healthCount===1)return Promise.resolve(health());
   return new Promise<Response>((_resolve,reject)=>{secondHealthSignal=init.signal!;secondHealthSignal.addEventListener('abort',()=>reject(abort()),{once:true});});
  }));
  const {sourceFormulaGlyph,sourceFormulaRendererIdentity}=await client(),pending=sourceFormulaGlyph('x','#ffffff');await vi.waitFor(()=>expect(postFinish).toBeDefined());
  const stop=new AbortController(),extra=sourceFormulaRendererIdentity(stop.signal),cancelled=expect(extra).rejects.toMatchObject({name:'AbortError'});await vi.waitFor(()=>expect(secondHealthSignal).toBeDefined());stop.abort();await cancelled;
  postFinish!(glyph());await expect(pending).resolves.toMatchObject({rendererIdentity:A});
 });

});
