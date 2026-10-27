#ifndef SOURCE_CGL_ROOTS_POINT_PROTOCOL_H
#define SOURCE_CGL_ROOTS_POINT_PROTOCOL_H
// v15 prepared Roots point raster ABI: the producer owns math, arrival order,
// projection, metric clamp, color and clear/fade policy. Native owns execution.
static const uint64_t RootsPointControlBytes=1024*1024,RootsPointVboBytes=65536*16;
static const uint32_t RootsPointReplyBytes=96,RootsPointMaxChunkPoints=65536,RootsPointMaxPoints=3000000;
static NSDictionary<NSString*,NSNumber*> *rootsPointUniformKinds(void){return @{@"projection":@7,@"modelview":@7,@"pointSize":@1,@"rotationDegrees":@1,@"scaleVec":@5,@"offsetVec":@5,@"brightness":@1,@"contrast":@1,@"gamma":@1,@"dynamicRange":@1,@"saturation":@1,@"paletteOffset":@1,@"backgroundRgb":@5,@"paletteTex":@9};}
static uint64_t rootsPointResident(uint32_t width,uint32_t height,uint64_t programs){return (uint64_t)width*height*4+1024+RootsPointVboBytes+programs+RootsPointControlBytes;}
static void rootsPointBudget(uint64_t retained,uint64_t allocation,uint64_t packet,uint64_t response){ensure(retained<=Budget&&allocation<=Budget&&packet<=Budget/8&&response<=Budget/4&&retained+allocation+packet*8+response*4<=Budget,@"capacity",@"Roots point targets and transfer copies exceed shared capacity");}
static NSData *rootsPointToken(FrameReader *r){NSData *token=attractorBlock(r,16);BOOL nonzero=NO;for(NSUInteger i=0;i<token.length;i++)nonzero|=((const uint8_t*)token.bytes)[i]!=0;INPUT(token.length==16&&nonzero,@"Invalid Roots point token");return token;}
static NSData *rootsPointColor(FrameReader *r,BOOL enabled){float v[4];for(int i=0;i<4;i++){v[i]=[r number];INPUT(enabled?(v[i]>=0&&v[i]<=1):v[i]==0,@"Invalid prepared clear/fade color");}return[NSData dataWithBytes:v length:sizeof(v)];}
static NSDictionary *parseRootsPoint(FrameReader *r,uint32_t width,uint32_t height,uint64_t retained){
 INPUT([r word]==7,@"Unknown Roots point family");uint32_t kind=[r word];NSData *resource=rootsPointToken(r);INPUT(kind>=1&&kind<=5,@"Invalid Roots point operation");if(kind==5)INPUT(width==1&&height==1,@"Roots point release requires 1x1 envelope");
 uint64_t response=RootsPointReplyBytes+(kind==4?(uint64_t)width*height*4:0);rootsPointBudget(kind==5?0:retained,0,r.data.length,response);
 // A frame must fit its eventual readback before clear/fade can mutate history.
 // Begin and finish are distinct peaks; finish has its actual 92-byte packet.
 if(kind==2)rootsPointBudget(retained,0,92,RootsPointReplyBytes+(uint64_t)width*height*4);
 NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource}mutableCopy];
 if(kind==1){
  op[@"session"]=rootsPointToken(r);uint32_t target=[r word],profile=[r word];INPUT((target==1||target==2)&&profile==1,@"Invalid Roots point target/profile");op[@"target"]=@(target);uint64_t programs=0;
  rootsPointBudget(retained,rootsPointResident(width,height,0),r.data.length,response);
  for(NSString *key in @[@"pointVertex",@"pointFragment",@"fadeVertex",@"fadeFragment"]){uint32_t length=[r word];INPUT(length>0,@"Empty Roots point program");rootsPointBudget(retained,rootsPointResident(width,height,programs+(uint64_t)length*3),r.data.length,response);const void *bytes=[r take:length];INPUT(memchr(bytes,0,length)==NULL,@"Roots point program contains NUL");NSString *source=[[NSString alloc]initWithBytes:bytes length:length encoding:NSUTF8StringEncoding];INPUT(source&&[source hasPrefix:@"#version 410 core\n"],@"Roots point program requires explicit GL 4.1 core profile");op[key]=source;programs+=(uint64_t)length*3;}op[@"programBytes"]=@(programs);
 }else if(kind!=5){
  uint32_t display=[r word];INPUT(display<UINT32_MAX,@"Roots point display index cannot advance");op[@"display"]=@(display);
  if(kind==2){
   uint32_t flags=[r word],chunk=[r word],ranges=[r word];INPUT(flags<=3&&chunk>=1&&chunk<=RootsPointMaxChunkPoints&&ranges<=2&&(display>0||(flags&1)),@"Invalid Roots point frame flags or chunk schedule");NSMutableArray *counts=[NSMutableArray new];uint64_t total=0,chunks=0;uint32_t maximumRange=0;for(uint32_t i=0;i<ranges;i++){uint32_t n=[r word];INPUT(n>0&&n<=RootsPointMaxPoints,@"Invalid Roots point range count");total+=n;maximumRange=MAX(maximumRange,n);chunks+=((uint64_t)n+chunk-1)/chunk;[counts addObject:@(n)];}INPUT(total<=RootsPointMaxPoints&&chunks<=UINT32_MAX,@"Roots point recent window exceeds capacity");
   uint64_t appendBytes=maximumRange?112+(uint64_t)16*MIN(chunk,maximumRange):0;op[@"appendBytes"]=@(appendBytes);if(appendBytes)rootsPointBudget(retained,0,appendBytes,RootsPointReplyBytes);
   op[@"flags"]=@(flags);op[@"chunk"]=@(chunk);op[@"ranges"]=counts;op[@"total"]=@(total);op[@"chunks"]=@(chunks);op[@"clear"]=rootsPointColor(r,flags&1);op[@"fade"]=rootsPointColor(r,flags&2);NSData *palette=attractorBlock(r,1024);INPUT(palette.length==1024,@"Roots point LUT must be RGBA8 256x1");op[@"palette"]=palette;
   NSArray *uniforms=samilaUniforms(r);NSDictionary *abi=rootsPointUniformKinds();INPUT(uniforms.count==abi.count,@"Roots point frame requires fourteen uniforms");for(NSDictionary *u in uniforms){NSNumber *expected=abi[u[@"name"]];INPUT(expected&&[u[@"kind"]isEqual:expected],@"Roots point uniform name/type mismatch");if(expected.unsignedIntValue==9)INPUT([u[@"texture"]unsignedIntValue]==0,@"Roots point palette sampler must be unit zero");else INPUT([u[@"count"]unsignedIntValue]==1,@"Roots point uniforms cannot be arrays");}op[@"uniforms"]=uniforms;
  }else if(kind==3){
   for(NSString *key in @[@"ordinal",@"rangeIndex",@"rangeOffset",@"count"])op[key]=@([r word]);uint32_t n=[op[@"count"]unsignedIntValue];INPUT(n>0&&n<=RootsPointMaxChunkPoints&&r.data.length<=4*1024*1024,@"Roots point append exceeds bounded chunk");NSData *points=attractorBlock(r,RootsPointMaxChunkPoints*16);INPUT(points.length==(uint64_t)n*16,@"Roots point append byte length mismatch");for(uint32_t i=0;i<n;i++){uint32_t bits=indexAt(points,(NSUInteger)i*4+3,4);float metric;memcpy(&metric,&bits,4);INPUT(isfinite(metric)&&metric>=0&&metric<=1,@"Prepared Roots point metric must be finite and clamped");}op[@"points"]=points;
  }
 }
 INPUT(r.offset==r.data.length,@"Trailing Roots point packet bytes");return op;
}
#endif
