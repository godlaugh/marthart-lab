import {RootsPointCloudNativeBackend} from './rootsPointCloudNativeBackend';
import {SourceNativeError} from './sourceNativeError';
import type {SourceNativeRootsPointResponse} from './sourceNativeClient';
import type {RootsNativeCommandRequest,RootsNativeCommandResponse,RootsPointBrokerCoverage,RootsPointBrokerResult} from './rootsPointCloudBrokerProtocol';
type Port=Pick<Worker,'postMessage'>;
type Backend=Pick<RootsPointCloudNativeBackend,'initialize'|'begin'|'append'|'finish'|'release'|'settle'|'diagnostics'>;
interface Cursor {rpcId:number;displayId:number;frame?:{id:number;displayId:number;target:'primary'|'offscreen'};}
interface Owner {backend:Backend;pending?:Promise<void>;releasing?:Promise<void>;retired:boolean;memory:{read:()=>number};}
interface Binding {current:()=>boolean;retainedBytes:()=>number;}
const uint=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<=0xffffffff;
const coverage=(r:SourceNativeRootsPointResponse):RootsPointBrokerCoverage=>({displayIndex:r.displayIndex,receivedPoints:r.receivedPoints,totalPoints:r.totalPoints,nextChunk:r.nextChunk,totalChunks:r.totalChunks,pointDraws:r.pointDraws,fadeDraws:r.fadeDraws,clears:r.clears});
function demand(ok:unknown,message:string):asserts ok {if(!ok)throw new SourceNativeError('protocol',message);}
/** Binds native target custody to the exact Worker object. Retired Workers
 * cannot publish or issue another command, and are retained until cleanup ACK. */
export class RootsPointCloudPageBroker {
 private readonly owners=new Map<Port,Owner>();
 private readonly cursors=new WeakMap<Port,Cursor>();
 constructor(private readonly createBackend:(retainedBytes:()=>number)=>Backend=retainedBytes=>new RootsPointCloudNativeBackend({retainedBytes})){}
 has(worker:Port):boolean{return this.owners.has(worker);}
 execute(worker:Port,request:RootsNativeCommandRequest,binding:Binding):Promise<void>{
  if(!binding.current())return Promise.resolve();
  const previous=this.cursors.get(worker)??{rpcId:0,displayId:0};
  try{
   demand(uint(request.sessionId)&&uint(request.id)&&uint(request.rpcId)&&request.rpcId===previous.rpcId+1,'复根原生代理序号无效');
   const c=request.command;demand(c&&typeof c==='object'&&['initialize','begin','append','finish','release'].includes(c.kind),'复根原生代理操作无效');
   demand(c.kind==='release'&&c.target===undefined||c.target==='primary'||c.target==='offscreen','复根原生代理目标无效');
   if(c.kind==='initialize'||c.kind==='release')demand(request.displayId===0,'复根控制响应混入显示序号');
   else if(c.kind==='begin')demand(uint(request.displayId)&&request.displayId>previous.displayId&&!previous.frame,'复根显示事务顺序无效');
   else demand(previous.frame&&previous.frame.id===request.id&&previous.frame.displayId===request.displayId&&previous.frame.target===c.target,'复根分块不属于当前显示事务');
  }catch(error){return Promise.reject(error);}
  let owned=this.owners.get(worker);
  if(owned?.retired||owned?.releasing)return Promise.reject(new SourceNativeError('cleanup','复根 Worker 仍待清理'));
  if(owned?.pending)return Promise.reject(new SourceNativeError('protocol','复根 Worker 未等待上一条原生确认'));
  previous.rpcId=request.rpcId;this.cursors.set(worker,previous);
  if(!owned){
   if(request.command.kind==='release'){
    // No native token was ever acquired for this Worker, or its prior release
    // was already acknowledged. This is local proof of absence, not a guess.
    previous.frame=undefined;
    const response:RootsNativeCommandResponse={operation:'roots-native-result',sessionId:request.sessionId,id:request.id,displayId:request.displayId,rpcId:request.rpcId,result:{kind:'release'}};
    worker.postMessage(response);return Promise.resolve();
   }
   if(request.command.kind!=='initialize')return Promise.reject(new SourceNativeError('protocol','复根 Worker 尚未取得原生目标'));
   const memory={read:binding.retainedBytes};
   const owner:Owner={backend:this.createBackend(()=>memory.read()),retired:false,memory};owned=owner;this.owners.set(worker,owner);
  }
  const owner=owned;owner.memory.read=binding.retainedBytes;
  let resolve!:()=>void,reject!:(error:unknown)=>void;
  const pending=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});owner.pending=pending;
  const clearPending=()=>{if(owner.pending===pending){owner.pending=undefined;owner.memory.read=()=>0;}};
  const done=(async()=>{
   let result:RootsPointBrokerResult;
   try{
    const c=request.command;
    if(c.kind==='initialize'){
     const device=await owner.backend.initialize(c.target,c.size,c.programs);result={kind:'initialize',width:device.width,height:device.height,pointSizeRange:device.pointSizeRange};
    }else if(c.kind==='begin'){
     const r=await owner.backend.begin(c.target,{metadata:c.metadata,rangeCounts:c.rangeCounts,chunkPoints:c.chunkPoints});
     previous.displayId=request.displayId;previous.frame={id:request.id,displayId:request.displayId,target:c.target};result={kind:'begin',...coverage(r)};
    }else if(c.kind==='append'){
     const r=await owner.backend.append(c.target,{ordinal:c.ordinal,rangeIndex:c.rangeIndex,rangeOffset:c.rangeOffset,points:c.points});result={kind:'append',...coverage(r)};
    }else if(c.kind==='finish'){
     const r=await owner.backend.finish(c.target);demand(r.pixels,'复根完成确认缺少像素');previous.frame=undefined;
     result={kind:'finish',...coverage(r),width:r.width,height:r.height,pixels:r.pixels,rendererIdentity:r.rendererIdentity,generation:r.generation,sequence:r.sequence,requestBytes:r.requestBytes};
    }else{
     await owner.backend.release(c.target);
     if(c.target===undefined||previous.frame?.target===c.target)previous.frame=undefined;
     result={kind:'release'};
    }
    if(owner.retired||!binding.current())return;
    if(result.kind==='finish'){
     const pixels=result.pixels;
     demand(pixels instanceof Uint8ClampedArray&&pixels.buffer instanceof ArrayBuffer&&pixels.byteLength===result.width*result.height*4,'复根完成确认像素范围无效');
     // The codec borrows an image view after its 96-byte ACK. This is the
     // sole page→Worker delivery owner: transfer only an independent RGBA
     // buffer, preserving every channel and the client's one row flip.
     // The native response×4 admission already reserves this delivery copy.
     if(pixels.byteOffset!==0||pixels.buffer.byteLength!==pixels.byteLength)result={...result,pixels:pixels.slice()};
    }
    const response:RootsNativeCommandResponse={operation:'roots-native-result',sessionId:request.sessionId,id:request.id,displayId:request.displayId,rpcId:request.rpcId,result};
    // Receiving the ACK grants permission to issue the next command. Clear
    // this operation before publishing, including synchronous loopback ports.
    clearPending();
    worker.postMessage(response,result.kind==='finish'?[result.pixels.buffer]:[]);
   }catch(error){
    if(owner.retired||!binding.current())return;
    const d=owner.backend.diagnostics();
    const response:RootsNativeCommandResponse={operation:'roots-native-result',sessionId:request.sessionId,id:request.id,displayId:request.displayId,rpcId:request.rpcId,error:{kind:error instanceof SourceNativeError?error.kind:'runtime',reason:error instanceof Error?error.message:String(error),cleanupPending:d.cleanupPending||d.transactionTarget!==undefined}};
    clearPending();
    worker.postMessage(response);
   }
  })();
  void done.then(()=>{clearPending();resolve();},error=>{clearPending();reject(error);});return pending;
 }
 /** Mark retirement before waiting, suppressing any late result. A failed
  * release leaves this exact owner available for a later explicit retry. */
 async release(worker?:Port):Promise<void>{
  const entries=worker?[[worker,this.owners.get(worker)] as const]:[...this.owners.entries()];
  for(const [,owner] of entries)if(owner)owner.retired=true;
  entries.sort((a,b)=>Number(b[1]?.backend.diagnostics().transactionTarget!==undefined)-Number(a[1]?.backend.diagnostics().transactionTarget!==undefined));
  const errors:unknown[]=[];
  for(const [port,owner] of entries){
   if(!owner)continue;
   if(!owner.releasing){
    const pending=(async()=>{await owner.pending?.catch(()=>{});await owner.backend.release();if(this.owners.get(port)===owner)this.owners.delete(port);const cursor=this.cursors.get(port);if(cursor)cursor.frame=undefined;})();
    const settled=pending.finally(()=>{if(owner.releasing===settled)owner.releasing=undefined;});owner.releasing=settled;
   }
   try{await owner.releasing;}catch(error){errors.push(error);}
  }
  if(errors.length)throw new AggregateError(errors,'复根原生资源仍待清理');
 }
 async settle():Promise<void>{const results=await Promise.allSettled([...this.owners.values()].flatMap(o=>[o.pending,o.releasing]));for(const r of results)if(r.status==='rejected')throw r.reason;}
}
