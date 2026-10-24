/** MathArt 1.7.8 GradientPaletteSupportKt's discrete palette generators.
 * Authored state, generated RGB strings and renderer sampling have separate
 * owners. These operations never modify the caller's state or palette. */
export type SourceGeneratorTriple=[number,number,number];
export interface SourceCosinePaletteState {colorCount:number;a:SourceGeneratorTriple;b:SourceGeneratorTriple;c:SourceGeneratorTriple;d:SourceGeneratorTriple;}
export interface SourceCurvePoint {id:string;x:number;y:number;}
export interface SourceCurvePaletteState {colorCount:number;red:SourceCurvePoint[];green:SourceCurvePoint[];blue:SourceCurvePoint[];}
export type SourceGradientPaletteMode='manual'|'cosine'|'curve';
/** User actions remain distinct: editing an imported Curve must not silently
 * change independently authored renderer flags. */
export type SourceGradientPaletteCommit={kind:'mode'|'change'|'bake';colors:string[]} & (
 {mode:'cosine';state:SourceCosinePaletteState}|{mode:'curve';state:SourceCurvePaletteState});
export type SourcePaletteGenerationResult<T>={ok:true;value:T}|{ok:false;error:{kind:'input'|'capacity'|'random';path:string;reason:string}};
export interface SourcePaletteRandom {nextDouble(from:number,until:number):number;nextFloat():number;nextInt(from:number,until:number):number;}
export const SOURCE_GENERATOR_POINT_BUDGET=65_536;
const F=Math.fround;
const clamp=(x:number,min=0,max=1)=>x<min?min:x>max?max:x;
class Failure extends Error {constructor(readonly kind:'input'|'capacity'|'random',readonly path:string,reason:string){super(reason);}}
function attempt<T>(operation:()=>T):SourcePaletteGenerationResult<T>{try{return{ok:true,value:operation()};}catch(e){if(e instanceof Failure)return{ok:false,error:{kind:e.kind,path:e.path,reason:e.message}};throw e;}}
function object(value:unknown,path:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Failure('input',path,'Expected an object');return value as Record<string,unknown>;}
function scalar(value:unknown,path:string):number{if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(F(value)))throw new Failure('input',path,'Expected a finite Float32 number');return F(value);}
function integer(value:unknown,path:string):number{if(typeof value!=='number'||!Number.isInteger(value)||value< -2147483648||value>2147483647)throw new Failure('input',path,'Expected a signed 32-bit integer');return value;}
const point=(x:number,y:number):SourceCurvePoint=>({id:crypto.randomUUID(),x,y});
export const defaultSourceCosinePalette=():SourceCosinePaletteState=>({colorCount:8,a:[.5,.5,.5],b:[.5,.5,.5],c:[1,1,1],d:[0,F(.333),F(.667)]});
export const defaultSourceCurvePalette=():SourceCurvePaletteState=>({colorCount:8,red:[point(0,0),point(1,1)],green:[point(0,0),point(1,1)],blue:[point(0,0),point(1,1)]});

function cosineState(value:unknown):SourceCosinePaletteState {
 const input=object(value,'cosine'),defaults=defaultSourceCosinePalette(),out={colorCount:clamp(integer(input.colorCount,'colorCount'),2,25)} as SourceCosinePaletteState;
 for(const key of ['a','b','c','d'] as const){
  const vector=input[key];if(!Array.isArray(vector))throw new Failure('input',key,'Expected a vector array');
  out[key]=[0,1,2].map(i=>{const v=vector[i]===undefined||vector[i]===null?defaults[key][i]:scalar(vector[i],`${key}.${i}`);return key==='b'?clamp(v):key==='c'?clamp(v,.5,3):v;}) as SourceGeneratorTriple;
 }
 return out;
}
// Float.compare orders -0 before +0; JS subtraction alone does not. Stable
// order of equal x is significant at duplicate knots.
const compareX=(a:SourceCurvePoint,b:SourceCurvePoint)=>a.x<b.x?-1:a.x>b.x?1:Object.is(a.x,b.x)?0:Object.is(a.x,-0)?-1:1;
function normalizedPoints(input:unknown,path:string,budget:{points:number;text:number}):SourceCurvePoint[]{
 if(!Array.isArray(input))throw new Failure('input',path,'Expected a curve point array');
 budget.points+=input.length;
 // Normalization may add two endpoints per channel; account for them before
 // allocating. This is a local resource budget, not an original point limit.
 if(budget.points+6>SOURCE_GENERATOR_POINT_BUDGET)throw new Failure('capacity',path,'Curve normalization exceeds the local 65536-point budget');
 const points=input.map((raw,i)=>{
  const p=object(raw,`${path}.${i}`);
  if(typeof p.id!=='string')throw new Failure('input',`${path}.${i}.id`,'Expected a point identity string');
  budget.text+=p.id.length*2;if(budget.text>1_048_576)throw new Failure('capacity',path,'Curve identities exceed the local 1 MiB UTF-16 text budget');
  return{id:p.id,x:clamp(scalar(p.x,`${path}.${i}.x`)),y:clamp(scalar(p.y,`${path}.${i}.y`))};
 }).sort(compareX);
 if(!points.length)return[point(0,0),point(1,1)];
 if(points[0].x>0)points.unshift(point(0,points[0].y));else points[0]={...points[0],x:0};
 const last=points.length-1;
 if(points[last].x<1)points.push(point(1,points[last].y));else points[last]={...points[last],x:1};
 return points.sort(compareX);
}
function curveState(value:unknown):SourceCurvePaletteState {
 const input=object(value,'curve'),budget={points:0,text:0};
 return{colorCount:clamp(integer(input.colorCount,'colorCount'),2,25),red:normalizedPoints(input.red,'red',budget),green:normalizedPoints(input.green,'green',budget),blue:normalizedPoints(input.blue,'blue',budget)};
}
export const normalizeSourceCosinePalette=(input:unknown)=>attempt(()=>cosineState(input));
export const normalizeSourceCurvePalette=(input:unknown)=>attempt(()=>curveState(input));
export function sourceCosineAmplitudeLimit(a:number):number{return clamp(Math.min(F(a),F(1-F(a))),0,.5);}
function byte(value:number):number{return clamp(Math.floor(F(clamp(value)*255)+.5),0,255);}
function cosineChannel(a:number,b:number,c:number,d:number,t:number):number{return byte(F(a+F(b*F(Math.cos(2*Math.PI*F(F(c*t)+d))))));}
/** Prepared sorted points; no repeated sorting/copying for each output color. */
export function sampleSourcePaletteCurve(points:readonly SourceCurvePoint[],t:number):number {
 t=F(t);
 if(!points.length)return 0;if(points.length===1||t<=points[0].x)return points[0].y;
 if(t>=points[points.length-1].x)return points[points.length-1].y;
 for(let i=0;i<points.length-1;i++){
  const a=points[i],b=points[i+1];if(t<a.x||t>b.x)continue;
  if(a.x===b.x)return a.y;
  const u=F(F(t-a.x)/F(b.x-a.x));return F(a.y+F(F(b.y-a.y)*u));
 }
 return 0;
}
function count(value:unknown,maxStops:number):number {
 const maximum=integer(maxStops,'maxStops');if(maximum<2)throw new Failure('input','maxStops','The palette maximum must be at least two');
 return clamp(clamp(integer(object(value,'state').colorCount,'colorCount'),2,maximum),2,25);
}
const hex=(rgb:number[])=>'#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
export function generateSourceCosinePalette(input:unknown,maxStops=25):SourcePaletteGenerationResult<string[]>{return attempt(()=>{
 const n=count(input,maxStops),s=cosineState(input);
 return Array.from({length:n},(_,i)=>hex([0,1,2].map(c=>cosineChannel(s.a[c],s.b[c],s.c[c],s.d[c],F(i/(n-1))))));
});}
export function generateSourceCurvePalette(input:unknown,maxStops=25):SourcePaletteGenerationResult<string[]>{return attempt(()=>{
 const n=count(input,maxStops),s=curveState(input);
 return Array.from({length:n},(_,i)=>hex([s.red,s.green,s.blue].map(points=>byte(sampleSourcePaletteCurve(points,F(i/(n-1)))))));
});}

function boundedDouble(from:number,until:number):number {
 const value=from+Math.random()*(until-from);if(value<until)return value;
 // All source generator ranges have positive finite upper bounds. Kotlin's
 // bounded nextDouble uses the preceding double when addition rounds upward.
 const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,until);bits.setBigUint64(0,bits.getBigUint64(0)-1n);return bits.getFloat64(0);
}
const defaultRandom:SourcePaletteRandom={
 nextDouble:boundedDouble,
 nextFloat:()=>Math.floor(Math.random()*16_777_216)/16_777_216,
 nextInt:(from,until)=>from+Math.floor(Math.random()*(until-from)),
};
function draws(random:SourcePaletteRandom):SourcePaletteRandom {
 const check=(n:number,from:number,until:number)=>{if(!Number.isFinite(n)||n<from||n>=until)throw new Failure('random','random','Random value is outside its requested range');return n;};
 return{nextDouble:(from,until)=>check(random.nextDouble(from,until),from,until),nextFloat:()=>{const n=check(random.nextFloat(),0,1);if(F(n)!==n)throw new Failure('random','random','Expected an exactly representable Float32 draw');return n;},nextInt:(from,until)=>{const n=check(random.nextInt(from,until),from,until);if(!Number.isInteger(n))throw new Failure('random','random','Expected an integer draw');return n;}};
}
export function randomizeSourceCosinePalette(input:unknown,random:SourcePaletteRandom=defaultRandom):SourcePaletteGenerationResult<SourceCosinePaletteState>{return attempt(()=>{
 const colorCount=clamp(integer(object(input,'cosine').colorCount,'colorCount'),2,25),r=draws(random),s=defaultSourceCosinePalette();s.colorCount=colorCount;
 for(let i=0;i<3;i++){s.a[i]=F(r.nextDouble(.2,.8));s.b[i]=F(sourceCosineAmplitudeLimit(s.a[i])*r.nextDouble(.45,1));s.c[i]=F(r.nextDouble(.5,3));s.d[i]=r.nextFloat();}
 return s;
});}
export function randomizeSourceCurvePalette(input:unknown,random:SourcePaletteRandom=defaultRandom):SourcePaletteGenerationResult<SourceCurvePaletteState>{return attempt(()=>{
 const colorCount=clamp(integer(object(input,'curve').colorCount,'colorCount'),2,25),r=draws(random);
 const channel=()=>{const points=[point(0,r.nextFloat())],n=r.nextInt(2,7);for(let i=0;i<n;i++)points.push(point(r.nextFloat(),r.nextFloat()));points.push(point(1,r.nextFloat()));return points.sort(compareX);};
 return curveState({colorCount,red:channel(),green:channel(),blue:channel()});
});}
