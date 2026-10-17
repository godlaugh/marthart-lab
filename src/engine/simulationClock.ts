/** Fixed-step identity is shared by CPU/GPU integration. Decimal UI values can
 * differ from n/fps by a few binary64 rounding units; this error bound treats
 * only that arithmetic neighborhood as the same committed frame. The caller's
 * time remains untouched for display transforms, timeline evaluation and output. */
export function simulationTime(time:number,fps:number):{frame:number;fraction:number;gridTime:number}{
 if(!Number.isFinite(time)||time<0||time>86400||!Number.isInteger(fps)||fps<1||fps>120)throw new Error('固定模拟时间或采样率无效');
 const scaled=time*fps,nearest=Math.round(scaled),atGrid=Math.abs(scaled-nearest)<=8*Number.EPSILON*Math.max(1,Math.abs(scaled));
 const frame=atGrid?nearest:Math.floor(scaled);
 return{frame,fraction:atGrid?0:scaled-frame,gridTime:frame/fps};
}
