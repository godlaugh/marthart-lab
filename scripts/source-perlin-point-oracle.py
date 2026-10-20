#!/usr/bin/env python3
"""Independent Processing P3D ROUND point tessellation reference.

Transcribed from retained class instructions/shaders; no product renderer imports,
JVM target execution, OpenGL execution, or native framebuffer equality claim.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'tests/fixtures/source-perlin/points.json'


def f(x):
    try:return struct.unpack('>f',struct.pack('>f',x))[0]
    except OverflowError:return math.copysign(math.inf,x)


def add(x,y):return f(f(x)+f(y))
def sub(x,y):return f(f(x)-f(y))
def mul(x,y):return f(f(x)*f(y))
def div(x,y):return f(f(x)/f(y))


def f2i(x):
    return 0 if math.isnan(x) else max(-2147483648,min(2147483647,math.trunc(x))) if math.isfinite(x) else (2147483647 if x>0 else -2147483648)


def lut():
    radians_per_degree=f(.01745329238474369)
    angles=[mul(mul(i,radians_per_degree),.5) for i in range(720)]
    return [f(math.cos(v)) for v in angles],[f(math.sin(v)) for v in angles]


COS,SIN=lut()


def scale(matrix):
    if matrix is None:return 1.
    if len(matrix)==4:
        a,b,c,d=matrix
        return f(math.sqrt(abs(sub(mul(a,d),mul(b,c)))))
    a,b,c,d,e,g,h,i,j=matrix
    determinant=add(add(mul(a,sub(mul(e,j),mul(g,i))),
                        mul(b,sub(mul(g,h),mul(d,j)))),
                    mul(c,sub(mul(d,i),mul(e,h))))
    return f(math.pow(abs(determinant),.3333333432674408))


def color(packed):
    # MathArt extracts low RGB bytes then supplies alpha=255 to RGB255 stroke.
    rgb=[f2i(mul(255.,div((packed>>s)&255,255.))) for s in [16,8,0]]
    rgba=rgb+[255]
    packed=(255<<24)|(rgb[0]<<16)|(rgb[1]<<8)|rgb[2]
    return packed,rgba,[div(v,255.) for v in rgba]


def point_case(name,width,transform_scale=1.,packed=0x12345678,diagnostic=False):
    input_packed=packed
    width,transform_scale=f(width),f(transform_scale)
    n=min(200,max(20,f2i(div(mul(f(math.tau),width),10.))))
    step=div(720.,n)
    phase=0.
    offsets=[[0.,0.]]
    indices=[]
    phases=[]
    for _ in range(n):
        index=f2i(phase)
        phases.append(index)
        offsets.append([mul(mul(mul(.5,COS[index]),transform_scale),width),
                        mul(mul(mul(.5,SIN[index]),transform_scale),width)])
        phase=f(math.fmod(add(phase,step),720.))
    for i in range(1,n):indices.extend([0,i,i+1])
    indices.extend([0,1,n])  # Source's closing triangle reverses perimeter order.
    packed,rgba,normalized=color(packed)
    return dict(name=name,diagnosticOnly=diagnostic,
        input=dict(strokeWeight=width,transformScale=transform_scale,position=[12.25,-7.5,0.],packedColor=input_packed),
        segments=n,vertices=n+1,phaseStep=step,phaseIndices=phases,finalPhase=phase,
        offsets=offsets,indices=indices,strokeColor=packed,rgba=rgba,normalizedColor=normalized)


def shader_case(name,clip,offset,viewport,projection_scale,perspective):
    chosen=projection_scale if perspective>0 else [div(clip[3],mul(.5,viewport[k])) for k in [2,3]]
    position=[add(clip[k],mul(offset[k],chosen[k])) for k in range(2)]+[f(v) for v in clip[2:]]
    return dict(name=name,input=dict(clip=clip,offset=offset,viewport=viewport,
                perspective=perspective,projectionScale=projection_scale),glPosition=position)


def fixtures():
    cases=[point_case('unit-minimum',1.),point_case('opaque-rgb',.02,packed=0xfffa017f),
           point_case('noninteger-phase',34.,scale([2.,0.,0.,0.,3.,0.,0.,0.,1.])),
           point_case('medium-segments',100.,.375),point_case('maximum-segments',1000.,2.25),
           point_case('zero-width-native-degenerate',0.,diagnostic=True),
           point_case('negative-width-native-reflected',-7.25,diagnostic=True),
           point_case('zero-transform-native-degenerate',34.,0.,diagnostic=True)]
    matrices=[None,[2.,0.,0.,3.],[2.,0.,0.,0.,3.,0.,0.,0.,1.],
              [-2.,0.,0.,0.,3.,0.,0.,0.,1.],[1.,.2,.1,.3,1.5,-.2,0.,.4,.75],
              [0.,0.,0.,0.,2.,0.,0.,0.,1.],[.1,0.,0.,0.,.1,0.,0.,0.,1.]]
    shader=[shader_case('orthographic-logical-viewport',[.2,-.4,.1,1.],[3.25,-1.5],[0.,0.,320.,200.],[.00625,.01],0),
            shader_case('no-perspective-cancels-clip-w',[.25,.5,-.2,2.75],[-.75,4.],[0.,0.,853.,481.],[1.2,-1.4],0),
            shader_case('perspective-projection-scale',[.25,.5,-.2,2.75],[-.75,4.],[0.,0.,853.,481.],[1.2,-1.4],1)]
    return dict(provenance=dict(kind='independent-static-instruction-transcription',nativeExecution=False,
        processingJarSha256='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
        tessellatorClassSha256='fcedfbb636040e7641e19a85c87ae6ce294c7e12a75a360c0883df8fe0749b05',
        pGraphicsClassSha256='d495bc8e9b3f6855759da98715874d9f95aed561664c12edf792a08abcb5e818',
        pGraphicsOpenGLClassSha256='a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c',
        pointVertSha256='a0a2d9f77c73c66ff0f81fa403789986c6254718d87f11bfa566202c8747c485',
        pointFragSha256='09eb98aa440b5d4c362aac405075218be6e97be20e33dfd0aecdfb1099bb0073',
        methods=['Tessellator.tessellateRoundPoints PC0-120','tessellateRoundPoints3D PC0-464',
                 'PGraphics.<clinit> PC0-71','PGraphicsOpenGL.matrixScale PC0-152','PointVert/PointFrag'],
        limits=['Single P3D ROUND point in an empty index cache; repeated position/color attributes represented once, offsets/indices complete.',
                'Native-method zero/negative widths produce degenerate/reflected offsets; these are not assertions of supported local inputs or visible raster output.',
                'Native index-cache rollover, aggregate allocation capacity and inherited non-ROUND strokeCap are not exercised.',
                'transformScale is a supplied scalar in point cases; matrixScale cases separately cover determinant-based source computation.',
                'Shader cases start after modelview/projection; scalar Float32 interpretation does not establish driver precision, FMA, raster/MSAA or blending parity.',
                'Packed palette alpha is ignored by MathArt RGB255 stroke with trailAlpha255. Fragment shader returns interpolated vertex color unchanged.']),
        cases=cases,matrixScaleCases=[dict(matrix=m,expected=scale(m)) for m in matrices],shaderCases=shader,
        lutSamples=[dict(index=i,cos=COS[i],sin=SIN[i]) for i in [0,1,179,180,181,359,360,540,719]])


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    data=fixtures()
    compact=lambda v:json.dumps(v,separators=(',',':'),allow_nan=False)
    text='{\n'+',\n'.join(json.dumps(k)+':'+compact(v) for k,v in data.items())+'\n}\n'
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:raise SystemExit('Perlin point fixture differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']),vertices=sum(c['vertices'] for c in data['cases']),
        bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__=='__main__':main()
