import type {SceneDocument,Settings} from '../types';
import {existingParameterNameError} from './expression';
import {hasSymmetryCustom,prepareSymmetryCustomSource,symmetryCustomCompileDegree} from './symmetryCustom';
import {parameterTimelineReferences} from './sceneParameters';

/** Values remain exclusively in scene.parameters. This JSON only owns editing
 * and sampling bounds; it never constrains imported values or timeline ranges. */
export interface ParameterRange {readonly min:number;readonly max:number;readonly step:number;}
export type ParameterSamplingRanges=Readonly<Record<string,ParameterRange>>;
type ParameterScene=Pick<SceneDocument,'kind'|'parameters'|'settings'>&Partial<Pick<SceneDocument,'equations'>>;
const customSymmetry=(scene:ParameterScene)=>hasSymmetryCustom({kind:scene.kind,equations:scene.equations??{}});
export interface ParameterEditingSpec {name:string;value:number;range?:ParameterRange;rangeSource:'fixed'|'authored'|'default'|'none';editableRange:boolean;canDelete:boolean;displayDecimals?:number;customBinding?:'matched'|'unmatched'|'unknown';}
export const PARAMETER_RANGES_KEY='parameterRanges';
export const MAX_PARAMETER_RANGES=128;
export const MAX_PARAMETER_RANGE_JSON=32768;
const fixed:Readonly<Record<string,ParameterRange>>=Object.freeze(Object.fromEntries(Object.entries({lambda:3,alpha:3,beta:1.5,gamma:1,omega:1,delta:1}).map(([key,max])=>[key,Object.freeze({min:-max,max,step:.001})])));
const defaultRange:ParameterRange=Object.freeze({min:-3,max:3,step:.001});
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(obj:object,key:string)=>Object.hasOwn(obj,key);
function nameValid(name:string){if(name.length>100||existingParameterNameError(name,'samila'))throw new Error(`参数范围名称无效：${name}`);}
function range(value:unknown):ParameterRange {
 if(!object(value)||Object.keys(value).length!==3||!['min','max','step'].every(k=>own(value,k)))throw new Error('参数范围必须包含 min、max 和 step');
 const {min,max,step}=value;
 if(typeof min!=='number'||typeof max!=='number'||typeof step!=='number'||![min,max,step].every(Number.isFinite)||min>=max||!Number.isFinite(max-min)||step<=0||step>max-min||min+step===min||max-step===max)throw new Error('参数范围须有限、下限小于上限，步长为可表示的正数且不超过范围宽度');
 return Object.freeze({min,max,step});
}
/** Strict, single owner for the optional versioned serialization. Unknown keys,
 * orphan names and all stored ranges are checked; valid orphan data is retained. */
export function parseParameterRanges(settings:Settings):ParameterSamplingRanges {
 const raw=settings[PARAMETER_RANGES_KEY];if(raw===undefined)return Object.freeze({});
 if(typeof raw!=='string'||raw.length>MAX_PARAMETER_RANGE_JSON)throw new Error('参数范围 JSON 必须是最多 32768 字符的文本');
 let data:unknown;try{data=JSON.parse(raw);}catch{throw new Error('参数范围 JSON 无效');}
 if(!object(data)||data.version!==1||!own(data,'version')||Object.keys(data).length!==2||!own(data,'ranges')||!object(data.ranges))throw new Error('参数范围 JSON 需要 version:1 和 ranges 对象');
 const entries=Object.entries(data.ranges);if(entries.length>MAX_PARAMETER_RANGES)throw new Error('参数范围最多保存 128 项');
 const out:Record<string,ParameterRange>=Object.create(null);
 for(const [name,value]of entries){nameValid(name);out[name]=range(value);}
 return Object.freeze(out);
}
function rows(scene:ParameterScene):ParameterEditingSpec[]{
 if(scene.kind!=='symmetry'&&scene.kind!=='samila')return[];
 const custom=customSymmetry(scene);
 let bindingNames:Set<string>|undefined;
 // Source diagnostics must not hide editable authored values. The source panel
 // reports the preparation error; these rows retain explicit unknown binding.
 if(custom)try{bindingNames=new Set(prepareSymmetryCustomSource(scene.equations!.glsl,symmetryCustomCompileDegree(scene)).bindingNames);}catch{/* Retain values even when source cannot be prepared. */}
 return Object.entries(scene.parameters).filter(([name])=>scene.kind!=='symmetry'||custom||name!=='delta'||scene.settings.template==='modified').map(([name,value])=>{
  if(!Number.isFinite(value))throw new Error(`参数 ${name} 必须为有限数值`);
  const bound=scene.kind==='symmetry'&&!custom&&own(fixed,name)?fixed[name]:undefined;
  return{name,value,...(bound?{range:bound,displayDecimals:3}:{}),rangeSource:bound?'fixed':'none',editableRange:scene.kind==='samila',canDelete:!bound,...(custom?{customBinding:bindingNames?(bindingNames.has(name)?'matched' as const:'unmatched' as const):'unknown' as const}:{})};
 });
}
export function parameterEditingSpecs(scene:ParameterScene):ParameterEditingSpec[]{
 const values=rows(scene);if(scene.kind!=='samila')return values;
 const authored=parseParameterRanges(scene.settings);
 return values.map(spec=>({...spec,range:authored[spec.name]??defaultRange,rangeSource:own(authored,spec.name)?'authored':'default'}));
}
/** Recovery keeps exact parameter values readable even when optional metadata is
 * malformed. Only explicit reset discards that owned JSON. Math ignores it. */
export function readParameterEditing(scene:ParameterScene):{specs:ParameterEditingSpec[];error?:string}{
 try{return{specs:parameterEditingSpecs(scene)};}catch(error){return{specs:rows(scene).map(spec=>({...spec,editableRange:false})),error:error instanceof Error?error.message:String(error)};}
}
export function parameterSamplingRanges(scene:ParameterScene):ParameterSamplingRanges {
 const out:Record<string,ParameterRange>=Object.create(null);
 for(const spec of parameterEditingSpecs(scene))if(spec.range)out[spec.name]=spec.range;
 return Object.freeze(out);
}
/** Continuous random sampling uses the parsed endpoints. The authored step is
 * the slider resolution, not a quantization of the mathematical parameter. */
export function sampleParameterRange(bounds:ParameterRange,unit:number):number {
 if(!Number.isFinite(unit)||unit<0||unit>1)throw new Error('参数采样分数须为 0 至 1 的有限数值');
 const value=bounds.min+(bounds.max-bounds.min)*unit;
 if(!Number.isFinite(value))throw new Error('参数采样结果不是有限数值');return value;
}
/** Suggested bounds only for a newly created animation. Never apply this to an
 * existing ParameterAnimation or change its chosen min/max/step. */
export function parameterAnimationSuggestion(scene:ParameterScene,target:string):{min:number;max:number}|undefined {
 if(!target.startsWith('parameters.')||target.slice(11).includes('.'))return undefined;
 const spec=parameterEditingSpecs(scene).find(p=>p.name===target.slice(11));return spec?.range?{min:spec.range.min,max:spec.range.max}:undefined;
}
function editable(scene:ParameterScene,name?:string){
 if(scene.kind!=='samila'&&scene.kind!=='symmetry')throw new Error('参数滑块仅支持 Symmetry 和 Samila');
 if(name!==undefined&&!own(scene.parameters,name))throw new Error(`参数不存在：${name}`);
}
export function withParameterValue(scene:SceneDocument,name:string,value:number):SceneDocument {
 editable(scene,name);if(!Number.isFinite(value))throw new Error(`参数 ${name} 必须为有限数值`);
 return{...scene,parameters:{...scene.parameters,[name]:value}};
}
export function withParameterRange(scene:SceneDocument,name:string,value:ParameterRange):SceneDocument {
 editable(scene,name);if(scene.kind!=='samila')throw new Error('Symmetry 的参数滑块范围固定');nameValid(name);
 const checked=range(value),ranges={...parseParameterRanges(scene.settings),[name]:checked};
 if(Object.keys(ranges).length>MAX_PARAMETER_RANGES)throw new Error('参数范围最多保存 128 项');
 const text=JSON.stringify({version:1,ranges});if(text.length>MAX_PARAMETER_RANGE_JSON)throw new Error('参数范围 JSON 超过 32768 字符');
 return{...scene,settings:{...scene.settings,[PARAMETER_RANGES_KEY]:text}};
}
export function withoutEditableParameter(scene:SceneDocument,name:string):SceneDocument {
 editable(scene,name);if(scene.kind==='symmetry'&&!customSymmetry(scene)&&own(fixed,name))throw new Error('Symmetry 固定公式参数不能删除');
 if(parameterTimelineReferences(scene).some(reference=>reference.enabled&&reference.kind==='value'&&reference.target==='parameters.'+name))throw new Error(`参数 ${name} 仍被启用的动画引用；请先停用或修改该动画，参数与动画保持不变。`);
 const parameters={...scene.parameters};delete parameters[name];if(scene.kind!=='samila')return{...scene,parameters};
 const ranges={...parseParameterRanges(scene.settings)};delete ranges[name];const settings={...scene.settings};
 if(Object.keys(ranges).length)settings[PARAMETER_RANGES_KEY]=JSON.stringify({version:1,ranges});else delete settings[PARAMETER_RANGES_KEY];
 return{...scene,parameters,settings};
}
export function resetParameterRanges(scene:SceneDocument):SceneDocument {
 if(scene.kind!=='samila')throw new Error('只有 Samila 支持重置编辑范围');
 const settings={...scene.settings};delete settings[PARAMETER_RANGES_KEY];return{...scene,settings};
}
