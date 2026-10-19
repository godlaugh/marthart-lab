import {it,expect} from 'vitest';
import {SourceParticleTrailHistory} from '../src/engine/sourceParticleTrails';

it('polls cancellation within a long single-slot expiration, not only between particles',()=>{
 let checks=0,cancelAfter=Infinity;
 const history=new SourceParticleTrailHistory(1,1000,false,new Uint32Array([0xffffffff]),()=>{if(++checks>cancelAfter)throw Error('cancelled');},()=>{throw Error('capacity');});
 for(let i=0;i<4096;i++)history.add(0,i,0,0,0);
 cancelAfter=checks+1;
 expect(()=>history.expire(0,1001)).toThrow('cancelled');
 expect(history.recordCount).toBe(3072);
});
