import {rootsPointCloudPrograms,prepareRootsPointFrame} from '../src/engine/rootsPointCloudDrawing';
import {defaultRootsPresentationConfiguration} from '../src/engine/rootsPresentationConfig';
import {prepareRootsProjection} from '../src/engine/rootsProjection';
import {prepareRootsDensityColor,ROOTS_DENSITY_COLOR_VERSION} from '../src/engine/rootsDensityColor';
import {encodeSourceRootsPointNativeRequest,captureSourceRootsPointNativeResponseBinding,sourceRootsPointNativeResponseBytes,type SourceRootsPointNativeRequest,type SourceRootsPointNativeOperation} from '../src/engine/sourceRootsPointNativeProtocol';
export const resource='12'.repeat(16),session='34'.repeat(16);
export function metadata(width=2,height=3,fresh=true){
 const config=defaultRootsPresentationConfiguration();config.mode='point-cloud';
 const plan=prepareRootsProjection(config,{width,height,viewport:{logicalWidth:width,logicalHeight:height,referenceLogicalHeight:height,target:'primary'}});
 const color=prepareRootsDensityColor({settings:{rootDensityColorVersion:ROOTS_DENSITY_COLOR_VERSION,background:'#000000'}});
 if(color.kind!=='metric-sum')throw Error('Expected metric color');
 return prepareRootsPointFrame(plan,color,fresh);
}
export function request(operation:SourceRootsPointNativeOperation,width=2,height=3,sequence=1):SourceRootsPointNativeRequest{
 return{generation:1,sequence,width:operation.kind==='release'?1:width,height:operation.kind==='release'?1:height,operation};
}
export const create=()=>request({kind:'create',resource,session,target:'primary',programs:rootsPointCloudPrograms('native-gl41')});
export const begin=()=>request({kind:'begin',resource,expectedDisplay:0,chunkPoints:3,rangeCounts:[5,2],metadata:metadata()});
export function packet(r:SourceRootsPointNativeRequest){const encoded=encodeSourceRootsPointNativeRequest(r);if(!encoded.ok)throw Error(encoded.error.reason);return encoded.value;}
/** Controlled ACK fixture for transport faults, not native drawing evidence. */
export function reply(r:SourceRootsPointNativeRequest,overrides:Partial<Record<number,number>>={}){
 const b=captureSourceRootsPointNativeResponseBinding(r),out=new Uint8Array(sourceRootsPointNativeResponseBytes(b)),v=new DataView(out.buffer);
 const absent=r.operation.kind==='release';
 const words:Record<number,number>={0:7,4:{create:1,begin:2,append:3,finish:4,release:5}[r.operation.kind],24:b.displayIndex??0,28:absent?2:0,32:absent?1:b.width,36:absent?1:b.height,40:b.phase==='active'?1:0,44:b.receivedPoints??0,48:b.totalPoints??0,52:b.nextChunk??0,56:b.totalChunks??0,60:b.pointDraws??0,64:b.fadeDraws??0,68:b.clears??0,80:absent?0:1,...overrides};
 for(const [offset,n] of Object.entries(words))v.setUint32(Number(offset),n,true);
 for(let i=0;i<16;i++)out[8+i]=parseInt(r.operation.resource.slice(i*2,i*2+2),16);
 v.setFloat32(72,absent?0:1,true);v.setFloat32(76,absent?0:64,true);return out;
}
