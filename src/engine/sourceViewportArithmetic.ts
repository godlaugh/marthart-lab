/** MathArt.mouseDragged/mouseWheel arithmetic shared by native scene families.
 * Callers validate finite Float32 inputs and own pause/identity/event policy. */
const F=Math.fround;
export function sourceViewportRotation(phi:number,theta:number,dx:number,dy:number){
 return{phi:F(phi+F(dy*F(.01))),theta:F(theta-F(dx*F(.01)))};
}
export function sourceViewportZoom(zoom:number,count:number):number {
 // Native widens 1.05f and zoom, then narrows the double pow product once.
 return Math.max(F(.01),Math.min(1000,F(zoom*Math.pow(F(1.05),-count))));
}
