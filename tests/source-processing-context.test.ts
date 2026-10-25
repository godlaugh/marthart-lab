import {describe,expect,it} from 'vitest';
import inverse from './fixtures/source-processing-context/inverse.json';
import {invertSourceProcessingMatrix} from '../src/engine/sourceProcessingMatrix';
import {SourceProcessingContext,SourceProcessingShaderContext,type SourceProcessingContextResult} from '../src/engine/sourceProcessingContext';
import {sourceProcessingAutomaticBindings} from '../src/engine/sourceProcessingAutomaticBindings';

const value=<T>(result:SourceProcessingContextResult<T>):T=>{if(!result.ok)throw result.error;return result.value;};
const words=(values:readonly number[])=>[...new Uint32Array(new Float32Array(values).buffer)];
const context=(width=405,height=486)=>{const c=value(SourceProcessingContext.create(width,height));value(c.apply({kind:'begin-draw'}));return c;};
describe('Processing matrix and graphics ownership boundaries',()=>{
 it.each(inverse.rows)('matches the pinned actual PMatrix3D inverse: $name',row=>{
  const a=[...new Float32Array(new Uint32Array(row.inputBits).buffer)];expect(invertSourceProcessingMatrix(a)).toBe(row.inverted);expect(words(a)).toEqual(row.outputBits);
 });
 it('retains the first graphics object while reading its updated state, without resolving a new selector each time',()=>{
  const primary=context(),offscreen=context(257,193),shader=new SourceProcessingShaderContext();value(primary.apply({kind:'reset-matrix'}));const first=value(shader.bind(primary));
  value(primary.apply({kind:'end-draw'}));expect(value(shader.bind(undefined))).toEqual(first);
  value(primary.apply({kind:'begin-draw'}));value(primary.apply({kind:'translate',x:7,y:8,z:9}));const after=value(primary.snapshot());expect(value(shader.bind(offscreen))).toEqual(after);expect(after).not.toEqual(first);
  const replacement=new SourceProcessingShaderContext();expect(value(replacement.bind(offscreen)).viewport).toEqual([0,0,257,193]);primary.dispose();expect(shader.bind(offscreen)).toMatchObject({ok:false,error:{kind:'state'}});
  shader.dispose();expect(shader.bind(offscreen)).toMatchObject({ok:false,error:{kind:'state'}});replacement.dispose();offscreen.dispose();
 });
 it('keeps overlay projection outside the matrix stack and persists hints across resize',()=>{
  const c=context(),before=value(c.snapshot());value(c.apply({kind:'hint',index:7,enabled:true}));expect(value(c.snapshot()).perspective).toBe(1);
  value(c.apply({kind:'push-matrix'}));value(c.apply({kind:'default-camera'}));value(c.apply({kind:'ortho'}));value(c.apply({kind:'pop-matrix'}));const after=value(c.snapshot());expect(after.modelview).toEqual(before.modelview);expect(after.projection).not.toEqual(before.projection);expect(after.perspective).toBe(0);expect(after.scale).toEqual([1,1,Math.fround(.999)]);
  value(c.apply({kind:'hint',index:6,enabled:true}));value(c.apply({kind:'end-draw'}));value(c.apply({kind:'resize',width:257,height:193}));value(c.apply({kind:'begin-draw'}));expect(value(c.snapshot())).toMatchObject({viewport:[0,0,257,193],perspective:1,scale:[1,1,1]});c.dispose();
 });
 it('rejects invalid identities, matrix stack overflow and invalid inputs without replacing known state',()=>{
  expect(new SourceProcessingShaderContext().bind(undefined)).toMatchObject({ok:false,error:{kind:'input'}});expect(SourceProcessingContext.create(0,1)).toMatchObject({ok:false,error:{kind:'input'}});
  const c=context(),before=value(c.snapshot());expect(c.apply({kind:'translate',x:1,y:Infinity,z:3})).toMatchObject({ok:false,error:{kind:'input'}});expect(value(c.snapshot())).toEqual(before);
  expect(c.apply({kind:'pop-matrix'})).toMatchObject({ok:false,error:{kind:'state'}});for(let i=0;i<32;i++)value(c.apply({kind:'push-matrix'}));expect(c.apply({kind:'push-matrix'})).toMatchObject({ok:false,error:{kind:'capacity'}});expect(value(c.snapshot())).toEqual(before);c.dispose();
 });
 it('chooses primary automatic names before aliases, preserves ordinary defaults and uses compatible integer setters',()=>{
  const c=context(),snapshot=value(c.snapshot()),reflection=[{name:'transform',type:35676,size:1},{name:'transformMatrix',type:35676,size:1},{name:'modelviewMatrix',type:35676,size:2},{name:'perspective',type:35670,size:1},{name:'ppixels',type:5124,size:1},{name:'authoredGain',type:5126,size:1},{name:'lightPosition',type:35666,size:8},{name:'texture',type:35678,size:1}];
  const {bindings,rejectedSetters}=value(sourceProcessingAutomaticBindings(reflection,snapshot));expect(bindings.map(b=>b.name)).toEqual(['transform','modelviewMatrix','ppixels','perspective']);expect(bindings.find(b=>b.name==='modelviewMatrix')!.values).toHaveLength(16);expect(bindings.find(b=>b.name==='perspective')!.type).toBe(35670);expect(rejectedSetters).toEqual([]);
  expect(value(sourceProcessingAutomaticBindings([{name:'transform',type:5126,size:1}],snapshot))).toEqual({bindings:[],rejectedSetters:[{name:'transform',setterType:35676,linkedType:5126,reason:'incompatible-setter'}]});c.dispose();
 });
 it('preserves rejected-setter diagnostics without falling back to aliases and rejects unknown compatibility',()=>{
  const c=context(),snapshot=value(c.snapshot());
  const plan=value(sourceProcessingAutomaticBindings([{name:'transform',type:5126,size:1},{name:'transformMatrix',type:35676,size:1},{name:'scale',type:35672,size:1},{name:'viewport',type:35673,size:1}],snapshot));
  expect(plan.rejectedSetters).toEqual([{name:'transform',setterType:35676,linkedType:5126,reason:'incompatible-setter'}]);
  expect(plan.bindings).toEqual([{name:'viewport',type:35673,values:[0,0,1,1]},{name:'scale',type:35672,values:[1,1,1]}]);
  expect(sourceProcessingAutomaticBindings([{name:'perspective',type:35680,size:1}],snapshot)).toMatchObject({ok:false,error:{kind:'unsupported'}});c.dispose();
 });
});
