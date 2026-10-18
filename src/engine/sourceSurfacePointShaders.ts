// Source fragment equations retained; WebGL2/instancing adapts only the input
// transport. Raw shaders do not add Three lighting or an sRGB output transform.
export const sourcePointVertex=`
precision highp float;
uniform mat4 projection;
uniform mat4 modelview;
uniform float radius;
uniform float focalLength;
in vec3 particlePosition;
in vec3 particleColor;
in float particleAlpha;
in vec2 uv;
out vec4 vertColor;
out vec2 vertTexCoord;
out vec2 vertBillboardCoord;
void main(){
 vec4 viewPos=modelview*vec4(particlePosition,1.0);
 float depth=-viewPos.z;
 if(depth<0.1)depth=0.1;
 float r=radius*(depth/focalLength);
 vec2 offset=(uv-0.5)*2.0;
 viewPos.xy+=offset*r;
 gl_Position=projection*viewPos;
 vertColor=vec4(particleColor,particleAlpha);
 vertBillboardCoord=uv;
 vertTexCoord=uv;
}`;
export const sourcePointFragment=`// MathArt 1.7.8 CPU point fragment; original sha256 46ee2d8b19ae9226f2853baac15c573d54f0a7ad2c66ec847d72cff0733e17e2


#ifdef GL_ES
precision highp float;
precision highp int;
#endif

uniform float opacity;
uniform sampler2D sprite; // Renamed from texture to avoid conflict
uniform vec3 lightDir;
uniform float materialShininess;
uniform vec3 materialSpecular;
uniform float specularStrength;

in vec4 vertColor;
in vec2 vertTexCoord;
in vec2 vertBillboardCoord;

out vec4 fragColor;

void main() {
  vec4 texColor = texture(sprite, vertTexCoord);

  vec2 p = vertBillboardCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;

  vec3 N = normalize(vec3(p.x, -p.y, sqrt(max(0.0, 1.0 - r2))));
  vec3 Lraw = lightDir;
  vec3 L = dot(Lraw, Lraw) > 1.0e-6 ? normalize(Lraw) : normalize(vec3(0.45, 0.5, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);

  float ndl = max(dot(N, L), 0.0);
  float ndh = max(dot(N, H), 0.0);
  float shininessNorm = clamp(materialShininess / 100.0, 0.0, 1.0);
  float specPower = mix(3.0, 220.0, shininessNorm * shininessNorm);
  float specWeightBase = mix(0.35, 2.4, shininessNorm);
  float specWeight = specularStrength > 0.0 ? specularStrength : specWeightBase;
  vec3 specColor = dot(materialSpecular, materialSpecular) > 1.0e-6 ? materialSpecular : vec3(1.0);

  float diffuseWrap = mix(0.45, 0.0, shininessNorm);
  float diff = max((ndl + diffuseWrap) / (1.0 + diffuseWrap), 0.0);
  float spec = pow(ndh, specPower) * specWeight;
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.28;
  float edgeAlpha = smoothstep(1.0, 0.82, r2);

  vec3 base = texColor.rgb * vertColor.rgb;
  vec3 lit = base * (0.18 + 0.82 * diff) + specColor * (spec + fresnel);
  fragColor = vec4(clamp(lit, 0.0, 1.0), texColor.a * vertColor.a * edgeAlpha * opacity);
}
`;
