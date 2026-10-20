#!/usr/bin/env python3
"""Independent finite-Wait clock transcript of the fixed MathArt JAR.

No product imports, Java execution, native graphics, or FFmpeg assumptions.
All arithmetic narrowing follows Scene/SceneManager/Animation bytecode PCs
listed in the generated provenance. Empty queues still receive the initial
warmup draw before MathArt tests the stop predicate.
"""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/source-perlin/recording-clock.json'
JAR_SHA256 = 'a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
CLASS_SHA256 = {'mathart/MathArt.class': '3cf332de2b196ed835006b963b2149553b5a66f17999f6b92dd75ce4cdd56cc0', 'mathart/scene/Scene.class': '1237defdd1a14b13e63669cbf5dfdab517cb2e4587c47264fff4b87fb6f58e53', 'mathart/scene/SceneManager.class': '973ee64fef4c06b615eab028ae0668db1917ac1b7db47a62b0a73fc278b760e7', 'mathart/scene/GenericScene.class': 'aa1dc49a5375b773fee7732b77d70c3a7166c0e36ca5477f754567621c8905f0', 'mathart/noise/GenericPerlinScene.class': '96757b4937f046627cc37358099295a38bb799ddc85bce0f5b7f2609f3575427', 'mathart/animation/Animation.class': '63b961d5b29c2b70c7b6ddb7e10af117d586a8c408592f4ab1a5cbb238f68212', 'mathart/animation/Wait.class': '1732a0ef18674f93ad7b744f9c71a5ccb19017c8f6f7d15f9f2fbe679d70965a', 'mathart/utils/VideoRecorder.class': 'c5a1d8e69524570636b7c26d4e300c0cc9becb35fadbc1beced29304548e9515', 'mathart/config/MathArtConfig.class': 'd5ab3f16075662ddcbf738767e42b87f082a63a9a5cfe9956e2134f658b4ab9f'}

F=lambda n:struct.unpack('>f',struct.pack('>f',n))[0]
def transcript(fps,durations):
 ds=list(map(F,durations));raw=F(1/F(fps));time=F(0);index=0;runtime=F(0);current=False;frames=[];encoded=0
 for ordinal in range(1,10001):
  before=index>=len(ds) and not current
  remaining=F(0)
  if current:remaining=F(remaining+max(F(0),F(ds[index]-runtime)))
  for duration in ds[index+(1 if current else 0):]:remaining=F(remaining+max(F(0),duration))
  active=F(0) if before else min(raw,remaining) if remaining>0 else F(0)
  time=F(time+(raw if before else active))
  if not before:
   if not current:current=True;runtime=F(0)
   runtime=F(runtime+active)
   if runtime>=ds[index]:current=False;index+=1
  complete=index>=len(ds) and not current
  emit=ordinal>1
  if emit:encoded+=1
  frames.append(dict(ordinal=ordinal,rawDt=raw,activeDt=active,sceneTime=time,managerFinishedAtFrameStart=before,queueIndex=index,queueComplete=complete,mobjectUpdated=not before,warmup=not emit,encoded=emit))
  if complete:break
 else:raise RuntimeError('oracle capacity exceeded')
 return dict(fps=fps,durations=durations,frames=frames,encodedFrames=encoded,stopOrdinal=ordinal)
step30=F(1/F(30));step30next=struct.unpack('>f',struct.pack('>I',struct.unpack('>I',struct.pack('>f',step30))[0]+1))[0]
cases=[('float-step30',30,[step30]),('float-step30-next',30,[step30next]),('zeros-three',24,[0,0,0]),('two-substeps-60',60,[.001,.001]),('one-second-24',24,[1]),('empty',30,[]),('zero',30,[0]),('zero-pair',30,[0,0]),('negative',30,[-1]),('substep',30,[.001]),('exact-step',8,[.125]),('one-longer',10,[.15]),('two-substeps',10,[.01,.02]),('zero-then-wait',10,[0,.15]),('wait-then-zero',10,[.15,0]),('float-sequence',30,[.1,.2,.3]),('one-second',60,[1])]

def fixtures():
    return dict(provenance=dict(
        kind='independent-static-instruction-transcription', nativeExecution=False,
        jarSha256=JAR_SHA256, classes=CLASS_SHA256,
        methods=[
            'GenericPerlinScene.<init> PC4 -> GenericScene; GenericScene.<init> PC2 -> Scene; neither overrides isAutoRecordingComplete',
            'Scene.isAutoRecordingComplete PC4 -> SceneManager.isFinished',
            'SceneManager.isFinished PCs11,18 index>=queue.size and currentAnim==null',
            'Scene.setRenderMode PCs6-9 float renderStep=1/fps',
            'Scene.update PC16 pre-update complete; PC36 fixed step; PC93 remaining; PC108 min; PC124 time; PC132 manager; PC183 mobject; PC215 finished time; PC218 unused activeDt=0',
            'SceneManager.getRemainingDuration PCs25-30 current remainder then PCs81-85 ordered future-duration float fold',
            'SceneManager.update PC43 start one clip, PC62 update, PC77 clear, PC87 increment; no loop or dt carry',
            'Animation.update PCs21-26 float runtime addition; PCs50-63 runtime>=duration finish',
            'MathArt.startRecordingInternal PC435 iconst_1, PC436 warmupFrames=1',
            'MathArt.draw PC539 warmup guard, PC552 decrement, PC563 recordFrame, PC682 completion check, PC700 stop'
        ],
        limitations=[
            'Finite Wait queue cases only; no callback-specific animation or rendering oracle.',
            'Encoded counts assume successful recorder start, no manual stop/failure, and one discarded warmup.',
            'Zero encoded frames do not establish that native FFmpeg yields a valid video.',
            'FPS is the configured simulation FPS; license caps can separately reduce native encoder FPS.',
            'Does not reproduce retained offscreen canvas/configuration history or establish native pixel parity.'
        ]), cases=[dict(name=n,**transcript(fps,ds)) for n,fps,ds in cases])


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--check',action='store_true')
    parser.add_argument('--jar',type=Path,help='Optionally recheck the fixed original artifact and class digests without executing it')
    args=parser.parse_args()
    if args.jar:
        if hashlib.sha256(args.jar.read_bytes()).hexdigest()!=JAR_SHA256:
            raise SystemExit('Original JAR SHA-256 differs')
        with zipfile.ZipFile(args.jar) as archive:
            for entry,expected in CLASS_SHA256.items():
                if hashlib.sha256(archive.read(entry)).hexdigest()!=expected:
                    raise SystemExit('Original class SHA-256 differs: '+entry)
    text=json.dumps(fixtures(),ensure_ascii=False,separators=(',',':'))+'\n'
    if args.check:
        if not OUT.exists() or OUT.read_text()!=text:
            raise SystemExit('Recording clock oracle differs; regenerate and review')
    else:
        OUT.parent.mkdir(parents=True,exist_ok=True)
        OUT.write_text(text)
    print(json.dumps(dict(cases=len(cases),bytes=len(text.encode()),sha256=hashlib.sha256(text.encode()).hexdigest(),nativeExecution=False)))


if __name__=='__main__':
    main()
