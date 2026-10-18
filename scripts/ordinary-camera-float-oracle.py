#!/usr/bin/env python3
"""Independent exact-rational Float rounding fixtures. No Java execution.
Optionally verify the retained 1.7.8 artifact identity with --jar PATH.
The fixture numbers are IEEE-754 arithmetic goldens, not original-app outputs.
"""
import argparse, hashlib, json, struct, zipfile
from fractions import Fraction
from pathlib import Path
JAR_SHA='a6e1da3acfc05c347d2529c1d590657e2dd798e16d38c55df3dc61312be24018'
CLASSES={
 'mathart/surface/config/JsonSurfaceConfig.class':'parseValue(String): Float.parseFloat, then FastExpression with constants; exception fallback 0',
 'mathart/implicit/config/JsonImplicitSurfaceConfig.class':'parseValue(String): same direct Float and scoped expression paths',
 'mathart/utils/ConfigUtils.class':'parseValue(JSONObject,String,float): JSONObject.getFloat; expression uses empty map',
 'processing/data/JSONObject.class':'getFloat(String): getDouble(String) followed by d2f',
}
def rational(bits):
 return Fraction.from_float(struct.unpack('>f',struct.pack('>I',bits))[0])
def round_bits(value):
 # Search the representable lattice rather than reproduce the TS quotient algorithm.
 lo,hi=0,0x7f7fffff
 while lo<hi:
  mid=(lo+hi+1)//2
  if rational(mid)<=value:lo=mid
  else:hi=mid-1
 if lo==0x7f7fffff:return 0x7f800000 if value>=2**128-2**103 else lo
 left,right=rational(lo),rational(lo+1)
 return lo if value-left<right-value or value-left==right-value and lo%2==0 else lo+1

def decimal(value):
 assert value.denominator&(value.denominator-1)==0
 places=value.denominator.bit_length()-1
 digits=str(value.numerator*5**places).rjust(places+1,'0')
 return digits if places==0 else digits[:-places]+'.'+digits[-places:]

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--jar',type=Path);ap.add_argument('--processing-jar',type=Path);ap.add_argument('--output',type=Path,default=Path('tests/fixtures/source-camera/scalars.json'));args=ap.parse_args()
 source={'jarSha256':JAR_SHA,'evidence':'static bytecode routing plus independent exact-rational IEEE-754 fixture; no original method execution','methods':CLASSES}
 if args.jar:
  assert hashlib.sha256(args.jar.read_bytes()).hexdigest()==JAR_SHA,'Unexpected target artifact'
  with zipfile.ZipFile(args.jar) as archive:source['classSha256']={name:hashlib.sha256(archive.read(name)).hexdigest() for name in CLASSES if name.startswith('mathart/')}
 if args.processing_jar:
  with zipfile.ZipFile(args.processing_jar) as archive:
   digest=hashlib.sha256(archive.read('processing/data/JSONObject.class')).hexdigest()
   assert digest=='1d3979ec438b30a5e39ebaca98a0fe9600678cd117e3e958b3d7c1d8d2e4bfc7'
   source.setdefault('classSha256',{})['processing/data/JSONObject.class']=digest
  source['processingJarSha256']=hashlib.sha256(args.processing_jar.read_bytes()).hexdigest()
 rows=[]
 for lower in [0,1,2,0x007ffffe,0x007fffff,0x00800000,0x3dcccccc,0x3f000000,0x3f7fffff,0x3f800000,0x3f800001,0x40000000,0x4b000000,0x7f7ffffe]:
  midpoint=(rational(lower)+rational(lower+1))/2
  epsilon=(rational(lower+1)-rational(lower))/2**80
  for offset in [-1,0,1]:
   value=midpoint+offset*epsilon
   rows.append({'literal':decimal(value),'expectedBits':round_bits(value),'lowerBits':lower,'offsetFromMidpoint':offset})
 source['cases']=rows
 args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(source,indent=2)+'\n')
 print(json.dumps({'output':str(args.output),'cases':len(rows),'jarVerified':bool(args.jar)}))
if __name__=='__main__':main()
