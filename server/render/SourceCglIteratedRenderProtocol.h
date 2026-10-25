// Version 7's typed render input. The wire parser owns scalar/identity shape;
// the retained ink owner validates the linked shader ABI and its owned values.
static NSData *iteratedRenderToken(FrameReader *r){
 NSData *token=[r block];BOOL nonzero=NO;for(NSUInteger i=0;i<token.length;i++)if(((const uint8_t*)token.bytes)[i])nonzero=YES;
 INPUT(token.length==16&&nonzero,@"Invalid iterated render resource identity");return token;
}
static NSArray *iteratedRenderUniforms(FrameReader *r){
 NSUInteger n=count(r,17);INPUT(n<=65536,@"Iterated render uniform capacity");NSMutableArray *out=[NSMutableArray new];NSMutableSet *names=[NSMutableSet new];
 NSArray *kinds=@[@"",@"float",@"int",@"bool",@"vec2",@"vec3",@"vec4",@"ivec2",@"mat4",@"sampler2d",@"usampler2d"];
 for(NSUInteger i=0;i<n;i++){
  NSString *name=[r text];uint32_t kind=[r word],components=[r word];INPUT(nameValid(name)&&![names containsObject:name]&&kind>=1&&kind<=10,@"Invalid iterated render uniform declaration");[names addObject:name];
  uint32_t expected=kind==4||kind==7?2:kind==5?3:kind==6?4:kind==8?16:1;INPUT(components==expected,@"Invalid iterated render uniform component count");
  if(kind>=9){uint32_t unit=[r word];INPUT(unit<=3,@"Invalid iterated render sampler unit");[out addObject:@{@"name":name,@"kind":kinds[kind],@"texture":@(unit)}];continue;}
  NSMutableArray *values=[NSMutableArray new];for(uint32_t j=0;j<components;j++){
   if(kind==2||kind==3||kind==7){uint32_t bits=[r word];int32_t value;memcpy(&value,&bits,4);INPUT(kind!=3||value==0||value==1,@"Invalid iterated render boolean");[values addObject:@(value)];}
   else [values addObject:@([r number])];
  }
  [out addObject:@{@"name":name,@"kind":kinds[kind],@"values":values}];
 }return out;
}
static NSDictionary *parseIteratedRender(FrameReader *r,uint32_t width,uint32_t height){
 uint32_t kind=[r word];INPUT(kind>=1&&kind<=5,@"Unknown iterated render operation");NSData *resource=iteratedRenderToken(r);
 NSMutableDictionary *op=[@{@"kind":@(kind),@"resource":resource}mutableCopy];
 if(kind==4){INPUT(width==1&&height==1,@"Iterated render release must use control dimensions");return op;}
 op[@"stateResource"]=iteratedRenderToken(r);op[@"index"]=@([r word]);uint32_t displays=[r word],particles=[r word];
 INPUT(particles>=1&&particles<=8000000&&(kind!=1||displays==0)&&(kind!=2||displays<UINT32_MAX)&&(kind!=3||displays>0),@"Invalid iterated render count/display checkpoint");op[@"displays"]=@(displays);op[@"count"]=@(particles);
 if(kind==1||kind==5){NSMutableDictionary *programs=[NSMutableDictionary new];uint64_t bytes=0;
  for(NSString *name in @[@"draw",@"statsFirst",@"statsReduce",@"present",@"presentReduce",@"decay"]){NSMutableDictionary *stages=[NSMutableDictionary new];for(NSString *stage in @[@"vertex",@"fragment"]){NSString *source=[r text];INPUT([source hasPrefix:@"#version 410 core\n"],@"Iterated render shader requires native GL41 profile");stages[stage]=source;bytes+=[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}programs[name]=stages;}
  op[@"programs"]=programs;op[@"programBytes"]=@(bytes);
 }else if(kind==2){uint32_t clear=[r word],record=[r word];float decay=[r number];uint32_t primitive=[r word];INPUT(clear<=1&&record<=1&&decay>=0&&decay<=1&&(primitive==1||primitive==2),@"Invalid iterated draw controls");
  NSString *key=[r text];uint32_t format=[r word];INPUT(format==1||format==2,@"Unknown iterated palette format");NSData *palette=[r block];samilaFloatBlock(palette,format==1?1024*12:4097*16);NSData *noise=[r block];INPUT(noise.length==256,@"Invalid iterated noise table");NSArray *draw=iteratedRenderUniforms(r),*stats=iteratedRenderUniforms(r);
  op[@"clear"]=@(clear);op[@"record"]=@(record);op[@"decay"]=@(decay);op[@"plan"]=@{@"primitive":primitive==1?@"points":@"triangles",@"palette":@{@"key":key,@"format":format==1?@"source-rgb1024":@"local-rgba4097",@"bytes":palette},@"noise":noise,@"drawUniforms":draw,@"statsUniforms":stats};
 }else{uint32_t filter=[r word];INPUT(filter==1||filter==2,@"Invalid iterated presentation filter");NSMutableArray *clear=[NSMutableArray new];for(int i=0;i<4;i++){float v=[r number];INPUT(v>=0&&v<=1,@"Invalid iterated presentation clear");[clear addObject:@(v)];}op[@"plan"]=@{@"filter":filter==1?@"linear":@"nearest",@"clear":clear,@"uniforms":iteratedRenderUniforms(r)};}
 return op;
}
