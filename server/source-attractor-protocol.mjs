// v14 prepared Attractor pipeline. No author JSON, RNG or shader rewriting.
export const ATTRACTOR_MAX_UPLOAD_BYTES=4*1024*1024,ATTRACTOR_MAX_READ_BYTES=4*1024*1024,ATTRACTOR_FIXED_BYTES=1024*1024;
const BUDGET=256*1024*1024,fail=(kind,message)=>({ok:false,error:{kind,message}});
const dims=(w,h)=>w>0&&h>0&&w<=16384&&h<=16384&&w*h<=16000000;
const resident=(count,side,programBytes=0)=>side*side*32+count*24+programBytes+ATTRACTOR_FIXED_BYTES;
const targetBytes=(w,h,aw,ah)=>w*h*4+aw*ah*16;
export function inspectAttractorRequest(b,base){
 try{
  const u=o=>b.readUInt32LE(o),operation=u(64),resource=b.subarray(72,88).toString('hex');
  if(u(60)!==6||operation<1||operation>6||u(68)!==16||resource==='0'.repeat(32)||!b.subarray(28,60).every(n=>n===0)||operation!==4&&(base.width!==1||base.height!==1))return fail('input','Attractor v14 envelope invalid');
  const result={...base,family:'attractor',operation,resource,control:operation!==4,packetBytes:b.length,readCount:0,responseBytes:96};
  if(operation===6)return b.length===88?{ok:true,value:result}:fail('input','Attractor release trailing bytes');
  let count,texSize,programBytes=0;
  if(operation===1){
   if(b.length<124)return fail('input','Attractor create truncated');count=u(88);texSize=u(92);result.shaderOperations=u(96);if(!result.shaderOperations)return fail('input','Attractor shader work invalid');
   let at=100;const decoder=new TextDecoder('utf-8',{fatal:true});
   for(let i=0;i<6;i++){const n=u(at);at+=4;if(!n||n>b.length-at)return fail('input','Attractor shader block invalid');const text=decoder.decode(b.subarray(at,at+n));if(!text.startsWith('#version 410 core\n')||text.includes('\0'))return fail('input','Attractor shader profile invalid');programBytes+=n*3;at+=n;}
   if(at!==b.length)return fail('input','Attractor create trailing bytes');result.programBytes=programBytes;
  }else{
   if(b.length<108)return fail('input','Attractor checkpoint truncated');result.expectedIndex=u(88);result.expectedRenderIndex=u(92);result.expectedUploaded=u(96);count=u(100);texSize=u(104);
  }
  if(!count||!texSize||texSize>16384||texSize!==Math.ceil(Math.sqrt(count))||texSize*texSize*64+count*48>BUDGET)return fail('capacity','Attractor particle layout exceeds admission');
  result.count=count;result.texSize=texSize;result.residentBytes=resident(count,texSize,programBytes);
  if(operation!==1&&(result.expectedUploaded>texSize*texSize||operation!==2&&result.expectedUploaded!==texSize*texSize))return fail('input','Attractor upload incomplete');
  if(operation===2){
   if(b.length<124||result.expectedIndex||result.expectedRenderIndex)return fail('input','Attractor upload phase invalid');const offset=u(108);let at=112,total=0;const arrays=[];
   for(let i=0;i<3;i++){const n=u(at);at+=4;if(n%4||n>b.length-at)return fail('input','Attractor upload block invalid');arrays.push({at,n});total+=n;at+=n;}
   const n=arrays[0].n/16,m=Math.min(n,Math.max(count-offset,0));
   if(at!==b.length||!n||!Number.isInteger(n)||offset!==result.expectedUploaded||offset+n>texSize*texSize||arrays[1].n!==m*8||arrays[2].n!==m*16||total>ATTRACTOR_MAX_UPLOAD_BYTES)return fail('input','Attractor upload cursor/shape invalid');
   for(const a of arrays)for(let i=a.at;i<a.at+a.n;i+=4)if(!Number.isFinite(b.readFloatLE(i)))return fail('input','Attractor upload must be finite');result.uploaded=offset+n;result.offset=offset;
  }
  if(operation===3){if(b.length!==132||u(112)>1||result.expectedIndex===0xffffffff)return fail('input','Attractor pass invalid');result.steps=b.readInt32LE(108);}
  if(operation===4){
   if(b.length!==304||result.expectedRenderIndex===0xffffffff)return fail('input','Attractor render invalid');const aw=u(108),ah=u(112);if(!dims(aw,ah)||b.readFloatLE(116)<=0)return fail('input','Attractor target/radius invalid');for(let at=116;at<304;at+=4)if(!Number.isFinite(b.readFloatLE(at)))return fail('input','Attractor uniforms must be finite');
   result.accumWidth=aw;result.accumHeight=ah;result.targetBytes=targetBytes(base.width,base.height,aw,ah);result.responseBytes+=base.width*base.height*4;
  }
  if(operation===5){
   if(b.length!==120)return fail('input','Attractor read invalid');const target=u(108),offset=u(112),n=u(116);if(![1,2].includes(target)||!n||n*16>ATTRACTOR_MAX_READ_BYTES||target===1&&offset+n>texSize*texSize||target===2&&!result.expectedRenderIndex)return fail('input','Attractor read range invalid');result.target=target;result.offset=offset;result.readCount=n;result.responseBytes+=n*16;
  }
  if(result.residentBytes+(result.targetBytes??0)+b.length*6+result.responseBytes*4>BUDGET)return fail('capacity','Attractor native representations exceed budget');return{ok:true,value:result};
 }catch{return fail('input','Attractor v14 packet malformed');}
}
/** Server resource ownership supplements immutable request checks; all indices
 * and producing-pass metadata come from the actual native ACK. */
export function inspectAttractorResponse(b,e){
 try{
  const u=o=>b.readUInt32LE(o),resource=b.subarray(8,24).toString('hex');
  if(b.length!==e.responseBytes||u(0)!==6||u(4)!==e.operation||resource!==e.resource||![80,84,88,92].every(o=>u(o)===0))return fail('protocol','Attractor response envelope invalid');
  const r={family:'attractor',resource,passIndex:u(24),renderIndex:u(28),uploaded:u(32),count:u(36),texSize:u(40),disposition:u(44),width:u(48),height:u(52),accumWidth:u(56),accumHeight:u(60),renderedPassIndex:u(64)};
  if(u(68)!==(e.target??0)||u(72)!==(e.operation===5?e.offset:0)||u(76)!==e.readCount)return fail('protocol','Attractor response read range invalid');
  if(e.operation===6?![1,2].includes(r.disposition):r.disposition!==0)return fail('protocol','Attractor response disposition invalid');
  if(r.disposition===2){if(Object.entries(r).some(([k,v])=>!['family','resource','disposition'].includes(k)&&v!==0))return fail('protocol','Attractor absent state invalid');return{ok:true,value:r};}
  if(!r.count||r.texSize!==Math.ceil(Math.sqrt(r.count))||r.uploaded>r.texSize*r.texSize||r.passIndex>10000||r.renderedPassIndex>r.passIndex)return fail('protocol','Attractor response checkpoint invalid');
  if(r.renderIndex===0?[r.width,r.height,r.accumWidth,r.accumHeight,r.renderedPassIndex].some(n=>n!==0):!dims(r.width,r.height)||!dims(r.accumWidth,r.accumHeight))return fail('protocol','Attractor response targets invalid');
  if(e.operation!==6){
   const index=e.operation===1?0:e.expectedIndex+(e.operation===3?1:0),renderIndex=e.operation===1?0:e.expectedRenderIndex+(e.operation===4?1:0),uploaded=e.operation===1?0:e.operation===2?e.uploaded:e.expectedUploaded;
   if(r.passIndex!==index||r.renderIndex!==renderIndex||r.uploaded!==uploaded||r.count!==e.count||r.texSize!==e.texSize)return fail('protocol','Attractor response does not match issued checkpoint');
  }else if(e.owned&&(r.count!==e.owned.count||r.texSize!==e.owned.texSize||r.passIndex<e.owned.passIndex||r.renderIndex<e.owned.renderIndex||r.uploaded<e.owned.uploaded))return fail('protocol','Attractor released resource identity changed');
  if(e.operation===4){if(r.width!==e.width||r.height!==e.height||r.accumWidth!==e.accumWidth||r.accumHeight!==e.accumHeight||r.renderedPassIndex!==r.passIndex)return fail('protocol','Attractor render target/producing pass invalid');}
  else if(e.owned&&e.operation!==6&&['width','height','accumWidth','accumHeight','renderedPassIndex'].some(k=>r[k]!==e.owned[k]))return fail('protocol','Attractor preserved target metadata changed');
  if(e.operation===5&&e.target===2&&(r.renderedPassIndex!==r.passIndex||e.offset+e.readCount>r.accumWidth*r.accumHeight))return fail('protocol','Attractor accumulation read is stale/out of range');
  return{ok:true,value:{...r,programBytes:e.operation===1?e.programBytes:e.owned?.programBytes??0,shaderOperations:e.operation===1?e.shaderOperations:e.owned?.shaderOperations??0,residentBytes:e.operation===1?e.residentBytes:e.owned?.residentBytes??resident(r.count,r.texSize),work:(e.owned?.work??0)+(e.operation===3?e.work??0:0)}};
 }catch{return fail('protocol','Attractor response malformed');}
}
/** Reject wrong owned checkpoints before forwarding bytes. Other families are
 * charged authoritatively by the native resource registry, not guessed here. */
export function admitAttractorRequest(e,resources){
 const owners=[...resources.values()].filter(r=>r.family==='attractor'),owned=e.owned;
 if(e.operation===6)return{ok:true};
 if(e.operation===1){if(owned)return fail('ownership','Attractor resource already exists');if(owners.length>=2)return fail('capacity','Attractor retained owner limit exceeded');}
 else{
  if(!owned)return fail('state-lost','Attractor resource absent');
  if(owned.failed)return fail('state-lost','Attractor owner is failed; release required');
  if(e.count!==owned.count||e.texSize!==owned.texSize)return fail('ownership','Attractor resource layout changed');
  if(e.expectedIndex!==owned.passIndex||e.expectedRenderIndex!==owned.renderIndex||e.expectedUploaded!==owned.uploaded)return fail('input','Attractor owned checkpoint mismatch');
  if(e.operation===3){const work=e.texSize*e.texSize*Math.max(0,e.steps)*(owned.shaderOperations*4+40);if(!Number.isSafeInteger(work)||work>1e9||owned.work+work>64e9||owned.passIndex>=10000)return fail('capacity','Attractor pass work exceeded');e.work=work;}
  if(e.operation===5&&e.target===2&&(owned.renderedPassIndex!==owned.passIndex||e.offset+e.readCount>owned.accumWidth*owned.accumHeight))return fail('input','Attractor accumulation is stale/out of range');
 }
 const retained=owners.reduce((n,r)=>n+r.residentBytes+targetBytes(r.width,r.height,r.accumWidth,r.accumHeight),0);
 const growth=e.operation===1?e.residentBytes:e.operation===4&&(!owned||e.width!==owned.width||e.height!==owned.height||e.accumWidth!==owned.accumWidth||e.accumHeight!==owned.accumHeight)?e.targetBytes:0;
 return retained+growth+e.packetBytes*6+e.responseBytes*4>BUDGET?fail('capacity','Attractor retained and transient representations exceed budget'):{ok:true};
}
