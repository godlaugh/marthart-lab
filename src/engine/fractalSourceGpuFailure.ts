export type FractalSourceGpuFailureKind='input'|'capacity'|'device'|'cleanup';
/** Only device failures describe GPU unavailability. None authorize replacing
 * the explicit source arithmetic with an independent CPU/DD orbit. */
export class FractalSourceGpuError extends Error {
 constructor(message:string,readonly kind:FractalSourceGpuFailureKind,options?:ErrorOptions){super(message,options);this.name='FractalSourceGpuError';}
}
export function fractalSourceRequire(ok:unknown,reason:string,kind:FractalSourceGpuFailureKind='input'):asserts ok {if(!ok)throw new FractalSourceGpuError(reason,kind);}
export function fractalSourceDevice<T>(operation:()=>T):T {
 try{return operation();}catch(error){if(error instanceof FractalSourceGpuError||error instanceof DOMException&&error.name==='AbortError')throw error;throw new FractalSourceGpuError('Source fractal GPU operation failed','device',{cause:error});}
}
export function fractalSourceCancel(isCancelled?:()=>boolean){if(isCancelled?.())throw new DOMException('Source fractal cancelled','AbortError');}
