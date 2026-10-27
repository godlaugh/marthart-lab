export interface SourceTextureAnisotropy {readonly parameter:number;readonly maximum:number;}
const maximumTextures=new WeakSet<object>();
/** The WebGL context supplies its own numeric maximum; a native drawing
 * receiver must resolve its capability independently rather than inherit the
 * browser driver's limit. The existing drawing protocol carries this policy. */
export function markSourceTextureMaximumAnisotropy(texture:object):void{maximumTextures.add(texture);}
export function sourceTextureUsesMaximumAnisotropy(texture:object):boolean{return maximumTextures.has(texture);}
/** Processing Texture.allocate uses the context's maximum supported anisotropy.
 * Resolve once per context owner; callers apply it to sampled source textures,
 * never to nearest-filtered framebuffer attachments. Absence is supported. */
export function sourceTextureAnisotropy(gl:WebGL2RenderingContext):SourceTextureAnisotropy|undefined {
 const extension=gl.getExtension('EXT_texture_filter_anisotropic');
 if(!extension)return undefined;
 const maximum:unknown=gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
 if(typeof maximum!=='number'||!Number.isFinite(maximum)||maximum<1)throw new Error('源纹理过滤能力无效');
 return{parameter:extension.TEXTURE_MAX_ANISOTROPY_EXT,maximum};
}
