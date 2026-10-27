const BUDGET=256*1024*1024;
// Mirrored from sourceDrawingBudget.ts; cross-runtime boundary tests bind it.
const MAX_CHUNK_BYTES=4*1024*1024;
const failure=message=>({ok:false,error:{kind:'input',message}});
/** Envelope facts only. Native retains the complete generic draw validator. */
export function inspectDrawingRequest(b,base,inspect,bodyOffset=60){
 try{
  const shift=bodyOffset-60,word=offset=>b.readUInt32LE(offset+shift);
  if(b.length<92+shift||word(60)!==5||word(68)!==16||b.readUInt32LE(44)||b.readUInt32LE(48))throw Error();
  const operation=word(64),resource=b.subarray(72+shift,88+shift).toString('hex'),expectedIndex=word(88),frameKey=b.subarray(20,60).toString('hex')+(shift?b.subarray(60,80).toString('hex'):'');
  if(operation<1||operation>4||resource==='0'.repeat(32))throw Error();
  const facts={...base,family:'drawing',operation,resource,expectedIndex,control:operation!==3,frameKey};
  if(operation===1){
   if(b.length<108+shift||expectedIndex!==0)throw Error();const chunks=word(92),maximum=word(96),metadata=word(100),count=word(104);let at=108+shift,total=0;
   if(!maximum||maximum>MAX_CHUNK_BYTES||count>(b.length-at)/32)throw Error();
   for(let i=0;i<count;i++){if(at+28>b.length)throw Error();const command=b.readUInt32LE(at),range=b.readUInt32LE(at+4),n=b.readUInt32LE(at+8),per=b.readUInt32LE(at+12),size=b.readUInt32LE(at+16),primitive=b.readUInt32LE(at+20),passes=b.readUInt32LE(at+24);at+=28;if(command!==i||range<1||range>3||!size||primitive!==1||passes<1||passes>2||per!==Math.ceil(n/size)||range===3&&per!==(n?1:0)||at+passes*4>b.length)throw Error();for(let p=0;p<passes;p++){if(b.readUInt32LE(at)>2)throw Error();at+=4;}total+=per*passes;}
   if(at!==b.length||total!==chunks||metadata*3+count*512+8*(maximum+120+shift)+base.width*base.height*(12+8*base.samples)>BUDGET)throw Error();
   return{ok:true,value:{...facts,chunks,maximum,metadata}};
  }
  if(operation===2){if(b.length<180+shift)throw Error();const size=word(116);if(size>MAX_CHUNK_BYTES||size+120+shift!==b.length||![3,12].includes(word(124)))throw Error();const inner=inspect(b.subarray(120+shift));if(!inner.ok||inner.value.family||inner.value.width!==1||inner.value.height!==1||inner.value.samples!==0)throw Error();return{ok:true,value:{...facts,packetBytes:size}};}
  if(b.length!==92+shift)throw Error();return{ok:true,value:facts};
 }catch{return failure('分块原生绘制协议范围或预算无效');}
}
export function inspectDrawingResponse(payload,expected){
 const u=n=>payload.readUInt32LE(n),resource=payload.subarray(8,24).toString('hex'),index=u(24),disposition=u(28),chunks=u(40),finished=u(44),owned=expected.owned;
 if(u(0)!==5||u(4)!==expected.operation||resource!==expected.resource||u(32)!==expected.width||u(36)!==expected.height||finished>1||!payload.subarray(48,64).every(x=>x===0))return failure('分块原生响应身份不符');
 if(expected.operation===4){
  if(![1,2].includes(disposition)||disposition===2&&(index||chunks||finished)||disposition===1&&(!owned||index<owned.index||index>chunks||chunks!==owned.chunks||owned.finished&&!finished))return failure('分块原生释放未确认');
 }else{
  const expectedChunks=expected.operation===1?expected.chunks:owned?.chunks;
  if(disposition!==0||chunks!==expectedChunks||index!==(expected.operation===1?0:expected.operation===2?expected.expectedIndex+1:expected.expectedIndex)||index>chunks||finished!==(expected.operation===3?1:0))return failure('分块原生确认顺序不符');
 }
 return{ok:true,value:{family:'drawing',resource,index,chunks,finished:!!finished,frameKey:expected.frameKey,maximum:expected.maximum??owned?.maximum}};
}
