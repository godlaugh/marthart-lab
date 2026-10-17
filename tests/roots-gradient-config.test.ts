import {describe,it,expect} from 'vitest';
import {parseRootsGradientConfiguration,prepareRootsGradientImport,rootsGradientSourcePayload,ROOTS_GRADIENT_DEFAULT,ROOTS_GRADIENT_MODES,ROOTS_GRADIENT_INTERPOLATIONS,RootsGradientConfigurationError} from '../src/engine/rootsGradientConfig';
import {SOURCE_JSON_LIMITS} from '../src/engine/sourceJson';

const config=(args:unknown)=>{const facts=prepareRootsGradientImport(args);expect(facts.kind).toBe('start');if(facts.kind!=='start')throw new Error('not start');return facts.config;};
describe('Roots canonical gradient ownership',()=>{
 it('accepts all canonical choices and only the forced source region flags',()=>{
  for(const mode of ROOTS_GRADIENT_MODES)for(const interpolation of ROOTS_GRADIENT_INTERPOLATIONS){
   const raw={model:'offsets',mode,interpolation,speed:1.234567890123,affectInside:true,affectOutside:true};
   expect(parseRootsGradientConfiguration(raw)).toEqual({mode,interpolation,speed:raw.speed});
  }
 });
 it.each([undefined,null,[],{}, {...ROOTS_GRADIENT_DEFAULT,speed:'60'}, {...ROOTS_GRADIENT_DEFAULT,speed:NaN}, {...ROOTS_GRADIENT_DEFAULT,speed:Infinity}, {...ROOTS_GRADIENT_DEFAULT,speed:-1}, {...ROOTS_GRADIENT_DEFAULT,mode:'HUE_ROTATE'}, {...ROOTS_GRADIENT_DEFAULT,model:'palette'}, {...ROOTS_GRADIENT_DEFAULT,affectInside:false}, {...ROOTS_GRADIENT_DEFAULT,affectOutside:false}, {...ROOTS_GRADIENT_DEFAULT,fromStops:['#000000']}].map(raw=>[raw]))('does not default malformed or inactive local config %j',raw=>{
  expect(()=>parseRootsGradientConfiguration(raw)).toThrow(RootsGradientConfigurationError);
 });
 it('requires own canonical fields and never mutates raw input',()=>{
  expect(()=>parseRootsGradientConfiguration(Object.create(ROOTS_GRADIENT_DEFAULT))).toThrow();
  const raw={...ROOTS_GRADIENT_DEFAULT},before={...raw};const parsed=parseRootsGradientConfiguration(raw);
  expect(raw).toEqual(before);expect(parsed).not.toBe(raw);
 });
});
describe('retained JsonComplexRootsConfig gradient input',()=>{
 it.each([undefined,null,7,true,'ignored',[],[null,3,[],false]].map(args=>[args]))('uses source defaults when no object exists: %j',args=>{
  expect(config(args)).toEqual(ROOTS_GRADIENT_DEFAULT);expect(prepareRootsGradientImport(args).payloadPath).toBeNull();
 });
 it('selects the first object anywhere in args, with no invented3/64 positional limit',()=>{
  const args=[...Array(70).fill(null),{mode:'OFFSET_CYCLE',speed:17},{mode:'HUE_ROTATE',speed:999}];
  expect(rootsGradientSourcePayload(args)?.path).toEqual(['70']);expect(config(args)).toEqual({mode:'offset_cycle',interpolation:'oklab',speed:17});
  expect(config([{}, {speed:999}])).toEqual(ROOTS_GRADIENT_DEFAULT);
 });
 it.each(['COMPLEX_ROOTS',' complex_roots ','', ' \t\r\n ',null,undefined])('accepts the source targetDomain %j',targetDomain=>{
  expect(config({targetDomain})).toEqual(ROOTS_GRADIENT_DEFAULT);
 });
 it.each(['DOMAIN_COLORING','COMPLEXROOTS','\u2003',42,false,[],{}].map(targetDomain=>[targetDomain]))('skips unsupported targetDomain without parsing later config %j',targetDomain=>{
  expect(prepareRootsGradientImport({targetDomain,speed:'1'.repeat(65537)})).toMatchObject({kind:'skip',reason:'target-domain',consumedFields:['targetDomain']});
 });
 it('uses Java blank versus trim and records unavailable default-locale casing',()=>{
  expect(config({mode:'\u2003',interpolation:'\u2003'})).toEqual(ROOTS_GRADIENT_DEFAULT);
  expect(prepareRootsGradientImport({mode:'\u2003HUE_ROTATE\u2003'})).toMatchObject({kind:'skip',reason:'unknown-mode'});
  const lower=prepareRootsGradientImport({mode:'hue_rotate',interpolation:'linear'});
  expect(lower).toMatchObject({kind:'start',config:{mode:'hue_rotate',interpolation:'linear',speed:60}});expect(lower.diagnostics.join('\n')).toContain('区域');
  expect(prepareRootsGradientImport({mode:'HUE_ROTATE',interpolation:'LINEAR'}).diagnostics).toEqual([]);
 });
 it('skips unknown mode, defaults unknown interpolation, and still parses a rejected mode speed',()=>{
  expect(prepareRootsGradientImport({mode:'NONE'})).toMatchObject({kind:'skip',reason:'unknown-mode'});
  expect(prepareRootsGradientImport({mode:5})).toMatchObject({kind:'skip',reason:'unknown-mode'});
  expect(config({interpolation:'bad'}).interpolation).toBe('oklab');
  expect(()=>prepareRootsGradientImport({mode:'bad',speed:'1'.repeat(65537)})).toThrow('容量');
 });
 it.each([[0,0],[-0,0],[-12,0],[1.234567890123,1.234567890123],['0x1.8p3',12],['1e3',1000],[' 12.5D ',12.5],['2*pi',60],['',60],['NaN',60],['Infinity',60],[-Infinity,60],[null,60],[true,60],[{},60]])('uses Double literals, finite fallback and nonnegative clamp: %j', (raw,expected)=>{
  const result=config({speed:raw});expect(result.speed).toBe(expected);if(expected===0)expect(Object.is(result.speed,-0)).toBe(false);
 });
 it('forces region applicability after source parsing without advertising local switches',()=>{
  const facts=prepareRootsGradientImport({affectInside:false,affectOutside:{invalid:true}});
  expect(facts).toMatchObject({kind:'start',config:ROOTS_GRADIENT_DEFAULT});expect(facts.diagnostics.join('\n')).toContain('固定同时');
 });
 it('keeps source resource failure distinct from a default or skipped action',()=>{
  expect(()=>rootsGradientSourcePayload(new Array(SOURCE_JSON_LIMITS.nodes+1))).toThrow('容量');
  expect(()=>prepareRootsGradientImport({speed:'1'.repeat(65537)})).toThrow('容量');
 });
});
