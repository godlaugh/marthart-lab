import {createSourceSurfacePoints} from './sourceSurfacePointRenderer';
import {createSourceSurfaceMeshFill} from './sourceSurfaceMeshRenderer';
import {prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import type {SourceCameraPlan} from './sourceCamera';
import {implicitMeshPresentation,createImplicitWireframe} from './implicitMeshPresentation';
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneDocument, SceneOutput, CameraState } from "../types";
import { vertexColors } from "./palette";
import {createMeshMaterial} from './meshMaterial';
import {parseMeshAppearance} from './meshAppearance';
import {createSurfaceWireframe,createThickWireframe} from './thickWireframe';
import {createThickTrails} from './thickTrails';
import {parseTrailAppearance} from './trailAppearance';
import {compositeFormulas} from './formulaCanvas';
import {fitGeometryCamera} from './cameraFit';
export class ArtRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private group = new THREE.Group();
  private ambientLight = new THREE.AmbientLight(0xffffff,0.9);
  private grid: THREE.GridHelper;
  private axes: THREE.AxesHelper;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private controls: OrbitControls;
  private raster = false;
  private cameraResolved = false;
  private sourceCameraPlan?:SourceCameraPlan;
  private interactiveRequested=true;
  private planar = false;
  private roll = 0;
  private focalLength?:number;
  private programmatic = false;
  private size: [number, number] = [1, 1];
  private fitted = false;
  private document:SceneDocument|null=null;
  private listeners = new Set<(camera: CameraState) => void>();
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.001, 100000);
    this.camera.position.set(7, 5, 8);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.addEventListener("change", () => {
      this.render();
      if(!this.programmatic)for (const fn of this.listeners) fn(this.cameraState());
    });
    this.scene.add(this.group, this.ambientLight);
    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(3, 7, 5);
    this.scene.add(light);
    this.grid = new THREE.GridHelper(10, 20, 0x34434a, 0x222c34);
    this.axes = new THREE.AxesHelper(3);
    this.grid.visible = false;
    this.axes.visible = false;
    this.scene.add(this.grid, this.axes);
  }
  onCamera(fn: (state: CameraState) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  cameraState(): CameraState {
    return {
      position: this.camera.position.toArray(),
      target: this.controls.target.toArray(),
      orthographic: this.camera instanceof THREE.OrthographicCamera,
      zoom: this.camera.zoom,
    };
  }
  setSize(width: number, height: number, pixelRatio?: number) {
    this.size = [width, height];
    if (pixelRatio) this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.updateCameraAspect();
    if(this.cameraResolved)this.fit();
    this.render();
  }
  private updateCameraAspect() {
    if(this.sourceCameraPlan)return;
    const [w, h] = this.size;
    if (this.camera instanceof THREE.PerspectiveCamera){
      this.camera.aspect = w / h;
      if(this.focalLength!==undefined)this.camera.setFocalLength(this.focalLength);
    }
    else {
      this.camera.left = (-5 * w) / h;
      this.camera.right = (5 * w) / h;
      this.camera.top = 5;
      this.camera.bottom = -5;
    }
    this.camera.updateProjectionMatrix();
  }
  private clear() {
    for (const obj of [...this.group.children]) {
      this.group.remove(obj);
      const item = obj as THREE.Mesh;
      item.geometry?.dispose();
      const materials = Array.isArray(item.material)
        ? item.material
        : [item.material];
      for (const m of materials) {
        if (m) {
          const map = (m as THREE.MeshBasicMaterial).map;
          map?.dispose();
          m.dispose();
        }
      }
    }
  }
  setOutput(output: SceneOutput, document: SceneDocument, fit = false,optics?:{roll:number;focalLength:number;camera?:CameraState}) {
    if(!!document.sourceCamera!==!!output.sourceCameraFrame)throw new Error('原版相机与已交付图像帧不匹配');
    if(output.sourceCameraFrame&&output.type!=='geometry')throw new Error('原版几何相机不能应用到已投影的像素图像');
    if(output.type==='geometry'&&output.pointAlphas&&!output.sourcePointAppearance)throw new Error('源曲面逐点透明度缺少对应的点外观');
    if(output.type==='geometry'&&output.sourcePointAppearance&&output.sourceMeshAppearance)throw new Error('源曲面点与网格外观不能混用');
    const sourcePlan=output.sourceCameraFrame?prepareOrdinarySourceFrame(output.sourceCameraFrame):undefined;
    const wasSource=!!this.sourceCameraPlan;this.sourceCameraPlan=sourcePlan;
    if(wasSource&&!sourcePlan){this.camera.matrixAutoUpdate=true;this.camera.matrixWorldAutoUpdate=true;this.updateCameraAspect();fit=true;}
    this.controls.enabled=this.interactiveRequested&&!sourcePlan;
    const implicitAppearance=document.kind==='implicit'&&output.type==='geometry'&&output.topology==='mesh'?parseMeshAppearance(document.settings):undefined;
    if(implicitAppearance&&output.type==='geometry')implicitMeshPresentation(output,implicitAppearance.wireframe);
    this.document=document;
    const cameraResolved=output.type==='raster'&&output.cameraResolved===true;
    if(cameraResolved!==this.cameraResolved)fit=true;
    this.cameraResolved=cameraResolved;
    this.clear();
    this.ambientLight.color.set(0xffffff);this.ambientLight.intensity=.9;
    const isRaster = output.type === "raster",
      planar = !sourcePlan&&(isRaster || output.dimension === 2);
    if (planar !== this.planar || isRaster !== this.raster) {
      this.raster = isRaster;
      this.planar = planar;
      this.setProjection(sourcePlan?false:planar || document.camera.orthographic);
      fit = true;
    }
    if (output.type === "raster") {
      const texture = new THREE.DataTexture(
        output.pixels,
        output.width,
        output.height,
        THREE.RGBAFormat,
      );
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      texture.flipY = true;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry((10 * output.width) / output.height, 10),
        // Native Roots pixels already contain a complete background-composited
        // framebuffer. Its GL alpha records point blending, not another layer
        // opacity. Copy RGB opaquely to avoid blending the background twice.
        new THREE.MeshBasicMaterial({ map: texture, transparent:!output.rootsPresentation }),
      );
      this.group.add(plane);
      this.controls.enableRotate = false;
    } else if(output.sourceMeshAppearance){
      if(!sourcePlan)throw new Error('源曲面网格需要对应的源相机帧');
      this.group.add(createSourceSurfaceMeshFill(output,sourcePlan,Number(document.settings.opacity??1)));
      this.controls.enableRotate=false;
    } else if(output.sourcePointAppearance){
      if(!sourcePlan)throw new Error('源曲面点外观需要对应的源相机帧');
      this.group.add(createSourceSurfacePoints(output,sourcePlan,Number(document.settings.opacity??1)));
      this.controls.enableRotate=false;
    } else {
      const colors=output.colors??vertexColors(output.positions,document.palette,String(document.settings.colorMetric??'height'));
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(output.positions,3));
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
      if (output.indices)
        geometry.setIndex(new THREE.BufferAttribute(output.indices, 1));
      const opacity = Number(document.settings.opacity ?? 1);
      let item: THREE.Object3D;
      if (output.topology === "mesh") {
        const blend=Math.max(0,Math.min(1,Number(document.settings.surfaceBlend??1)));
        geometry.computeVertexNormals();
        if(['surface','implicit'].includes(document.kind)){
          const appearance=implicitAppearance??parseMeshAppearance(document.settings);geometry.computeBoundingBox();
          this.ambientLight.color.set(appearance.ambient);this.ambientLight.intensity=1;
          item=new THREE.Mesh(geometry,createMeshMaterial(appearance,geometry.boundingBox!,opacity*blend,!!document.settings.wireframe));
          item.visible=appearance.fill&&blend>0;
          if(appearance.wireframe&&blend>0){
            const lines=document.kind==='surface'&&output.surfaceGrid
              ? createSurfaceWireframe(output,appearance,opacity*blend)
              : document.kind==='implicit'?createImplicitWireframe(output,geometry.getAttribute('position') as THREE.BufferAttribute,appearance,opacity*blend)
              : new THREE.LineSegments(new THREE.WireframeGeometry(geometry),new THREE.LineBasicMaterial({color:appearance.wireColor,transparent:true,opacity:opacity*blend,depthWrite:false}));
            this.group.add(lines);
          }
        }else item=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.55,metalness:.12,wireframe:!!document.settings.wireframe,transparent:opacity*blend<1,opacity:opacity*blend,depthWrite:blend===1&&opacity===1}));
        if(blend<1){const pointsGeometry=new THREE.BufferGeometry();pointsGeometry.setAttribute('position',geometry.getAttribute('position'));pointsGeometry.setAttribute('color',geometry.getAttribute('color'));this.group.add(new THREE.Points(pointsGeometry,new THREE.PointsMaterial({vertexColors:true,size:Number(document.settings.pointSize??2),sizeAttenuation:false,transparent:true,opacity:opacity*(1-blend),depthWrite:false})));}
      } else if (document.kind==='surface' && output.surfaceGrid && document.settings.renderMode==='wireframe') {
        const appearance=parseMeshAppearance(document.settings);
        geometry.dispose();
        item=createSurfaceWireframe(output,appearance,opacity);
      } else if (output.topology === "points") {
        item = new THREE.Points(
          geometry,
          new THREE.PointsMaterial({
            vertexColors: true,
            size: Number(document.settings.pointSize ?? 2),
            sizeAttenuation: false,
            transparent: true,
            opacity,
            depthWrite: opacity === 1,
          }),
        );
      } else {
        const material = new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: opacity < 1,
          opacity,
        });
        item =
          output.topology === "segments"
            ? new THREE.LineSegments(geometry, material)
            : new THREE.Line(geometry, material);
      }
      this.group.add(item);
      this.controls.enableRotate = !planar;
    }
    if(output.type==='geometry'&&output.lineOverlays){
      for(const overlay of output.lineOverlays){
        const line=createThickWireframe(overlay.positions,overlay.color,overlay.width,overlay.opacity);
        line.renderOrder=2;line.material.depthTest=false;this.group.add(line);
      }
    }
    if(output.type==='geometry'&&output.trails){
      const trail=output.trails;
      const colors=trail.colors??vertexColors(trail.positions,document.palette,String(document.settings.colorMetric??'height'));
      const lines=createThickTrails({...trail,colors},trail.appearance?.width??parseTrailAppearance(document.settings).width,Number(document.settings.opacity??1));
      if(trail.appearance?.overlay){lines.material.depthTest=false;lines.renderOrder=2;}
      this.group.add(lines);
    }
    this.renderer.setClearColor(
      String(document.settings.background ?? "#111317"),
      document.settings.transparentBackground?0:1,
    );
    this.grid.visible = !!document.settings.showGrid && !isRaster;
    this.axes.visible = !!document.settings.showAxes && !isRaster;
    if(sourcePlan){this.fitted=true;this.render();return;}
    if(optics)this.configureCameraEffects(optics.roll,optics.focalLength);
    // A supplied final camera takes precedence over automatic fitting. Fitting
    // first would publish an intermediate OrbitControls change to the editor.
    if(optics?.camera&&!this.cameraResolved){this.setCamera(optics.camera);this.fitted=true;}
    else if (fit || !this.fitted || this.cameraResolved) this.fit();
    this.render();
  }
  setProjection(orthographic: boolean) {
    const state = this.cameraState();
    this.controls.dispose();
    this.camera = orthographic
      ? new THREE.OrthographicCamera(-5, 5, 5, -5, 0.001, 100000)
      : new THREE.PerspectiveCamera(40, 1, 0.001, 100000);
    this.camera.position.fromArray(state.position);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.fromArray(state.target);
    this.controls.enableRotate = !this.planar;
    this.controls.enabled=this.interactiveRequested&&!this.sourceCameraPlan;
    this.controls.addEventListener("change", () => {
      this.render();
      if(!this.programmatic)for (const fn of this.listeners) fn(this.cameraState());
    });
    this.updateCameraAspect();
  }
  setCamera(state: CameraState) {
    if(this.cameraResolved||this.sourceCameraPlan)return;
    this.programmatic=true;
    try {
    if (state.orthographic !== this.camera instanceof THREE.OrthographicCamera)
      this.setProjection(state.orthographic);
    this.camera.position.fromArray(state.position);
    this.controls.target.fromArray(state.target);
    this.camera.zoom = state.zoom;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
    } finally {this.programmatic=false;}
  }
  private configureCameraEffects(roll:number,focalLength:number){
    if(this.cameraResolved){this.roll=0;return;}
    this.roll=Number.isFinite(roll)?roll:0;
    if(Number.isFinite(focalLength)&&focalLength>0){this.focalLength=focalLength;if(this.camera instanceof THREE.PerspectiveCamera)this.camera.setFocalLength(focalLength);}
  }
  setCameraEffects(roll=0,focalLength=35){
    this.configureCameraEffects(roll,focalLength);
    this.render();
  }
  fit() {
    if(this.sourceCameraPlan)return;
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    if (this.planar) {
      this.camera.position.copy(center).add(new THREE.Vector3(0, 0, 20));
      this.controls.target.copy(center);
      const span=this.cameraResolved?10:8;
      this.camera.zoom = Math.min(
        (span * this.size[0]) / this.size[1] / Math.max(size.x, 0.01),
        span / Math.max(size.y, 0.01),
      );
    } else {
      const fitted=fitGeometryCamera(box.min.toArray(),box.max.toArray(),this.camera instanceof THREE.PerspectiveCamera
        ?{kind:'perspective',verticalFov:this.camera.fov,aspect:this.camera.aspect}
        :{kind:'orthographic',width:this.camera.right-this.camera.left,height:this.camera.top-this.camera.bottom});
      this.controls.target.copy(center);
      this.camera.position
        .copy(center)
        .add(
          new THREE.Vector3(1, 0.65, 1)
            .normalize()
            .multiplyScalar(fitted.distance),
        );
      this.camera.zoom=fitted.zoom;
      // Fit may extend clipping coverage, but must not shrink the manual and
      // timeline camera's existing travel range after the user moves again.
      this.camera.near=Math.min(this.camera.near,fitted.near);this.camera.far=Math.max(this.camera.far,fitted.far);
    }
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.fitted = true;
    this.render();
  }
  setInteractive(enabled: boolean) {
    this.interactiveRequested=enabled;
    this.controls.enabled = enabled&&!this.sourceCameraPlan;
  }
  render() {
    if(this.sourceCameraPlan){
      const plan=this.sourceCameraPlan;
      this.camera.matrixAutoUpdate=false;this.camera.matrixWorldAutoUpdate=false;
      this.camera.projectionMatrix.fromArray(plan.projection.columnMajor);
      this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
      this.camera.matrixWorldInverse.fromArray(plan.modelView.columnMajor);
      this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
      this.camera.matrix.copy(this.camera.matrixWorld);
      this.camera.position.setFromMatrixPosition(this.camera.matrixWorld);
    }else{
      this.camera.lookAt(this.controls.target);
      if(this.roll)this.camera.rotateZ(this.roll);
    }
    this.renderer.render(this.scene, this.camera);
  }
  async blob(type = "image/png", quality = 0.95): Promise<Blob> {
    this.render();
    const canvas=this.document?await compositeFormulas(this.renderer.domElement,this.document):this.renderer.domElement;
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("图像导出失败"))),
        type,
        quality,
      ),
    );
  }
  dispose() {
    this.clear();
    this.controls.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.axes.geometry.dispose();
    (this.axes.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }
}
