import type {SceneDocument} from '../types';
export const SOURCE_SAMILA_SAMPLING_MODEL='samila-pcg-1.7.8' as const;
export type SourceSamilaSamplingFacts = {model:typeof SOURCE_SAMILA_SAMPLING_MODEL;frameSeed:number;sampleCount:number;baseBatchSize:number;seedSource:'system-entropy'|'injected'} & ({replay:'live-session-tape';replayFrame:number}|{replay:'hot-display';displayIndex:number});
export function usesSourceSamilaSampling(scene:Pick<SceneDocument,'kind'|'settings'>):boolean{return scene.kind==='samila'&&scene.settings.samilaSamplingModel===SOURCE_SAMILA_SAMPLING_MODEL;}
export function validateSourceSamilaSampling(scene:Pick<SceneDocument,'kind'|'settings'>):void {
 if(scene.settings.samilaSamplingModel===undefined)return;
 if(!usesSourceSamilaSampling(scene)||scene.settings.iteratedMode!=='continuous'||scene.settings.samilaMathModel!=='mathart-1.7.8'||scene.settings.samilaProjectionModel!=='source-ndc-v1'||scene.settings.samilaHistoryModel!=='bounded-v2'||scene.settings.samilaSplatModel!=='samila-splat-1.7.8')throw Error('源 Samila PCG 采样需要源数学、NDC、splat 和 bounded-v2 持续批次');
}
const F=Math.fround,PAGE=4096,PAGE_BYTES=PAGE*5;
export const SOURCE_SAMILA_SEED_TAPE_BYTES=10*1024*1024;
const MAX_PAGES=SOURCE_SAMILA_SEED_TAPE_BYTES/PAGE_BYTES,MAX_FRAMES=MAX_PAGES*PAGE;
const uint=(n:number)=>{if(!Number.isInteger(n)||n< -2147483648||n>0xffffffff)throw Error('源 Samila frameSeed 必须为 32 位整数位型');return n>>>0;};
function frameIndex(frame:number):void{if(!Number.isSafeInteger(frame)||frame<0||frame>=MAX_FRAMES)throw Error('源 Samila 随机重放记录超过 10 MiB 容量或帧编号无效');}
function entropy():number {if(!globalThis.crypto?.getRandomValues)throw Error('源 Samila 系统随机源不可用');return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];}
/** Fresh entropy owner has no replay tape. It survives target resize. */
export class SourceSamilaRandomSource {
 readonly seedSource:'system-entropy'|'injected';private readonly provider:()=>number;private words=0;
 constructor(options:{nextSeed?:()=>number}={}){this.seedSource=options.nextSeed?'injected':'system-entropy';this.provider=options.nextSeed??entropy;}
 next():number{const value=uint(this.provider());this.words++;return value;}
 diagnostics(){return{words:this.words,seedSource:this.seedSource};}
}
export function prepareSourceSamilaLiveBatch(owner:SourceSamilaRandomSource,displayIndex:number,baseBatchSize:number,multiplier:number):SourceSamilaSamplingFacts {
 if(!Number.isSafeInteger(displayIndex)||displayIndex<0||!Number.isInteger(baseBatchSize)||baseBatchSize<1||baseBatchSize>8_000_000||![1,6].includes(multiplier))throw Error('源 Samila 热显示批次无效');
 return{model:SOURCE_SAMILA_SAMPLING_MODEL,frameSeed:owner.next(),sampleCount:baseBatchSize*multiplier,baseBatchSize,displayIndex,seedSource:owner.seedSource,replay:'hot-display'};
}
/** Ephemeral display seed tape. It belongs to a live sampler epoch, not a saved
 * document or the reference application's inaccessible ThreadLocalRandom state. */
export class SourceSamilaSamplingSession {
 private pages=new Map<number,{values:Uint32Array;valid:Uint8Array}>();private seeds=0;
 readonly seedSource:'system-entropy'|'injected';private readonly provider:()=>number;
 constructor(options:{nextSeed?:()=>number}={}){this.seedSource=options.nextSeed?'injected':'system-entropy';this.provider=options.nextSeed??entropy;}
 get retainedBytes():number{return this.pages.size*PAGE_BYTES;}
 projectedBytes(frame:number):number {frameIndex(frame);return this.retainedBytes+(this.pages.has(Math.floor(frame/PAGE))?0:PAGE_BYTES);}
 diagnostics(){return{retainedBytes:this.retainedBytes,seeds:this.seeds,seedSource:this.seedSource};}
 seed(frame:number):number {frameIndex(frame);const pageIndex=Math.floor(frame/PAGE),index=frame%PAGE;let page=this.pages.get(pageIndex);if(page?.valid[index])return page.values[index];
  const value=uint(this.provider());if(!page){page={values:new Uint32Array(PAGE),valid:new Uint8Array(PAGE)};this.pages.set(pageIndex,page);}page.values[index]=value;page.valid[index]=1;this.seeds++;return value;
 }
 reset():void{this.pages.clear();this.seeds=0;}
}
export function prepareSourceSamilaSamplingBatch(owner:SourceSamilaSamplingSession,frame:number,baseBatchSize:number,multiplier:number):SourceSamilaSamplingFacts {
 if(!Number.isInteger(baseBatchSize)||baseBatchSize<1||baseBatchSize>8_000_000||![1,6].includes(multiplier))throw Error('源 Samila 采样批次大小无效');
 return{model:SOURCE_SAMILA_SAMPLING_MODEL,frameSeed:owner.seed(frame),sampleCount:baseBatchSize*multiplier,baseBatchSize,replayFrame:frame,seedSource:owner.seedSource,replay:'live-session-tape'};
}
export function validateSourceSamilaSamplingBatch(batch:SourceSamilaSamplingFacts,count:number,passes:number,frame:number):void {
 const index=batch.replay==='live-session-tape'?batch.replayFrame:batch.replay==='hot-display'?batch.displayIndex:NaN;
 if(batch.model!==SOURCE_SAMILA_SAMPLING_MODEL||uint(batch.frameSeed)!==batch.frameSeed||index!==frame||batch.baseBatchSize!==count||batch.sampleCount!==count*passes||![1,6].includes(passes)||!['system-entropy','injected'].includes(batch.seedSource)||!Number.isSafeInteger(index)||index<0)throw Error('源 Samila 采样事实与显示批次不匹配');if(batch.replay==='live-session-tape')frameIndex(frame);
}
export function sourceSamilaPcgHash(value:number):number {const state=(Math.imul(value>>>0,747796405)+2891336453)>>>0,word=Math.imul((state>>>((state>>>28)+4))^state,277803737)>>>0;return((word>>>22)^word)>>>0;}
/** Literal uint PCG, then float32 range arithmetic. JS float staging may differ
 * from GPU fused operations; the production GPU evaluates the original GLSL. */
export function sourceSamilaSample(frameSeed:number,sampleId:number,lo:number,hi:number):[number,number] {
 if(!Number.isSafeInteger(sampleId)||sampleId<0||sampleId>0x7fffffff)throw Error('源 Samila sample ID 无效');const seed=uint(frameSeed),x=sourceSamilaPcgHash((sampleId^seed)>>>0),y=sourceSamilaPcgHash(x),span=F(F(hi)-F(lo));return[x,y].map(hash=>F(F(lo)+F(F(F(hash)/F(0xffffffff))*span))) as [number,number];
}
export const SOURCE_SAMILA_PCG_GLSL=`uint sourceSamilaPcgHash(uint v){uint state=v*747796405u+2891336453u;uint word=((state>>((state>>28u)+4u))^state)*277803737u;return(word>>22u)^word;}
float sourceSamilaRandFloat(uint seed){return float(sourceSamilaPcgHash(seed))/float(0xFFFFFFFFu);}
`;
