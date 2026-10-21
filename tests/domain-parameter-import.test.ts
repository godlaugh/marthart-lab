import {describe,it,expect} from 'vitest';
import {parseProjectFile} from '../src/engine/legacyImport';
import {parseScene} from '../src/engine/document';
import {sceneAtTime} from '../src/engine/timeline';

const base={config_version:'1.0.0',type:'DOMAIN_COLORING',name:'Source parameter import',domainColoring:{formula:'z'},settings:{render_mode:'CPU'}};
const read=(changes:Record<string,unknown>={})=>parseProjectFile(JSON.stringify({...base,...changes}));
const action=(method:string,args?:unknown,extra:Record<string,unknown>={})=>({method,...(args===undefined?{}:{args}),...extra});
const clip=(actions:unknown[],extra:Record<string,unknown>={})=>({type:'animate',actions,...extra});
const imported=(method:string,args?:unknown)=>read({timeline:[clip([action(method,args)])]});
const specs=(method:string,args?:unknown)=>imported(method,args).scene.timeline.tracks[0].actions![0].domainParameters!;

describe('public Domain source registry import',()=>{
 it.each(['paramStart','paramStop'])('keeps All separate from an explicitly empty operation list for %s',method=>{
  for(const args of [undefined,null,0,true,'ignored',[],[null],[3],{},[{}],{parameters:{}},[{parameters:{}}]])expect(specs(method,args)).toEqual([{model:'domain-registry-1.7.8',scope:{kind:'all'}}]);
  const args={parameters:{a:null,b:3,c:[],d:{enable:false},e:{enable:'FALSE'}}};
  const {scene}=imported(method,args);expect(scene.timeline.tracks[0].actions![0].domainParameters).toEqual([]);
  expect(parseScene(JSON.stringify(scene)).timeline.tracks[0].actions![0].domainParameters).toEqual([]);
 });
 it.each([null,[],1,true,'invalid'])('rejects malformed present parameter containers: %j',parameters=>{
  expect(()=>specs('paramStart',{parameters})).toThrow('应为对象');
  expect(()=>specs('paramStop',[{parameters}])).toThrow('应为对象');
 });
 it('reads only the first argument object, retains later arguments and ignores action enabled',()=>{
  const raw={timeline:[clip([action('paramStart',[{parameters:{x:{}}},{parameters:{y:{}}}],{enabled:{ignored:true}})])]};
  const {scene,warnings}=read(raw),a=scene.timeline.tracks[0].actions![0];
  expect(a.enabled).toBe(true);expect(a.domainParameters).toHaveLength(1);expect(a.domainParameters![0].scope).toEqual({kind:'named',name:'x'});
  expect(scene.provenance!.original).toMatchObject(raw);expect(warnings.join()).toContain('不读取动作级 enabled');expect(warnings.join()).toContain('args.1');
 });
 it.each([true,'true','TRUE','TrUe',undefined])('accepts source enable %j and fills the source defaults',enable=>{
  expect(specs('paramStart',{parameters:{x:{enable}}})[0]).toEqual({model:'domain-registry-1.7.8',scope:{kind:'named',name:'x'},configuration:{min:-1,max:1,step:Math.fround(.1),edgeEasing:{window:.5,floor:.25,easing:'sine-out'}}});
 });
 it.each([null,0,1,' true ','yes',[],{}])('rejects invalid source enable %j',enable=>{
  expect(()=>specs('paramStart',{parameters:{x:{enable}}})).toThrow('应为布尔值');
  expect(()=>specs('paramStop',{parameters:{x:{enable}}})).toThrow('应为布尔值');
 });
 it('uses the empty-map scalar language instead of project parameters or MathJS',()=>{
  const raw={parameters:{x:40},timeline:[clip([action('paramStart',{parameters:{x:{min:'x+1',max:'PI/2',step:'1e3+1'},y:{min:'',max:'0x1.8p1',step:'1e-3'}}})])]};
  const {scene,warnings}=read(raw),ops=scene.timeline.tracks[0].actions![0].domainParameters!;
  expect(ops[0].configuration).toMatchObject({min:-1,max:Math.PI/2,step:Math.fround(.1)});
  expect(ops[1].configuration).toMatchObject({min:0,max:3,step:.001});expect(warnings.join()).toContain('原版标量转换规则');
  const frame=sceneAtTime(scene,0).evaluatedDomainScene!.parameterState;expect(frame.entries.find(e=>e.name==='x')!.configuration.max).toBe(Math.fround(Math.PI/2));
  expect(scene.provenance!.original).toMatchObject(raw);
 });
 it('inherits edge doubles without expression evaluation or easing-name normalization',()=>{
  const {scene}=read({settings:{...base.settings,param_edge_easing:{window:.7,floor:.1,easing:'QUAD_OUT'}},timeline:[clip([action('paramStart',{edgeEasing:{window:'PI/2',floor:'0x1p-2',easing:'linear'},parameters:{x:{edgeEasing:{window:'0.2',easing:'LINEAR'}},y:{}}})])]});
  const [x,y]=scene.timeline.tracks[0].actions![0].domainParameters!;
  expect(x.configuration!.edgeEasing).toEqual({window:.2,floor:.25,easing:'linear'});
  expect(y.configuration!.edgeEasing).toEqual({window:.7,floor:.25,easing:'quad-out'});
 });
 it('validates wrapper edge before branching, while named Stop ignores its entry ranges and edge',()=>{
  for(const method of ['paramStart','paramStop'])expect(()=>specs(method,{edgeEasing:null})).toThrow('应为对象');
  const args={parameters:{x:{min:[],max:'Infinity',step:{bad:true},edgeEasing:null}}};
  expect(specs('paramStop',args)).toEqual([{model:'domain-registry-1.7.8',scope:{kind:'named',name:'x'}}]);
  expect(imported('paramStop',args).warnings.join()).toContain('尚未映射');
 });
 it('preserves exact names and special-setting precedence through save/reload and first positive update',()=>{
  const names=['a.b','a_b','aB','__proto__','constructor','\u00a0','\u0000',' scale ',''];
  const parameters=Object.fromEntries(names.map((name,i)=>[name,i+2]));
  Object.assign(parameters,{scale:99,phaseDensity:88});
  const config=Object.fromEntries([...names.map((name,i)=>[name,{min:i+20,max:i+20,step:0}]),['new-name',{min:7,max:7,step:0}],['scale',{min:2,max:2,step:0}],['phaseDensity',{min:5,max:5,step:0}]]);
  const {scene}=read({parameters,timeline:[clip([action('paramStart',{parameters:config})])]});
  expect(scene.parameters).toEqual(parameters);expect(Object.hasOwn(scene.parameters,'new-name')).toBe(false);
  // Display ordinal zero already executes the first native object update.
  const start=sceneAtTime(scene,0);expect(start.parameters['new-name']).toBe(7);
  const later=sceneAtTime(scene,.1);expect(later.parameters['a.b']).toBe(20);expect(later.parameters.__proto__).toBe(23);expect(Object.getPrototypeOf(later.parameters)).toBe(Object.prototype);
  expect(later.parameters['']).toBe(parameters['']);expect(later.parameters['\u00a0']).toBe(25);expect(later.parameters['\u0000']).toBe(26);expect(later.parameters[' scale ']).toBe(27);
  expect(later.settings.scale).toBe(2);expect(later.settings.phaseDensity).toBe(5);expect(later.parameters.scale).toBe(99);expect(later.parameters.phaseDensity).toBe(88);expect(later.parameters['new-name']).toBe(7);
  expect(sceneAtTime(parseScene(JSON.stringify(scene)),.1)).toEqual(later);expect(sceneAtTime(scene,0).parameters).toEqual(start.parameters);expect(scene.parameters).toEqual(parameters);
 });
 it('keeps a disabled-only named Stop from becoming StopAll',()=>{
  const {scene}=read({parameters:{x:0},timeline:[clip([action('paramStart',{parameters:{x:{min:-1,max:1,step:.01}}})],{duration:0}),clip([action('paramStop',{parameters:{x:{enable:false}}})]),{type:'wait',duration:2}]});
  expect(sceneAtTime(scene,2).evaluatedDomainScene!.parameterState.running).toBe(true);
  const all=structuredClone(scene);all.timeline.tracks[1].actions![0].domainParameters=[{model:'domain-registry-1.7.8',scope:{kind:'all'}}];
  expect(sceneAtTime(all,2).evaluatedDomainScene!.parameterState.running).toBe(false);
 });
 it('retains source duration fallback, exact easing lookup and unknown-type hold',()=>{
  const {scene}=read({timeline:[clip([]),clip([],{duration:'PI/2',easing:'linear'}),clip([],{duration:'',easing:'LINEAR'}),{type:'wait',duration:'1e3+1',easing:{ignored:true}},{type:' param ',duration:2}]});
  expect(scene.timeline.tracks.map(t=>t.duration)).toEqual([1,Math.fround(Math.PI/2),0,1,2]);
  expect(scene.timeline.tracks.map(t=>t.easing)).toEqual(['sine-in-out','sine-in-out','linear','sine-in-out','sine-in-out']);expect(scene.timeline.tracks[4].type).toBe('wait');
  expect(parseScene(JSON.stringify(scene)).timeline).toEqual(scene.timeline);
 });
 it('skips disabled clips before parsing their invalid fields; other malformed clip/action fields fail',()=>{
  expect(read({timeline:[{enabled:'FALSE',type:[],duration:'Infinity',actions:null},clip([])]}).scene.timeline.tracks).toHaveLength(1);
  for(const raw of [{enabled:0,type:'wait'},{type:null},{type:'animate',actions:null},{type:'animate',actions:[null]},{type:'animate',actions:[{}]},{type:'animate',actions:[{method:3}]}])expect(()=>read({timeline:[raw]})).toThrow();
 });
 it('uses a base group when actions are absent and preserves source-ignored methods',()=>{
  const raw={timeline:[{type:'animate'},clip([action('zoom',[2]),action('ParamStart',{})]),{type:'align',target_theta:40}]};
  const {scene,warnings}=read(raw);expect(scene.timeline.tracks).toHaveLength(3);expect(scene.timeline.tracks[0].actions).toEqual([]);expect(scene.timeline.tracks[1].actions).toEqual([]);expect(scene.timeline.tracks[2].type).toBe('wait');expect(warnings.join()).toContain('原版域着色不执行');expect(scene.provenance!.original).toMatchObject(raw);
 });
 it('reports successful nonfinite conversions and local float capacity instead of calling them source fallback',()=>{
  expect(()=>specs('paramStart',{parameters:{x:{step:'Infinity'}}})).toThrow('原版标量转换结果');
  expect(()=>specs('paramStart',{parameters:{x:{step:1e100}}})).toThrow('超出可表示范围');
  expect(()=>read({timeline:[{type:'wait',duration:'Infinity'}]})).toThrow('原版标量转换结果');
 });
 it('preserves 128 named operations in one action rather than expanding past the 64-action limit',()=>{
  const parameters=Object.fromEntries(Array.from({length:128},(_,i)=>['x'+i,{}]));
  const {scene}=imported('paramStart',{parameters});expect(scene.timeline.tracks[0].actions).toHaveLength(1);expect(scene.timeline.tracks[0].actions![0].domainParameters).toHaveLength(128);expect(parseScene(JSON.stringify(scene))).toEqual(scene);
  parameters.extra={};expect(()=>specs('paramStart',{parameters})).toThrow('128');
 });
 it('uses source scalar fallback for formula parameters and preserves their original text',()=>{
  const parameters={x:'bad + value(',y:'PI/2',z:'1e3',t:'1e3+1'};const {scene}=read({parameters});expect(scene.parameters).toEqual({x:0,y:Math.PI/2,z:1000,t:0});expect(scene.provenance!.original).toMatchObject({parameters});
 });
 it('applies the shared whole-timeline operation capacity before accepting source data',()=>{
  const parameters=Object.fromEntries(Array.from({length:128},(_,i)=>['x'+i,{}]));
  const operation=action('paramStart',{parameters});
  expect(read({timeline:[clip(Array.from({length:31},()=>operation))]}).scene.timeline.tracks[0].actions).toHaveLength(31);
  expect(()=>read({timeline:[clip(Array.from({length:32},()=>operation))]})).toThrow('4096');
 });
 it('honors the different Object scalar overload for rotation and ignores extra arguments',()=>{
  const {scene}=read({timeline:[clip([action('domainRotate',['1e3',100]),action('domainRotate',[1000]),action('domainRotate',['PI/2']),action('domainRotate',{speed:5}),action('gradientStop',{ignored:true})])]});
  expect(scene.timeline.tracks[0].actions!.map(a=>a.args)).toEqual([{speed:0},{speed:1000},{speed:Math.PI/2},{speed:0},{}]);
 });
 it('imports source gradient wrappers/defaults with direct-only speed and tolerant flags',()=>{
  const {scene}=read({timeline:[clip([action('gradientStart'),action('gradientStart',{mode:' offset_cycle ',speed:'PI/2',interpolation:' linear ',affectInside:'FALSE',affectOutside:1}),action('gradientStart',[{mode:'unknown',speed:-4,interpolation:null,affectInside:' false '}])])]});
  expect(scene.timeline.tracks[0].actions!.map(a=>a.gradient)).toEqual([
   {model:'offsets',mode:'hue_rotate',speed:60,interpolation:'oklab',affectInside:true,affectOutside:true},
   {model:'offsets',mode:'offset_cycle',speed:60,interpolation:'linear',affectInside:false,affectOutside:true},
   {model:'offsets',mode:'hue_rotate',speed:0,interpolation:'oklab',affectInside:true,affectOutside:true},
  ]);
 });
});
