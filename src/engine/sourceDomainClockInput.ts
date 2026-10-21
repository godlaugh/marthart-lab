/** Domain parameter animation consumes a finite Float32 observation. Zero and
 * signed rates retain their source meaning; simulation FPS is a separate input. */
export function validateSourceDomainFrameRate(value:unknown):asserts value is number {if(typeof value!=='number'||!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))throw Error('域着色宿主帧率必须为有限 Float32');}
