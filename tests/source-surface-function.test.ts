import {describe,expect,it} from 'vitest';
import {prepareSourceSurfaceFunction} from '../src/engine/sourceSurfaceFunction';

// Static JsonSurfaceFunction.setParameter/baseConstants and constructor slot
// ownership, exercised across the mode-switch reconstruction boundary. The
// original UI/JVM lifecycle has not been executed by these tests.
describe('source surface function ownership across mode replacement',()=>{
 it('captures current shared constants into new slots without mutating authored data or other replays',()=>{
  const input={equations:{x:'a',y:'u',z:'v'},parameters:{a:2},scales:[1,1,1],offsets:[0,0,0]},factory=prepareSourceSurfaceFunction(input);
  const old=factory.create();old.write('a',3);
  const next=old.recreate();expect(next.read('a')).toBe(3);
  old.write('a',4);expect(next.read('a')).toBe(3);
  expect(next.revision).toBe(0);expect(old.revision).toBe(2);
  old.write('a',4);expect(old.revision).toBe(2);
  expect(next.recreate().read('a')).toBe(4);
  next.write('a',5);expect(old.read('a')).toBe(4);expect(old.recreate().read('a')).toBe(5);
  expect(factory.create().read('a')).toBe(2);expect(input.parameters.a).toBe(2);
  expect(old.write('missing',99)).toBe(false);expect(old.read('missing')).toBe(0);
 });
 it('keeps seam probes offset-free and render samples separately Float32-rounded',()=>{
  const factory=prepareSourceSurfaceFunction({equations:{x:'16777217',y:'u',z:'v'},parameters:{},scales:[3,2,4],offsets:[-50331648,100,-100]});
  const state=factory.create(),out=new Float32Array(3);
  expect(state.position(2,3,out,0,false)).toBe(true);expect(Array.from(out)).toEqual([50331648,4,12]);
  expect(state.position(2,3,out)).toBe(true);expect(Array.from(out)).toEqual([0,104,-88]);
 });
 it('preserves parameter shadowing and exposes invalid samples for caller-specific geometry handling',()=>{
  const state=prepareSourceSurfaceFunction({equations:{x:'u',y:'v',z:'1/a'},parameters:{a:0,u:7,v:9},scales:[1,1,1],offsets:[0,0,0]}).create(),out=new Float32Array(3);
  expect(state.position(100,200,out)).toBe(false);expect(Array.from(out)).toEqual([7,9,Infinity]);
  state.write('a',2);expect(state.position(100,200,out)).toBe(true);expect(out[2]).toBe(.5);
 });
 it('narrows coordinate arguments before evaluating in double precision',()=>{
  const state=prepareSourceSurfaceFunction({equations:{x:'u-16777216',y:'v-16777216',z:'a-16777216'},parameters:{a:16777217},scales:[1,1,1],offsets:[0,0,0]}).create(),out=new Float32Array(3);
  expect(state.position(16777217,16777217,out)).toBe(true);
  expect(Array.from(out)).toEqual([0,0,1]);
 });
 it('tracks signed-zero writes while reads/sampling and unknown writes leave geometry revision unchanged',()=>{
  const state=prepareSourceSurfaceFunction({equations:{x:'a',y:'u',z:'v'},parameters:{a:0},scales:[1,1,1],offsets:[0,0,0]}).create();
  state.position(1,2,new Float32Array(3));state.read('a');state.write('missing',2);expect(state.revision).toBe(0);
  state.write('a',-0);expect(state.revision).toBe(1);state.write('a',-0);expect(state.revision).toBe(1);
 });
});
