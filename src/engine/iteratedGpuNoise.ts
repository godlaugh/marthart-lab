/** Same seeded lattice and quintic gradient interpolation as scenes/noise.ts.
 * The canonical permutation is uploaded by the owning GPU session. Coordinates
 * remain float32; this does not claim CPU double-precision equality. */
export const iteratedNoiseGlsl=`
uniform highp usampler2D noisePermutation;
int perm(int i){return int(texelFetch(noisePermutation,ivec2(i&255,0),0).r);}
float noiseFade(float v){return v*v*v*(v*(v*6.-15.)+10.);}
float noiseMix(float a,float b,float t){return a+(b-a)*t;}
float noiseGradient(int hash,vec3 p){int h=hash&15;float u=h<8?p.x:p.y,v=h<4?p.y:(h==12||h==14?p.x:p.z);return ((h&1)==0?u:-u)+((h&2)==0?v:-v);}
float spatialNoise(vec3 p){
 vec3 cell=floor(p),f=p-cell,fade=vec3(noiseFade(f.x),noiseFade(f.y),noiseFade(f.z));
 // Modulo before integer conversion preserves the 256-cell lattice even for
 // finite coordinates outside signed-int range.
 ivec3 at=ivec3(mod(cell,256.));int A=perm(at.x)+at.y,B=perm(at.x+1)+at.y,AA=perm(A)+at.z,AB=perm(A+1)+at.z,BA=perm(B)+at.z,BB=perm(B+1)+at.z;
 float n000=noiseGradient(perm(AA),f),n100=noiseGradient(perm(BA),f-vec3(1.,0.,0.)),n010=noiseGradient(perm(AB),f-vec3(0.,1.,0.)),n110=noiseGradient(perm(BB),f-vec3(1.,1.,0.));
 float n001=noiseGradient(perm(AA+1),f-vec3(0.,0.,1.)),n101=noiseGradient(perm(BA+1),f-vec3(1.,0.,1.)),n011=noiseGradient(perm(AB+1),f-vec3(0.,1.,1.)),n111=noiseGradient(perm(BB+1),f-vec3(1.,1.,1.));
 return noiseMix(noiseMix(noiseMix(n000,n100,fade.x),noiseMix(n010,n110,fade.x),fade.y),noiseMix(noiseMix(n001,n101,fade.x),noiseMix(n011,n111,fade.x),fade.y),fade.z);
}`;
