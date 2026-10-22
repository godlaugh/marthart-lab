/** The canvas element owns its CSS fit/letterboxing. Source labels consume its
 * measured rectangle instead of repeating project-resolution fitting rules. */
export function formulaOverlayRect(host:{left:number;top:number;width:number;height:number},canvas:{left:number;top:number;width:number;height:number}|undefined,source:boolean){
 if(!source)return{left:0,top:0,width:host.width,height:host.height};
 if(!canvas)return{left:0,top:0,width:0,height:0};
 return{left:canvas.left-host.left,top:canvas.top-host.top,width:canvas.width,height:canvas.height};
}
