/** Retained ComplexRootsMobject / ComplexRootsComputationWorker queue rules.
 * This owner stores caller-ordered arrivals; it never simulates native threads.
 * Source heap-derived backlog thresholds and local representation admission are
 * separate. The caller owns solver/RNG, transforms, finite submission N and GPU.
 */
const INT_MAX=2147483647,LONG_MAX=(1n<<63n)-1n;
const STRIDE=4,POINT_BYTES=16,WORKER_BYTES=128,BATCH_BYTES=96,BASE_BYTES=256;
/** Local peak representation bound, not Runtime.maxMemory or a source limit.
 * Scalar/reference accounting is a conservative logical representation charge;
 * VM object headers, allocator/GC overhead and borrowed inputs are not measured. */
export const ROOTS_PENDING_MAX_BYTES=768*1024*1024;
export const ROOTS_PENDING_SLICE_POINTS=65536;
export class RootsPendingError extends Error {
 constructor(readonly kind:'input'|'capacity'|'state'|'allocation',readonly reason:string,options?:ErrorOptions){super('Roots pending: '+reason,options);this.name='RootsPendingError';}
}
export interface RootsPendingPlan {
 readonly batchSize:number;readonly workerCount:number;readonly maxPointsPerSample:number;
 readonly maxSplatPointsPerFrame:number;readonly queueCapacity:number;readonly maximumPendingPoints:number;
 readonly referenceHeapBytes:string;readonly heapPolicy:'explicit-reference-heap';readonly nativeHeapObserved:false;
}
const integer=(v:unknown,n:string,min=1,max=INT_MAX):number=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)throw new RootsPendingError('input',`${n} must be an integer in [${min},${max}]`);return v;};
const failCapacity=(n:string):never=>{throw new RootsPendingError('capacity',n);};
export function prepareRootsPendingPlan(raw:{batchSize:number;workerCount:number;maxPointsPerSample:number;maxSplatPointsPerFrame:number;referenceHeapBytes:number|bigint}):RootsPendingPlan {
 if(!raw||typeof raw!=='object')throw new RootsPendingError('input','plan input must be an object');
 const batchSize=integer(raw.batchSize,'batchSize'),workerCount=integer(raw.workerCount,'workerCount'),maxPointsPerSample=integer(raw.maxPointsPerSample,'maxPointsPerSample',0),maxSplatPointsPerFrame=integer(raw.maxSplatPointsPerFrame,'maxSplatPointsPerFrame');
 const value=raw.referenceHeapBytes;
 if(typeof value!=='bigint'&&(typeof value!=='number'||!Number.isSafeInteger(value)))throw new RootsPendingError('input','referenceHeapBytes must be an exact signed-long integer');
 const heap=BigInt(value);if(heap<0n||heap>LONG_MAX)throw new RootsPendingError('input','referenceHeapBytes must be a nonnegative signed Java long');
 // maxPendingDensityPoints(IIIJ): signed-long multiplication, then truncating
 // divisions. Preserve wrap even for a caller's enormous explicit heap fact.
 const byWorkers=2n*BigInt(batchSize)*BigInt(workerCount),bySplat=4n*BigInt(maxSplatPointsPerFrame),byHeap=BigInt.asIntN(64,heap*35n)/100n/24n;
 const threshold=[byWorkers,bySplat,byHeap].reduce((a,b)=>a>b?a:b);
 const maximumPendingPoints=Number(threshold<1n?1n:threshold>64000000n?64000000n:threshold);
 return Object.freeze({batchSize,workerCount,maxPointsPerSample,maxSplatPointsPerFrame,queueCapacity:Math.max(2,Math.imul(workerCount,2)),maximumPendingPoints,referenceHeapBytes:String(heap),heapPolicy:'explicit-reference-heap',nativeHeapObserved:false});
}
/** Source adaptiveSplatPointBudget(III). The 1,048,576 cap applies only
 * above half capacity; a large configured base budget is not capped below it. */
export function rootsPendingSplatBudget(pending:number,base:number,capacity:number):number {
 integer(pending,'pending',0);integer(base,'base');integer(capacity,'capacity',-INT_MAX-1);
 if(!pending)return 0;
 if(capacity<=0||pending<=Math.trunc(capacity/2))return Math.min(pending,base);
 const ratio=pending/capacity,multiplier=ratio>=.9?8:ratio>=.75?4:2;
 return Math.min(pending,Math.min(base*multiplier,1048576));
}
export interface RootsPendingHooks {isCancelled?:()=>boolean;}
export interface RootsPendingOptions {
 readonly storage:'points'|'count-only';readonly maximumBytes?:number;
 /** Before owned allocation, including simultaneous old/new buffers and batch
  * copy. Caller adds math, borrowed input, rings, display, output and transport. */
 readonly onBytes?:(ownerRetainedPlusTransient:number)=>void;
}
export interface RootsPendingSlice {
 readonly workerIndex:number;readonly pointCount:number;
 /** Synchronous read-only borrow; do not mutate, transfer or retain it. Raw
  * float nonfinite values are intentional and consume the same point budget. */
 readonly points?:Float32Array;
}
export interface RootsPendingWorkerState {
 readonly workerIndex:number;readonly builderPoints:number;readonly blockedBatchPoints:number;
 readonly finishRequested:boolean;readonly terminal:'none'|'waiting'|'queued'|'polled';readonly blocked:boolean;readonly canProduce:boolean;
}
export interface RootsPendingSnapshot {
 readonly storage:'points'|'count-only';readonly queueCapacity:number;readonly queuedBatches:number;readonly queuedPoints:number;readonly queueFull:boolean;
 readonly pendingBatches:number;readonly pendingPoints:number;readonly finishedWorkers:number;readonly workerCount:number;
 readonly builders:number;readonly builderPoints:number;readonly blockedWorkers:number;readonly blockedPoints:number;readonly finishWaitingWorkers:number;
 readonly producedPoints:number;readonly publishedPoints:number;readonly drainedPoints:number;readonly consumedPoints:number;
 readonly retainedBytes:number;readonly peakBytes:number;readonly failed:boolean;readonly disposed:boolean;
}
interface Batch {workerIndex:number;count:number;data?:Float32Array;terminal:boolean;next?:Batch;}
interface Worker {index:number;count:number;data?:Float32Array;blocked?:Batch;finish:boolean;terminal:'none'|'waiting'|'queued'|'polled';}
const check=(h:RootsPendingHooks)=>{if(h.isCancelled?.())throw new DOMException('Roots pending operation cancelled','AbortError');};
/** Whole-batch bounded FIFO plus density head remainder. A full queue blocks
 * publication, never discards a computed sample or silently declares a worker
 * finished. publishWorker is called explicitly after a caller-chosen drain;
 * draining never pumps producers or fabricates concurrent arrival order. */
export class RootsPendingQueue {
 readonly plan:RootsPendingPlan;readonly storage:RootsPendingOptions['storage'];
 private maximumBytes:number;private onBytes?:RootsPendingOptions['onBytes'];
 private workers=new Map<number,Worker>();private queueHead?:Batch;private queueTail?:Batch;private pendingHead?:Batch;private pendingTail?:Batch;private pendingOffset=0;
 private queuedBatches=0;private queuedPoints=0;private pendingBatches=0;private pendingPoints=0;private finishedWorkers=0;
 private builderPoints=0;private blockedWorkers=0;private blockedPoints=0;private finishWaitingWorkers=0;
 private producedPoints=0;private publishedPoints=0;private drainedPoints=0;private consumedPoints=0;
 private retainedBytes=BASE_BYTES;private peakBytes=BASE_BYTES;private failed=false;private disposed=false;private busy=false;
 constructor(plan:RootsPendingPlan,options:RootsPendingOptions){
  if(!options||!['points','count-only'].includes(options.storage))throw new RootsPendingError('input','storage must be points or count-only');
  // Revalidate the public prepared boundary once; consumers use this frozen plan.
  const checked=prepareRootsPendingPlan({...plan,referenceHeapBytes:typeof plan?.referenceHeapBytes==='string'&&/^(?:0|[1-9][0-9]{0,18})$/.test(plan.referenceHeapBytes)?BigInt(plan.referenceHeapBytes):NaN});
  if(plan.queueCapacity!==checked.queueCapacity||plan.maximumPendingPoints!==checked.maximumPendingPoints||plan.heapPolicy!==checked.heapPolicy||plan.nativeHeapObserved!==false)throw new RootsPendingError('input','unprepared queue plan');
  this.plan=checked;this.storage=options.storage;this.maximumBytes=integer(options.maximumBytes??ROOTS_PENDING_MAX_BYTES,'maximumBytes',BASE_BYTES,Number.MAX_SAFE_INTEGER);
  if(options.onBytes!==undefined&&typeof options.onBytes!=='function')throw new RootsPendingError('input','onBytes must be a callback');this.onBytes=options.onBytes;this.admit(BASE_BYTES);
 }
 private ready(){if(this.disposed||this.failed)throw new RootsPendingError('state',this.disposed?'queue disposed':'consumer failed; dispose this queue before rebuilding');}
 private operation<T>(f:()=>T):T {this.ready();if(this.busy)throw new RootsPendingError('state','reentrant queue mutation');this.busy=true;try{return f();}finally{this.busy=false;}}
 private workerIndex(index:number){integer(index,'workerIndex',0,this.plan.workerCount-1);}
 private admit(peak:number){if(!Number.isSafeInteger(peak)||peak>this.maximumBytes)failCapacity(`owned representations require ${peak} bytes, limit ${this.maximumBytes}`);this.onBytes?.(peak);this.peakBytes=Math.max(this.peakBytes,peak);}
 private dataBytes(batch:Batch){return batch.data?.byteLength??0;}
 private allocate(length:number):Float32Array {try{return new Float32Array(length);}catch(error){throw new RootsPendingError('allocation','unable to allocate admitted point storage',{cause:error});}}
 private copy(target:Float32Array,offset:number,source:Float32Array,h:RootsPendingHooks){for(let i=0;i<source.length;i+=16384){check(h);target.set(source.subarray(i,i+16384),offset+i);}check(h);}
 private worker(index:number):Worker|undefined{this.workerIndex(index);return this.workers.get(index);}
 workerState(index:number):RootsPendingWorkerState {
  this.ready();const w=this.worker(index),blocked=!!w&&(!!w.blocked||w.terminal==='waiting');
  return Object.freeze({workerIndex:index,builderPoints:w?.count??0,blockedBatchPoints:w?.blocked?.count??0,finishRequested:w?.finish??false,terminal:w?.terminal??'none',blocked,canProduce:!w||!w.finish&&!w.blocked});
 }
 canProduce(index:number){return this.workerState(index).canProduce;}
 private enqueue(batch:Batch){
  if(this.queueTail)this.queueTail.next=batch;else this.queueHead=batch;this.queueTail=batch;this.queuedBatches++;this.queuedPoints+=batch.count;
  this.publishedPoints+=batch.count;
 }
 private publish(w:Worker):{blocked:boolean}{
  if(w.blocked&&this.queuedBatches<this.plan.queueCapacity){
   const b=w.blocked;this.enqueue(b);w.blocked=undefined;this.blockedWorkers--;this.blockedPoints-=b.count;
   this.retainedBytes-=w.data?.byteLength??0;this.builderPoints-=w.count;w.count=0;w.data=undefined;
  }
  if(w.finish&&!w.blocked&&w.terminal==='waiting'&&this.queuedBatches<this.plan.queueCapacity){
   this.enqueue({workerIndex:w.index,count:0,terminal:true});w.terminal='queued';this.finishWaitingWorkers--;
  }
  return{blocked:!!w.blocked||w.terminal==='waiting'};
 }
 /** Caller supplies the complete sample's raw tuples, after finite-double root
  * admission. Filtered samples must supply zero points and skip threshold check.
  * No scalar/metric/transform interpretation is duplicated here. */
 appendSample(index:number,input:Float32Array|number,options:RootsPendingHooks&{filtered?:boolean}={}):{blocked:boolean}{return this.operation(()=>{
  check(options);let w=this.worker(index);if(w&&(w.finish||w.blocked))throw new RootsPendingError('state','worker cannot accept another sample before publication');
  if(options.filtered!==undefined&&typeof options.filtered!=='boolean')throw new RootsPendingError('input','filtered must be boolean');
  let n:number,values:Float32Array|undefined;
  if(this.storage==='points'){
   if(!(input instanceof Float32Array)||typeof SharedArrayBuffer!=='undefined'&&input.buffer instanceof SharedArrayBuffer||input.length%STRIDE!==0)throw new RootsPendingError('input','points require non-shared interleaved Float32 XYZ/metric');
   try{input.subarray(0,0);}catch{throw new RootsPendingError('input','detached point storage');}values=input;n=input.length/STRIDE;
  }else n=integer(input,'pointCount',0);
  if(n>this.plan.maxPointsPerSample)throw new RootsPendingError('input','sample exceeds prepared polynomial root-count bound');
  if(options.filtered&&n!==0)throw new RootsPendingError('input','filtered sample cannot contain points');
  if(!Number.isSafeInteger(this.producedPoints+n))failCapacity('cumulative raw point count exceeds exact integer representation');
  const count=(w?.count??0)+n;if(count>INT_MAX)failCapacity('batch count exceeds the supported signed-int representation');
  const flush=!options.filtered&&count>=this.plan.batchSize;
  const current=w?.data,currentCapacity=(current?.length??0)/STRIDE;
  const capacity=this.storage==='points'&&n?Math.max(16,this.plan.batchSize,currentCapacity,count>currentCapacity?Math.max(count,currentCapacity*2):0):currentCapacity;
  const grow=this.storage==='points'&&n>0&&(!current||capacity*STRIDE>current.length);
  const newBytes=grow?capacity*POINT_BYTES:0,batchBytes=flush?BATCH_BYTES+(this.storage==='points'?count*POINT_BYTES:0):0;
  this.admit(this.retainedBytes+(!w?WORKER_BYTES:0)+newBytes+batchBytes);
  let data=current;
  if(grow){data=this.allocate(capacity*STRIDE);if(current)this.copy(data,0,current.subarray(0,(w?.count??0)*STRIDE),options);}
  if(values&&n)this.copy(data!,(w?.count??0)*STRIDE,values,options);
  let batch:Batch|undefined;
  if(flush){let saved:Float32Array|undefined;if(this.storage==='points'){saved=this.allocate(count*STRIDE);this.copy(saved,0,data!.subarray(0,count*STRIDE),options);}batch={workerIndex:index,count,data:saved,terminal:false};}
  check(options);
  if(!w){w={index,count:0,finish:false,terminal:'none'};this.workers.set(index,w);this.retainedBytes+=WORKER_BYTES;}
  if(grow)this.retainedBytes+=newBytes-(current?.byteLength??0);
  w.data=data;w.count=count;this.builderPoints+=n;this.producedPoints+=n;
  if(batch){w.blocked=batch;this.blockedWorkers++;this.blockedPoints+=count;this.retainedBytes+=batchBytes;}
  return this.publish(w);
 });}
 /** End of an uncancelled partition. A final partial batch precedes its terminal
  * and both may wait for queue space. Cancel never fabricates this call. */
 finishWorker(index:number,h:RootsPendingHooks={}):{blocked:boolean}{return this.operation(()=>{
  check(h);let w=this.worker(index);if(w?.finish)return this.publish(w);
  const count=w?.count??0,makeBatch=count>0&&!w?.blocked,bytes=(makeBatch?BATCH_BYTES+(this.storage==='points'?count*POINT_BYTES:0):0)+BATCH_BYTES;
  this.admit(this.retainedBytes+(!w?WORKER_BYTES:0)+bytes);
  let batch:Batch|undefined;
  if(makeBatch){let data:Float32Array|undefined;if(this.storage==='points'){data=this.allocate(count*STRIDE);this.copy(data,0,w!.data!.subarray(0,count*STRIDE),h);}batch={workerIndex:index,count,data,terminal:false};}
  check(h);if(!w){w={index,count:0,finish:false,terminal:'none'};this.workers.set(index,w);this.retainedBytes+=WORKER_BYTES;}
  if(batch){w.blocked=batch;this.blockedWorkers++;this.blockedPoints+=count;}
  this.retainedBytes+=bytes;w.finish=true;w.terminal='waiting';this.finishWaitingWorkers++;return this.publish(w);
 });}
 publishWorker(index:number,h:RootsPendingHooks={}):{blocked:boolean}{return this.operation(()=>{check(h);const w=this.worker(index);return w?this.publish(w):{blocked:false};});}
 private shiftQueue():Batch {const b=this.queueHead!;this.queueHead=b.next;if(!this.queueHead)this.queueTail=undefined;b.next=undefined;this.queuedBatches--;this.queuedPoints-=b.count;return b;}
 /** A source drain polls whole batches until its pre-poll predicate fails. Cloud
  * borrows each bounded slice synchronously; the PShape fallback list is not
  * duplicated here. A callback failure retains buffers and poisons this owner. */
 drain(mode:'density'|'point-cloud',consumer?:(slice:RootsPendingSlice)=>void,h:RootsPendingHooks={}):{batches:number;points:number;terminals:number}{return this.operation(()=>{
  if(mode!=='density'&&mode!=='point-cloud')throw new RootsPendingError('input','unknown drain mode');
  if(mode==='point-cloud'&&this.storage==='points'&&typeof consumer!=='function')throw new RootsPendingError('input','cloud points drain needs a consumer');
  if(consumer!==undefined&&typeof consumer!=='function')throw new RootsPendingError('input','consumer must be a callback');
  let batches=0,points=0,terminals=0;
  while(this.queueHead&&(mode==='point-cloud'||this.pendingPoints<this.plan.maximumPendingPoints)){
   check(h);const b=this.queueHead;
   if(b.terminal){this.shiftQueue();this.workers.get(b.workerIndex)!.terminal='polled';this.finishedWorkers++;this.retainedBytes-=BATCH_BYTES;terminals++;continue;}
   if(mode==='density'&&this.pendingPoints+b.count>INT_MAX)failCapacity('pending count exceeds supported signed-int representation');
   if(mode==='point-cloud'&&consumer){try{for(let at=0;at<b.count;at+=ROOTS_PENDING_SLICE_POINTS){check(h);const count=Math.min(ROOTS_PENDING_SLICE_POINTS,b.count-at);consumer({workerIndex:b.workerIndex,pointCount:count,points:b.data?.subarray(at*STRIDE,(at+count)*STRIDE)});}check(h);}catch(error){this.failed=true;throw error;}}
   this.shiftQueue();if(mode==='density'){if(this.pendingTail)this.pendingTail.next=b;else this.pendingHead=b;this.pendingTail=b;this.pendingBatches++;this.pendingPoints+=b.count;}
   else this.retainedBytes-=BATCH_BYTES+this.dataBytes(b);
   points+=b.count;this.drainedPoints+=b.count;batches++;
  }
  return{batches,points,terminals};
 });}
 /** One display's adaptive budget, not a readback. A single consumer receives
  * the iterable so projection/clear can occur exactly once. Full iteration and
  * successful return commit the FIFO offsets; failure preserves owned data but
  * prevents retrying a possibly partly submitted external draw. */
 consumeDensity(consumer?:(slices:Iterable<RootsPendingSlice>)=>void,h:RootsPendingHooks={}):{budget:number;consumedPoints:number}{return this.operation(()=>{
  if(this.storage==='points'&&typeof consumer!=='function')throw new RootsPendingError('input','density points consumption needs a consumer');
  if(consumer!==undefined&&typeof consumer!=='function')throw new RootsPendingError('input','consumer must be a callback');check(h);
  const budget=rootsPendingSplatBudget(this.pendingPoints,this.plan.maxSplatPointsPerFrame,this.plan.maximumPendingPoints),self=this;let visited=0,exhausted=false;
  function* slices():Generator<RootsPendingSlice>{let b=self.pendingHead,at=self.pendingOffset;while(b&&visited<budget){check(h);const n=Math.min(b.count-at,budget-visited,ROOTS_PENDING_SLICE_POINTS);visited+=n;yield{workerIndex:b.workerIndex,pointCount:n,points:b.data?.subarray(at*STRIDE,(at+n)*STRIDE)};at+=n;if(at===b.count){b=b.next;at=0;}}check(h);exhausted=true;}
  try{const iterable=slices();if(consumer)consumer(iterable);else for(const _ of iterable){/* count-only consumes identical batch boundaries */}if(!exhausted||visited!==budget)throw new RootsPendingError('state','density consumer did not exhaust its budget iterable');check(h);}catch(error){if(consumer)this.failed=true;throw error;}
  let left=budget;while(left){const b=this.pendingHead!,n=Math.min(left,b.count-this.pendingOffset);left-=n;this.pendingOffset+=n;this.pendingPoints-=n;if(this.pendingOffset===b.count){this.pendingHead=b.next;b.next=undefined;if(!this.pendingHead)this.pendingTail=undefined;this.pendingOffset=0;this.pendingBatches--;this.retainedBytes-=BATCH_BYTES+this.dataBytes(b);}}
  this.consumedPoints+=budget;return{budget,consumedPoints:budget};
 });}
 snapshot():RootsPendingSnapshot {return Object.freeze({storage:this.storage,queueCapacity:this.plan.queueCapacity,queuedBatches:this.queuedBatches,queuedPoints:this.queuedPoints,queueFull:this.queuedBatches>=this.plan.queueCapacity,pendingBatches:this.pendingBatches,pendingPoints:this.pendingPoints,finishedWorkers:this.finishedWorkers,workerCount:this.plan.workerCount,builders:this.workers.size,builderPoints:this.builderPoints,blockedWorkers:this.blockedWorkers,blockedPoints:this.blockedPoints,finishWaitingWorkers:this.finishWaitingWorkers,producedPoints:this.producedPoints,publishedPoints:this.publishedPoints,drainedPoints:this.drainedPoints,consumedPoints:this.consumedPoints,retainedBytes:this.retainedBytes,peakBytes:this.peakBytes,failed:this.failed,disposed:this.disposed});}
 dispose():void {if(this.busy)throw new RootsPendingError('state','cannot dispose inside borrowed consumption');if(this.disposed)return;this.workers.clear();this.queueHead=this.queueTail=this.pendingHead=this.pendingTail=undefined;this.queuedBatches=this.queuedPoints=this.pendingBatches=this.pendingPoints=this.pendingOffset=this.builderPoints=this.blockedWorkers=this.blockedPoints=this.finishWaitingWorkers=this.retainedBytes=0;this.disposed=true;}
}
