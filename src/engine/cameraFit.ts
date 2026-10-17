type Point3=readonly[number,number,number];
export type GeometryFitProjection={kind:'perspective';verticalFov:number;aspect:number}|{kind:'orthographic';width:number;height:number};
/** Conservative fit of the world-space bounding sphere. The sphere makes the
 * result independent of view direction and roll, including portrait canvases.
 * Lens/projection facts must already describe the final camera configuration. */
export function fitGeometryCamera(min:Point3,max:Point3,projection:GeometryFitProjection){
 if(!min.every(Number.isFinite)||!max.every(Number.isFinite)||max.some((v,i)=>v<min[i]))throw Error('相机适配边界无效');
 const center=min.map((v,i)=>v/2+max[i]/2) as[number,number,number],half=min.map((v,i)=>max[i]/2-v/2);
 const radius=Math.max(.005,Math.hypot(...half)),padding=1.08;
 let distance:number,zoom:number;
 if(projection.kind==='perspective'){
  const{verticalFov,aspect}=projection;if(!Number.isFinite(verticalFov)||verticalFov<=0||verticalFov>=180||!Number.isFinite(aspect)||aspect<=0)throw Error('相机适配投影无效');
  const vertical=verticalFov*Math.PI/360,horizontal=Math.atan(Math.tan(vertical)*aspect);
  distance=padding*radius/Math.sin(Math.min(vertical,horizontal));zoom=1;
 }else{
  const{width,height}=projection;if(!Number.isFinite(width)||width<=0||!Number.isFinite(height)||height<=0)throw Error('相机适配投影无效');
  distance=radius*2;zoom=Math.min(width,height)/(2*radius*padding);
 }
 const near=(distance-radius)/2,far=(distance+radius)*2;
 if(![radius,distance,zoom,near,far].every(v=>Number.isFinite(v)&&v>0))throw Error('相机适配范围不可表示');
 return{center,radius,distance,zoom,near,far};
}
