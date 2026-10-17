import {describe,expect,it} from 'vitest';
import {DOMAIN_SOURCE_SCALAR_LIMITS,parseDomainSourceDouble,prepareDomainSourceScalar,prepareDomainSourceObjectScalar} from '../src/engine/domainSourceScalar';

const scalar=(raw:unknown,fallback=7,precision:'float64'|'float32'='float64')=>{
 const result=prepareDomainSourceScalar(raw,{fallback,precision});
 if(!result.ok)throw new Error(JSON.stringify(result.error));
 return result.facts;
};

describe('source Domain scalar conversion, reconstructed from 1.7.8 bytecode',()=>{
 it('separates Java direct literals, the source expression parser and a failed expression',()=>{
  expect(scalar('1e3')).toMatchObject({route:'direct',value:1000});
  expect(scalar('1e3+1')).toMatchObject({route:'fallback',value:7,fallbackReason:'invalid-expression'});
  expect(scalar('1e+1')).toMatchObject({route:'direct',value:10});
  expect(scalar('1e +1')).toMatchObject({route:'expression',value:Math.E+1});
  expect(scalar('PI/2')).toMatchObject({route:'expression',value:Math.PI/2});
  for(const raw of [undefined,null,true,{},[]])expect(scalar(raw).route).toBe('fallback');
 });
 it.each([
  ['1',1],[' +.5D ',.5],['-1.e2f',-100],['\u0000\t1\r\u001f',1],['-0',-0],['+Infinity',Infinity],['-Infinity',-Infinity],['NaN',NaN],['-NaN',NaN],
  ['0x1p0',1],['-0X.8P1F',-1],['0x1.fffffffffffffp1023',Number.MAX_VALUE],['0x1.fffffffffffff8p1023',Infinity],
  ['0x0.0000000000001p-1022',Number.MIN_VALUE],['0x1p-1075',0],['-0x1p-1075',-0],['0x3p-1075',2*Number.MIN_VALUE],
  ['0x1.00000000000008p0',1],['0x1.00000000000018p0',1+2**-51],['0x1p99999999999999',Infinity],['0x0p99999999999999',0],
 ] as const)('accepts the Java literal %s without expression evaluation',(text,value)=>{
  const result=parseDomainSourceDouble(text);expect(result.ok).toBe(true);if(result.ok)expect(Object.is(result.value,value)).toBe(true);
  expect(scalar(text).route).toBe('direct');expect(Object.is(scalar(text).value,value)).toBe(true);
 });
 it.each(['',' ','0x10','1_000','nan','infinity','Infinityf','1e','1e3+1','\u00a01','1\u00a0','PI','2**3'])('does not widen Java direct grammar for %j',text=>{
  expect(parseDomainSourceDouble(text)).toEqual({ok:false,error:{kind:'invalid-literal'}});
 });
 it.each([
  ['-2^2',-4],['(-2)^2',4],['2^3^2',512],['2^-2',.25],['2/3pi',2/3*Math.PI],['2(3+4)',14],['PI(2)',Math.PI*2],
  ['2 3',6],['5%3',2],['-5%3',-2],['|-3|',3],['||-2||',2],['tau+HALF_PI',2.5*Math.PI],['e',Math.E],
  ['sin(PI/2)',1],['ARCSIN(1)',Math.PI/2],['arccos(1)',0],['arctan(0)',0],['log(E)',1],['ln(E)',1],['log10(100)',2],
  ['min(3,2,-1)',-1],['max(-1,2,3)',3],['atan2(0,-1)',Math.PI],['pow(2,3)',8],['sqrt(4)',2],['exp(0)',1],
  ['sinh(0)',0],['cosh(0)',1],['tanh(0)',0],['tan(0)',0],['floor(-.1)',-1],['ceil(.1)',1],['abs(-2)',2],['sign(-2)',-1],
 ] as const)('preserves source operator/function semantics for %s',(text,value)=>{
  expect(scalar(text)).toMatchObject({route:'expression',value});
 });
 it('preserves unusual source arity and lazy argument evaluation',()=>{
  for(const text of ['min(3)','max(3)','pow(3)','atan2(3)'])expect(scalar(text)).toMatchObject({route:'expression',value:0});
  for(const text of ['sin()','min()','pow()','sin(0,missing)'])expect(scalar(text).route).toBe('fallback');
  expect(scalar('sin(0,sqrt())')).toMatchObject({route:'expression',value:0});
  expect(scalar('pow(2,3,sqrt())')).toMatchObject({route:'expression',value:8});
  expect(scalar('min(2,3,sqrt())').route).toBe('fallback');
 });
 it('matches Java round-to-long saturation and zero rather than JavaScript zero/Infinity',()=>{
  const cases:[string,number][]=[['round(-.1)',0],['round(-.5)',0],['round(-1.5)',-1],['round(.5)',1],['round(.49999999999999994)',0],['round(0/0)',0],['round(1/0)',2**63],['round(-1/0)',-(2**63)]];
  for(const [raw,value] of cases){const facts=scalar(raw);expect(facts.route).toBe('expression');expect(Object.is(facts.value,value)).toBe(true);}
 });
 it('uses Java trim only for the empty check and only ASCII space within expressions',()=>{
  for(const text of ['',' \t\r\n\u0000'])expect(scalar(text)).toMatchObject({route:'expression',value:0});
  for(const text of ['sin (0)','\tPI','PI\t','1\t+2','2|3|','sqrt[4]','atanh(0)','a+1','1e3+1','1f+1'])expect(scalar(text).route).toBe('fallback');
  expect(scalar('sin( 0 )').value).toBe(0);
 });
 it('retains the source Unicode replacement fast path, including its middle-dot asymmetry',()=>{
  expect(scalar('−2＋3×（4÷2）').value).toBe(4);
  expect(scalar('2·3').value).toBe(6);
  expect(scalar('2⋅3').route).toBe('fallback');
  expect(scalar('π⋅2').value).toBe(Math.PI*2);
  expect(scalar('［2］').route).toBe('fallback');
 });
 it('does not reinterpret successful nonfinite results as a fallback',()=>{
  for(const raw of [Infinity,'1e999','1/0'])expect(scalar(raw)).toMatchObject({value:Infinity,classification:'positive-infinity'});
  for(const raw of [NaN,'NaN','0/0','sqrt(-1)']){const facts=scalar(raw);expect(facts.classification).toBe('nan');expect(facts.route).not.toBe('fallback');expect(Number.isNaN(facts.value)).toBe(true);}
  const overflow=scalar('3.4028236e38',0,'float32');expect(overflow.parsedValue).toBe(3.4028236e38);expect(overflow.value).toBe(Infinity);expect(overflow.classification).toBe('positive-infinity');
 });
 it('preserves raw input, omission, source default and the requested one final f32 conversion',()=>{
  const raw=' 0.10000000000000001 ';expect(scalar(raw)).toMatchObject({raw,parsedValue:.1,value:.1,precision:'float64'});
  expect(scalar(raw,0,'float32')).toMatchObject({raw,parsedValue:.1,value:Math.fround(.1),precision:'float32'});
  expect(scalar(undefined,Math.fround(.1))).toMatchObject({raw:undefined,route:'fallback',value:Math.fround(.1),fallbackReason:'missing'});
  const object={unsupported:true};expect(scalar(object).raw).toBe(object);
  expect(Object.is(scalar('-0',0,'float32').value,-0)).toBe(true);
 });
 it('returns explicit local capacity failures rather than source defaults or stack overflow',()=>{
  const huge='1'.repeat(DOMAIN_SOURCE_SCALAR_LIMITS.characters+1);
  expect(prepareDomainSourceScalar(huge,{fallback:7,precision:'float64'})).toEqual({ok:false,error:{kind:'capacity',resource:'characters',limit:65536,actual:65537}});
  expect(parseDomainSourceDouble(huge)).toEqual({ok:false,error:{kind:'capacity',resource:'characters',limit:65536,actual:65537}});
  const nested='('.repeat(128)+'1'+')'.repeat(128);expect(prepareDomainSourceScalar(nested,{fallback:7,precision:'float64'})).toMatchObject({ok:false,error:{kind:'capacity',resource:'depth'}});
  const long=Array(4096).fill('1').join('+');expect(scalar(long).value).toBe(4096);
  expect(prepareDomainSourceScalar(long+'+1',{fallback:7,precision:'float64'})).toMatchObject({ok:false,error:{kind:'capacity',resource:'nodes'}});
 });
 it('keeps the Object/JSONArray overload distinct while sharing expression semantics',()=>{
  const object=(raw:unknown,precision:'float64'|'float32'='float64')=>{
   const result=prepareDomainSourceObjectScalar(raw,{fallback:7,precision});
   if(!result.ok)throw new Error(JSON.stringify(result.error));return result.facts;
  };
  expect(object(1000)).toMatchObject({raw:1000,route:'direct',value:1000});
  for(const raw of ['1e3','NaN','Infinity','0x1p0','1f'])expect(object(raw)).toMatchObject({raw,route:'fallback',value:7,fallbackReason:'invalid-expression'});
  expect(object('1e+1')).toMatchObject({route:'expression',value:Math.E+1});
  for(const [raw,value] of [['PI/2',Math.PI/2],['2^3',8],['1.25',1.25],[' \t\r',0]] as const)expect(object(raw)).toMatchObject({raw,route:'expression',value});
  for(const raw of [undefined,null,true,[],{}])expect(object(raw)).toMatchObject({raw,route:'fallback',value:7});
  expect(object(Infinity)).toMatchObject({route:'direct',value:Infinity,classification:'positive-infinity'});
  expect(object('1/0')).toMatchObject({route:'expression',value:Infinity,classification:'positive-infinity'});
  expect(object(NaN)).toMatchObject({route:'direct',classification:'nan'});
  expect(object('0/0')).toMatchObject({route:'expression',classification:'nan'});
  expect(object('.1','float32')).toMatchObject({route:'expression',parsedValue:.1,value:Math.fround(.1)});
  expect(Object.is(object('-0').value,-0)).toBe(true);
  for(const raw of ['1'.repeat(65537),'('.repeat(128)+'1'+')'.repeat(128),Array(4097).fill('1').join('+')])expect(prepareDomainSourceObjectScalar(raw,{fallback:7,precision:'float64'})).toMatchObject({ok:false,error:{kind:'capacity'}});
 });
});
