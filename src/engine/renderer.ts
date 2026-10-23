import {hasFormulaComposition} from './formulaConfig';
import {snapshotSourceDrawings,type SourceDrawingResult} from './sourceDrawingSnapshot';
import type {SourceDrawingFrame} from './sourceDrawingFrame';
import {usesSourceImplicitCpuMesh} from './sourceImplicitPresentation';
import {createSourceImplicitMesh} from './sourceImplicitRenderer';
import {usesSourceMapPresentation} from './sourceMapPresentation';
import {usesSourceSymmetryPresentation} from './sourceSymmetryPresentation';
import {usesSourceBouncing} from './sourceBouncingDocument';
import {usesSourceSamilaPresentation} from './sourceSamilaPresentation';
import {createSourceParticleTrailLines} from './sourceProcessingLineRenderer';
import {createSourceSurfaceGpuMesh} from './sourceSurfaceGpuMeshRenderer';
import {createSourceParticlePoints} from './sourceParticlePointRenderer';
import {createSourceSurfaceMeshFill} from './sourceSurfaceMeshRenderer';
import {createSourceSurfaceMeshLines} from './sourceSurfaceLineRenderer';
import {writeSourcePackedColor} from './sourceProcessingGeometry';
import {createSourceSurfaceOverlay} from './sourceSurfaceOverlay';
import {prepareOrdinarySourceFrame} from './ordinarySourceCamera';
import type {SourceCameraPlan} from './sourceCamera';
import {implicitMeshPresentation,createImplicitWireframe} from './implicitMeshPresentation';
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SceneDocument, SceneOutput, CameraState, RasterOutput, FormulaPresentation } from "../types";
import { vertexColors } from "./palette";
import {createMeshMaterial} from './meshMaterial';
import {parseMeshAppearance} from './meshAppearance';
import {createSurfaceWireframe,createThickWireframe} from './thickWireframe';
import {createThickTrails} from './thickTrails';
import {parseTrailAppearance} from './trailAppearance';
import {compositeFormulas,type FormulaCompositeOptions} from './formulaCanvas';
import {compositeSourceFormulaPixels,formulaBasePixels} from './sourceFormulaCompositor';
import {formulaPresentation} from './formulas';
import {encodeRgbaPng} from './rgbaPng';
import {MAX_RASTER_PIXELS} from './rasterDimensions';
import {fitGeometryCamera} from './cameraFit';
import {usesSourceSurfaceGeometry} from './sourceSurfaceIdentity';
export type ArtRendererPurpose='display'|'local-export'|'source-offscreen-export';
/** Context attributes are fixed at allocation. MathArt.ensureRenderBuffer(F)
 * calls noSmooth before beginDraw; primary display smoothing is separate.
 * Source Surface and CPU Implicit use this verified offscreen policy. */
export function artExportPurpose(scene:SceneDocument):ArtRendererPurpose {
  return usesSourceSurfaceGeometry(scene)||usesSourceImplicitCpuMesh(scene)?'source-offscreen-export':'local-export';
}
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
  private sourceClear?:readonly [number,number,number,number];
  private sourceCompositedRaster?:RasterOutput;
  private formulaFrame?:FormulaPresentation;
  private readonly surfaceOverlayScene=new THREE.Scene();
  private surfaceOverlay?:ReturnType<typeof createSourceSurfaceOverlay>;
  private interactiveRequested=true;
  private planar = false;
  private shaderFailure:Error|undefined;
  private roll = 0;
  private focalLength?:number;
  private programmatic = false;
  private size: [number, number] = [1, 1];
  private fitted = false;
  private document:SceneDocument|null=null;
  private listeners = new Set<(camera: CameraState) => void>();
  constructor(canvas: HTMLCanvasElement, purpose:ArtRendererPurpose='display') {
    if(!['display','local-export','source-offscreen-export'].includes(purpose))throw new Error('未知绘图目标');
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: purpose!=='source-offscreen-export',
      preserveDrawingBuffer: true,
      alpha: true,
    });
    this.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{
      this.shaderFailure=new Error(`渲染着色器编译或链接失败：${gl.getProgramInfoLog(program)??''} ${gl.getShaderInfoLog(vertex)??''} ${gl.getShaderInfoLog(fragment)??''}`);
      // Three r180 calls this before deleting its two shader objects. Abort
      // before it queries uniforms or draws an invalid program, completing
      // that cleanup here. The material/program cache still owns the program.
      gl.deleteShader(vertex);gl.deleteShader(fragment);throw this.shaderFailure;
    };
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
    this.shaderFailure=undefined;
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
    if(output.type==='geometry'&&output.sourceGpuMesh&&(output.backend!=='webgl2'||output.topology!=='mesh'||output.positions.length||output.sourcePointAppearance||output.sourceMeshAppearance||output.sourceGpuPoints))throw new Error('GPU 网格需要独立的种子缓冲与匹配后端');
    if(output.type==='geometry'&&output.sourceGpuPoints&&(!output.sourcePointAppearance||output.backend!=='webgl2'))throw new Error('GPU 曲面种子缺少匹配的点外观与后端');
    if(usesSourceBouncing(document)!==!!output.sourceBouncingFrame||output.sourceBouncingFrame&&(output.type!=='raster'||!output.cameraResolved))throw new Error('源弹跳需要与文档配对的已投影图像');
    const sourceMap=output.type==='raster'?output.sourceMapPresentation:undefined,sourceSamila=output.type==='raster'?output.sourceSamilaPresentation:undefined,sourceSymmetry=output.type==='raster'?output.sourceSymmetryPresentation:undefined;
    if(usesSourceMapPresentation(document)!==!!sourceMap||sourceMap&&(output.type!=='raster'||!output.cameraResolved||sourceMap.model!=='map-present-1.7.8'||sourceMap.stage!=='scene-target-rgba8'||sourceMap.display!=='opaque-rgb-copy'))throw Error('源 Map 需要与文档配对的场景合成图像');
    if(usesSourceSymmetryPresentation(document)!==!!sourceSymmetry||sourceSymmetry&&(output.type!=='raster'||!output.cameraResolved||sourceSymmetry.model!=='symmetry-present-1.7.8'||sourceSymmetry.stage!=='scene-target-rgba8'||sourceSymmetry.display!=='opaque-rgb-copy'))throw Error('源 Symmetry 需要与文档配对的场景合成图像');
    if(usesSourceSamilaPresentation(document)!==!!sourceSamila||sourceSamila&&(output.type!=='raster'||!output.cameraResolved||sourceSamila.model!=='samila-present-1.7.8'||sourceSamila.stage!=='present-target-rgba8'||sourceSamila.display!=='opaque-rgb-copy'))throw new Error('源 Samila 需要与文档配对的已合成图像');
    if(!!document.sourceCamera!==!!output.sourceCameraFrame)throw new Error('原版相机与已交付图像帧不匹配');
    if(output.sourceCameraFrame&&output.type==='raster'&&!output.cameraResolved)throw new Error('源相机像素图像必须已完成投影');
    if(output.type==='geometry'&&output.pointAlphas&&!output.sourcePointAppearance)throw new Error('源曲面逐点透明度缺少对应的点外观');
    if(output.type==='geometry'&&output.sourcePointAppearance&&output.sourceMeshAppearance)throw new Error('源曲面点与网格外观不能混用');
    if(output.type==='geometry'&&output.sourceMeshWireframe&&!output.sourceMeshAppearance)throw new Error('源曲面线框缺少对应网格外观');
    if(output.type==='geometry'&&output.sourceBackgroundColor!==undefined&&(!(output.sourceMeshAppearance||output.sourcePointAppearance||output.sourceGpuMesh||output.sourceImplicitPresentation)||!Number.isInteger(output.sourceBackgroundColor)||output.sourceBackgroundColor<0||output.sourceBackgroundColor>0xffffffff))throw new Error('源曲面背景需要对应源几何和 uint32 颜色');
    const overlayAlpha=output.type==='geometry'?output.sourceSurfaceOverlayAlpha:undefined;
    if(overlayAlpha!==undefined&&(output.type!=='geometry'||output.sourceBackgroundColor===undefined||!Number.isInteger(overlayAlpha)||overlayAlpha<0||overlayAlpha>255))throw new Error('源曲面遮罩需要对应背景与 0–255 透明度');
    // A source raster carries its camera as provenance; its producer already
    // projected the pixels. Validate the frame without applying it twice.
    const deliveredSourcePlan=output.sourceCameraFrame?prepareOrdinarySourceFrame(output.sourceCameraFrame):undefined;
    const sourcePlan=output.type==='geometry'?deliveredSourcePlan:undefined;
    const wasSource=!!this.sourceCameraPlan;this.sourceCameraPlan=sourcePlan;
    if(wasSource&&!sourcePlan){this.camera.matrixAutoUpdate=true;this.camera.matrixWorldAutoUpdate=true;this.updateCameraAspect();fit=true;}
    this.controls.enabled=this.interactiveRequested&&!sourcePlan;
    const implicitAppearance=!usesSourceImplicitCpuMesh(document)&&document.kind==='implicit'&&output.type==='geometry'&&output.topology==='mesh'?parseMeshAppearance(document.settings):undefined;
    if(implicitAppearance&&output.type==='geometry')implicitMeshPresentation(output,implicitAppearance.wireframe);
    this.document=document;
    this.formulaFrame=output.formulaPresentation;
    this.sourceCompositedRaster=(sourceMap||sourceSamila||sourceSymmetry)&&output.type==='raster'?output:undefined;
    const cameraResolved=output.type==='raster'&&output.cameraResolved===true;
    if(cameraResolved!==this.cameraResolved)fit=true;
    this.cameraResolved=cameraResolved;
    this.clear();
    if(overlayAlpha){if(!this.surfaceOverlay){this.surfaceOverlay=createSourceSurfaceOverlay();this.surfaceOverlayScene.add(this.surfaceOverlay);}this.surfaceOverlay.material.uniforms.alpha.value=Math.fround(overlayAlpha/255);}
    if(this.surfaceOverlay)this.surfaceOverlay.visible=!!overlayAlpha;
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
        // These producers deliver completed framebuffer RGB. Their alpha
        // records native blending, not another layer opacity. Samila's normal
        // native window copies the target with blending disabled to an opaque
        // surface; PNG preserves the separately retained target alpha below.
        new THREE.MeshBasicMaterial({ map: texture, transparent:!output.rootsPresentation&&!output.sourceBouncingFrame&&!sourceMap&&!sourceSamila&&!sourceSymmetry }),
      );
      this.group.add(plane);
      this.controls.enableRotate = false;
    } else if(output.sourceImplicitPresentation){
      if(!sourcePlan||!usesSourceImplicitCpuMesh(document))throw Error('源隐式曲面显示需要匹配的文档与相机帧');
      const {fill,lines}=createSourceImplicitMesh(output,sourcePlan);this.group.add(fill);if(lines)this.group.add(lines);this.controls.enableRotate=false;
    } else if(output.sourceGpuMesh){
      if(!sourcePlan)throw new Error('源 GPU 网格需要对应相机帧');
      const {fill,wire}=createSourceSurfaceGpuMesh(output.sourceGpuMesh,sourcePlan,Number(document.settings.opacity??1));
      if(fill)this.group.add(fill);if(wire)this.group.add(wire);this.controls.enableRotate=false;
    } else if(output.sourceMeshAppearance){
      if(!sourcePlan)throw new Error('源曲面网格需要对应的源相机帧');
      const opacity=Number(document.settings.opacity??1),fill=createSourceSurfaceMeshFill(output,sourcePlan,opacity);
      try{
        const lines=output.sourceMeshWireframe?createSourceSurfaceMeshLines(output.sourceMeshWireframe,sourcePlan,opacity):undefined;
        this.group.add(fill);if(lines)this.group.add(lines);
      }catch(error){fill.geometry.dispose();fill.material.dispose();throw error;}
      this.controls.enableRotate=false;
    } else if(output.sourcePointAppearance){
      if(!sourcePlan)throw new Error('源曲面点外观需要对应的源相机帧');
      this.group.add(createSourceParticlePoints(output,sourcePlan,Number(document.settings.opacity??1),Math.max(1,this.renderer.capabilities.getMaxAnisotropy())));
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
      const native=trail.appearance?.model==='processing-lines-1.7.8';
      if(native&&(!sourcePlan||!output.sourcePointAppearance||!trail.indices||!trail.colors||!trail.appearance?.overlay))throw new Error('源粒子拖尾需要相机、点外观、索引、颜色和叠加样式');
      const width=trail.appearance?.width??parseTrailAppearance(document.settings).width,opacity=Number(document.settings.opacity??1);
      const lines=native?createSourceParticleTrailLines({positions:trail.positions,colors:trail.colors!,alphas:trail.alphas,indices:trail.indices!},width,sourcePlan!,opacity):createThickTrails({...trail,colors},width,opacity);
      if(trail.appearance?.overlay){lines.material.depthTest=false;lines.renderOrder=2;}
      this.group.add(lines);
    }
    const sourceBackground=output.type==='geometry'?output.sourceBackgroundColor:undefined;
    // Source shaders and P3D clear colors are already display channel values.
    // Keep screen and offscreen clear paths in the same raw channel space.
    this.renderer.outputColorSpace=sourceBackground===undefined?THREE.SRGBColorSpace:THREE.LinearSRGBColorSpace;
    if(sourceBackground!==undefined){
      const rgba=new Float32Array(4);writeSourcePackedColor(sourceBackground,rgba,0);
      this.sourceClear=[rgba[0],rgba[1],rgba[2],document.settings.transparentBackground?0:rgba[3]];
      this.renderer.setClearColor(new THREE.Color().setRGB(rgba[0],rgba[1],rgba[2]),this.sourceClear[3]);
    }else{
      this.sourceClear=undefined;
      this.renderer.setClearColor(String(document.settings.background??'#111317'),document.settings.transparentBackground?0:1);
    }
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
    if(this.shaderFailure)throw this.shaderFailure;
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
    if(this.sourceClear){
      // Processing passes straight RGBA directly to glClearColor. Three's
      // ordinary canvas clear premultiplies RGB, even for render targets.
      // Use Three's state owner to preserve its cache and restore ordinary
      // automatic clearing after this source-only render.
      const state=this.renderer.state,autoClear=this.renderer.autoClear;
      try{
        state.buffers.color.setMask(true);state.buffers.depth.setMask(true);
        state.buffers.color.setClear(...this.sourceClear,false);this.renderer.clear(true,true,true);
        this.renderer.autoClear=false;this.renderer.render(this.scene,this.camera);
      }finally{this.renderer.autoClear=autoClear;}
    }else this.renderer.render(this.scene, this.camera);
    if(this.surfaceOverlay?.visible){
      const autoClear=this.renderer.autoClear;
      try{this.renderer.autoClear=false;this.renderer.render(this.surfaceOverlayScene,this.camera);}finally{this.renderer.autoClear=autoClear;}
    }
  }
  /** Capture the render lists owned and sorted by Three, including the final
   * overlay pass. Unsupported draw types fail rather than disappearing. */
  sourceDrawingFrame(generation:number,sequence:number):SourceDrawingResult<SourceDrawingFrame>{
    if(!this.sourceCameraPlan||this.raster)return{ok:false,error:{kind:'unsupported',path:['frame'],reason:'当前画面不是可提交原生绘制的源几何帧'}};
    this.render();const gl=this.renderer.getContext();
    if(gl.isContextLost()||gl.isEnabled(gl.SCISSOR_TEST))return{ok:false,error:{kind:'unsupported',path:['frame'],reason:'原生帧暂不支持丢失的上下文或裁剪视口'}};
    const viewport=gl.getParameter(gl.VIEWPORT) as Int32Array;if(viewport[0]!==0||viewport[1]!==0||viewport[2]!==gl.drawingBufferWidth||viewport[3]!==gl.drawingBufferHeight)return{ok:false,error:{kind:'unsupported',path:['frame'],reason:'原生帧需要完整物理视口'}};
    const meshes:THREE.Mesh[]=[];
    const scenes=[this.scene,...(this.surfaceOverlay?.visible?[this.surfaceOverlayScene]:[])];
    for(const scene of scenes){
      const list=this.renderer.renderLists.get(scene,0);
      if(list.transmissive.length)return{ok:false,error:{kind:'unsupported',path:['draws'],reason:'原生绘制尚不支持透射材质'}};
      for(const item of [...list.opaque,...list.transparent]){
        if(!(item.object instanceof THREE.Mesh)||item.material!==item.object.material||item.geometry!==item.object.geometry||item.group)return{ok:false,error:{kind:'unsupported',path:['draws'],reason:'原生绘制包含尚未支持的对象或分组'}};
        meshes.push(item.object);
      }
    }
    const drawing=snapshotSourceDrawings(meshes);if(!drawing.ok)return drawing;
    // Read the actual clear state. Source packed colors and legacy Three
    // backgrounds have different conversion/alpha rules, already applied here.
    const clear=Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array) as [number,number,number,number];
    return{ok:true,value:{generation,sequence,width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,samples:gl.getParameter(gl.SAMPLES) as number,clear,drawing:drawing.value}};
  }
  private sourceFramebufferPixels(isCancelled:()=>boolean){
    if(isCancelled())throw new DOMException('图像导出已取消','AbortError');
    const gl=this.renderer.getContext(),width=gl.drawingBufferWidth,height=gl.drawingBufferHeight;
    if(!Number.isSafeInteger(width*height)||width*height>MAX_RASTER_PIXELS)throw new Error('源网格 PNG 超过共享 RGBA 图像容量');
    const pixels=new Uint8ClampedArray(width*height*4);
    gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.isContextLost()||gl.getError()!==gl.NO_ERROR)throw new Error('源网格 PNG 像素回读失败');
    const stride=width*4,row=new Uint8ClampedArray(stride);
    for(let y=0;y<Math.floor(height/2);y++){
      if((y&63)===0&&isCancelled())throw new DOMException('图像导出已取消','AbortError');
      const a=y*stride,b=(height-1-y)*stride;row.set(pixels.subarray(a,a+stride));pixels.copyWithin(a,b,b+stride);pixels.set(row,b);
    }
    return{pixels,width,height};
  }
  async blob(type = "image/png", quality = 0.95, options?:Omit<FormulaCompositeOptions,'sourceImageProcessing'>&{sourcePresentationAlpha:'preserve'|'opaque'}): Promise<Blob> {
    this.render();
    if(options?.signal?.aborted||options?.isCancelled?.())throw new DOMException('图像导出已取消','AbortError');
    if((this.document?.fractalSource||this.document?.formulas?.layout==='source-surface-centered-v1')&&!this.formulaFrame)throw new Error('源图像缺少实际帧的公式标注');
    const presentation=this.formulaFrame??(this.document?formulaPresentation(this.document):undefined);
    const isCancelled=()=>!!options?.signal?.aborted||!!options?.isCancelled?.();
    if(this.sourceCompositedRaster&&type==='image/png'&&!hasFormulaComposition(presentation)){
      const frame=this.sourceCompositedRaster,gl=this.renderer.getContext();
      if(frame.width!==gl.drawingBufferWidth||frame.height!==gl.drawingBufferHeight)throw new Error('源合成图像导出尺寸必须与已生成图像一致');
      if(!Number.isSafeInteger(frame.width*frame.height)||frame.width*frame.height>MAX_RASTER_PIXELS||frame.pixels.length!==frame.width*frame.height*4)throw new Error('源合成图像导出超过共享 RGBA 图像容量或像素不完整');
      // Canvas serializes a composited display, not the native target bytes.
      // Preserve PNG RGBA explicitly. Video keeps that target RGB and makes
      // alpha opaque before PNG transport; no additional background mix.
      return encodeRgbaPng(frame.pixels,frame.width,frame.height,isCancelled,{alpha:options?.sourcePresentationAlpha??'preserve'});
    }
    if(this.sourceClear&&type==='image/png'&&!hasFormulaComposition(presentation)){
      // Canvas.toBlob would unpremultiply source framebuffer bytes. Reuse the
      // existing lossless encoder for unannotated source PNGs, including hidden
      // RGB at alpha zero. Annotated/non-PNG exports retain their compositor.
      const {pixels,width,height}=this.sourceFramebufferPixels(isCancelled);
      return encodeRgbaPng(pixels,width,height,isCancelled);
    }
    if(type==='image/png'&&presentation?.layout==='source-surface-centered-v1'&&hasFormulaComposition(presentation)){
      const canvas=this.renderer.domElement,{width,height}=canvas;
      if(this.sourceCompositedRaster&&(this.sourceCompositedRaster.width!==width||this.sourceCompositedRaster.height!==height))throw new Error('源合成图像导出尺寸必须与已生成图像一致');
      const pixels=await compositeSourceFormulaPixels(this.sourceCompositedRaster?.pixels??formulaBasePixels(canvas),width,height,presentation,options?.signal);
      if(isCancelled())throw new DOMException('图像导出已取消','AbortError');
      return encodeRgbaPng(pixels,width,height,isCancelled,{alpha:options?.sourcePresentationAlpha??'preserve'});
    }
    const source=this.renderer.domElement;
    const canvas=presentation?await compositeFormulas(source,presentation,options):source;
    try{
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('图像导出失败')),type,quality));
      if(isCancelled())throw new DOMException('图像导出已取消','AbortError');
      return blob;
    }finally{if(canvas!==source)canvas.width=canvas.height=0;}
  }

  dispose() {
    this.clear();
    this.sourceCompositedRaster=undefined;this.formulaFrame=undefined;this.document=null;
    this.surfaceOverlay?.geometry.dispose();this.surfaceOverlay?.material.dispose();this.surfaceOverlayScene.clear();
    this.controls.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.axes.geometry.dispose();
    (this.axes.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.listeners.clear();
  }
}
