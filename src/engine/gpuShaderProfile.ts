/** Profiles used by the shared iterated kernels. A profile selects only the
 * language preamble; it never rewrites a generated or authored shader body. */
export type GpuShaderProfile='webgl2'|'native-gl41';
export function gpuShaderHeader(profile:GpuShaderProfile,webglPrecision:string):string {
 switch(profile){
  case 'webgl2':return '#version 300 es\n'+webglPrecision;
  case 'native-gl41':return '#version 410 core\n';
  default:throw Error('未知 GPU shader profile');
 }
}
