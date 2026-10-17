export type RenderQuality='low'|'standard'|'high';
export interface RenderPreferences {frameRate:number;quality:RenderQuality;}
export const DEFAULT_RENDER_PREFERENCES:RenderPreferences={frameRate:30,quality:'standard'};
export function parseRenderPreferences(value:unknown):RenderPreferences {
  if(value===undefined)return {...DEFAULT_RENDER_PREFERENCES};
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('渲染设置无效');
  const data=value as Record<string,unknown>;
  if(!Number.isInteger(data.frameRate)||Number(data.frameRate)<1||Number(data.frameRate)>120)throw new Error('预览帧率须为 1–120 的整数');
  if(!['low','standard','high'].includes(String(data.quality)))throw new Error('未知渲染质量');
  return {frameRate:Number(data.frameRate),quality:data.quality as RenderQuality};
}
/** The quality choice controls both mathematical sampling and display pixels. */
export function previewProfile(quality:RenderQuality,deviceRatio=1){
  if(quality==='low')return {width:480,height:360,pixelRatio:1,quality:'preview' as const};
  if(quality==='high')return {width:1920,height:1080,pixelRatio:2,quality:'export' as const};
  return {width:720,height:540,pixelRatio:Math.max(1,Math.min(deviceRatio,2)),quality:'preview' as const};
}
/** Keep the selected pixel budget while sampling the actual canvas aspect. */
export function previewDimensions(quality:RenderQuality,width:number,height:number){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('视口尺寸必须为正数');
  const profile=previewProfile(quality),scale=Math.sqrt(profile.width*profile.height/(width*height));
  return{width:Math.max(1,Math.min(16384,Math.floor(width*scale))),height:Math.max(1,Math.min(16384,Math.floor(height*scale)))};
}
