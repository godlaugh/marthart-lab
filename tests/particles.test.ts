import {describe, expect, it} from 'vitest';
import {definitions, mapStep, symmetryStep, createNoise, spirographPoint, insideBoundary, advanceBilliard, projectSamila, type Boundary} from '../src/scenes/particles';
import {compileReal} from '../src/engine/expression';
import type {SceneDefinition, SceneDocument, GenerateContext} from '../src/types';
const context:GenerateContext={time:2,quality:'preview',width:800,height:600};
function document(def:SceneDefinition):SceneDocument{return{version:1,id:def.kind,name:def.name,kind:def.kind,equations:{...def.defaults.equations},parameters:{...def.defaults.parameters},settings:{...def.defaults.settings,count:300,steps:20,burnIn:20},palette:{name:'test',stops:['#ff0000','#00ffff'],mode:'linear',offset:0,cycles:1},camera:{position:[0,0,10],target:[0,0,0],orthographic:true,zoom:1},timeline:{duration:10,fps:30,loop:true,tracks:[]},favorite:false};}
function get(kind:string){return definitions.find(d=>d.kind===kind)!;}
function closePoint(actual:number[],expected:number[],places=8){expect(actual[0]).toBeCloseTo(expected[0],places);expect(actual[1]).toBeCloseTo(expected[1],places);}

describe('all six particle and curve scenes',()=>{
 it('has exactly six distinct public scene definitions',()=>{expect(definitions.map(d=>d.kind).sort()).toEqual(['bouncing','map','perlin','samila','spirograph','symmetry']);});
 for(const def of definitions){
  it(`${def.kind}: generates finite colored geometry and reproducible seeds`,()=>{const doc=document(def),one=def.generate(doc,context),two=def.generate(doc,context);expect(one.type).toBe('geometry');if(one.type!=='geometry'||two.type!=='geometry')return;expect(one.positions.length).toBeGreaterThan(0);expect([...one.positions].every(Number.isFinite)).toBe(true);expect(one.colors?.length).toBe(one.positions.length);expect(one.stats.generated).toBe(one.positions.length/3);expect(one.stats.samples).toBeGreaterThan(0);expect(one.positions).toEqual(two.positions);});
  it(`${def.kind}: cancels with honest partial output`,()=>{const out=def.generate(document(def),{...context,isCancelled:()=>true});expect(out.stats.generated).toBe(0);expect(out.warnings?.some(x=>x.includes('取消'))).toBe(true);});
  it(`${def.kind}: rejects invalid sample count`,()=>{const doc=document(def);doc.settings.count=NaN;expect(()=>def.generate(doc,context)).toThrow();doc.settings.count=1.5;expect(()=>def.generate(doc,context)).toThrow();});
  for(const preset of def.presets){it(`${def.kind}: preset ${preset.id} produces real finite geometry`,()=>{const doc=document(def);Object.assign(doc.equations,preset.equations);doc.parameters={...doc.parameters,...preset.parameters};Object.assign(doc.settings,preset.settings);const out=def.generate(doc,context);expect(out.stats.generated).toBeGreaterThan(0);if(out.type==='geometry')expect([...out.positions].every(Number.isFinite)).toBe(true);});}
 }
 it('rejects an unknown setting mode instead of displaying an unrelated fallback',()=>{for(const [kind,key] of [['bouncing','shape'],['samila','projection'],['perlin','flow'],['spirograph','rotorMode']]){const def=get(kind),doc=document(def);doc.settings[key]='not-a-mode';expect(()=>def.generate(doc,context)).toThrow();}});
});

describe('iterated maps and symmetric chaos',()=>{
 it('updates x and y simultaneously from the previous point',()=>{const f={x:compileReal('x+y'),y:compileReal('x-y')};expect(mapStep(2,1,f,{})).toEqual([3,1]);});
 it('computes the standard Hénon step',()=>{const f={x:compileReal('1-a*x^2+y'),y:compileReal('b*x')};closePoint(mapStep(.2,.1,f,{a:1.4,b:.3}),[1.044,.06]);});
 it('symmetry mapping commutes with rotation by 2π/n',()=>{const p={lambda:-2.34,alpha:2,beta:.2,gamma:.2,omega:.03,n:5},angle=2*Math.PI/p.n;const rotate=(q:number[])=>[q[0]*Math.cos(angle)-q[1]*Math.sin(angle),q[0]*Math.sin(angle)+q[1]*Math.cos(angle)];const source:[number,number]=[.31,-.27],rotated=rotate(source);closePoint(symmetryStep(rotated[0],rotated[1],p),rotate(symmetryStep(...source,p)));});
 it('retains the zero fixed point',()=>{expect(symmetryStep(0,0,{lambda:-2,alpha:2,beta:.2,gamma:.3,omega:1,n:5})).toEqual([0,0]);});
 it('marks divergent mathematical samples instead of leaking infinities',()=>{const def=get('map'),doc=document(def);doc.equations={x:'1/0',y:'x'};const out=def.generate(doc,context);expect(out.stats.generated).toBe(0);expect(out.stats.invalid).toBe(320);expect(out.warnings?.length).toBeGreaterThan(0);});
 it('surfaces malformed or unknown formulas',()=>{const def=get('map'),doc=document(def);doc.equations.x='missing+x';expect(()=>def.generate(doc,context)).toThrow('未知变量');doc.equations.x='sin(';expect(()=>def.generate(doc,context)).toThrow();});
 it('formula time is passed through the restricted evaluator',()=>{const def=get('map'),doc=document(def);doc.equations={x:'t',y:'0'};const out=def.generate(doc,{...context,time:3});if(out.type==='geometry')expect(out.positions[0]).toBe(3);});
});

describe('seeded gradient noise',()=>{
 it('vanishes on lattice points, repeats at 256 and is seed deterministic',()=>{const a=createNoise(4),b=createNoise(4);expect(a(1,2,3)).toBe(0);expect(a(.31,.72,.18)).toBe(b(.31,.72,.18));expect(a(.31,.72,.18)).toBeCloseTo(a(256.31,.72,.18),10);expect(createNoise(5)(.31,.72,.18)).not.toBe(a(.31,.72,.18));});
 it('is continuous across lattice boundaries and bounded for a dense probe',()=>{const noise=createNoise(91);expect(Math.abs(noise(1-1e-7,.31,.2)-noise(1+1e-7,.31,.2))).toBeLessThan(1e-5);for(let i=0;i<200;i++)expect(Math.abs(noise(i*.123,i*.371,i*.019))).toBeLessThan(1.5);expect(()=>noise(Infinity,0)).toThrow();});
 it('time changes the generated flow while a frozen seed reproduces it',()=>{const def=get('perlin'),doc=document(def);expect(def.generate(doc,{...context,time:0})).not.toEqual(def.generate(doc,{...context,time:1}));});
 it('particles mode uses actual point topology',()=>{const def=get('perlin'),doc=document(def);doc.settings.style='particles';const result=def.generate(doc,context);if(result.type==='geometry'){expect(result.topology).toBe('points');expect(result.stats.generated).toBe(300*20);}});
});

describe('spirograph rolling geometry',()=>{
 it('matches the analytic hypocycloid and closes after a full revolution',()=>{const rotors=[{radius:1,mode:'inside' as const}],t=.73;closePoint(spirographPoint(t,3,rotors,1),[2*Math.cos(t)+Math.cos(2*t),2*Math.sin(t)-Math.sin(2*t)]);closePoint(spirographPoint(0,3,rotors,1),spirographPoint(2*Math.PI,3,rotors,1));});
 it('has a circular locus when the pen is centered',()=>{for(let i=0;i<20;i++){const p=spirographPoint(i*.4,4,[{radius:1,mode:'inside'}],0);expect(Math.hypot(...p)).toBeCloseTo(3,10);}});
 it('supports nested rotors without invalid positions',()=>{expect(spirographPoint(.7,3,[{radius:1,mode:'inside'},{radius:.5,mode:'outside',speed:2}],.4).every(Number.isFinite)).toBe(true);});
 it('rejects empty or zero-radius rotor chains and malformed JSON',()=>{expect(()=>spirographPoint(1,3,[],1)).toThrow();expect(()=>spirographPoint(1,3,[{radius:0,mode:'inside'}],1)).toThrow();const def=get('spirograph'),doc=document(def);doc.settings.rotors='[';expect(()=>def.generate(doc,context)).toThrow('JSON');});
 it('draw progress is deterministic and reaches the same full trace',()=>{const def=get('spirograph'),doc=document(def);doc.settings.animate=true;doc.settings.drawDuration=10;const start=def.generate(doc,{...context,time:0}),end=def.generate(doc,{...context,time:10});doc.settings.animate=false;const full=def.generate(doc,{...context,time:0});if(start.type==='geometry'&&end.type==='geometry'&&full.type==='geometry'){expect(new Set(start.positions).size).toBeLessThanOrEqual(3);expect(end.positions).toEqual(full.positions);}});
});

describe('elastic billiards',()=>{
 const circle:Boundary={kind:'circle',radius:1},ellipse:Boundary={kind:'ellipse',a:2,b:1},square:Boundary={kind:'polygon',vertices:[[-1,-1],[1,-1],[1,1],[-1,1]]};
 it('circle collision reverses the outward normal component and preserves speed',()=>{const s=advanceBilliard([0,0],[1,0],1.5,circle);closePoint(s.position,[.5,0]);closePoint(s.velocity,[-1,0]);expect(s.collisions).toBe(1);});
 it('ellipse axial trajectory has exact reflection distance',()=>{const s=advanceBilliard([0,0],[1,0],3,ellipse);closePoint(s.position,[1,0]);closePoint(s.velocity,[-1,0]);});
 it('polygon collisions reflect against the struck edge',()=>{const s=advanceBilliard([0,0],[1,.2],1.5,square);closePoint(s.position,[.5,.3]);closePoint(s.velocity,[-1,.2]);});
 it('reflects simultaneous corner contacts without escaping the polygon',()=>{const s=advanceBilliard([0,0],[1,1],1.5,square);closePoint(s.position,[.5,.5]);closePoint(s.velocity,[-1,-1]);expect(insideBoundary(s.position,square)).toBe(true);});
 it('preserves speed and confinement over repeated angled collisions',()=>{for(const b of [circle,ellipse,square]){let p:[number,number]=[.11,.13],v:[number,number]=[.8,.3];const speed=Math.hypot(...v);for(let i=0;i<40;i++){const s=advanceBilliard(p,v,.31,b);p=s.position;v=s.velocity;expect(insideBoundary(p,b)).toBe(true);expect(Math.hypot(...v)).toBeCloseTo(speed,9);}}});
 it('splitting time yields the same state as a continuous flight',()=>{for(const b of [circle,ellipse,square]){const one=advanceBilliard([0,0],[.7,.3],7,b),half=advanceBilliard([0,0],[.7,.3],3,b),two=advanceBilliard(half.position,half.velocity,4,b);closePoint(one.position,two.position,7);closePoint(one.velocity,two.velocity,7);}});
 it('handles zero velocity, zero elapsed time and outward boundary starts',()=>{closePoint(advanceBilliard([.2,.1],[0,0],1,circle).position,[.2,.1]);closePoint(advanceBilliard([.2,.1],[1,0],0,circle).position,[.2,.1]);expect(insideBoundary(advanceBilliard([1,0],[1,0],.5,circle).position,circle)).toBe(true);expect(insideBoundary(advanceBilliard([1,0],[1,0],.5,square).position,square)).toBe(true);});
 it('rejects outside starts, negative time and degenerate boundaries',()=>{expect(()=>advanceBilliard([2,0],[1,0],1,circle)).toThrow();expect(()=>advanceBilliard([0,0],[1,0],-1,circle)).toThrow();expect(()=>advanceBilliard([0,0],[1,0],1,{kind:'circle',radius:0})).toThrow();expect(()=>advanceBilliard([0,0],[1,0],1,{kind:'polygon',vertices:[[0,0],[1,0],[2,0]]})).toThrow();});
 it('initial shapes and every velocity mode remain confined',()=>{const def=get('bouncing');for(const shape of ['box','circle','ring','spiral','star','heart','lissajous','rose','infinity','superellipse','hypocycloid','epicycloid','formula'])for(const velocity of ['uniform','random','out','in','cw','ccw']){const doc=document(def);doc.settings.count=12;doc.settings.shape=shape;doc.settings.velocity=velocity;const out=def.generate(doc,{...context,time:8});expect(out.stats.generated).toBeGreaterThan(0);if(out.type==='geometry')for(let i=0;i<out.positions.length;i+=3)expect(Math.hypot(out.positions[i],out.positions[i+1])).toBeLessThanOrEqual(3.000001);}});
 it('reports impossible formula masks without infinite rejection loops',()=>{const def=get('bouncing'),doc=document(def);doc.settings.shape='formula';doc.settings.fill=true;doc.settings.count=2;doc.equations.mask='0';const out=def.generate(doc,context);expect(out.stats.generated).toBe(0);expect(out.stats.samples).toBe(512);expect(out.stats.invalid).toBe(512);});
});

describe('Samila mappings and cartographic projections',()=>{
 it('preserves the Cartesian identity and polar radius',()=>{expect(projectSamila(2,3,'cartesian')).toEqual([2,3]);expect(Math.hypot(...projectSamila(.7,3,'polar'))).toBeCloseTo(3,12);});
 it('maps projection centers to the origin and Mollweide poles to ±sqrt(2)',()=>{for(const mode of ['aitoff','hammer','lambert','mollweide'])closePoint(projectSamila(0,0,mode),[0,0]);closePoint(projectSamila(.3,Math.PI/2,'mollweide'),[0,Math.SQRT2]);});
 it('is symmetric across the equator and prime meridian',()=>{for(const mode of ['aitoff','hammer','lambert','mollweide']){const [x,y]=projectSamila(.7,.4,mode);closePoint(projectSamila(-.7,-.4,mode),[-x,-y]);}});
 it('marks the Lambert antipode as a singularity and rejects unknown projections',()=>{expect(projectSamila(Math.PI,0,'lambert').every(Number.isNaN)).toBe(true);expect(()=>projectSamila(0,0,'bad')).toThrow();});
 it('samples every advertised mapping and projection',()=>{const def=get('samila'),mapping=def.controls.find(x=>x.key==='mapping')!.options!,projections=def.controls.find(x=>x.key==='projection')!.options!;for(const m of mapping)for(const p of projections){const doc=document(def);doc.settings.count=30;doc.settings.mapping=m.value;doc.settings.projection=p.value;const out=def.generate(doc,context);expect(out.stats.generated).toBeGreaterThan(0);}});
 it('rejects inverted input bounds and reports formula singularities',()=>{const def=get('samila'),doc=document(def);doc.settings.start=2;doc.settings.stop=1;expect(()=>def.generate(doc,context)).toThrow();doc.settings.start=-1;doc.settings.stop=1;doc.equations.f1='1/0';const out=def.generate(doc,context);expect(out.stats.generated).toBe(0);expect(out.stats.invalid).toBe(300);});
});
