import type {OscillationEdgeEasing} from '../types';
import {sourceEase} from './sourceEasing';
/** OscillationEdgeEasing.speedScale: normalize by repeated subtraction, keeping
 * the native rounding order. Callers own work limits and cancellation. */
export function wrapSourceOscillationPhase(phase:number,reserve:(units:number)=>void):number {
 const tau=6.283185307179586;
 if(!Number.isFinite(phase))throw Error('原版参数相位必须有限');
 while(phase>tau){reserve(1);const next=phase-tau;if(next===phase)throw Error('原版参数相位约简无法推进');phase=next;}
 while(phase<0){reserve(1);const next=phase+tau;if(next===phase)throw Error('原版参数相位约简无法推进');phase=next;}
 return phase;
}
export function sourceOscillationEdgeScale(phase:number,edge:Readonly<OscillationEdgeEasing>,reserve:(units:number)=>void):number {
 const tau=6.283185307179586;phase=wrapSourceOscillationPhase(phase,reserve);
 const distance=(to:number)=>{const d=Math.abs(phase-to)%tau;return d>Math.PI?tau-d:d;};
 const q=Math.max(0,Math.min(1,Math.min(distance(Math.PI/2),distance(3*Math.PI/2))/edge.window));
 const scale=edge.floor+(1-edge.floor)*sourceEase(edge.easing,Math.fround(q));
 if(!Number.isFinite(scale))throw Error('原版参数端点速度必须有限');return scale;
}
