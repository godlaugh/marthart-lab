import type {GenerateContext} from '../types';
import type {SourceCameraPlan} from './sourceCamera';
import {SourceProcessingHost} from './sourceProcessingHost';
import type {SourceProcessingContextResult} from './sourceProcessingContext';

const value=<T>(r:SourceProcessingContextResult<T>):T=>{if(!r.ok)throw r.error;return r.value;};
/** Primary dimensions are measured host facts. An offscreen target must not
 * masquerade as primary merely because its aspect ratio happens to match. */
export function sourceSymmetryProcessingPrimarySize(c:GenerateContext):{width:number;height:number}{
 const viewport=c.sourceViewport;if(!viewport)throw Error('自定义 Symmetry 缺少宿主逻辑画布');
 let width:number,height:number;
 if(viewport.target==='primary'){width=viewport.logicalWidth;height=viewport.logicalHeight;}
 else{
  const reference=c.sourceSymmetryToneReference,density=c.sourcePointPixelDensity;
  if(!reference||typeof density!=='number'||!Number.isInteger(density)||density<1)throw Error('自定义 Symmetry 离屏生成缺少主画布尺寸及像素密度');
  width=reference.width/density;height=reference.height/density;
 }
 if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=2147483647)||height!==viewport.referenceLogicalHeight)throw Error('自定义 Symmetry 主画布尺寸与逻辑参考不一致');
 return{width,height};
}
/** Enter one actual primary draw. Scene initialization is explicit and resets
 * the mobject binding while preserving an existing graphics object's identity. */
export function beginSourceSymmetryProcessingFrame(host:SourceProcessingHost|undefined,c:GenerateContext,initialize=false):SourceProcessingHost{
 const size=sourceSymmetryProcessingPrimarySize(c),fresh=!host;
 host??=value(SourceProcessingHost.create(size.width,size.height));
 try{
  value(host.apply({kind:'begin-primary',...size}));
  if(fresh||initialize){value(host.apply({kind:'initialize-scene'}));value(host.apply({kind:'reset-mobject'}));}
  return host;
 }catch(error){if(fresh)host.dispose();throw error;}
}
export function beginSourceSymmetryProcessingRender(host:SourceProcessingHost,plan:SourceCameraPlan,hasUpdates:boolean){
 const update=hasUpdates?value(host.bindCompute()):undefined;
 value(host.apply({kind:'begin-render',plan}));
 return{update,display:value(host.bindCompute())};
}
/** The reconstructed source presentation includes the default post-world
 * screen-overlay matrix stage observed in the pinned 1.7.8 VIEW/RUN records.
 * This is a rendering policy, not a guess from shader uniform names. It does
 * not reproduce a different, unobserved original license/debug configuration. */
export function endSourceSymmetryProcessingRender(host:SourceProcessingHost):void{value(host.apply({kind:'end-render',screenOverlay:true}));}
export function endSourceSymmetryProcessingFrame(host:SourceProcessingHost,previewCopy=false):void{
 if(previewCopy)value(host.apply({kind:'preview-copy'}));value(host.apply({kind:'end-primary'}));
}
