import {describe,it,expect} from 'vitest';
import {defaultSourceCosinePalette,defaultSourceCurvePalette,generateSourceCosinePalette,generateSourceCurvePalette,normalizeSourceCosinePalette,normalizeSourceCurvePalette,randomizeSourceCosinePalette,randomizeSourceCurvePalette,sourceCosineAmplitudeLimit,SOURCE_GENERATOR_POINT_BUDGET,type SourcePaletteGenerationResult,type SourcePaletteRandom,type SourceCurvePaletteState,type SourceCosinePaletteState} from '../src/engine/sourceGradientPaletteGeneration';
import oracle from './fixtures/source-gradient-palette/oracle.json';
type FloatValue={text:string;bits:string};
type State={colorCount:number;[key:string]:unknown};
type Event={method:string;from?:number|FloatValue;until?:number|FloatValue;value:number|FloatValue};
interface Case {id:string;kind:string;input:State&{maxStops?:number;value?:FloatValue};output:{value?:FloatValue;constructed?:State;normalized?:State;randomized?:State;palette?:string[];constructError?:unknown;paletteError?:unknown;random?:{events:Event[]}};}
const decodeFloat=(v:FloatValue)=>{const b=new DataView(new ArrayBuffer(v.bits.length/2));if(v.bits.length===8){b.setUint32(0,parseInt(v.bits,16));return b.getFloat32(0);}b.setBigUint64(0,BigInt('0x'+v.bits));return b.getFloat64(0);};
const bits=(n:number)=>{const b=new DataView(new ArrayBuffer(4));b.setFloat32(0,n);return b.getUint32(0).toString(16).padStart(8,'0');};
function decode(value:unknown):unknown {if(Array.isArray(value))return value.map(decode);if(value&&typeof value==='object'){if('bits' in value)return decodeFloat(value as FloatValue);return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));}return value;}
function value<T>(r:SourcePaletteGenerationResult<T>):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
const channels=['red','green','blue'] as const;
function compare(actual:SourceCurvePaletteState|SourceCosinePaletteState,expected:State,input:State){
 expect(actual.colorCount).toBe(expected.colorCount);
 if('a' in actual){for(const key of ['a','b','c','d'] as const)expect(actual[key].map(bits)).toEqual((expected[key] as FloatValue[]).map(x=>x.bits));return;}
 const newIds:string[]=[];
 for(const key of channels){
  const old=new Set((input[key] as {id:string}[]|undefined)?.map(p=>p.id));
  const wanted=expected[key] as {id:string;x:FloatValue;y:FloatValue}[];
  expect(actual[key].map(p=>[bits(p.x),bits(p.y)])).toEqual(wanted.map(p=>[p.x.bits,p.y.bits]));
  actual[key].forEach((p,i)=>{if(old.has(wanted[i].id))expect(p.id).toBe(wanted[i].id);else{expect(old.has(p.id)).toBe(false);expect(p.id).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);newIds.push(p.id);}});
 }
 expect(new Set(newIds).size).toBe(newIds.length);
}
describe('actual MathArt 1.7.8 GradientPaletteSupportKt oracle',()=>{
 for(const c of oracle.cases as unknown as Case[])it(c.id,()=>{
  const o=c.output;if(c.kind==='upper'){expect(bits(sourceCosineAmplitudeLimit(decodeFloat(c.input.value!)))).toBe(o.value!.bits);return;}
  const cosine=c.kind==='cosine'||c.kind==='randomCosine',normalize=cosine?normalizeSourceCosinePalette:normalizeSourceCurvePalette,generate=cosine?generateSourceCosinePalette:generateSourceCurvePalette;
  const input=decode(o.constructed??c.input) as State,before=structuredClone(input);
  if(o.constructError){expect(normalize(input)).toMatchObject({ok:false,error:{kind:'input'}});expect(generate(input)).toMatchObject({ok:false,error:{kind:'input'}});return;}
  let generatedFrom:unknown=input;
  if(o.randomized){
   const events=o.random!.events.filter(e=>['nextDouble(DD)D','nextFloat()F','nextInt(II)I'].includes(e.method));let index=0;
   const next=(method:string,from?:number,until?:number)=>{const event=events[index++];expect(event?.method).toBe(method);if(from!==undefined){expect(decode(event.from)).toBe(from);expect(decode(event.until)).toBe(until);}return decode(event.value) as number;};
   const random:SourcePaletteRandom={nextDouble:(from,until)=>next('nextDouble(DD)D',from,until),nextFloat:()=>next('nextFloat()F'),nextInt:(from,until)=>next('nextInt(II)I',from,until)};
   const actual=value<SourceCosinePaletteState|SourceCurvePaletteState>(cosine?randomizeSourceCosinePalette(input,random):randomizeSourceCurvePalette(input,random));compare(actual,o.randomized,input);expect(index).toBe(events.length);generatedFrom=actual;
  }else compare(value<SourceCosinePaletteState|SourceCurvePaletteState>(normalize(input)),o.normalized!,input);
  if(o.paletteError)expect(generate(generatedFrom,c.input.maxStops)).toMatchObject({ok:false,error:{kind:'input',path:'maxStops'}});
  else expect(generate(generatedFrom,c.input.maxStops)).toEqual({ok:true,value:o.palette});
  expect(input).toEqual(before);
 });
});
it('rejects nonfinite inputs, allocation expansion and invalid RNG returns at their owners',()=>{
 const cosine=defaultSourceCosinePalette(),curve=defaultSourceCurvePalette();
 for(const bad of [NaN,Infinity,1e40])expect(generateSourceCosinePalette({...cosine,a:[bad,0,0]})).toMatchObject({ok:false,error:{kind:'input',path:'a.0'}});
 for(const bad of [NaN,1.5,2147483648])expect(generateSourceCurvePalette({...curve,colorCount:bad})).toMatchObject({ok:false,error:{kind:'input',path:'colorCount'}});
 expect(normalizeSourceCurvePalette({...curve,red:Array(SOURCE_GENERATOR_POINT_BUDGET).fill({id:'same',x:.5,y:.5})})).toMatchObject({ok:false,error:{kind:'capacity'}});
 expect(normalizeSourceCurvePalette({...curve,red:[{id:'x'.repeat(524_289),x:0,y:0}]})).toMatchObject({ok:false,error:{kind:'capacity'}});
 const random:SourcePaletteRandom={nextDouble:from=>from,nextFloat:()=>0,nextInt:from=>from};
 expect(randomizeSourceCosinePalette(cosine,{...random,nextDouble:(_from,until)=>until})).toMatchObject({ok:false,error:{kind:'random'}});
 for(const nextFloat of [()=>1,()=>NaN,()=>.1])expect(randomizeSourceCurvePalette(curve,{...random,nextFloat})).toMatchObject({ok:false,error:{kind:'random'}});
 expect(randomizeSourceCurvePalette(curve,{...random,nextInt:()=>2.5})).toMatchObject({ok:false,error:{kind:'random'}});
});
