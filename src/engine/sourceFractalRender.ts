import type {SourceFractalSceneRuntime} from './sourceFractalSceneRuntime';
import type {FractalSourceNativePrecisionInput} from './fractalSourcePrecision';

export type SourceFractalRenderFrame=ReturnType<SourceFractalSceneRuntime['snapshot']>;
export interface SourceFractalRenderFailure {readonly kind:'input'|'unsupported';readonly reason:string;readonly formulaId?:string;}
export class SourceFractalRenderError extends Error {
 constructor(readonly failure:SourceFractalRenderFailure){super(failure.reason);this.name='SourceFractalRenderError';}
}
/** The scene owner has already mapped sparse parameters and advanced every
 * child. Rendering consumes those facts; it must never rebuild this state from
 * settings or mistake a locally approximated formula for a source renderer. */
export function prepareSourceFractalRenderInput(frame:SourceFractalRenderFrame|undefined):{ok:true;value:FractalSourceNativePrecisionInput}|{ok:false;error:SourceFractalRenderFailure} {
 if(!frame)return{ok:false,error:{kind:'input',reason:'原版分形场景必须先完成时间线求值'}};
 const formula=frame.formula.formulaId;
 if(formula!=='newton'&&formula!=='nova'&&formula!=='mandelbrot'&&formula!=='julia')return{ok:false,error:{kind:'unsupported',formulaId:formula,reason:`原版分形公式 ${formula} 的渲染尚未验证；完整源场景已保留`}};
 return{ok:true,value:{formula,native:frame.formula.native,iterations:frame.scene.object.iterations}};
}
export function sourceFractalRenderInput(frame:SourceFractalRenderFrame|undefined):FractalSourceNativePrecisionInput {
 const result=prepareSourceFractalRenderInput(frame);if(!result.ok)throw new SourceFractalRenderError(result.error);return result.value;
}
