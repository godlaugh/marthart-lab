import type {RootsPointPrograms,RootsPointFrameMetadata} from './rootsPointCloudDrawing';
import type {SourceNativePixels} from './sourceNativeClient';
export type RootsPointBrokerTarget='primary'|'offscreen';
export type RootsPointBrokerCommand=
 | {kind:'initialize';target:RootsPointBrokerTarget;size:{width:number;height:number};programs:RootsPointPrograms}
 | {kind:'begin';target:RootsPointBrokerTarget;metadata:RootsPointFrameMetadata;rangeCounts:readonly number[];chunkPoints:number}
 | {kind:'append';target:RootsPointBrokerTarget;ordinal:number;rangeIndex:number;rangeOffset:number;points:Float32Array<ArrayBuffer>}
 | {kind:'finish';target:RootsPointBrokerTarget}
 | {kind:'release';target?:RootsPointBrokerTarget};
export interface RootsPointBrokerCoverage {displayIndex:number;receivedPoints:number;totalPoints:number;nextChunk:number;totalChunks:number;pointDraws:number;fadeDraws:number;clears:number;}
export type RootsPointBrokerResult=
 | {kind:'initialize';width:number;height:number;pointSizeRange:readonly[number,number]}
 | ({kind:'begin'}&RootsPointBrokerCoverage)
 | ({kind:'append'}&RootsPointBrokerCoverage)
 | ({kind:'finish'}&RootsPointBrokerCoverage&SourceNativePixels)
 | {kind:'release'};
/** Internal duplex protocol. Native resource/session tokens remain exclusively
 * with the page owner; the Worker retains numerical state and frame clocks. */
export interface RootsNativeCommandRequest {operation:'roots-native-command';sessionId:number;id:number;displayId:number;rpcId:number;command:RootsPointBrokerCommand;}
export type RootsNativeCommandResponse={operation:'roots-native-result';sessionId:number;id:number;displayId:number;rpcId:number}&(
 {result:RootsPointBrokerResult}|{error:{kind:string;reason:string;cleanupPending:boolean}});
export type RootsPointBrokerCall=(command:RootsPointBrokerCommand,displayId:number)=>Promise<RootsPointBrokerResult>;
