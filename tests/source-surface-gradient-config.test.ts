import {describe,it,expect} from 'vitest';
import {importSourceSurfaceGradient,sourceSurfaceGradientPayload,SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS} from '../src/engine/sourceSurfaceGradientConfig';
import {parseSourceParticleGradientConfiguration,SOURCE_PARTICLE_GRADIENT_DEFAULT,SOURCE_PARTICLE_GRADIENT_MODES,SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS,SourceParticleGradientConfigurationError} from '../src/engine/sourceParticleGradientConfig';
import {SOURCE_JSON_LIMITS} from '../src/engine/sourceJson';

const config=(args:unknown)=>{const facts=importSourceSurfaceGradient(args);expect(facts.kind).toBe('start');if(facts.kind!=='start')throw new Error('not start');return facts.config;};

describe('canonical source Surface gradient configuration',()=>{
 it('normalizes optional model/flags without changing canonical numeric precision',()=>{
  for(const mode of SOURCE_PARTICLE_GRADIENT_MODES)for(const interpolation of SOURCE_PARTICLE_GRADIENT_INTERPOLATIONS){
   const raw={mode,interpolation,speed:1.234567890123},before={...raw};
   expect(parseSourceParticleGradientConfiguration(raw)).toEqual({...raw,model:'offsets',affectInside:true,affectOutside:true});
   expect(raw).toEqual(before);
  }
  expect(parseSourceParticleGradientConfiguration(SOURCE_PARTICLE_GRADIENT_DEFAULT)).toEqual(SOURCE_PARTICLE_GRADIENT_DEFAULT);
 });
 it.each([undefined,null,[],{}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,speed:'60'}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,speed:NaN}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,speed:Infinity}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,speed:-1}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,mode:'HUE_ROTATE'}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,interpolation:null}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,model:'palette'}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,affectInside:false}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,affectOutside:false}, {...SOURCE_PARTICLE_GRADIENT_DEFAULT,fromStops:['#000000']},Object.create(SOURCE_PARTICLE_GRADIENT_DEFAULT)].map(raw=>[raw]))('rejects malformed saved config rather than activating defaults: %j',raw=>{
  expect(()=>parseSourceParticleGradientConfiguration(raw)).toThrow(SourceParticleGradientConfigurationError);
 });
});

describe('retained JsonSurfaceConfig gradient import contract',()=>{
 it.each([undefined,null,7,true,'ignored',[],[null,{speed:19}],[0,{mode:'OFFSET_CYCLE',speed:5}],[[],{mode:'OFFSET_CYCLE'}]].map(args=>[args]))('uses defaults without scanning later slots: %j',args=>{
  expect(config(args)).toEqual(SOURCE_PARTICLE_GRADIENT_DEFAULT);
  expect(importSourceSurfaceGradient(args)).toMatchObject({payloadPath:null,payloadEmpty:false,consumedFields:[]});
 });
 it('retains direct versus first-slot payload paths and never mutates source values',()=>{
  const payload={mode:'OFFSET_CYCLE',speed:'0x1.8p4',unknown:{retained:true}},snapshot=structuredClone(payload);
  expect(sourceSurfaceGradientPayload(payload)).toEqual({value:payload,path:[]});
  expect(importSourceSurfaceGradient([payload,{speed:999}])).toMatchObject({kind:'start',payloadPath:['0'],payloadEmpty:false,consumedFields:SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS,config:{mode:'offset_cycle',speed:24}});
  expect(importSourceSurfaceGradient({})).toMatchObject({kind:'start',payloadPath:[],payloadEmpty:true});
  expect(importSourceSurfaceGradient([{}])).toMatchObject({kind:'start',payloadPath:['0'],payloadEmpty:true});
  expect(payload).toEqual(snapshot);
 });
 it.each(['FRACTAL','fractal','FrAcTaL'])('skips only exact untrimmed FRACTAL target %j before later config parsing',targetDomain=>{
  expect(importSourceSurfaceGradient([{targetDomain,speed:'1'.repeat(65537)}])).toMatchObject({kind:'skip',reason:'target-domain',payloadPath:['0'],consumedFields:['targetDomain']});
 });
 it.each([' FRACTAL ','FRACTAL\n','SURFACE','DOMAIN_COLORING','COMPLEX_ROOTS','', '\t\n', '\u2003',123,false,[],{},null,undefined].map(targetDomain=>[targetDomain]))('permits other target values using Processing string semantics: %j',targetDomain=>{
  expect(config({targetDomain})).toEqual(SOURCE_PARTICLE_GRADIENT_DEFAULT);
 });
 it('defaults Java blank names, uses Java trim, and discloses unavailable locale',()=>{
  expect(config({mode:'\u2003',interpolation:'\u2003'})).toEqual(SOURCE_PARTICLE_GRADIENT_DEFAULT);
  expect(config({mode:' \tOFFSET_CYCLE\n',interpolation:' RGB '})).toMatchObject({mode:'offset_cycle',interpolation:'rgb'});
  expect(importSourceSurfaceGradient({mode:'\u2003HUE_ROTATE\u2003'})).toMatchObject({kind:'skip',reason:'unknown-mode'});
  expect(importSourceSurfaceGradient({mode:'hue_rotate',interpolation:'linear'}).diagnostics.join('\n')).toContain('区域');
  expect(importSourceSurfaceGradient({mode:'HUE_ROTATE',interpolation:'LINEAR'}).diagnostics).toEqual([]);
 });
 it.each([123,true,false,{},[],['HUE_ROTATE'],'NONE'].map(mode=>[mode]))('skips unknown mode after source stringification: %j',mode=>{
  expect(importSourceSurfaceGradient({mode})).toMatchObject({kind:'skip',reason:'unknown-mode',payloadPath:[],consumedFields:SOURCE_SURFACE_GRADIENT_SOURCE_FIELDS});
 });
 it.each([123,true,false,{},[],['RGB'],'unknown'].map(interpolation=>[interpolation]))('defaults unknown interpolation after source stringification: %j',interpolation=>{
  expect(config({interpolation}).interpolation).toBe('oklab');
  expect(importSourceSurfaceGradient({interpolation}).diagnostics.join('\n')).toContain('采用 OKLAB');
 });
 it.each([[0,0],[-0,0],[-3,0],[1.234567890123,1.234567890123],['0x1.8p4',24],['1e3',1000],[' 12.5D ',12.5],['2*pi',60],['',60],['NaN',60],['Infinity',60],[NaN,60],[-Infinity,60],[null,60],[true,60],[{},60],[[2],60]])('parses finite Java Double literals and nonnegative source speed: %j',(speed,expected)=>{
  const result=config({speed});expect(result.speed).toBe(expected);
  if(expected===0)expect(Object.is(result.speed,-0)).toBe(false);
 });
 it('forces both flags, preserving diagnostics and raw payload',()=>{
  const raw={interpolation:'unknown',speed:'NaN',affectInside:false,affectOutside:{invalid:true}},snapshot=structuredClone(raw),facts=importSourceSurfaceGradient(raw);
  expect(facts).toMatchObject({kind:'start',config:SOURCE_PARTICLE_GRADIENT_DEFAULT});
  expect(facts.diagnostics.join('\n')).toContain('固定同时');expect(raw).toEqual(snapshot);
 });
 it('does not collapse capacity errors into malformed-input defaults or skipped modes',()=>{
  expect(()=>importSourceSurfaceGradient({speed:'1'.repeat(65537)})).toThrow('容量');
  expect(()=>importSourceSurfaceGradient({mode:'bad',speed:'1'.repeat(65537)})).toThrow('容量');
  expect(()=>importSourceSurfaceGradient({mode:'a'.repeat(SOURCE_JSON_LIMITS.characters+1)})).toThrow('容量');
 });
 it('does not examine ignored array slots, inherited fields or custom toString methods',()=>{
  const args:unknown[]=[{speed:3}];Object.defineProperty(args,1,{get(){throw new Error('ignored slot read');}});
  expect(config(args).speed).toBe(3);
  expect(config(Object.create({targetDomain:'FRACTAL',speed:99}))).toEqual(SOURCE_PARTICLE_GRADIENT_DEFAULT);
  expect(importSourceSurfaceGradient({mode:{toString(){throw new Error('not source JSON');}}})).toMatchObject({kind:'skip',reason:'unknown-mode'});
 });
});
