#ifndef SOURCE_CGL_DRAWING_PROTOCOL_H
#define SOURCE_CGL_DRAWING_PROTOCOL_H
// Mirrors sourceDrawingBudget.ts; verified through native boundary requests.
static const uint32_t SourceDrawingMaxChunkBytes=4*1024*1024;
static NSDictionary *parseWithRetained(NSData*,BOOL,uint64_t);
static NSDictionary *parseDrawingRequest(FrameReader *r,uint32_t width,uint32_t height,uint32_t samples,uint64_t retained,uint32_t envelope){
 INPUT([r word]==5,@"Unknown drawing family");uint32_t kind=[r word];NSData *resource=[r block];BOOL nonzero=NO;for(NSUInteger i=0;i<resource.length;i++)nonzero|=((const uint8_t*)resource.bytes)[i]!=0;
 INPUT(kind>=1&&kind<=4&&resource.length==16&&nonzero,@"Invalid drawing operation/resource");uint32_t index=[r word];NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource,@"index":@(index)}mutableCopy];
 if(kind==1){
  uint32_t chunks=[r word],maximum=[r word],metadata=[r word];INPUT(index==0&&maximum>0&&maximum<=SourceDrawingMaxChunkBytes,@"Invalid drawing chunk admission");
  ensure(retained+metadata+(uint64_t)width*height*(12+(uint64_t)8*samples)+(uint64_t)8*((uint64_t)maximum+envelope)<=Budget,@"capacity",@"Drawing transaction exceeds shared budget");
  NSUInteger n=count(r,32);NSMutableArray *schedule=[NSMutableArray new];uint64_t expected=0;
  for(NSUInteger i=0;i<n;i++){uint32_t command=[r word],range=[r word],total=[r word],perPass=[r word],size=[r word],primitive=[r word],np=[r word];INPUT(command==i&&range>=1&&range<=3&&size>0&&primitive==1&&np>=1&&np<=2&&perPass==((uint64_t)total+size-1)/size&&(range!=3||perPass==(total?1:0)),@"Invalid drawing schedule");NSMutableArray *passes=[NSMutableArray new];for(uint32_t p=0;p<np;p++){uint32_t face=[r word];INPUT(face<=2,@"Invalid drawing face pass");[passes addObject:@(face)];}expected+=(uint64_t)perPass*np;INPUT(expected<=UINT32_MAX,@"Drawing schedule overflows");[schedule addObject:@{@"command":@(command),@"range":@(range),@"total":@(total),@"perPass":@(perPass),@"size":@(size),@"passes":passes}];}
  INPUT(expected==chunks,@"Drawing chunk total mismatch");op[@"chunks"]=@(chunks);op[@"maximum"]=@(maximum);op[@"metadata"]=@(metadata);op[@"schedule"]=schedule;
 }else if(kind==2){
  for(NSString *name in @[@"command",@"pass",@"range",@"offset",@"count",@"total"])op[name]=@([r word]);NSData *nested=[r block];INPUT(nested.length>=60&&nested.length<=SourceDrawingMaxChunkBytes&&(indexAt(nested,1,4)==3||indexAt(nested,1,4)==12),@"Invalid bounded generic drawing packet");
  NSDictionary *draw=parseWithRetained(nested,NO,retained);INPUT([draw[@"width"]unsignedIntValue]==1&&[draw[@"height"]unsignedIntValue]==1&&[draw[@"samples"]unsignedIntValue]==0&&[draw[@"completion"]unsignedIntValue]==0&&[draw[@"draws"]count]==1&&[draw[@"draws"][0][@"passes"]count]==1,@"Chunk must contain exactly one face pass");for(NSNumber *v in draw[@"clear"])INPUT(v.floatValue==0,@"Chunk cannot clear the target");op[@"drawing"]=draw;op[@"packetBytes"]=@(nested.length);
 }
 INPUT(r.offset==r.data.length,@"Trailing drawing transaction bytes");return op;
}
#endif
