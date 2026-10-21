import {it,expect} from 'vitest';
import {SourceParticleTrailHistory,SOURCE_PARTICLE_TRAIL_MAX_RECORDS} from '../src/engine/sourceParticleTrails';

it('polls cancellation within a long single-slot expiration, not only between particles',()=>{
 let checks=0,cancelAfter=Infinity;
 const history=new SourceParticleTrailHistory(1,1000,false,new Uint32Array([0xffffffff]),()=>{if(++checks>cancelAfter)throw Error('cancelled');},()=>{throw Error('capacity');});
 for(let i=0;i<4096;i++)history.add(0,i,0,0,0);
 cancelAfter=checks+1;
 expect(()=>history.expire(0,1001)).toThrow('cancelled');
 expect(history.recordCount).toBe(3072);
});

it('bounds the opt-in pool in bytes and rejects excess before adding storage',()=>{
 expect(()=>new SourceParticleTrailHistory(1,1000,false,new Uint32Array([0xffffffff]),()=>{},()=>{throw Error('capacity');},SOURCE_PARTICLE_TRAIL_MAX_RECORDS+1)).toThrow('32 MiB');
 const history=new SourceParticleTrailHistory(1,1000,false,new Uint32Array([0xffffffff]),()=>{},()=>{throw Error('capacity');},2);
 history.add(0,0,0,0,0);history.add(0,1,0,0,0);expect(history.retainedBytes).toBe(12+2*20);
 expect(()=>history.add(0,2,0,0,0)).toThrow('capacity');expect(history.recordCount).toBe(2);
 history.expire(0,1001);history.add(0,3,0,0,1001);expect(history.recordCount).toBe(1);expect(history.retainedBytes).toBe(52);
});
