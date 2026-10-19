import {describe,it,expect} from 'vitest';
import {SourcePerlinParticleTrails} from '../src/engine/sourcePerlinParticleTrails';
import {SourcePerlinParticleMotion} from '../src/engine/sourcePerlinParticleMotion';
import {SourcePerlinParticleColors} from '../src/engine/sourcePerlinParticleColors';
import fixture from './fixtures/source-perlin/trails.json';
type Op={op:string;position?:number[];actualStep?:number;time?:number;wrapped?:boolean;respawned?:boolean;value?:boolean};
function reader(initial:number[]=[0,0,0]){
 const state={x:initial[0],y:initial[1],step:0,flags:0};
 return {state,count:1,visitParticles(visit:(i:number,x:number,y:number,vx:number,vy:number,step:number,flags:number)=>void){visit(0,state.x,state.y,0,0,state.step,state.flags);}};
}
const clean=(n:number)=>Number.isNaN(n)?null:n;
describe('source Perlin trail lifecycle and open polygon contract',()=>{
 // Direct native append and arbitrary-capacity diagnostics intentionally stay
 // outside this production consumer. No test-only history mutation interface.
 for(const c of fixture.cases.filter(c=>c.interface==='production'))it(`matches independent recording and topology: ${c.name}`,()=>{
  const config=c.config,motion=reader(config.initialPosition),packedColors=new Uint32Array([0x01336699]);
  const trails=new SourcePerlinParticleTrails({motion,packedColors,lifetime:config.trailLifetime,fade:config.fadeTrails,accumulation:config.accumulation});
  let show=config.showTrails;
  const check=(expected:{records:unknown[];count:number;visibleShapes:{positions:number[][];alphas:number[]}[]})=>{
   const records:unknown[]=[];trails.visitRecords(0,(x,y,z,time)=>records.push({x:clean(x),y:clean(y),z:clean(z),time}));
   expect(records).toEqual(expected.records);expect(trails.diagnostics().records).toBe(expected.count);
   if(!show)return; // Visibility belongs to the caller, not pooled history.
   const s=trails.snapshotPolygons(config.width,config.height),shapes=expected.visibleShapes;
   expect([...s.positions]).toEqual(shapes.flatMap(s=>s.positions.flat()));
   expect([...s.alphas]).toEqual(shapes.flatMap(s=>s.alphas));
   const offsets=[0];for(const shape of shapes)offsets.push(offsets.at(-1)!+shape.positions.length);
   expect([...s.polygonOffsets]).toEqual(offsets);
   expect([...s.particleIds]).toEqual(Array(s.alphas.length).fill(0));
   expect([...s.colors]).toEqual(Array.from({length:s.alphas.length},()=>[.2,.4,.6].map(Math.fround)).flat());
  };
  check(c.initial);
  for(const [index,op] of (c.operations as Op[]).entries()){
   if(op.op==='setVisible')show=op.value!;
   else if(op.op==='expire')trails.afterMotion(op.time!,false);
   else if(op.op==='move'){
    Object.assign(motion.state,{x:Math.fround(op.position![0]),y:Math.fround(op.position![1]),step:Math.fround(op.actualStep!),flags:(op.wrapped?1:0)|(op.respawned?2:0)});
    trails.afterMotion(op.time!,show);
   }else throw new Error('Unexpected non-production operation');
   const row=c.snapshots.find(row=>row.afterOperation===index);if(row)check(row.expected);
  }
 });
 it('couples actual motion and live colors, recoloring existing retained history',()=>{
  const motion=new SourcePerlinParticleMotion({seed:'12345',count:8,width:800,height:600});
  const colors=new SourcePerlinParticleColors({count:8,palette:[0xff0000ff]});
  const trails=new SourcePerlinParticleTrails({motion,packedColors:colors.packed,lifetime:4,fade:true,accumulation:false});
  for(let i=1;i<=12;i++){
   colors.runtime.update(1/60);
   motion.update({time:i/60,deltaTime:1/60,noiseScale:8,noiseOffset:0,stepSize:1,timeScale:0,respawnRate:0,flowMode:'ANGLE_FIELD',angleMap:'LINEAR'});
   trails.afterMotion(i/60,true);
  }
  const before=trails.snapshotPolygons(800,600);expect(before.alphas.length).toBeGreaterThan(0);
  colors.runtime.replacePalette([0xffff0000]);const after=trails.snapshotPolygons(800,600);
  expect(after.positions).toEqual(before.positions);expect(after.alphas).toEqual(before.alphas);
  expect([...before.colors]).toEqual(Array.from({length:before.alphas.length},()=>[0,0,1]).flat());
  expect([...after.colors]).toEqual(Array.from({length:after.alphas.length},()=>[1,0,0]).flat());
  after.positions.fill(999);expect(trails.snapshotPolygons(800,600).positions).toEqual(before.positions);
 });
 it('captures configuration but intentionally borrows live colors',()=>{
  const motion=reader(),options={motion,packedColors:new Uint32Array([0xffffffff]),lifetime:4,fade:false,accumulation:false};
  const trails=new SourcePerlinParticleTrails(options);options.fade=true;options.lifetime=0;
  for(let i=1;i<3;i++){motion.state.x=i;trails.afterMotion(i,true);}
  expect([...trails.snapshotPolygons(800,600).alphas]).toEqual([1,1,1]);
 });
 it('refuses partial reads after cancellation during motion delivery',()=>{
  const motion=reader();let armed=false,checks=0;
  const trails=new SourcePerlinParticleTrails({motion,packedColors:new Uint32Array(1),lifetime:4,fade:true,accumulation:false,isCancelled:()=>armed&&++checks===2});
  armed=true;expect(()=>trails.afterMotion(1,true)).toThrow(expect.objectContaining({code:'cancelled'}));
  armed=false;expect(()=>trails.diagnostics()).toThrow(expect.objectContaining({code:'failed'}));
 });
 it('rejects malformed input before allocation or snapshot',()=>{
  const motion=reader(),options={motion,packedColors:new Uint32Array(1),lifetime:4,fade:true,accumulation:false};
  expect(()=>new SourcePerlinParticleTrails({...options,packedColors:new Uint32Array()})).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>new SourcePerlinParticleTrails({...options,lifetime:Infinity})).toThrow(expect.objectContaining({code:'input'}));
  const trails=new SourcePerlinParticleTrails(options);
  expect(()=>trails.snapshotPolygons(NaN,600)).toThrow(expect.objectContaining({code:'input'}));
  expect(()=>trails.visitRecords(1,()=>{})).toThrow();
  const accumulation=new SourcePerlinParticleTrails({...options,accumulation:true});
  expect(()=>accumulation.visitRecords(-1,()=>{})).toThrow();
 });
});
