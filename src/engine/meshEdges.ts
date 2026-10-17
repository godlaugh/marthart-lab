/** Final compact vertex identities own edges. Coordinates are never welded. */
export interface EdgeMemory {add(bytes:number):void;release(bytes:number):void;}
export const IMPLICIT_OUTPUT_BYTES=128*1024*1024,IMPLICIT_WORK_BYTES=256*1024*1024;
export function checkedMeshBytes(vertices:number,triangleIndices:number,edgeCount:number){
 if(!Number.isSafeInteger(vertices)||vertices<0||vertices>0x1_0000_0000||!Number.isSafeInteger(triangleIndices)||triangleIndices<0||triangleIndices%3||!Number.isSafeInteger(edgeCount)||edgeCount<0||edgeCount>triangleIndices)throw Error('等值面输出计数无效');
 const bytes=24*vertices+4*triangleIndices+8*edgeCount;if(!Number.isSafeInteger(bytes)||bytes>IMPLICIT_OUTPUT_BYTES)throw Error('等值面输出超过 128 MiB 预算；请降低分辨率或缩小采样域');return bytes;
}
/** The caller owns retained input/output storage. Key scratch is charged before
 * allocation and released here, including exceptional/cancelled completion.
 * Native typed-array sort is a bounded, noninterruptible section. */
export function buildMeshEdges(indices:Uint32Array,vertices:number,memory:EdgeMemory,cancel:()=>void=()=>{},admit:(edges:number)=>void=()=>{}):Uint32Array{
 if(!(indices instanceof Uint32Array)||indices.length%3||!Number.isSafeInteger(vertices)||vertices<0||vertices>0x1_0000_0000)throw Error('网格边输入无效');
 const keyBytes=indices.length*8;if(!Number.isSafeInteger(keyBytes)||keyBytes>IMPLICIT_WORK_BYTES)throw Error('网格边键缓冲超过 256 MiB 预算');
 cancel();memory.add(keyBytes);let keys:BigUint64Array|undefined;
 try{
  keys=new BigUint64Array(indices.length);let written=0;
  const edge=(a:number,b:number)=>{if(a>=vertices||b>=vertices)throw Error('网格边索引越界');if(a!==b)keys![written++]=(BigInt(Math.min(a,b))<<32n)|BigInt(Math.max(a,b));};
  for(let i=0;i<indices.length;i+=3){if((i&4095)===0)cancel();const a=indices[i],b=indices[i+1],c=indices[i+2];edge(a,b);edge(b,c);edge(c,a);}
  cancel();const ordered=keys.subarray(0,written);ordered.sort();cancel();
  let count=0,last:bigint|undefined;for(let i=0;i<ordered.length;i++){if((i&4095)===0)cancel();const key=ordered[i];if(key!==last){count++;last=key;}}
  admit(count);const bytes=count*8;memory.add(bytes);let edges:Uint32Array;
  try{edges=new Uint32Array(count*2);let at=0;last=undefined;for(let i=0;i<ordered.length;i++){if((i&4095)===0)cancel();const key=ordered[i];if(key!==last){edges[at++]=Number(key>>32n);edges[at++]=Number(key&0xffff_ffffn);last=key;}}cancel();}
  catch(error){memory.release(bytes);throw error;}
  return edges;
 }finally{keys=undefined;memory.release(keyBytes);}
}
