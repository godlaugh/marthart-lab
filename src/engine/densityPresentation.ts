import {validateSamilaView,type PreparedSamilaView} from './samilaCamera';
import {validateCapturedDensityView,type PreparedCapturedDensityView} from './sourceDensityCamera';

/** Presentation facts retain their producer's identity. Captured Map/Sym
 * views do not borrow the Samila rotation model or its nearest-only policy. */
export type PreparedDensityView=PreparedSamilaView|PreparedCapturedDensityView;
export function isCapturedDensityView(view:PreparedDensityView):view is PreparedCapturedDensityView{return 'family' in view;}
export function validateDensityView(view:PreparedDensityView,width:number,height:number):void{
 if(isCapturedDensityView(view))validateCapturedDensityView(view,width,height);
 else validateSamilaView(view,width,height);
}
