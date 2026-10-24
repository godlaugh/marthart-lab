import {prepareDomainSourceScalar,parseDomainSourceDouble,DOMAIN_SOURCE_SCALAR_LIMITS} from './domainSourceScalar';
import {prepareRootsSourceJsonInt,prepareRootsSourceJsonLong,prepareRootsSourceJsonString,parseRootsSignedLongText} from './rootsSourceOrder';
import {javaTrim,javaEqualsIgnoreCaseAscii} from './sourceJavaText';

export const SOURCE_BOUNCING_MODEL='bouncing-initialization-1.7.8' as const;
export const SOURCE_BOUNCING_POSITION_MODES=['BOX','CIRCLE','HEART','INFINITY','RING','SPIRAL','STAR','LISSAJOUS','ROSE','SUPERELLIPSE','HYPOCYCLOID','EPICYCLOID','ARCHIMEDEAN_SPIRAL','FORMULA'] as const;
export type SourceBouncingInitialPositionMode=typeof SOURCE_BOUNCING_POSITION_MODES[number];
export type SourceBouncingVelocityMode='UNIFORM'|'RADIAL_OUT'|'RADIAL_IN'|'TANGENTIAL_CW'|'TANGENTIAL_CCW'|'RANDOM';
export interface SourceBouncingConfiguration {
 model:typeof SOURCE_BOUNCING_MODEL;settingsPresence:'absent'|'object';polygonSource:'default'|'root'|'settings';
 particleCount:number;seed:string;subSteps:number;timeStep:number;particleRadius:number;
 containerShape:'POLYGON'|'CIRCLE'|'ELLIPSE';circleCenterX:number;circleCenterY:number;circleRadius:number;
 ellipseSemiMajorAxis:number;ellipseSemiMinorAxis:number;boundaryCenterX:number;boundaryCenterY:number;polygonVertices:number[];
 initialPositionMode:SourceBouncingInitialPositionMode;initialCircleCenterX:number;initialCircleCenterY:number;initialCircleRadius:number;
 initialXMin:number;initialXMax:number;initialYMin:number;initialYMax:number;
 initialSpeed:number;initialVelocityMode:SourceBouncingVelocityMode;velocityCenterX:number;velocityCenterY:number;velocityNoise:number;initialAngle:number;initialAngleSpread:number;
 shapeInnerRatio:number;shapeNumPoints:number;shapeNumTurns:number;shapeTightness:number;shapeLissajousA:number;shapeLissajousB:number;shapeLissajousDelta:number;shapeRoseK:number;shapeSuperellipseN:number;shapeK:number;shapeFillMode:'FILL'|'OUTLINE';shapeLineWidth:number;shapeFormula:string;
}
export type SourceBouncingError={kind:'input'|'capacity'|'nonfinite'|'cancelled';path:readonly string[];reason:string};
export type SourceBouncingResult<T>={ok:true;value:T}|{ok:false;error:SourceBouncingError};
export interface SourceBouncingImportFacts {configuration:SourceBouncingConfiguration;consumedPaths:string[][];numericPaths:string[][];diagnostics:string[];}
export interface SourceBouncingImportOptions {numberToken?:(path:readonly string[])=>string|undefined;}
const F=Math.fround;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
class Failure extends Error {constructor(readonly detail:SourceBouncingError){super(detail.reason);}}
function fail(kind:SourceBouncingError['kind'],path:readonly string[],reason:string):never{throw new Failure({kind,path,reason});}
function attempt<T>(fn:()=>T):SourceBouncingResult<T>{try{return{ok:true,value:fn()};}catch(error){if(error instanceof Failure)return{ok:false,error:error.detail};throw error;}}
function finite(value:unknown,path:readonly string[]):number{if(typeof value!=='number')fail('input',path,'必须为数值');const n=F(value);if(!Number.isFinite(n))fail('nonfinite',path,'源初始化数值必须为有限 Float32');return n;}
export const SOURCE_BOUNCING_DEFAULT_POLYGON:readonly number[]=Object.freeze([-.95,-.5,-.38,-.88,.75,-.65,.95,.25,.28,.82,-.82,.58].map(F));
function defaults():SourceBouncingConfiguration{return{model:SOURCE_BOUNCING_MODEL,settingsPresence:'absent',polygonSource:'default',particleCount:200000,seed:'1',subSteps:2,timeStep:F(.012),particleRadius:F(.006),containerShape:'POLYGON',circleCenterX:0,circleCenterY:0,circleRadius:F(.95),ellipseSemiMajorAxis:F(.95),ellipseSemiMinorAxis:F(.55),boundaryCenterX:0,boundaryCenterY:0,polygonVertices:[...SOURCE_BOUNCING_DEFAULT_POLYGON],initialPositionMode:'BOX',initialCircleCenterX:0,initialCircleCenterY:0,initialCircleRadius:.25,initialXMin:F(-.45),initialXMax:F(.45),initialYMin:-.25,initialYMax:.25,initialSpeed:1,initialVelocityMode:'UNIFORM',velocityCenterX:0,velocityCenterY:0,velocityNoise:0,initialAngle:F(Math.PI/2),initialAngleSpread:0,shapeInnerRatio:F(.62),shapeNumPoints:5,shapeNumTurns:5.5,shapeTightness:F(.16),shapeLissajousA:3,shapeLissajousB:4,shapeLissajousDelta:F(Math.PI/2),shapeRoseK:3,shapeSuperellipseN:2,shapeK:4,shapeFillMode:'FILL',shapeLineWidth:F(.02),shapeFormula:''};}
const numericFields={particleCount:'particle_count',subSteps:'sub_steps',timeStep:'time_step',particleRadius:'particle_radius',circleCenterX:'circle_center_x',circleCenterY:'circle_center_y',circleRadius:'circle_radius',ellipseSemiMajorAxis:'ellipse_semi_major_axis',ellipseSemiMinorAxis:'ellipse_semi_minor_axis',boundaryCenterX:'boundary_center_x',boundaryCenterY:'boundary_center_y',initialCircleCenterX:'initial_circle_center_x',initialCircleCenterY:'initial_circle_center_y',initialCircleRadius:'initial_circle_radius',initialSpeed:'initial_speed',velocityCenterX:'velocity_center_x',velocityCenterY:'velocity_center_y',velocityNoise:'velocity_noise',initialAngle:'initial_angle',initialAngleSpread:'initial_angle_spread',initialXMin:'x0_min',initialXMax:'x0_max',initialYMin:'y0_min',initialYMax:'y0_max',shapeInnerRatio:'shape_inner_ratio',shapeNumPoints:'shape_num_points',shapeNumTurns:'shape_num_turns',shapeTightness:'shape_tightness',shapeLineWidth:'shape_line_width',shapeLissajousA:'shape_lissajous_a',shapeLissajousB:'shape_lissajous_b',shapeLissajousDelta:'shape_lissajous_delta',shapeRoseK:'shape_rose_k',shapeSuperellipseN:'shape_superellipse_n',shapeK:'shape_k'} as const;
type NumericKey=keyof typeof numericFields;
const integerMin:Partial<Record<NumericKey,number>>={particleCount:1,subSteps:1,shapeNumPoints:3,shapeLissajousA:1,shapeLissajousB:1,shapeRoseK:1,shapeK:2};
const ranges:Partial<Record<NumericKey,readonly[number,number]>>={timeStep:[F(.0001),F(.25)],particleRadius:[0,F(.25)],circleRadius:[F(.001),10],ellipseSemiMajorAxis:[F(.001),10],ellipseSemiMinorAxis:[F(.001),10],initialCircleRadius:[0,10],initialSpeed:[0,100],velocityNoise:[0,1],initialAngleSpread:[0,F(2*Math.PI)],shapeInnerRatio:[0,1],shapeTightness:[0,1],shapeNumTurns:[F(.1),Infinity],shapeLineWidth:[F(.001),Infinity],shapeSuperellipseN:[F(.01),Infinity]};
const velocities=['UNIFORM','RADIAL_OUT','RADIAL_IN','TANGENTIAL_CW','TANGENTIAL_CCW','RANDOM'] as const;
function textBudget(value:string,path:readonly string[]):string{if(value.length>DOMAIN_SOURCE_SCALAR_LIMITS.characters)fail('capacity',path,'初始化文本超过本地 65536 字符预算');return value;}
/** Initialization projection of JsonBouncingParticlesConfig only. Palette is
 * parsed before this projection in the native constructor; visual/camera fields
 * are owned separately. This does not assert whole-source-document validity.
 * Root settings omission returns before polygon parsing, as native PC10–27. */
export function importSourceBouncingConfig(rawRoot:unknown,options:SourceBouncingImportOptions={}):SourceBouncingResult<SourceBouncingImportFacts>{return attempt(()=>{
 const configuration=defaults(),consumedPaths:string[][]=[],numericPaths:string[][]=[],diagnostics:string[]=[];
 const facts=()=>({configuration,consumedPaths,numericPaths,diagnostics});
 if(rawRoot===null||rawRoot===undefined)return facts();if(!object(rawRoot))fail('input',[],'源配置必须为对象');
 if(!Object.hasOwn(rawRoot,'settings'))return facts();
 if(!object(rawRoot.settings))fail('input',['settings'],'源 settings 必须为对象');const settings=rawRoot.settings;configuration.settingsPresence='object';if(!Object.keys(settings).length)consumedPaths.push(['settings']);
 const read=(raw:Record<string,unknown>,key:string,path:readonly string[])=>{if(Object.hasOwn(raw,key)){consumedPaths.push([...path]);if(typeof raw[key]==='number')numericPaths.push([...path]);}return raw[key];};
 const text=(key:string,fallback:string)=>{const path=['settings',key],raw=read(settings,key,path),result=prepareRootsSourceJsonString(raw,fallback,options.numberToken?.(path));if(!result.ok)fail(result.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(result.error));if(result.value.status!=='known')fail('input',path,'源 Java 字符串转换尚无法确定：'+result.value.reason);return textBudget(result.value.value,path);};
 const scalar=(key:string,fallback:number)=>{const path=['settings',key],raw=read(settings,key,path);if(raw===undefined||raw===null)return fallback;const result=prepareDomainSourceScalar(raw,{fallback:0,precision:'float32'});if(!result.ok)fail('capacity',path,JSON.stringify(result.error));if(result.facts.route==='fallback')diagnostics.push(`${path.join('.')}: 源表达式解析失败，返回 0；原字段由调用者保留。`);return result.facts.value;};
 const integer=(key:string,fallback:number)=>{const path=['settings',key],raw=read(settings,key,path),result=prepareRootsSourceJsonInt(raw,fallback,options.numberToken?.(path));if(!result.ok)fail(result.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(result.error));if(result.value.route==='fallback'&&raw!==undefined)diagnostics.push(`${path.join('.')}: 按源 getInt(default) 使用默认值 ${fallback}。`);return result.value.value;};
 // Keep constructor ordering among initialization fields. Shape fields occur
 // after seed; unrelated visual/record/camera interpretation is not repeated.
 const beforeSeed=(Object.keys(numericFields) as NumericKey[]).filter(key=>!key.startsWith('shape'));
 const assignNumber=(key:NumericKey)=>{const rawKey=numericFields[key],minimum=integerMin[key];let value=minimum===undefined?scalar(rawKey,configuration[key]):integer(rawKey,configuration[key]);if(minimum!==undefined)value=Math.max(minimum,key==='subSteps'?Math.min(16,value):value);const bounds=ranges[key];if(bounds)value=Math.max(bounds[0],Math.min(bounds[1],value));configuration[key]=minimum===undefined?finite(value,['settings',rawKey]):value;};
 const enumText=(key:string,fallback:string,allowed:readonly string[])=>{const value=javaTrim(text(key,fallback)).toUpperCase();return allowed.includes(value)?value:fallback;};
 for(const key of beforeSeed){
  assignNumber(key);
  if(key==='particleRadius')configuration.containerShape=enumText('container_shape','POLYGON',['POLYGON','CIRCLE','ELLIPSE']) as SourceBouncingConfiguration['containerShape'];
  if(key==='boundaryCenterY')configuration.initialPositionMode=enumText('initial_position_mode','BOX',SOURCE_BOUNCING_POSITION_MODES) as SourceBouncingInitialPositionMode;
  if(key==='initialSpeed')configuration.initialVelocityMode=enumText('initial_velocity_mode','UNIFORM',velocities) as SourceBouncingVelocityMode;
 }
 if(Object.hasOwn(settings,'seed')){const path=['settings','seed'],raw=read(settings,'seed',path),result=prepareRootsSourceJsonLong(raw,1n,options.numberToken?.(path));if(!result.ok)fail(result.error.kind==='capacity'?'capacity':'input',path,JSON.stringify(result.error));if(result.value.route==='fallback')fail('input',path,'源 getLong(seed) 无默认回退，seed 必须可解析为 Java long');configuration.seed=result.value.canonicalText;}
 for(const key of Object.keys(numericFields) as NumericKey[])if(key.startsWith('shape')){assignNumber(key);if(key==='shapeTightness')configuration.shapeFillMode=javaEqualsIgnoreCaseAscii(text('shape_fill_mode','FILL'),'OUTLINE')?'OUTLINE':'FILL';}
 configuration.shapeFormula=text('shape_formula','');
 const parent=Object.hasOwn(rawRoot,'polygon')?rawRoot:Object.hasOwn(settings,'polygon')?settings:undefined;
 if(parent){configuration.polygonSource=parent===rawRoot?'root':'settings';const path=parent===rawRoot?['polygon']:['settings','polygon'],raw=read(parent,'polygon',path);if(!Array.isArray(raw))fail('input',path,'源 polygon 必须为数组');const vertices:number[]=[];
  const coordinate=(value:unknown,p:string[],fallback:boolean)=>{if(typeof value==='number'){numericPaths.push(p);return finite(value,p);}if(typeof value==='string'){const result=parseDomainSourceDouble(value);if(result.ok)return finite(result.value,p);if(result.error.kind==='capacity')fail('capacity',p,'多边形坐标超过解析容量');}if(fallback)return 0;return fail('input',p,'源数组坐标需要 Java double 字面量，不接受公式');};
  // Native caps examined input entries, not accepted vertices.
  for(let i=0;i<Math.min(64,raw.length);i++){const vertex=raw[i],p=[...path,String(i)];if(Array.isArray(vertex)&&vertex.length>=2){vertices.push(coordinate(vertex[0],[...p,'0'],false),coordinate(vertex[1],[...p,'1'],false));}else if(object(vertex)){vertices.push(coordinate(vertex.x,[...p,'x'],true),coordinate(vertex.y,[...p,'y'],true));}}
  if(vertices.length>=6)configuration.polygonVertices=vertices;
 }
 if(configuration.initialXMin>configuration.initialXMax)[configuration.initialXMin,configuration.initialXMax]=[configuration.initialXMax,configuration.initialXMin];if(configuration.initialYMin>configuration.initialYMax)[configuration.initialYMin,configuration.initialYMax]=[configuration.initialYMax,configuration.initialYMin];
 return facts();
});}
/** Canonical finite initialization facts: no aliases/defaulting or source re-read.
 * Float fields narrow once to binary32; source-clamped ranges are validated,
 * rather than silently repairing a malformed saved configuration. */
export function parseSourceBouncingConfiguration(raw:unknown):SourceBouncingResult<SourceBouncingConfiguration>{return attempt(()=>{
 if(!object(raw))fail('input',[],'初始化配置必须为对象');const result=defaults(),keys=Object.keys(result);if(Object.keys(raw).length!==keys.length||keys.some(key=>!Object.hasOwn(raw,key)))fail('input',[],'初始化配置字段缺失或包含未知字段');
 for(const key of Object.keys(numericFields) as NumericKey[]){const value=raw[key],minimum=integerMin[key];if(minimum!==undefined){if(typeof value!=='number'||!Number.isInteger(value)||value<minimum||value>(key==='subSteps'?16:2147483647))fail('input',[key],'必须处于源整数范围');result[key]=value;}else{result[key]=finite(value,[key]);const bounds=ranges[key];if(bounds&&(result[key]<bounds[0]||result[key]>bounds[1]))fail('input',[key],'超出源初始化范围');}}
 const enums={model:[SOURCE_BOUNCING_MODEL],settingsPresence:['absent','object'],polygonSource:['default','root','settings'],containerShape:['POLYGON','CIRCLE','ELLIPSE'],initialPositionMode:SOURCE_BOUNCING_POSITION_MODES,initialVelocityMode:velocities,shapeFillMode:['FILL','OUTLINE']} as const;
 for(const [key,allowed]of Object.entries(enums)){if(typeof raw[key]!=='string'||!(allowed as readonly string[]).includes(raw[key]))fail('input',[key],'未知初始化枚举');Object.assign(result,{[key]:raw[key]});}
 if(result.settingsPresence==='absent'&&result.polygonSource!=='default')fail('input',['polygonSource'],'settings 缺失时不读取 polygon');
 if(typeof raw.seed!=='string')fail('input',['seed'],'种子必须为带符号 64 位整数文本');const seed=parseRootsSignedLongText(raw.seed);if(!seed.ok)fail(seed.error.kind==='capacity'?'capacity':'input',['seed'],JSON.stringify(seed.error));result.seed=seed.value.toString();
 if(typeof raw.shapeFormula!=='string')fail('input',['shapeFormula'],'形状公式必须为字符串');result.shapeFormula=textBudget(raw.shapeFormula,['shapeFormula']);
 if(!Array.isArray(raw.polygonVertices)||raw.polygonVertices.length<6||raw.polygonVertices.length>128||raw.polygonVertices.length%2!==0)fail('input',['polygonVertices'],'多边形需要 3–64 个平面顶点');result.polygonVertices=raw.polygonVertices.map((value,index)=>finite(value,['polygonVertices',String(index)]));
 if(result.initialXMin>result.initialXMax||result.initialYMin>result.initialYMax)fail('input',['initialXMin'],'规范初始范围必须有序');return result;
});}
