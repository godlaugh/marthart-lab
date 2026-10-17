import {RootsPointCloudRing,ROOTS_POINT_CLOUD_APPEND_LIMIT} from '../src/engine/rootsPointCloudRing.ts';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output=process.argv[2];if(!output)throw Error('Pass a fresh report path');
const hash=v=>createHash('sha256').update(v).digest('hex');
const paths=['src/engine/rootsPointCloudRing.ts','scripts/verify-roots-point-cloud-ring.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,hash(await readFile(p))])));
const report={at:new Date().toISOString(),status:'running',sourceStart:await hashes(),cases:[]};
const ring=new RootsPointCloudRing(),input=new Float32Array(ROOTS_POINT_CLOUD_APPEND_LIMIT*4);let total=0;
const appendTo=target=>{
 const start=performance.now();
 while(total<target){const count=Math.min(ROOTS_POINT_CLOUD_APPEND_LIMIT,target-total);for(let i=0;i<count;i++){const n=total+i;input[i*4]=n;input[i*4+1]=-n;input[i*4+2]=n%2?Infinity:-Infinity;input[i*4+3]=(n%5)-2;}
  ring.append(input,{pointCount:count});total+=count;
 }
 return performance.now()-start;
};
function verify(window,expectedCount){
 if(window.pointCount!==expectedCount||window.totalWrites!==BigInt(total)||window.firstWriteOrdinal!==BigInt(total-expectedCount)||window.ranges.length>2)throw Error('Window facts differ');
 let checked=0;const digest=createHash('sha256');
 for(const range of window.ranges){
  digest.update(new Uint8Array(range.values.buffer,range.values.byteOffset,range.values.byteLength));
  for(let i=0;i<range.values.length;i+=4){const n=total-expectedCount+checked;
   if(!Object.is(range.values[i],n)||!Object.is(range.values[i+1],-n)||range.values[i+2]!== (n%2?Infinity:-Infinity)||range.values[i+3]!== (n%5)-2)throw Error('Arrival sequence/raw tuple mismatch at '+n);
   checked++;
  }
 }
 if(checked!==expectedCount)throw Error('Window coverage differs');
 return{pointCount:checked,firstOrdinal:String(window.firstWriteOrdinal),ranges:window.ranges.map(r=>({pointOffset:r.pointOffset,pointCount:r.pointCount})),sha256:digest.digest('hex')};
}
try{
 for(const target of[2_999_999,3_000_000,3_000_001,10_000_000,10_000_017]){
  const appendMs=appendTo(target),start=performance.now();
  const recent=verify(ring.recentWindow(),Math.min(target,3_000_000)),full=verify(ring.fullWindow(),Math.min(target,10_000_000));
  if(ring.facts.allocatedBytes!==160_000_000)throw Error('Owned representation differs');
  report.cases.push({target,appendMs,verificationMs:performance.now()-start,recent,full,allocatedBytes:ring.facts.allocatedBytes});
 }
 const borrowed=ring.recentWindow();ring.clear();if(ring.isCurrentWindow(borrowed)||ring.recentWindow().pointCount!==0||ring.facts.allocatedBytes!==160_000_000)throw Error('Clear boundary');
 ring.dispose();if(!ring.facts.disposed||ring.facts.allocatedBytes!==0)throw Error('Release ownership boundary');
 report.sourceEnd=await hashes();report.sourceStable=JSON.stringify(report.sourceStart)===JSON.stringify(report.sourceEnd);if(!report.sourceStable)throw Error('Source drift');report.status='passed';
}catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 ring.dispose();report.releasedOwnerReference=ring.facts.disposed&&ring.facts.allocatedBytes===0;
 report.limitations=['Executed the real 10M capacity / 3M window at threshold and wrap boundaries; all returned tuples were checked against independent ordinal arithmetic. No GPU or native application was executed.','This validates raw arrival retention only, not point-cloud shaders, UI, worker scheduling, or native-shape fallback.','allocatedBytes measures the owned typed array; releasing its owner is not evidence of immediate GC or memory release while borrowed views remain alive.','Node experimental type transformation executes this local TypeScript module only.'];
 await mkdir('.cache',{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,status:report.status,sourceStable:report.sourceStable,error:report.error?.message,cases:report.cases.length}));
}
