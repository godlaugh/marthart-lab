import {prepareSourcePerlinGpuFrame,sourcePerlinGpuChannelLayout,sourcePerlinPackedRgba,SourcePerlinGpuError,type SourcePerlinGpuFrame,type SourcePerlinGpuChannel} from './sourcePerlinGpu';
import {sourcePerlinFragmentBody} from './sourcePerlinGpuShader';
import type {SourceDrawingSnapshot,SourceDrawingUniform} from './sourceDrawingSnapshot';
import {SOURCE_FRAME_BUDGET} from './sourceDrawingFrame';

const vertexShader=`uniform mat4 transform;
in vec4 vertex;
void main() { gl_Position = transform * vertex; }
`;
type Numeric={name:string;kind:'float'|'int'|'vec2'|'mat4';values:readonly number[]};
const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] as const;
const scalarKeys=['time','noiseFrequency','warpAmplitude','warpFrequency','directionOffset','timeSpeed','stepSize','brightness','vignettePower','fiberStrength'] as const;
function inputs(frame:SourcePerlinGpuFrame,channel:SourcePerlinGpuChannel){
 const facts=sourcePerlinGpuChannelLayout(channel),prepared=prepareSourcePerlinGpuFrame(frame,facts.size);
 if(prepared.layout.pixels>16_000_000)throw new SourcePerlinGpuError('capacity','Perlin native frame exceeds the physical frame protocol budget.');
 if(!(channel.pixels.buffer instanceof ArrayBuffer)||!(prepared.palette.buffer instanceof ArrayBuffer))throw new SourcePerlinGpuError('input','Perlin native source images require exclusively owned ArrayBuffer storage.');
 const uniforms:Numeric[]=[{name:'transform',kind:'mat4',values:identity},{name:'u_resolution',kind:'vec2',values:[prepared.width,prepared.height]}];
 for(const key of scalarKeys)uniforms.push({name:'u_'+key,kind:'float',values:[prepared.uniforms[key]]});
 uniforms.push({name:'u_marchSteps',kind:'int',values:[prepared.uniforms.marchSteps]},{name:'u_renderStyle',kind:'int',values:[prepared.uniforms.renderStyle]},
  {name:'u_paletteSize',kind:'float',values:[256]},{name:'u_useChannel0',kind:'int',values:[1]});
 const retainedBufferBytes=[...new Set([channel.pixels.buffer,prepared.palette.buffer])].reduce((n,b)=>n+b.byteLength,0);
 return{prepared,uniforms,retainedBufferBytes};
}

/** Conservative joint representation peak, before any channel conversion or
 * output allocation. retainedBytes covers the caller's other owners (including
 * Worker originals when the page receives cloned source images). This owner
 * separately counts the passed source image backings, packed snapshot, protocol
 * copies/mip upload, native target/readback and row-swap scratch. It is not RSS.
 * The same admission is used by the awaiting target to reserve that whole peak. */
export function sourcePerlinNativeDrawingLayout(frame:SourcePerlinGpuFrame,channel:SourcePerlinGpuChannel,options:{retainedBytes?:number}={}){
 const retainedBytes=options.retainedBytes??0;
 if(!Number.isSafeInteger(retainedBytes)||retainedBytes<0)throw new SourcePerlinGpuError('input','Perlin native retained byte count must be a nonnegative safe integer.');
 const {prepared,uniforms,retainedBufferBytes}=inputs(frame,channel);
 const imageBytes=channel.pixels.byteLength+prepared.palette.byteLength,numericBytes=uniforms.reduce((n,u)=>n+u.values.length*4,0);
 const copiedBufferBytes=imageBytes+64+12+numericBytes;
 // The shared GLSL and binding names are ASCII. This is the exact v3/v12 wire
 // length; neither representation pads raw blocks. maximum changes the version
 // and texture scalar, not the layout. A test binds this count to the encoder.
 const packetBytes=60+32+imageBytes+(4+vertexShader.length)+(4+sourcePerlinFragmentBody.length)+28+
  (16+'vertex'.length+64)+20+4+uniforms.reduce((n,u)=>n+16+u.name.length+u.values.length*4,0)+
  (12+'u_palette'.length)+(12+'u_channel0'.length);
 const metadataBytes=3*(vertexShader.length+sourcePerlinFragmentBody.length)+1024+uniforms.reduce((n,u)=>n+96+u.name.length*3,0);
 const admittedBytes=retainedBufferBytes+copiedBufferBytes+metadataBytes;
 // Six packet representations conservatively cover native/parser copies,
 // input texture/mip storage and transport, independently of the input owner.
 const peakBytes=retainedBytes+admittedBytes+packetBytes*6+prepared.layout.pixels*12+prepared.width*4;
 if(!Number.isSafeInteger(peakBytes)||peakBytes>SOURCE_FRAME_BUDGET)throw new SourcePerlinGpuError('capacity','Perlin native source, target, transport and retained images exceed 256 MiB.');
 return{prepared,uniforms,retainedBufferBytes,copiedBufferBytes,packetBytes,admittedBytes,peakBytes};
}

/** Native mathematical layer, without formula/watermark composition. It shares
 * the original fragment body and the existing source uniform/texture owners.
 * The source fragment uses gl_FragCoord and no interpolants. This full clip quad
 * is calibrated against original actual-draw mathematical layers (two source
 * presets, five fixed times, 500×600); other dimensions/styles remain additional
 * runtime coverage, not an implied pixel-parity claim.
 *
 * Sampling requests the receiving CGL context's maximum anisotropy explicitly;
 * no browser capability or hardcoded host value stands in for the native one.
 * Numeric source interpretation, frame clocks and transport ownership are not
 * duplicated here. Both this admission and the frame codec precede allocations.
 */
export function prepareSourcePerlinNativeDrawing(frame:SourcePerlinGpuFrame,channel:SourcePerlinGpuChannel,options:{retainedBytes?:number}={}):SourceDrawingSnapshot {
 const layout=sourcePerlinNativeDrawingLayout(frame,channel,options);
 const uniforms:SourceDrawingUniform[]=layout.uniforms.map(u=>({name:u.name,kind:u.kind,count:1,values:u.kind==='int'?new Int32Array(u.values):new Float32Array(u.values)}));
 // Actual original sampler assignments: palette=0, channel=1.
 uniforms.push({name:'u_palette',kind:'sampler2d',texture:0},{name:'u_channel0',kind:'sampler2d',texture:1});
 const textures=[{width:256,height:1,pixels:sourcePerlinPackedRgba(layout.prepared.palette)},
  {width:channel.size,height:channel.size,pixels:sourcePerlinPackedRgba(channel.pixels)}].map(t=>({...t,anisotropy:'maximum' as const,magFilter:'linear' as const,minFilter:'linear-mipmap-linear' as const,wrap:'clamp' as const,generateMipmaps:true as const}));
 return{model:'source-drawing-v1',textures,copiedBufferBytes:layout.copiedBufferBytes,retainedBufferBytes:layout.retainedBufferBytes,admittedBytes:layout.admittedBytes,commands:[{
  primitive:'triangles',vertexShader,fragmentShader:sourcePerlinFragmentBody,
  attributes:[{name:'vertex',size:4,divisor:0,values:new Float32Array([-1,-1,0,1,1,-1,0,1,1,1,0,1,-1,1,0,1])}],
  index:new Uint16Array([0,1,2,2,3,0]),first:0,count:6,instances:1,uniforms,
  depthTest:false,depthWrite:false,depthFunction:'less-equal',frontFace:'clockwise',passes:['both'],blend:'source-alpha-over-additive-alpha',
 }]};
}
