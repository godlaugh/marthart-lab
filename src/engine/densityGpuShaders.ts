/** Stage bodies shared by WebGL and the native adapter. The adapter supplies
 * only the language profile; all arithmetic and varying order stay here. */
export const DENSITY_FULLSCREEN_VERTEX_GLSL='void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}';
export const DENSITY_PRESENT_VERTEX_GLSL='out vec2 texCoord;void main(){float x=float((gl_VertexID&1)<<1)-1.;float y=float(gl_VertexID&2)-1.;gl_Position=vec4(x,y,0.,1.);texCoord=vec2((x+1.)*.5,(y+1.)*.5);}';
export const SAMILA_HISTORY_COPY_GLSL='uniform sampler2D previousInk;uniform float decay,densityCeiling;out vec4 result;void main(){result=texelFetch(previousInk,ivec2(gl_FragCoord.xy),0)*decay;if(result.a>densityCeiling){result.rgb*=densityCeiling/result.a;result.a=densityCeiling;}}';
