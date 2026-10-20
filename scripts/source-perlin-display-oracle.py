#!/usr/bin/env python3
"""Independent Perlin display + Processing default-camera/ortho transcription.

Reuses only independent Python matrix arithmetic, not product TypeScript.
No original JVM, JOGL, graphics context or framebuffer is executed.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/source-perlin/display.json'
spec=importlib.util.spec_from_file_location('camera_reference',ROOT/'scripts/source-camera-bytecode-oracle.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
f,add,sub,mul,div=c.f,c.add,c.sub,c.mul,c.div


def length(v):return f(math.sqrt(add(add(mul(v[0],v[0]),mul(v[1],v[1])),mul(v[2],v[2]))))
def normalize(v):
    size=length(v)
    return [div(x,size) for x in v] if abs(size)>=2**-23 else v


def default_camera(w,h):
    # setSize computes these float fields; camera() forwards nine arguments.
    ex,ey=div(w,2.),div(h,2.)
    ez=div(ey,f(math.tan(div(f(1.0471975803375244),2.))))
    z=[sub(ex,ex),sub(ey,ey),sub(ez,0.)]
    distance=length(z)
    z=normalize(z)
    up=[0.,1.,0.]
    x=[sub(mul(up[1],z[2]),mul(up[2],z[1])),add(mul(-up[0],z[2]),mul(up[2],z[0])),sub(mul(up[0],z[1]),mul(up[1],z[0]))]
    # camera bytecode computes y from the pre-normalized x, then normalizes x/y.
    y=[sub(mul(z[1],x[2]),mul(z[2],x[1])),add(mul(-z[0],x[2]),mul(z[2],x[0])),sub(mul(z[0],x[1]),mul(z[1],x[0]))]
    x,y=normalize(x),normalize(y)
    matrix=[x+[0.],y+[0.],z+[0.],[0.,0.,0.,1.]]
    c.translate(matrix,-ex,-ey,-ez)
    return matrix,ez,distance


def scale(matrix,sx,sy,sz):
    for row in matrix:
        for i,s in enumerate([sx,sy,sz]):row[i]=mul(row[i],s)


def calculate(config):
    w,h=f(config['targetWidth']),f(config['targetHeight'])
    sw,sh=f(config['sourceWidth']),f(config['sourceHeight'])
    model,ez,distance=default_camera(w,h)
    camera=[row.copy() for row in model]
    left,right,bottom,top=div(-w,2.),div(w,2.),div(-h,2.),div(h,2.)
    near,far=0.,mul(distance,10.)
    rw,rh,rd=sub(right,left),sub(top,bottom),sub(far,near)
    projection=[[div(2.,rw),0.,0.,div(-add(right,left),rw)],
                [0.,-div(2.,rh),0.,div(-add(top,bottom),rh)],
                [0.,0.,div(-2.,rd),div(-add(far,near),rd)],
                [0.,0.,0.,1.]]
    transform=c.multiply(projection,model)
    sx,sy=div(w,sw) if sw>0 else 1.,div(h,sh) if sh>0 else 1.
    for matrix in [model,transform]:
        c.translate(matrix,mul(w,.5),mul(h,.5),0.)
        scale(matrix,sx,sy,1.)
    density_scale=f(math.pow(max(1,config['pixelDensity']),.15000000596046448))
    line_scale=1. if config['target']=='primary' else mul(mul(f(math.sqrt(div(f(config['lineScaleArg']),density_scale))),f(1.399999976158142)),f(.4000000059604645))
    return dict(cameraZ=ez,eyeDistance=distance,near=near,far=far,scaleX=sx,scaleY=sy,
        cameraModelView=sum(camera,[]),modelView=sum(model,[]),projection=sum(projection,[]),transform=sum(transform,[]),
        finalProduct=sum(c.multiply(projection,model),[]),lineScale=line_scale,
        trailWidth=max(f(.02),mul(f(config['lineWeight']),line_scale)),pointWidth=mul(f(config['dotSize']),line_scale))


def case(name,**overrides):
    config=dict(targetWidth=320,targetHeight=200,sourceWidth=320,sourceHeight=200,pixelDensity=1,
                target='primary',lineScaleArg=1.,lineWeight=1.3,dotSize=2.75)
    config.update(overrides)
    if config['target']=='offscreen' and 'lineScaleArg' not in overrides:
        config['lineScaleArg']=div(f(config['targetHeight']),f(config['sourceHeight']))
    return dict(name=name,input=config,expected=calculate(config))


def fixtures():
    cases=[case('primary-density1'),case('primary-density2',pixelDensity=2),
           case('offscreen-density1-double',target='offscreen',targetWidth=640,targetHeight=400),
           case('offscreen-density2-double',target='offscreen',targetWidth=640,targetHeight=400,pixelDensity=2),
           case('offscreen-unequal-xy',target='offscreen',targetWidth=853,targetHeight=481,pixelDensity=2),
           case('primary-odd-dimensions',targetWidth=253,targetHeight=197,sourceWidth=253,sourceHeight=197),
           case('raw-small-applet-no-simulation-fallback',sourceWidth=100,sourceHeight=80),
           case('raw-zero-width-primary-fallback',sourceWidth=0),
           case('raw-zero-height-primary-fallback',sourceHeight=0),
           case('raw-both-zero-primary-fallback',sourceWidth=0,sourceHeight=0),
           case('offscreen-zero-source-explicit-line-scale',target='offscreen',sourceWidth=0,sourceHeight=0,lineScaleArg=1.),
           case('trail-floor-point-no-floor',lineWeight=-2.,dotSize=-3.),
           case('density-floor-zero',target='offscreen',pixelDensity=0),
           case('offscreen-fractional-scale',target='offscreen',targetWidth=77,targetHeight=53,pixelDensity=2)]
    return dict(provenance=dict(kind='independent-static-instruction-transcription',nativeExecution=False,
        processingJarSha256='89410e2c4f59cb4b4aeb2a3baeaf6a4bc189d6e1c612920c3f8e0f58b62a769a',
        perlinClassSha256='ef1de66f25e6fed5a126cb260005d0b5d7fd161118cc83993f0648009de96d92',
        pGraphicsOpenGLClassSha256='a0129d4660d76f8f881dd867bef85f3bfab547f10db63616d482b7f8881c736c',
        methods=['PerlinNoiseField.display PC17-247/getLineScale PC0-28',
                 'ParticleSystemMobject.getLineScale PC0-54','PGraphicsOpenGL.setSize PC0-173',
                 'PGraphicsOpenGL.camera PC0-390 / ortho PC0-106 / translateImpl / scaleImpl',
                 'PMatrix3D.translate/scale/apply'],
        limits=['Row-major matrices, including separately incremented combined transform and diagnostic final P*M.',
                'Source PApplet dimensions may be zero in method diagnostics, but target dimensions remain positive for a valid camera/ortho.',
                'Offscreen zero source height with explicit lineScaleArg diagnoses display methods, not Scene render division-by-zero admission.',
                'Source small dimensions are not replaced by simulation/curve viewport fallback800.',
                'Physical framebuffer pixels, inherited target state, native MSAA/raster and libm parity are unverified.']),cases=cases)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
    data=fixtures();compact=lambda v:json.dumps(v,separators=(',',':'),allow_nan=False)
    text='{\n"provenance":'+compact(data['provenance'])+',\n"cases":[\n'+',\n'.join(compact(v) for v in data['cases'])+'\n]}\n'
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:raise SystemExit('Display fixture differs; regenerate and review')
    else:OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(text)
    print(json.dumps(dict(cases=len(data['cases']),differentCombinedMatrices=sum(c['expected']['transform']!=c['expected']['finalProduct'] for c in data['cases']),bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest())))


if __name__=='__main__':main()
