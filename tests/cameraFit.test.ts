import{describe,it,expect}from'vitest';
import*as THREE from'three';
import{fitGeometryCamera,type GeometryFitProjection}from'../src/engine/cameraFit';
const min:[number,number,number]=[-1,-2,-.5],max:[number,number,number]=[1,2,.5];
function projected(camera:THREE.PerspectiveCamera|THREE.OrthographicCamera,roll:number){
 const job=fitGeometryCamera(min,max,camera instanceof THREE.PerspectiveCamera?{kind:'perspective',verticalFov:camera.fov,aspect:camera.aspect}:{kind:'orthographic',width:camera.right-camera.left,height:camera.top-camera.bottom});
 const center=new THREE.Vector3(...job.center);camera.position.copy(center).add(new THREE.Vector3(1,.65,1).normalize().multiplyScalar(job.distance));camera.zoom=job.zoom;camera.near=job.near;camera.far=job.far;camera.lookAt(center);camera.rotateZ(roll);camera.updateMatrixWorld();camera.updateProjectionMatrix();
 const points=[];for(const x of[min[0],max[0]])for(const y of[min[1],max[1]])for(const z of[min[2],max[2]])points.push(new THREE.Vector3(x,y,z).project(camera));return points;
}
describe('geometry camera fit uses final lens and both viewport dimensions',()=>{
 it.each([[228,630],[800,600],[630,228],[640,640]])('fits all bounding corners at %sx%s for both projections, focal lengths and roll',(width,height)=>{
  const aspect=width/height;
  for(const focal of[12,35,120,1000])for(const roll of[0,.7,Math.PI/2]){const camera=new THREE.PerspectiveCamera(40,aspect,.001,1e5);camera.setFocalLength(focal);for(const point of projected(camera,roll)){expect(Math.abs(point.x)).toBeLessThan(1);expect(Math.abs(point.y)).toBeLessThan(1);expect(Math.abs(point.z)).toBeLessThan(1);}}
  for(const roll of[0,.7,Math.PI/2])for(const point of projected(new THREE.OrthographicCamera(-5*aspect,5*aspect,5,-5,.001,1e5),roll)){expect(Math.abs(point.x)).toBeLessThan(1);expect(Math.abs(point.y)).toBeLessThan(1);expect(Math.abs(point.z)).toBeLessThan(1);}
 });
 it('fits a translated or degenerate finite box and retains clipping coverage',()=>{
  const p:GeometryFitProjection={kind:'perspective',verticalFov:40,aspect:.36},a=fitGeometryCamera(min,max,p),shift=fitGeometryCamera([999,998,999.5],[1001,1002,1000.5],p);expect(shift.center).toEqual([1000,1000,1000]);expect(shift.distance).toBe(a.distance);expect(shift.near).toBeLessThan(shift.distance-shift.radius);expect(shift.far).toBeGreaterThan(shift.distance+shift.radius);
  expect(fitGeometryCamera([0,0,0],[0,0,0],p).distance).toBeGreaterThan(0);
 });
 it('rejects invalid bounds and projections before producing nonfinite cameras',()=>{
  for(const projection of[{kind:'perspective',verticalFov:0,aspect:1},{kind:'perspective',verticalFov:180,aspect:1},{kind:'perspective',verticalFov:40,aspect:0},{kind:'perspective',verticalFov:NaN,aspect:1},{kind:'orthographic',width:0,height:10},{kind:'orthographic',width:10,height:Infinity}] as GeometryFitProjection[])expect(()=>fitGeometryCamera(min,max,projection)).toThrow();
  expect(()=>fitGeometryCamera([NaN,0,0],max,{kind:'perspective',verticalFov:40,aspect:1})).toThrow();expect(()=>fitGeometryCamera(max,min,{kind:'perspective',verticalFov:40,aspect:1})).toThrow();
 });
});
