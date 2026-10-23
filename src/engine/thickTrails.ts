import {InstancedInterleavedBuffer,InterleavedBufferAttribute} from 'three';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import type {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import type {GeometryOutput} from '../types';
import {createScreenLineMaterial} from './thickWireframe';

type Trails=NonNullable<GeometryOutput['trails']>;
export const MAX_TRAIL_VERTICES=1_000_000,MAX_TRAIL_SEGMENTS=1_000_000;
/** Expanded instance positions + RGBA endpoints. Input ownership is unchanged. */
export function trailInstanceBytes(vertices:number,segments:number):number{
 if(!Number.isSafeInteger(vertices)||vertices<0||vertices>MAX_TRAIL_VERTICES||!Number.isSafeInteger(segments)||segments<0||segments>MAX_TRAIL_SEGMENTS)throw new Error('拖尾超过 100 万顶点或线段的呈现预算');
 return segments*14*Float32Array.BYTES_PER_ELEMENT;
}
/** Consume explicit edge identity. Never join adjacent input vertices implicitly
 * when indices exist; gaps and stopped particles remain disconnected. */
export function createThickTrails(trail:Trails,width:number,opacity:number):LineSegments2{
 if(!(trail.positions instanceof Float32Array)||!(trail.alphas instanceof Float32Array)||trail.colors!==undefined&&!(trail.colors instanceof Float32Array)||trail.indices!==undefined&&!(trail.indices instanceof Uint32Array))throw new Error('拖尾缓冲类型无效');
 const count=trail.positions.length/3,edges=trail.indices,segments=(edges?.length??count)/2;
 trailInstanceBytes(count,segments);
 if(trail.alphas.length!==count||trail.colors&&trail.colors.length!==count*3)throw new Error('拖尾顶点与颜色数据不匹配');
 if(!Number.isFinite(width)||width<0||!Number.isFinite(Math.fround(width))||!Number.isFinite(opacity)||opacity<0||opacity>1)throw new Error('拖尾宽度或不透明度无效');
 for(const value of trail.positions)if(!Number.isFinite(value))throw new Error('拖尾包含非有限顶点');
 for(const value of trail.alphas)if(!Number.isFinite(value)||value<0||value>1)throw new Error('拖尾透明度必须在 0–1');
 if(trail.colors)for(const value of trail.colors)if(!Number.isFinite(value)||value<0||value>1)throw new Error('拖尾颜色必须在 0–1');
 if(edges)for(const index of edges)if(index>=count)throw new Error('拖尾索引越界');
 // Validation and expansion budget precede all allocations and GPU ownership.
 const positions=new Float32Array(segments*6),rgba=new Float32Array(segments*8);
 for(let vertex=0;vertex<segments*2;vertex++){
  const id=edges?.[vertex]??vertex,source=id*3,p=vertex*3,c=vertex*4;
  positions[p]=trail.positions[source];positions[p+1]=trail.positions[source+1];positions[p+2]=trail.positions[source+2];
  rgba[c]=trail.colors?.[source]??1;rgba[c+1]=trail.colors?.[source+1]??1;rgba[c+2]=trail.colors?.[source+2]??1;rgba[c+3]=trail.alphas[id];
 }

 const geometry=new LineSegmentsGeometry();let material:LineMaterial|undefined;
 try{
  material=createScreenLineMaterial(width,opacity,{vertexColors:true});
  geometry.setPositions(positions);
  const data=new InstancedInterleavedBuffer(rgba,8,1);
  geometry.setAttribute('instanceColorStart',new InterleavedBufferAttribute(data,3,0));
  geometry.setAttribute('instanceColorEnd',new InterleavedBufferAttribute(data,3,4));
  geometry.setAttribute('instanceAlphaStart',new InterleavedBufferAttribute(data,1,3));
  geometry.setAttribute('instanceAlphaEnd',new InterleavedBufferAttribute(data,1,7));
  const base=material.onBeforeCompile;
  material.onBeforeCompile=(shader,renderer)=>{
   base(shader,renderer);
   if(!['void main() {','trimSegment( start, end );','trimSegment( end, start );','// clip space'].every(marker=>shader.vertexShader.includes(marker))||!shader.fragmentShader.includes('gl_FragColor = vec4( diffuseColor.rgb, alpha );'))throw new Error('拖尾线材质版本不兼容');
   // The line shader clips camera-crossing endpoints before projection. Carry
   // color and age through that same interpolation instead of stretching the
   // original end alpha over only the visible portion of a segment.
   shader.vertexShader='attribute float instanceAlphaStart;\nattribute float instanceAlphaEnd;\nvarying float vTrailAlpha;\n'+shader.vertexShader
    .replace('void main() {','void main() {\nfloat trailStartAlpha=instanceAlphaStart,trailEndAlpha=instanceAlphaEnd;vec3 trailStartColor=instanceColorStart,trailEndColor=instanceColorEnd;')
    .replace('trimSegment( start, end );','float trailOldZ=end.z;trimSegment( start, end );float trailFraction=clamp((end.z-start.z)/(trailOldZ-start.z),0.0,1.0);trailEndAlpha=mix(trailStartAlpha,trailEndAlpha,trailFraction);trailEndColor=mix(trailStartColor,trailEndColor,trailFraction);')
    .replace('trimSegment( end, start );','float trailOldZ=start.z;trimSegment( end, start );float trailFraction=clamp((start.z-end.z)/(trailOldZ-end.z),0.0,1.0);trailStartAlpha=mix(trailEndAlpha,trailStartAlpha,trailFraction);trailStartColor=mix(trailEndColor,trailStartColor,trailFraction);')
    .replace('// clip space','vTrailAlpha=(position.y<0.5)?trailStartAlpha:trailEndAlpha;vColor.xyz=(position.y<0.5)?trailStartColor:trailEndColor;\n// clip space');
   shader.fragmentShader='varying float vTrailAlpha;\n'+shader.fragmentShader.replace('gl_FragColor = vec4( diffuseColor.rgb, alpha );','gl_FragColor = vec4( diffuseColor.rgb, alpha*clamp(vTrailAlpha,0.0,1.0) );');
  };
  material.customProgramCacheKey=()=> 'mathart-butt-ended-screen-trails-rgba-v1';
  const line=new LineSegments2(geometry,material);line.frustumCulled=false;line.visible=width>0&&segments>0;line.renderOrder=1;return line;
 }catch(error){geometry.dispose();material?.dispose();throw error;}
}
