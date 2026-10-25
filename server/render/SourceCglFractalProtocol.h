// Fractal v11 wire parser. The caller has consumed the common 60-byte envelope.
static NSDictionary *parseFractal(FrameReader *r,uint32_t width,uint32_t height,uint64_t retained){
 INPUT([r word]==4,@"Unknown Fractal resource family");uint32_t kind=[r word];NSData *resource=[r block];BOOL nonzero=NO;
 for(NSUInteger i=0;i<resource.length;i++)if(((const uint8_t*)resource.bytes)[i])nonzero=YES;
 INPUT(kind>=1&&kind<=3&&resource.length==16&&nonzero,@"Invalid Fractal operation/resource");
 NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource}mutableCopy];
 if(kind!=2)INPUT(width==1&&height==1,@"Invalid Fractal control dimensions");
 if(kind==1){
  uint64_t programBytes=0;
  for(NSString *key in @[@"vertex",@"fragment"]){NSString *source=[r text];INPUT([source rangeOfString:@"#version"].location==NSNotFound,@"Fractal shaders must omit version directives");op[key]=source;programBytes+=[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}
  op[@"programBytes"]=@(programBytes);ensure(retained+programBytes+r.data.length*6+192<=Budget,@"capacity",@"Fractal creation exceeds shared budget");
 }else if(kind==2){
  uint32_t index=[r word];INPUT(index<UINT32_MAX,@"Fractal sample checkpoint exhausted");op[@"index"]=@(index);
  NSData *points=[r block];INPUT(points.length>0&&points.length%8==0&&points.length/8<=65536,@"Invalid Fractal point count");
  for(NSUInteger i=0;i<points.length/8;i++)INPUT(indexAt(points,i*2,4)<width&&indexAt(points,i*2+1,4)<height,@"Fractal point exceeds target");op[@"points"]=points;op[@"count"]=@(points.length/8);
  NSData *reference=[r block],*palette=[r block];INPUT(reference.length>=16&&reference.length%16==0&&reference.length/16<=2048,@"Invalid Fractal reference texture");INPUT(palette.length==12||palette.length==1024*12,@"Invalid Fractal gradient texture");
  samilaFloatBlock(reference,reference.length);samilaFloatBlock(palette,palette.length);op[@"reference"]=reference;op[@"palette"]=palette;
  NSArray *uniforms=samilaUniforms(r);NSDictionary *referenceSampler=nil,*paletteSampler=nil,*iterations=nil,*referenceLength=nil,*gradientSize=nil;
  for(NSDictionary *u in uniforms){uint32_t type=[u[@"kind"]unsignedIntValue];INPUT(type==1||type==2||type==3||type==5||type==6||type==8||type==9||type==10,@"Unsupported Fractal uniform kind");
   NSString *name=u[@"name"];if([name isEqual:@"u_refOrbitTex"])referenceSampler=u;else if([name isEqual:@"u_gradientTex"])paletteSampler=u;else if([name isEqual:@"u_iterations"])iterations=u;else if([name isEqual:@"u_refOrbitLen"])referenceLength=u;else if([name isEqual:@"u_gradientSize"])gradientSize=u;
   uint32_t bound=[name isEqual:@"u_palette"]?16:[name isEqual:@"u_dynamicParams"]?32:0;
   if(bound){uint32_t count=[u[@"count"]unsignedIntValue];INPUT(type==(bound==16?10U:8U)&&count>0&&count<=bound,@"Fractal source array exceeds typed profile bounds");}
   if([name isEqual:@"u_paletteSize"])INPUT(type==2&&[u[@"count"]unsignedIntValue]==1&&indexAt(u[@"bytes"],0,4)<=16,@"Fractal palette size must be int 0..16");
   if(type==9)INPUT(([name isEqual:@"u_refOrbitTex"]&&[u[@"texture"]unsignedIntValue]==2)||([name isEqual:@"u_gradientTex"]&&[u[@"texture"]unsignedIntValue]==1),@"Fractal sampler is not owned");
  }
  INPUT([referenceSampler[@"kind"]unsignedIntValue]==9&&[paletteSampler[@"kind"]unsignedIntValue]==9&&[iterations[@"kind"]unsignedIntValue]==2&&[referenceLength[@"kind"]unsignedIntValue]==2&&[gradientSize[@"kind"]unsignedIntValue]==2,@"Fractal fixed bindings missing");
  uint32_t limit=indexAt(iterations[@"bytes"],0,4),length=indexAt(referenceLength[@"bytes"],0,4);INPUT(limit>=1&&limit<=2048&&length<=2048&&reference.length==(uint64_t)MAX(length,1U)*16,@"Fractal iterations/reference length invalid");uint32_t size=indexAt(gradientSize[@"bytes"],0,4);INPUT(size==0||size==1024,@"Fractal gradient size invalid");op[@"iterations"]=@(limit);op[@"uniforms"]=uniforms;
 }
 INPUT(r.offset==r.data.length,@"Trailing Fractal frame bytes");return op;
}
