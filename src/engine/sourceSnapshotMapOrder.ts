import {ROOTS_SOURCE_ORDER_LIMITS} from './rootsSourceOrder';
import {sourceJavaStringHash} from './sourceJavaHash';
/** SnapshotStateMap's mutable HAMT retains singleton children after removal.
 * The tree, not just its current iteration order, owns subsequent edit behavior. */
export interface SourceSnapshotMap {data:string[];children:[number,SourceSnapshotMap][];}
export type SnapshotMapResult={ok:true;state:SourceSnapshotMap;keys:string[]}|{ok:false;error:{kind:'input'|'capacity';reason:string}};
class InputError extends Error {constructor(message:string,readonly kind:'input'|'capacity'='input'){super(message);}}
const empty=():SourceSnapshotMap=>({data:[],children:[]});
const bucket=(key:string,shift:number)=>(sourceJavaStringHash(key)>>>shift)&31;
export function sourceSnapshotMapKeys(node:SourceSnapshotMap):string[]{return[...node.data,...node.children.flatMap(([,child])=>sourceSnapshotMapKeys(child))];}
function validateKeys(keys:readonly string[]):void {
 if(keys.length>ROOTS_SOURCE_ORDER_LIMITS.members)throw new InputError('参数成员超过本地容量','capacity');
 let characters=0;const seen=new Set<string>();
 for(const key of keys){if(typeof key!=='string'||seen.has(key))throw new InputError('参数名类型无效或重复');seen.add(key);characters+=key.length;if(characters>ROOTS_SOURCE_ORDER_LIMITS.characters)throw new InputError('参数名文本超过本地容量','capacity');}
}
function readState(raw:unknown):SourceSnapshotMap {
 let count=0,characters=0,nodes=0;const seen=new Set<string>();
 function read(value:unknown,path:number[]):SourceSnapshotMap {
  if(++nodes>ROOTS_SOURCE_ORDER_LIMITS.members*8+1)throw new InputError('参数树超过本地容量','capacity');
  if(!value||typeof value!=='object'||Array.isArray(value)||path.length>7)throw new InputError('参数树节点无效');
  const v=value as Record<string,unknown>;
  if(!Array.isArray(v.data)||!Array.isArray(v.children)||v.data.length>(path.length===7?ROOTS_SOURCE_ORDER_LIMITS.members:32)||v.children.length>32||path.length===7&&v.children.length)throw new InputError('参数树节点容量或结构无效');
  const data:string[]=[],slots=new Set<number>();let last=-1;
  for(const key of v.data){
   if(typeof key!=='string'||seen.has(key))throw new InputError('参数树键无效或重复');seen.add(key);
   if(++count>ROOTS_SOURCE_ORDER_LIMITS.members||(characters+=key.length)>ROOTS_SOURCE_ORDER_LIMITS.characters)throw new InputError('参数树超过本地容量','capacity');
   for(let depth=0;depth<path.length;depth++)if(bucket(key,depth*5)!==path[depth])throw new InputError('参数树键与路径不匹配');
   if(path.length<7){const at=bucket(key,path.length*5);if(at<=last)throw new InputError('参数树数据顺序无效');last=at;slots.add(at);}
   data.push(key);
  }
  const children:[number,SourceSnapshotMap][]=[];last=32;
  for(const row of v.children){if(!Array.isArray(row)||row.length!==2||!Number.isInteger(row[0])||row[0]<0||row[0]>=last||slots.has(row[0]))throw new InputError('参数树子节点顺序无效');last=row[0];const child=read(row[1],[...path,row[0]]);if(!child.data.length&&!child.children.length)throw new InputError('参数树不能保留空子节点');children.push([row[0],child]);}
  return{data,children};
 }
 return read(raw,[]);
}
function insert(node:SourceSnapshotMap,key:string,shift=0):void {
 if(node.data.includes(key))return;
 if(shift>30){node.data.unshift(key);return;}
 const at=bucket(key,shift),child=node.children.find(([index])=>index===at);
 if(child){insert(child[1],key,shift+5);return;}
 const index=node.data.findIndex(k=>bucket(k,shift)===at);
 if(index<0){node.data.push(key);node.data.sort((a,b)=>bucket(a,shift)-bucket(b,shift));return;}
 const old=node.data.splice(index,1)[0],next=empty();
 // makeNode starts the complete-hash collision list [existing,new], whereas
 // later collisionPut prepends. Insertion into an empty depth-7 node differs.
 if(shift===30)next.data=[old,key];else{insert(next,old,shift+5);insert(next,key,shift+5);}
 node.children.push([at,next]);node.children.sort((a,b)=>b[0]-a[0]);
}
function remove(node:SourceSnapshotMap,key:string,shift=0):SourceSnapshotMap|null {
 const own=node.data.indexOf(key);if(own>=0)node.data.splice(own,1);
 else if(shift<=30){const at=bucket(key,shift),index=node.children.findIndex(([slot])=>slot===at);if(index>=0){const updated=remove(node.children[index][1],key,shift+5);if(updated)node.children[index][1]=updated;else node.children.splice(index,1);
   // mutableUpdateNodeAtIndex collapses only a parent with one child and no
   // own entries. Other singleton children persist; immutable put differs.
   if(updated&&node.data.length===0&&node.children.length===1&&updated.children.length===0&&updated.data.length===1)return updated;
  }}
 return node.data.length||node.children.length?node:null;
}
/** Keys describe the next local parameter set; previous is a persisted tree.
 * Value replacements preserve structure, deletions precede newly authored keys.
 * Fresh import inserts once in the supplied native JSON iteration order. */
export function prepareSourceSnapshotMap(keys:readonly string[],previous?:unknown):SnapshotMapResult {
 try{
  validateKeys(keys);let state=previous===undefined?empty():readState(previous);const wanted=new Set(keys),existing=new Set(sourceSnapshotMapKeys(state));
  for(const key of existing)if(!wanted.has(key))state=remove(state,key)??empty();
  for(const key of keys)if(!existing.has(key))insert(state,key);
  return{ok:true,state,keys:sourceSnapshotMapKeys(state)};
 }catch(cause){if(cause instanceof InputError)return{ok:false,error:{kind:cause.kind,reason:cause.message}};throw cause;}
}
/** Validate/detach saved state without reconstructing its historically retained
 * singleton nodes. Callers separately verify membership against their payload. */
export function parseSourceSnapshotMap(raw:unknown):SnapshotMapResult {
 try{const state=readState(raw);return{ok:true,state,keys:sourceSnapshotMapKeys(state)};}catch(cause){if(cause instanceof InputError)return{ok:false,error:{kind:cause.kind,reason:cause.message}};throw cause;}
}
