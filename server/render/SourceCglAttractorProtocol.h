#ifndef SOURCE_CGL_ATTRACTOR_PROTOCOL_H
#define SOURCE_CGL_ATTRACTOR_PROTOCOL_H
// v14 prepared Attractor ABI. The producer owns seeds, geometry, expressions,
// camera arithmetic and all source scalar values; native owns their execution.
static const uint64_t AttractorFixedBytes=1024*1024;
static const uint32_t AttractorTransferBytes=4*1024*1024,AttractorReplyBytes=96;
static uint64_t attractorTexels(uint32_t particles,uint32_t side){
 INPUT(particles>0&&particles<=INT_MAX&&side>0&&side<=46341,@"Invalid Attractor particle/texture dimensions");
 uint64_t texels=(uint64_t)side*side;INPUT(texels>=particles&&(uint64_t)(side-1)*(side-1)<particles,@"Attractor texture side must be ceil(sqrt(count))");
 // Preserve the existing shared producer's count admission as a separate
 // floor. Do not add its WebGL CPU-array estimate to native resident bytes.
 ensure(texels*64+(uint64_t)particles*48<=Budget,@"capacity",@"Attractor shared particle layout exceeds capacity");return texels;
}
static void attractorBudget(uint64_t retained,uint64_t allocation,uint64_t packet,uint64_t response){
 ensure(retained<=Budget&&allocation<=Budget&&packet<=Budget/6&&response<=Budget/4&&retained+allocation+packet*6+response*4<=Budget,@"capacity",@"Attractor shared resources, targets and transfer copies exceed capacity");
}
static NSData *attractorBlock(FrameReader *r,uint32_t maximum){uint32_t length=[r word];INPUT(length<=maximum,@"Attractor block exceeds transfer bound");const void *bytes=[r take:length];return [NSData dataWithBytes:bytes length:length];}
static NSData *attractorFloats(FrameReader *r,uint32_t number){float values[16];INPUT(number<=16,@"Attractor fixed scalar width invalid");for(uint32_t i=0;i<number;i++)values[i]=[r number];return [NSData dataWithBytes:values length:number*4];}
static NSDictionary *parseAttractor(FrameReader *r,uint32_t width,uint32_t height,uint64_t retained){
 INPUT([r word]==6,@"Unknown Attractor family");uint32_t kind=[r word];NSData *resource=attractorBlock(r,16);BOOL nonzero=NO;for(NSUInteger i=0;i<resource.length;i++)if(((const uint8_t*)resource.bytes)[i])nonzero=YES;
 INPUT(kind>=1&&kind<=6&&resource.length==16&&nonzero,@"Invalid Attractor operation/resource");INPUT(kind==4||(width==1&&height==1),@"Attractor controls require 1x1 envelope");
 NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource}mutableCopy];uint64_t response=AttractorReplyBytes;
 if(kind==4)response+=(uint64_t)width*height*4;
 attractorBudget(kind==6?0:retained,0,r.data.length,response);
 if(kind==1){
  uint32_t particles=[r word],side=[r word],operations=[r word];uint64_t texels=attractorTexels(particles,side);INPUT(operations>0,@"Attractor shader operation fact must be positive");op[@"count"]=@(particles);op[@"side"]=@(side);op[@"operations"]=@(operations);
  uint64_t base=texels*32+(uint64_t)particles*24+AttractorFixedBytes,programBytes=0;
  attractorBudget(retained,base,r.data.length,response);
  for(NSString *key in @[@"updateVertex",@"updateFragment",@"accumulateVertex",@"accumulateFragment",@"presentVertex",@"presentFragment"]){
   uint32_t length=[r word];INPUT(length>0,@"Attractor shader text is empty");attractorBudget(retained,base+programBytes+(uint64_t)length*3,r.data.length,response);const void *bytes=[r take:length];INPUT(memchr(bytes,0,length)==NULL,@"Attractor shader text contains NUL");NSString *source=[[NSString alloc]initWithBytes:bytes length:length encoding:NSUTF8StringEncoding];INPUT(source&&[source hasPrefix:@"#version 410 core\n"],@"Attractor shader requires explicit GL 4.1 core profile");op[key]=source;programBytes+=(uint64_t)length*3;
  }op[@"programBytes"]=@(programBytes);
 }else if(kind!=6){
  for(NSString *key in @[@"index",@"renderIndex",@"uploaded",@"count",@"side"])op[key]=@([r word]);uint64_t texels=attractorTexels([op[@"count"]unsignedIntValue],[op[@"side"]unsignedIntValue]);INPUT([op[@"uploaded"]unsignedIntValue]<=texels,@"Attractor upload checkpoint exceeds texture");
  if(kind==2){
   uint32_t offset=[r word];NSData *positions=attractorBlock(r,AttractorTransferBytes),*uv=attractorBlock(r,AttractorTransferBytes),*colors=attractorBlock(r,AttractorTransferBytes);INPUT(positions.length>0&&positions.length%16==0&&positions.length+uv.length+colors.length<=AttractorTransferBytes,@"Invalid Attractor upload byte lengths");
   uint64_t number=positions.length/16,particles=[op[@"count"]unsignedIntValue];INPUT(offset<=texels&&number<=texels-offset,@"Attractor upload exceeds full square");uint64_t attributes=MIN(number,offset<particles?particles-offset:0);INPUT(uv.length==attributes*8&&colors.length==attributes*16,@"Attractor upload attribute range differs from real particle slots");
   for(NSData *block in @[positions,uv,colors])samilaFloatBlock(block,block.length);op[@"offset"]=@(offset);op[@"positions"]=positions;op[@"texIndex"]=uv;op[@"colors"]=colors;op[@"uploadCount"]=@(number);
  }else if(kind==3){
   op[@"steps"]=@((int32_t)[r word]);uint32_t warmup=[r word];INPUT(warmup<=1,@"Invalid Attractor warmup boolean");op[@"warmup"]=@(warmup);
   for(NSString *key in @[@"warmupBase",@"currentStepBase",@"staggerMin",@"staggerRange"])op[key]=@((int32_t)[r word]);
  }else if(kind==4){
   uint32_t aw=[r word],ah=[r word];INPUT(aw>0&&ah>0&&aw<=16384&&ah<=16384&&(uint64_t)aw*ah<=16000000,@"Invalid Attractor accumulation dimensions");op[@"accumWidth"]=@(aw);op[@"accumHeight"]=@(ah);float radius=[r number];INPUT(radius>0,@"Attractor point radius must be positive");op[@"radius"]=@(radius);
   for(NSString *key in @[@"scale",@"offset",@"projection",@"modelview",@"backgroundRgb"])op[key]=attractorFloats(r,([key isEqual:@"projection"]||[key isEqual:@"modelview"])?16:3);
   for(NSString *key in @[@"exposure",@"contrast",@"gamma",@"saturation",@"densityScale"])op[key]=@([r number]);
  }else{
   uint32_t target=[r word],offset=[r word],number=[r word];INPUT((target==1||target==2)&&number>0&&number<=AttractorTransferBytes/16,@"Invalid Attractor diagnostic read range");op[@"target"]=@(target);op[@"offset"]=@(offset);op[@"readCount"]=@(number);attractorBudget(retained,0,r.data.length,AttractorReplyBytes+(uint64_t)number*16);
  }
 }
 INPUT(r.offset==r.data.length,@"Trailing Attractor packet bytes");return op;
}
#endif
