import type {ControlSpec,Palette,SceneDocument,Settings} from '../types';
import {numberSetting} from './expression';
import {abs,finite,type Complex,type ComplexScope} from './complexMath';
import {domainExpressions} from './domainExpressions';
import {prepareDomainViewport,parseDomainViewportVersion,domainPixelSpan,domainViewportGpuReason,type PreparedDomainViewport} from './domainViewport';
import {hexRGB,validatePalette} from './palette';
import {compileDomainPalette,type DomainPaletteFacts} from './domainGradient';
import {parseDomainColorVersion,prepareDomainSourceColor,type PreparedDomainSourceColor,type DomainSourceColorVersion} from './domainSourceColor';
import {prepareDomainExecution,nativeCpuExpressionFallback,parseDomainIterationVersion,type DomainIterationVersion,type DomainExecutionPolicy} from './domainSourceIteration';
import {prepareDomainNativeConstant,type PreparedDomainNativeConstant} from './domainNativeConstants';
import type {DomainRenderFacts} from './domainRenderPolicy';
type RGB=[number,number,number];

interface DomainModelBase {
 formula:string;next?:string;parameters:Record<string,number>;iterationVersion:DomainIterationVersion;execution:DomainExecutionPolicy;nextEnabled:boolean;expressionCost:number;executionWarnings:readonly string[];nativeConstant?:PreparedDomainNativeConstant;sourceConstantUpload?:boolean;iteration:boolean;steps:number;seed:'PIXEL_Z'|'ZERO'|'CONSTANT_C';constant:Complex;bailout:number;
 view:PreparedDomainViewport;curveMode:'PHASE'|'MODULUS'|'PHASE_MODULUS'|'NONE';phaseDensity:number;modDensity:number;phaseSharpness:number;modSharpness:number;bias:number;mix:number;
 grid:boolean;gridSpacing:number;supersampling:number;paletteOffset:number;background:RGB;backend:'auto'|'cpu'|'gpu';gradientWarnings:string[];
}
export interface LocalDomainModel extends DomainModelBase {colorVersion:'local-v1';palette:Palette;paletteSample:(coordinate:number)=>RGB;paletteFacts:DomainPaletteFacts;}
export interface SourceDomainModel extends DomainModelBase {colorVersion:DomainSourceColorVersion;sourceColor:PreparedDomainSourceColor;}
export type DomainModel=LocalDomainModel|SourceDomainModel;
function option<T extends string>(s:Settings,key:string,fallback:T,values:readonly T[]):T{const v=s[key]??fallback;if(typeof v!=='string'||!values.includes(v as T))throw new Error(key+' 不支持选项 '+v);return v as T;}
function bool(s:Settings,key:string,fallback=false):boolean{const v=s[key]??fallback;if(typeof v!=='boolean')throw new Error(key+' 必须为布尔值');return v;}
export function requestedDomainRenderRules(settings:Settings):DomainRenderFacts['requested'] {
 return Object.freeze({formula:parseDomainIterationVersion(settings.domainIterationVersion),color:parseDomainColorVersion(settings.domainColorVersion),viewport:parseDomainViewportVersion(settings.domainViewportVersion),backend:option(settings,'domainBackend','auto',['auto','cpu','gpu'])});
}
/** Reinterpret only rendering rules, on the SAME already-evaluated frame.
 * Authored constants, raw formulas, full source palette and timeline facts
 * remain inputs to their existing owners; no GPU-upload facts are reused. */
export function parseDomainCpuChainModel(scene:SceneDocument,time:number):DomainModel {
 return parseDomainModel({...scene,settings:{...scene.settings,domainIterationVersion:'mathart-1.7.8-cpu',domainColorVersion:'mathart-1.7.8-cpu',domainViewportVersion:'mathart-1.7.8-cpu',domainBackend:'cpu'}},time);
}
export function parseDomainModel(scene:SceneDocument,time:number):DomainModel{
 const s=scene.settings,n=(key:string,fallback:number,min=-Infinity,max=Infinity)=>numberSetting(s,key,fallback,min,max),integer=(key:string,fallback:number,min:number,max:number)=>{const v=n(key,fallback,min,max);if(!Number.isInteger(v))throw new Error(key+' 必须为整数');return v;};
 let execution=prepareDomainExecution(s);
 const parameters=execution.arithmetic==='local'?{...scene.parameters,time}:{...scene.parameters};if(!Object.values(parameters).every(Number.isFinite))throw new Error('域着色参数必须有限');
 const colorVersion=parseDomainColorVersion(s.domainColorVersion),formula=scene.equations.f??'z^3-1',next=execution.iteration?(execution.arithmetic==='local'?scene.equations.next?.trim()||undefined:scene.equations.next):undefined;
 let expressions=domainExpressions.get({formula,next,parameters,iterationVersion:execution.version,nextEnabled:execution.nextEnabled});
 if(execution.arithmetic==='native-gpu'&&expressions.nativeGpuFailure){execution=nativeCpuExpressionFallback(execution,expressions.nativeGpuFailure);expressions=domainExpressions.get({formula,next,parameters,iterationVersion:execution.version,nextEnabled:execution.nextEnabled});}
 const {version:iterationVersion,source:sourceIteration,iteration,nextEnabled}=execution;
 const nativeConstant=execution.arithmetic==='local'?undefined:prepareDomainNativeConstant({formula,authored:[n('constantReal',1),n('constantImag',0)]});
 const sourceConstantUpload=execution.arithmetic==='native-gpu'?expressions.referencesConstant:undefined;
 // The source uploads u_constant only when an active expression mentions c,
 // even when CONSTANT_C selects that uniform as the seed. Fresh uniforms are 0.
 const constant:Complex=sourceConstantUpload===false?[0,0]:nativeConstant?[...nativeConstant.effectiveConstant]:[n('constantReal',0),n('constantImag',0)];
 const executionWarnings=[...expressions.warnings,...(nativeConstant?.diagnostics??[]),...(execution.fallbackReason?[execution.fallbackReason]:[])];
 const seed=option(s,'seedMode','PIXEL_Z',['PIXEL_Z','ZERO','CONSTANT_C']);
 if(sourceConstantUpload===false&&seed==='CONSTANT_C')executionWarnings.push('原产物 GPU 公式未引用 c，不上传常量；常量种子使用新着色器的零初始值。');
 const common={formula,next,parameters,iterationVersion,execution,nextEnabled,expressionCost:expressions.nodeCost,executionWarnings,nativeConstant,sourceConstantUpload,iteration,steps:sourceIteration?.steps??integer('iterationSteps',12,1,64),bailout:sourceIteration?.escapeRadius??n('bailout',1e6,1,1e12),seed,constant,view:prepareDomainViewport(s),supersampling:integer('supersampling',1,1,3),background:hexRGB(String(s.background??'#0a0c14')),backend:option(s,'domainBackend','auto',['auto','cpu','gpu'])};
 if(colorVersion!=='local-v1'){
  const sourceColor=prepareDomainSourceColor({version:colorVersion,colors:scene.domainSourcePalette?.colors,runtime:scene.evaluatedDomainGradient,curveMode:s.curveMode,phaseDensity:s.phaseDensity,modDensity:s.modDensity,phaseSharpness:s.phaseSharpness,modSharpness:s.modSharpness,bias:s.curveBias,mix:s.curveMix,paletteOffset:s.paletteOffset}),f=sourceColor.facts;
  return{...common,colorVersion,sourceColor,curveMode:f.curveMode,phaseDensity:f.phaseDensity,modDensity:f.modDensity,phaseSharpness:f.phaseSharpness,modSharpness:f.modSharpness,bias:f.bias,mix:f.mix,paletteOffset:f.paletteOffset,grid:false,gridSpacing:1,gradientWarnings:[]};
 }
 const palette=validatePalette(scene.palette),gradient=compileDomainPalette(palette,scene.evaluatedDomainGradient);
 return{...common,colorVersion,
 curveMode:option(s,'curveMode','PHASE_MODULUS',['PHASE','MODULUS','PHASE_MODULUS','NONE']),phaseDensity:n('phaseDensity',12,.01,1e6),modDensity:n('modDensity',8,.01,1e6),phaseSharpness:n('phaseSharpness',1,.01,100),modSharpness:n('modSharpness',1,.01,100),bias:n('curveBias',.15,-1,1),mix:n('curveMix',1,0,1),grid:bool(s,'complexGrid'),gridSpacing:n('gridSpacing',1,.001,1e6),paletteOffset:n('paletteOffset',0),palette,paletteSample:gradient.sample,paletteFacts:gradient.paletteFacts,gradientWarnings:gradient.warnings};
}
/** Same direct-iteration contract for CPU rendering and GPU repair. No final
 * f(w) is added when next exists. Constant seed and pixel c stay distinct. */
export function domainEvaluator(model:DomainModel,isCancelled?:()=>boolean):(pixel:Complex)=>Complex{
 const {f,next}=domainExpressions.get(model);
 const scope:ComplexScope={...model.parameters,z:[0,0],w:[0,0],c:model.constant};
 if(model.execution.arithmetic!=='local'){
  const gpuReference=model.execution.arithmetic==='native-gpu',r=Math.fround;
  const radiusSquared=gpuReference?r(model.bailout*model.bailout):model.bailout*model.bailout;
  return point=>{
   const pixel:Complex=gpuReference?[r(point[0]),r(point[1])]:point;
   let current:Complex=model.seed==='PIXEL_Z'?pixel:model.seed==='ZERO'?[0,0]:model.constant;
   scope.z=pixel;scope.c=model.seed==='PIXEL_Z'?model.constant:pixel;
   for(let j=0;j<model.steps;j++){
    if((j&15)===0&&isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');
    scope.w=current;
    if(next)current=next(scope);else{scope.z=current;scope.c=model.constant;current=f(scope);}
    if(gpuReference){const magnitudeSquared=r(r(current[0]*current[0])+r(current[1]*current[1]));if(!(magnitudeSquared<=radiusSquared))break;}
    else{const magnitudeSquared=current[0]*current[0]+current[1]*current[1];if(!finite(current)||!Number.isFinite(magnitudeSquared)||magnitudeSquared>radiusSquared)break;}
   }
   return current;
  };
 }
 return pixel=>{scope.z=pixel;scope.c=model.constant;if(!model.iteration)return f(scope);
  let current:Complex=model.seed==='PIXEL_Z'?pixel:model.seed==='ZERO'?[0,0]:model.constant;scope.c=model.seed==='PIXEL_Z'?model.constant:pixel;
  for(let j=0;j<model.steps;j++){scope.w=current;if(next)current=next(scope);else{scope.z=current;scope.c=model.constant;current=f(scope);}if(!finite(current)||abs(current)>model.bailout)break;}return current;
 };
}
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
/** Sole domain color producer, shared by float64 and repaired float32 values. */
export function shadeDomainValue(value:Complex,pixel:Complex,model:DomainModel,height:number):RGB|undefined{
 if(model.colorVersion!=='local-v1')return model.sourceColor.sample(value);
 if(!finite(value)||abs(value)>1e12)return;
 const magnitude=abs(value),angle=Math.atan2(value[1],value[0]),phase=angle/(2*Math.PI);
 const phaseWave=(.5+.5*Math.cos(angle*model.phaseDensity))**model.phaseSharpness,modWave=(.5+.5*Math.cos(Math.log(Math.max(magnitude,1e-15))*model.modDensity))**model.modSharpness;
 const level=model.curveMode==='PHASE'?phaseWave:model.curveMode==='MODULUS'?modWave:model.curveMode==='PHASE_MODULUS'?Math.sqrt(phaseWave*modWave):1;
 let brightness=clamp((1-model.mix)+model.mix*(.25+.75*level)+model.bias)*Math.min(1,Math.sqrt(magnitude));
 if(model.grid){const distance=Math.min(Math.abs(pixel[0]/model.gridSpacing-Math.round(pixel[0]/model.gridSpacing)),Math.abs(pixel[1]/model.gridSpacing-Math.round(pixel[1]/model.gridSpacing)));brightness*=.35+.65*clamp(distance/(domainPixelSpan(model.view,height,model.gridSpacing)));}
 const color=model.paletteSample(phase+model.paletteOffset);return[color[0]*brightness,color[1]*brightness,color[2]*brightness];
}
export const domainBackendControl:ControlSpec={key:'domainBackend',label:'域着色计算后端',group:'计算',type:'select',options:[{value:'auto',label:'自动 · 优先 GPU'},{value:'cpu',label:'CPU · 按所选公式规则'},{value:'gpu',label:'GPU · 按所选公式规则'}],help:'后端不改变公式执行规则：本地及旧兼容多步迭代使用 CPU；原产物 CPU 公式使用双精度，原产物 GPU 公式支持 GPU 多步，选择 CPU 时使用分阶段 float32 参考。颜色、视口或设备限制会明确说明实际回退。'};
export function visibleDomainControls(controls:readonly ControlSpec[],settings:Settings):ControlSpec[]{
 const source=parseDomainColorVersion(settings.domainColorVersion)!=='local-v1',sourceIteration=parseDomainIterationVersion(settings.domainIterationVersion)!=='local-v1',iteration=new Set(sourceIteration?['iterationSteps','iterationMaxSteps','bailout']:['seedMode','iterationSteps','iterationMaxSteps','bailout']);
 const available=sourceIteration&&settings.iterationEnabled===true&&!controls.some(c=>c.key==='iterationMaxSteps')?[...controls,{key:'iterationMaxSteps',label:'原产物迭代上限',group:'迭代',type:'number' as const,min:1,max:256,step:1,help:'保留文档中的原始上限；实际执行最多 256 步。'}]:controls;
 return available.filter(c=>!(!sourceIteration&&c.key==='iterationMaxSteps')&&!(settings.iterationEnabled!==true&&iteration.has(c.key))&&!(source&&(c.key==='complexGrid'||c.key==='gridSpacing'))&&!(settings.complexGrid!==true&&c.key==='gridSpacing')).map(c=>{
  if(source&&(c.key==='phaseDensity'||c.key==='modDensity'))return{...c,min:.5,max:30,step:.1};
  if(source&&(c.key==='phaseSharpness'||c.key==='modSharpness'))return{...c,min:.05,max:4.5,step:.01};
  if(c.key==='scale'&&parseDomainViewportVersion(settings.domainViewportVersion)!=='local-v1')return{...c,min:1e-9,max:undefined,step:.1};
  if(sourceIteration&&c.key==='iterationSteps')return{...c,min:1,max:64,step:1};
  if(sourceIteration&&c.key==='iterationMaxSteps')return{...c,min:1,max:256,step:1};
  return c;
 });
}
/** Display-only defaults. Preserve explicit authored numbers, including values
 * outside the UI range; the iteration owner resolves their effective values. */
export function domainControlSettings(settings:Settings):Settings{
 const sourceView=parseDomainViewportVersion(settings.domainViewportVersion)!=='local-v1',sourceIteration=parseDomainIterationVersion(settings.domainIterationVersion)!=='local-v1';
 if(!sourceView&&!sourceIteration)return settings;
 return{...(sourceView?{scale:2.5}:{}),...(sourceIteration?{iterationSteps:1,iterationMaxSteps:64}:{}),...settings};
}

/** Admission is based on float32 resolution and supported color conditioning,
 * not an arbitrary maximum zoom. Center-zero deep views can remain resolvable. */
export function domainGpuPrecisionReason(m:DomainModel,width:number,height:number):string|undefined{
 if(m.execution.arithmetic==='native-cpu')return '原产物 CPU 公式执行规则使用双精度求值';
 if(m.execution.arithmetic==='native-gpu')return domainViewportGpuReason(m.view,width,height);
 // Arbitrary multi-step maps may amplify a tiny float32 error into a different
 // orbit or bailout decision. No general forward-error bound is available yet.
 if(m.iteration&&m.steps>1)return '多步复数迭代尚无 GPU 误差传播界，使用 CPU 双精度';
 const numbers=[...Object.values(m.parameters),...m.constant,m.bailout];if(numbers.some(v=>!Number.isFinite(Math.fround(v))||(v!==0&&Math.abs(v)<1.1754943508222875e-38)))return '域着色参数超出 GPU float32 范围';
 const viewportReason=domainViewportGpuReason(m.view,width,height);if(viewportReason)return viewportReason;
 if((m.phaseDensity*m.phaseSharpness+m.modDensity*m.modSharpness)*2**-22>1/255)return '等值线密度与锐度需要 CPU 双精度颜色输入';
 return;
}
