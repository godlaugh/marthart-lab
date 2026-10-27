// v15 gateway wire/admission owner. Shader reflection and drawing semantics
// belong to the native target; no author settings or GLSL are interpreted here.
const BUDGET=256*1024*1024,MAX_CHUNK=65536,MAX_POINTS=3000000;
const FIXED_BYTES=2*1024*1024+1024;
const failure=(kind,message)=>({ok:false,error:{kind,message}});
const dims=(w,h)=>w>0&&h>0&&w<=16384&&h<=16384&&w*h<=16000000;
const resident=(w,h,programBytes)=>w*h*4+FIXED_BYTES+programBytes;
export function inspectRootsPointRequest(b,base){
 try{
  const u=at=>b.readUInt32LE(at),operation=u(64),resource=b.subarray(72,88).toString('hex');
  if(u(60)!==7||operation<1||operation>5||u(68)!==16||resource==='0'.repeat(32)||!b.subarray(28,60).every(n=>n===0))return failure('input','Roots point v15 envelope invalid');
  const e={...base,family:'roots-point',operation,resource,control:operation!==4,packetBytes:b.length,responseBytes:96+(operation===4?base.width*base.height*4:0)};
  let at=88;const word=()=>{const n=u(at);at+=4;return n;};
  const block=()=>{const n=word();if(n>b.length-at)throw Error('truncated block');const value=b.subarray(at,at+n);at+=n;return value;};
  const text=()=>{const value=new TextDecoder('utf-8',{fatal:true}).decode(block());if(!value||value.includes('\0'))throw Error('invalid text');return value;};
  if(operation===5){if(base.width!==1||base.height!==1||b.length!==88)return failure('input','Roots point release shape invalid');return{ok:true,value:e};}
  if(operation===1){
   const session=block();e.session=session.toString('hex');e.target=word();
   if(session.length!==16||e.session==='0'.repeat(32)||![1,2].includes(e.target)||word()!==1)return failure('input','Roots point session/profile invalid');
   let programBytes=0;
   for(let i=0;i<4;i++){const start=at,shader=text();if(!shader.startsWith('#version 410 core\n'))return failure('input','Roots point shader profile invalid');programBytes+=(at-start-4)*3;}
   e.programBytes=programBytes;e.residentBytes=resident(base.width,base.height,programBytes);
  }else{
   e.expectedDisplay=word();if(e.expectedDisplay===0xffffffff)return failure('input','Roots point display would overflow');
   if(operation===2){
    e.flags=word();e.chunkPoints=word();const count=word();
    if(e.flags>3||!e.chunkPoints||e.chunkPoints>MAX_CHUNK||count>2||e.expectedDisplay===0&&!(e.flags&1))return failure('input','Roots point begin profile/schedule invalid');
    const ranges=[];for(let i=0;i<count;i++){const n=word();if(!n)return failure('input','Roots point range is empty');ranges.push(n);}
    e.rangeCounts=Object.freeze(ranges);e.totalPoints=ranges.reduce((n,x)=>n+x,0);e.totalChunks=ranges.reduce((n,x)=>n+Math.ceil(x/e.chunkPoints),0);
    if(e.totalPoints>MAX_POINTS)return failure('capacity','Roots point recent window exceeds capacity');
    for(let channel=0;channel<8;channel++){const value=b.readFloatLE(at);at+=4;if(!Number.isFinite(value)||value<0||value>1||!(e.flags&(channel<4?1:2))&&value!==0)return failure('input','Roots point clear/fade invalid');}
    if(block().length!==1024)return failure('input','Roots point palette shape invalid');
    if(word()!==14)return failure('input','Roots point uniform count invalid');
    // Traverse the generic uniform representation exactly. The native program
    // owner validates the fixed names, linked types and permitted sampler.
    for(let i=0;i<14;i++){
     const name=text(),kind=word();if(kind===9){if(word()!==0)return failure('input','Roots point palette unit invalid');continue;}
     const width={1:1,5:3,7:16}[kind];if(!width||word()!==1)return failure('input','Roots point uniform representation invalid');
     const values=block();if(values.length!==width*4)return failure('input','Roots point uniform length invalid');
     for(let off=0;off<values.length;off+=4)if(!Number.isFinite(values.readFloatLE(off)))return failure('input','Roots point uniform must be finite');
     if(name==='pointSize')e.pointSize=values.readFloatLE(0);
    }
    if(!Number.isFinite(e.pointSize))return failure('input','Roots point size missing/invalid');
   }else if(operation===3){
    e.ordinal=word();e.rangeIndex=word();e.rangeOffset=word();e.count=word();const points=block();
    if(!e.count||e.count>MAX_CHUNK||e.rangeIndex>1||points.length!==e.count*16||b.length>4*1024*1024)return failure('input','Roots point append range/shape invalid');
    // XYZ is the preserved source payload, including nonfinite/signed zero.
    // Metric is already clamped by its producing owner, never repaired here.
    for(let off=12;off<points.length;off+=16){const metric=points.readFloatLE(off);if(!Number.isFinite(metric)||metric<0||metric>1)return failure('input','Roots point metric is not prepared');}
   }
  }
  if(at!==b.length)return failure('input','Roots point packet trailing bytes');
  // Admit the eventual complete readback before begin can mutate history.
  // Its wire ACK is still only 96 bytes; no pixels are allocated here.
  e.admissionResponseBytes=operation===2?96+base.width*base.height*4:e.responseBytes;
  e.transientBytes=b.length*8+e.responseBytes*4;
  if(operation===2){
   const maximumPoints=Math.min(e.chunkPoints,Math.max(0,...e.rangeCounts));
   e.transientBytes=Math.max(e.transientBytes,92*8+e.admissionResponseBytes*4,maximumPoints?(112+maximumPoints*16)*8+96*4:0);
  }
  if((e.residentBytes??0)+e.transientBytes>BUDGET)return failure('capacity','Roots point transient representations exceed budget');
  return{ok:true,value:e};
 }catch{return failure('input','Roots point packet malformed');}
}

/** Cross-family allocations are charged by the native shared registry. This
 * owner charges known point targets and freezes the admitted coverage facts. */
export function admitRootsPointRequest(e,resources){
 const owners=[...resources.values()].filter(r=>r.family==='roots-point'),owned=e.owned;
 if(e.operation===5)return{ok:true};
 const reject=(kind,message)=>{if(owned&&(owned.phase===1||owned.transaction))owned.failed=true;return failure(kind,message);};
 if(e.operation===1){
  if(owned||owners.some(r=>r.session===e.session&&r.target===e.target))return failure('ownership','Roots point target already exists');
 }else{
  if(!owned)return failure('state-lost','Roots point target absent');
  if(owned.failed||owned.phase===2)return failure('state-lost','Roots point target failed; release required');
  if(e.width!==owned.width||e.height!==owned.height)return reject('ownership','Roots point target dimensions changed');
  if(e.expectedDisplay!==owned.displayIndex)return reject('input','Roots point display checkpoint differs');
  if(e.operation===2){
   if(owned.phase!==0)return reject('input','Roots point frame already active');
   const diameter=Math.max(1,Math.min(e.pointSize,owned.pointSizeRange[1]));
   const footprint=Math.min(e.width,Math.ceil(diameter)+2)*Math.min(e.height,Math.ceil(diameter)+2);
   const maximum=Math.max(1,Math.min(MAX_CHUNK,Math.floor(8000000/Math.max(1,footprint))));
   if(e.chunkPoints>maximum)return failure('capacity','Roots point draw footprint exceeds admitted work');
  }else{
   if(owned.phase!==1)return reject('input','Roots point frame is not active');
   if(e.operation===3){
    const sizes=owned.rangeCounts;let range=0,ordinal=e.ordinal;
    while(range<sizes.length&&ordinal>=Math.ceil(sizes[range]/owned.chunkPoints)){ordinal-=Math.ceil(sizes[range]/owned.chunkPoints);range++;}
    const offset=ordinal*owned.chunkPoints,count=Math.min(owned.chunkPoints,(sizes[range]??0)-offset);
    if(e.ordinal!==owned.nextChunk||e.rangeIndex!==range||e.rangeOffset!==offset||e.count!==count||range>=sizes.length)return reject('input','Roots point append does not cover the next admitted range');
   }else if(owned.receivedPoints!==owned.totalPoints||owned.nextChunk!==owned.totalChunks)return reject('input','Roots point frame coverage incomplete');
  }
 }
 const retained=owners.reduce((n,r)=>n+r.residentBytes,0);
 return retained+(e.operation===1?e.residentBytes:0)+e.transientBytes>BUDGET?failure('capacity','Roots point retained/transient representations exceed budget'):{ok:true};
}

export function inspectRootsPointResponse(b,e){
 try{
  const u=at=>b.readUInt32LE(at),resource=b.subarray(8,24).toString('hex');
  if(b.length!==e.responseBytes||u(0)!==7||u(4)!==e.operation||resource!==e.resource||!b.subarray(84,96).every(x=>x===0))return failure('protocol','Roots point ACK identity/length invalid');
  const r={family:'roots-point',resource,displayIndex:u(24),disposition:u(28),width:u(32),height:u(36),phase:u(40),receivedPoints:u(44),totalPoints:u(48),nextChunk:u(52),totalChunks:u(56),pointDraws:u(60),fadeDraws:u(64),clears:u(68),pointSizeRange:Object.freeze([b.readFloatLE(72),b.readFloatLE(76)]),profile:u(80)};
  if(r.phase>2||(e.operation===5?![1,2].includes(r.disposition):r.disposition!==0))return failure('protocol','Roots point ACK phase/disposition invalid');
  if(r.disposition===2){
   if(r.width!==1||r.height!==1||!b.subarray(24,28).every(x=>x===0)||!b.subarray(40,84).every(x=>x===0))return failure('protocol','Roots point absent ACK contains state');
   return{ok:true,value:r};
  }
  if(!dims(r.width,r.height)||r.profile!==1||r.totalPoints>MAX_POINTS||r.receivedPoints>MAX_POINTS||r.totalChunks>MAX_POINTS||r.nextChunk>MAX_POINTS||r.pointDraws>MAX_POINTS||r.fadeDraws>1||r.clears>1||!r.pointSizeRange.every(Number.isFinite))return failure('protocol','Roots point ACK metadata invalid');
  // A failed create/append can have an unknown checkpoint. Released is proof
  // of cleanup, not a claim that its last frame completed successfully.
  if(e.operation===5)return{ok:true,value:r};
  if(r.width!==e.width||r.height!==e.height||r.pointSizeRange[0]<=0||r.pointSizeRange[1]<r.pointSizeRange[0]||r.pointSizeRange[1]<1)return failure('protocol','Roots point ACK target/device differs');
  const o=e.owned,display=e.operation===1?0:e.expectedDisplay+(e.operation===4?1:0),phase=[1,4].includes(e.operation)?0:1;
  const points=e.operation===1?0:e.operation===2?e.totalPoints:o.totalPoints,chunks=e.operation===1?0:e.operation===2?e.totalChunks:o.totalChunks;
  const received=[1,2].includes(e.operation)?0:o.receivedPoints+(e.operation===3?e.count:0),next=[1,2].includes(e.operation)?0:o.nextChunk+(e.operation===3?1:0),flags=e.operation===1?0:e.operation===2?e.flags:o.flags;
  if(r.displayIndex!==display||r.phase!==phase||r.totalPoints!==points||r.totalChunks!==chunks||r.receivedPoints!==received||r.nextChunk!==next||r.pointDraws!==next||r.fadeDraws!==Number(!!(flags&2))||r.clears!==Number(!!(flags&1))||o&&r.pointSizeRange.some((x,i)=>x!==o.pointSizeRange[i]))return failure('protocol','Roots point ACK checkpoint/coverage differs');
  return{ok:true,value:{...r,session:e.operation===1?e.session:o.session,target:e.operation===1?e.target:o.target,programBytes:e.operation===1?e.programBytes:o.programBytes,residentBytes:e.operation===1?e.residentBytes:o.residentBytes,rangeCounts:e.operation===2?e.rangeCounts:o?.rangeCounts??Object.freeze([]),chunkPoints:e.operation===2?e.chunkPoints:o?.chunkPoints??0,flags,transaction:phase===1}};
 }catch{return failure('protocol','Roots point ACK malformed');}
}
