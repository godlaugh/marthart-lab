import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {prepareSpirographReplay,type SpirographReplayInput,type SpirographReplayFrame} from '../src/engine/spirographReplay';
// Vite's JSON transform serializes -0 as +0; parse retained text so the oracle's
// signed-zero stage remains available to the numerical boundary assertion.
const vectors=JSON.parse(readFileSync(new URL('./fixtures/spirograph/source-clock-1.7.8.json',import.meta.url),'utf8')) as typeof import('./fixtures/spirograph/source-clock-1.7.8.json');

// Expected frames are generated solely by .cache/spirograph-clock-oracle.py,
// an independent retained-bytecode transcription, not production replay output.
const doubles=new Set(['phases','elapsedMotionSeconds','clearedPhases']);
function assertFrame(actual:SpirographReplayFrame,expected:Record<string,unknown>,label:string):void {
 for(const [key,want] of Object.entries(expected)) {
  const got=(actual as unknown as Record<string,unknown>)[key];
  if(doubles.has(key)){
   expect(Array.isArray(got),label+' '+key).toBe(true);
   expect((got as number[]).length,label+' '+key).toBe((want as number[]).length);
   (want as number[]).forEach((v,i)=>expect(Math.abs((got as number[])[i]-v),`${label} ${key}[${i}]`).toBeLessThanOrEqual(1e-9));
  } else expect(got,label+' '+key).toEqual(want);
 }
}
describe('source frame clock against independent static oracle',()=>{
 for(const vector of vectors.cases)it(vector.id,()=>{
  const plan=prepareSpirographReplay(vector.input as unknown as SpirographReplayInput);
  try{
   for(let frame=0;frame<vector.expected.length;frame++)assertFrame(plan.sample(frame),vector.expected[frame],vector.id+' frame '+frame);
   // Query history is not part of the source state: seek back and restore warm.
   for(const frame of [3,1,0,vector.expected.length-1])assertFrame(plan.sample(frame),vector.expected[frame],vector.id+' seek '+frame);
   if('fork' in vector&&vector.fork){
    const fork=plan.forkRecording(vector.fork.at,vector.fork.fps);
    try{vector.fork.expected.forEach((want,frame)=>assertFrame(fork.sample(frame),want,vector.id+' recording '+frame));}finally{fork.dispose();}
   }
  }finally{plan.dispose();}
 });
});
