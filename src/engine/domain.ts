import type {DomainRepairPixel} from './domainGpuRaster';
import type {GenerateContext,SceneDocument,SceneOutput} from '../types';
import {domainPixel,domainViewportWarnings} from './domainViewport';
import {parseDomainModel,parseDomainCpuChainModel,requestedDomainRenderRules,domainEvaluator,shadeDomainValue,domainGpuPrecisionReason,type DomainModel} from './domainModel';
import {domainGpu} from './domainGpu';
import {rasterDimensions,validateRasterRequest} from './rasterDimensions';
import {DomainGpuError} from './domainGpuFailure';
import {DomainRenderSession} from './domainRenderSession';
import {parseDomainRenderPolicy,type DomainRenderFacts} from './domainRenderPolicy';

const aborted=(error:unknown)=>error instanceof DOMException&&error.name==='AbortError';
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const pixelWork=(model:DomainModel)=>(model.iteration?model.steps:1)*model.supersampling**2*5*(model.execution.arithmetic==='local'?1:model.expressionCost);
type DomainOutput=Extract<SceneOutput,{type:'raster'}>;

export function generateDomain(scene:SceneDocument,context:GenerateContext,session?:DomainRenderSession):DomainOutput{
 if(context.isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');
 validateRasterRequest(context);
 const started=performance.now(),policy=parseDomainRenderPolicy(scene.settings.domainRenderPolicy),requested=requestedDomainRenderRules(scene.settings),owner=session??new DomainRenderSession();
 owner.select(scene.id);
 const recoverWholeChain=policy==='source-cpu-on-gpu-failure-v1'&&requested.backend!=='cpu';
 let route:DomainRenderFacts['route']='selected',trigger:DomainRenderFacts['trigger'],sticky=false,model:DomainModel;
 const sourceCpu=()=>parseDomainCpuChainModel(scene,context.time);
 const fail=(failure:NonNullable<DomainRenderFacts['trigger']>)=>{owner.fail(failure);trigger=owner.failure();route='source-cpu-failure';return sourceCpu();};
 try{
  if(policy==='source-cpu-always-v1'){route='source-cpu-forced';model=sourceCpu();}
  else if(recoverWholeChain&&owner.failure()){
   // A failed renderer already chose CPU. Validate the active model only;
   // dormant local/GPU restrictions must not reject valid CPU edits.
   sticky=true;trigger=owner.failure();route='source-cpu-failure';model=sourceCpu();
  }
  else{
   model=parseDomainModel(scene,context.time);
   if(recoverWholeChain){
    // This is a proved-invalid source shader preflight, not a catch of every
    // emitter exception. Legacy saved documents retain formula-only recovery.
    if(model.execution.fallbackReason)model=fail({stage:'source-program',reason:model.execution.fallbackReason});
   }
  }
  const recover=(error:unknown):DomainModel|undefined=>{
   if(aborted(error))throw error;
   // Compatibility alone retains the old broad catch. New source recovery
   // cannot hide budget/input/emitter/CPU callback errors as device failures.
   if(policy!=='selected-rules-1723'&&!(error instanceof DomainGpuError))throw error;
   domainGpu.dispose();
   if(recoverWholeChain&&error instanceof DomainGpuError){model=fail(error.failure);return model;}
   return undefined;
  };
  const output=renderDomainModel(model,context,started,recover);
  output.domainRender={policy,requested,effective:{formula:model.execution.version,color:model.colorVersion,viewport:model.view.version,backend:output.backend??'cpu'},route,trigger,sticky,view:model.view,constant:[...model.constant],sourceConstantUpload:model.sourceConstantUpload};
  if(route==='source-cpu-failure')output.warnings=[`域着色整链 CPU 回退${sticky?'（保留本作品此前的 GPU 失败状态）':''}：${trigger!.reason}；当前图像使用 CPU 公式、CPU 坐标和 CPU 着色。`,...(output.warnings??[])];
  if(route==='source-cpu-forced')output.warnings=['域着色已显式选择完整 CPU 渲染链；所选公式、视口和色板规则仍保留在作品中。',...(output.warnings??[])];
  return output;
 }catch(error){
  if(aborted(error)){domainGpu.dispose();throw error;}
  if(route==='source-cpu-failure')throw new Error(`域着色 GPU 失败：${trigger!.reason}；完整 CPU 回退无法完成：${message(error)}`,{cause:error});
  throw error;
 }
}

function renderDomainModel(model:DomainModel,context:GenerateContext,started:number,recover:(error:unknown)=>DomainModel|undefined,reusePixels?:Uint8ClampedArray):DomainOutput{
 const cancel=()=>{if(context.isCancelled?.())throw new DOMException('域着色计算已取消','AbortError');};cancel();
 const evaluate=domainEvaluator(model,context.isCancelled),nativeGpu=model.execution.arithmetic==='native-gpu',warnings:string[]=[...model.gradientWarnings,...model.executionWarnings,...domainViewportWarnings(model.view)];
 if(model.execution.arithmetic==='native-cpu')warnings.push('MathArt 1.7.8 CPU 公式规则来自静态产物；Java Math 与 JavaScript Math 的逐位一致性尚未验证。');
 if(model.execution.fallbackReason)warnings.push('GPU 原式不可编译，实际采用原产物 CPU 公式规则；颜色与视口仍保持各自所选版本。');
 if(model.colorVersion==='mathart-1.7.8-gpu')warnings.push('MathArt 1.7.8 GPU 静态着色合同；复数求值与硬件像素不保证原版一致，零值相位约定为 0。');
 else if(model.colorVersion==='mathart-1.7.8-cpu')warnings.push('MathArt 1.7.8 CPU 静态着色合同；保留整数色板插值与最终截断，未运行原应用进行像素对照。');
 let gpu=model.backend!=='cpu',fallbackReason:string|undefined;
 // Admission may change preview dimensions; recalculate once with the actual
 // backend. Export dimensions are exact in either path.
 const workPerPixel=pixelWork(model);
 let [width,height]=rasterDimensions(context,workPerPixel,gpu?'webgl2':'cpu',[]);
 if(gpu){fallbackReason=domainGpuPrecisionReason(model,width,height);if(fallbackReason)gpu=false;}
 [width,height]=rasterDimensions(context,workPerPixel,gpu?'webgl2':'cpu',warnings);
 const s=model.supersampling,samplesPerPixel=s*s,pixels=reusePixels?.length===width*height*4?reusePixels:new Uint8ClampedArray(width*height*4),bg=model.background.map(v=>Math.round(v*255));
 const cpuPixel:DomainRepairPixel=(index,coordinates)=>{
  const sum=[0,0,0];let valid=0;
  // Preserve the old CPU sampling and averaging order exactly. If one GPU
  // subsample is risky, repair the whole pixel, never mix partial averages.
  for(let sample=0;sample<samplesPerPixel;sample++){
   const at=(coordinates?.offset??0)+sample*2,point:[number,number]=coordinates?[coordinates.values[at],coordinates.values[at+1]]:domainPixel(index%width,Math.floor(index/width),width,height,model.view,(sample%s+.5)/s,(Math.floor(sample/s)+.5)/s);
   const valueAt=coordinates?.kind==='native-gpu-result'?coordinates.valueOffset+sample*2:0;
   const value:[number,number]=coordinates?.kind==='native-gpu-result'?[coordinates.finalValues[valueAt],coordinates.finalValues[valueAt+1]]:evaluate(point),color=shadeDomainValue(value,point,model,height);
   if(!color)continue;for(let k=0;k<3;k++)sum[k]+=color[k];valid++;
  }
  for(let k=0;k<3;k++)pixels[index*4+k]=valid?Math.round(Math.max(0,Math.min(1,sum[k]/valid))*255):bg[k];pixels[index*4+3]=255;return valid;
 };
 const samples=width*height*samplesPerPixel;let generated=0,invalid=0,invalidSamples=0,repaired=0;
 try{
  if(gpu){
   try{const result=domainGpu.render(model,width,height,pixels,cpuPixel,context.isCancelled);({generated,invalid,invalidSamples,repaired}=result);if(result.colorFallbackReason)warnings.push('GPU 公式终值由 CPU 着色：'+result.colorFallbackReason);}
   catch(error){
    const recovered=recover(error);fallbackReason=message(error);gpu=false;
    // Full-resolution exports reuse their single RGBA allocation on failure.
    // Only a preview whose CPU budget changes dimensions needs a smaller result.
    const cpuModel=recovered??{...model,backend:'cpu' as const},cpuSize=rasterDimensions(context,pixelWork(cpuModel),'cpu',[]);
    if(recovered||cpuSize[0]!==width||cpuSize[1]!==height){const result=renderDomainModel(cpuModel,context,started,recover,pixels);if(!recovered)result.warnings=[`域着色 GPU 回退 CPU：${fallbackReason}`,...(result.warnings??[])];return result;}
   }
  }
  if(!gpu)for(let index=0;index<width*height;index++){if((index&127)===0)cancel();const valid=cpuPixel(index);invalidSamples+=samplesPerPixel-valid;if(valid)generated++;else invalid++;}
  cancel();
 }catch(error){if(error instanceof DOMException&&error.name==='AbortError')domainGpu.dispose();throw error;}
 // Source-coordinate provenance survives full CPU expression/color repair.
 // Legacy local execution labels retain their existing meaning.
 const actualGpu=gpu&&(nativeGpu||model.view.version==='mathart-1.7.8-gpu'||repaired<samples);
 if(gpu&&repaired===samples&&!nativeGpu)warnings.push(`全部 ${samples} 个子像素由 CPU 数值保护重新求值。`);
 if(fallbackReason){warnings.push('域着色 GPU 回退 CPU：'+fallbackReason);if(model.view.version==='mathart-1.7.8-gpu')warnings.push('GPU 视口执行失败或能力不足；CPU 使用分阶段 float32 参考，不能复现设备 varying 插值与三角函数。');}
 if(nativeGpu){
  warnings.push(actualGpu?'GPU 使用原产物 float32 公式与最多 256 步迭代规则；CPU 着色仅消费捕获的 GPU 终值。':'CPU 使用原产物 GPU 公式的分阶段 float32 参考；设备三角函数、融合运算和非正规数处理不能由此精确复现。');
  if(repaired)warnings.push(`${repaired} 个子像素使用实际 GPU 终值进行 CPU 着色，未重新求值公式。`);
 }else{
  warnings.push(actualGpu?'GPU 计算复平面坐标、复数、色板与等值线并完成超采样；风险像素由 CPU 完整重算。':'CPU 复数主值分支计算；与原应用 GPU 精度及分支边界可能不同。');
  if(repaired){warnings.push(`${repaired} 个子像素经过 CPU 主值或数值精度修复。`);if(model.view.version==='mathart-1.7.8-gpu')warnings.push('CPU 数学修复消费同一 GPU program 捕获的坐标，不重新计算另一套视口坐标。');}
 }
 if(invalidSamples)warnings.push(`${invalidSamples} 个子像素在极点、溢出或无定义区域，使用背景/其余有效子像素。`);
 return{type:'raster',dimension:2,cameraResolved:true,backend:actualGpu?'webgl2':'cpu',width,height,pixels,stats:{samples,generated,invalid,elapsedMs:performance.now()-started},warnings};
}
