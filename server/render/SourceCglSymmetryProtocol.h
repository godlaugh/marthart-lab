#ifndef SOURCE_CGL_SYMMETRY_PROTOCOL_H
#define SOURCE_CGL_SYMMETRY_PROTOCOL_H
// The same GL type/shape and logical object allowance owns wire parsing and
// retained-state admission. No scalar arrays are allocated before admission.
static NSUInteger symmetryUniformWidth(GLenum type){
 switch(type){case GL_FLOAT:case GL_INT:case GL_BOOL:case GL_SAMPLER_2D:return 1;case GL_FLOAT_VEC2:case GL_INT_VEC2:case GL_BOOL_VEC2:return 2;case GL_FLOAT_VEC3:case GL_INT_VEC3:case GL_BOOL_VEC3:return 3;case GL_FLOAT_VEC4:case GL_INT_VEC4:case GL_BOOL_VEC4:return 4;case GL_FLOAT_MAT3:return 9;case GL_FLOAT_MAT4:return 16;default:return 0;}
}
static BOOL symmetryBooleanType(GLenum type){return type==GL_BOOL||type==GL_BOOL_VEC2||type==GL_BOOL_VEC3||type==GL_BOOL_VEC4;}
static BOOL symmetryIntegerType(GLenum type){return type==GL_INT||symmetryBooleanType(type)||type==GL_SAMPLER_2D||type==GL_INT_VEC2||type==GL_INT_VEC3||type==GL_INT_VEC4;}
static BOOL symmetryBindingName(NSString *name){return nameValid(name)&&![name isEqual:@"stateTex"]&&![name isEqual:@"iterations"];}
// The source regex matches ASCII \w+ even inside comments. These names are
// lookup facts, not permission to submit arbitrary typed uniform writes.
static BOOL symmetryMatchedName(NSString *name){
 if(![name isKindOfClass:NSString.class])return NO;NSData *bytes=[name dataUsingEncoding:NSASCIIStringEncoding];if(!bytes.length)return NO;const uint8_t *p=bytes.bytes;
 for(NSUInteger i=0;i<bytes.length;i++)if(!((p[i]>='a'&&p[i]<='z')||(p[i]>='A'&&p[i]<='Z')||(p[i]>='0'&&p[i]<='9')||p[i]=='_'))return NO;return YES;
}
static uint64_t symmetryNameBytes(NSString *name){return 256+(uint64_t)[name lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}
static NSArray *parseSymmetryNames(FrameReader *r,uint64_t retained){
 NSUInteger n=count(r,5);INPUT(n<=65536,@"Symmetry binding name capacity");NSMutableArray *names=[NSMutableArray new];NSMutableSet *seen=[NSMutableSet new];uint64_t bytes=0;
 for(NSUInteger i=0;i<n;i++){NSString *name=[r text];INPUT(symmetryMatchedName(name)&&![seen containsObject:name],@"Symmetry binding name invalid or duplicate");bytes+=symmetryNameBytes(name);ensure(retained+r.data.length*6+bytes<=Budget,@"capacity",@"Symmetry binding names exceed memory budget");[names addObject:name];[seen addObject:name];}return names;
}
static NSArray *parseSymmetryBindings(FrameReader *r,uint64_t retained){
 NSUInteger n=count(r,17);INPUT(n<=65536,@"Symmetry typed binding capacity");NSMutableArray *bindings=[NSMutableArray new];NSMutableSet *seen=[NSMutableSet new];uint64_t charge=262144,scalars=0;
 for(NSUInteger i=0;i<n;i++){
  NSString *name=[r text];uint32_t type=[r word];NSUInteger width=symmetryUniformWidth(type),values=count(r,4);INPUT(symmetryBindingName(name)&&![seen containsObject:name]&&width&&values>0&&values%width==0,@"Symmetry typed binding shape/name invalid");scalars+=values;INPUT(scalars<=65536,@"Symmetry scalar capacity");
  charge+=symmetryNameBytes(name)+values*32;ensure(retained+r.data.length*6+charge<=Budget,@"capacity",@"Symmetry parsed bindings exceed memory budget");NSMutableArray *numbers=[NSMutableArray new];
  for(NSUInteger j=0;j<values;j++){if(symmetryIntegerType(type)){int32_t value=(int32_t)[r word];INPUT((!symmetryBooleanType(type)||(value==0||value==1))&&(type!=GL_SAMPLER_2D||value==0),@"Symmetry integer binding invalid");[numbers addObject:@(value)];}else [numbers addObject:@([r number])];}
  [bindings addObject:@{@"name":name,@"type":@(type),@"values":numbers}];[seen addObject:name];
 }return bindings;
}
static NSUInteger symmetryProcessingWidth(GLenum type){
 switch(type){case GL_INT:return 1;case GL_FLOAT_VEC2:return 2;case GL_FLOAT_VEC3:return 3;case GL_FLOAT_VEC4:return 4;case GL_FLOAT_MAT3:return 9;case GL_FLOAT_MAT4:return 16;default:return 0;}
}
static uint64_t symmetryProcessingBaseBytes(NSUInteger automatic,NSUInteger parameters){
 INPUT(automatic<=65536&&parameters<=65536&&automatic+parameters<=65536,@"Processing binding collection capacity");
 // Includes native result copies and the decoded client result objects.
 return 262144+128+(uint64_t)(automatic+parameters)*320;
}
static void symmetryProcessingBudget(uint64_t retained,uint64_t packetBytes,uint64_t bytes){
 ensure(retained<=Budget&&packetBytes<=Budget/6&&bytes<=Budget&&retained+packetBytes*6+bytes<=Budget,@"capacity",@"Processing bindings and result exceed memory budget");
}
static void symmetryProcessingScalar(id value,BOOL integer){
 INPUT([value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID(),@"Processing binding must be numeric");double n=[value doubleValue];
 INPUT(isfinite(n)&&isfinite((float)n)&&(!integer||(n>=INT32_MIN&&n<=INT32_MAX&&floor(n)==n)),@"Processing binding exceeds scalar range");
}
// Shared semantic admission for parsed wire facts and the resource owner.
static uint64_t symmetryProcessingBytes(id rawAutomatic,id rawParameters,uint64_t retained,uint64_t packetBytes){
 INPUT([rawAutomatic isKindOfClass:NSArray.class]&&[rawParameters isKindOfClass:NSArray.class],@"Processing bindings must be arrays");NSArray *automatic=rawAutomatic,*parameters=rawParameters;
 uint64_t bytes=symmetryProcessingBaseBytes(automatic.count,parameters.count),aliases=0,scalars=parameters.count;symmetryProcessingBudget(retained,packetBytes,bytes);
 for(id item in automatic){
  INPUT([item isKindOfClass:NSDictionary.class],@"Processing automatic setter must be a record");id rawType=item[@"type"],rawNames=item[@"names"],rawValues=item[@"values"];
  INPUT([rawType isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)rawType)!=CFBooleanGetTypeID()&&[rawType doubleValue]==(double)[rawType unsignedIntValue],@"Processing setter type invalid");NSUInteger width=symmetryProcessingWidth([rawType unsignedIntValue]);
  INPUT(width&&[rawNames isKindOfClass:NSArray.class]&&[rawValues isKindOfClass:NSArray.class],@"Processing setter shape invalid");NSArray *names=rawNames,*values=rawValues;INPUT(names.count>0&&names.count<=65536&&values.count==width,@"Processing setter alias/value shape invalid");
  aliases+=names.count;scalars+=width;INPUT(aliases<=65536&&scalars<=65536,@"Processing aliases/scalars exceed capacity");bytes+=256+width*32;symmetryProcessingBudget(retained,packetBytes,bytes);NSMutableSet *seen=[NSMutableSet new];
  for(id name in names){INPUT([name isKindOfClass:NSString.class]&&symmetryBindingName(name)&&![seen containsObject:name],@"Processing alias invalid or duplicate");bytes+=symmetryNameBytes(name);symmetryProcessingBudget(retained,packetBytes,bytes);[seen addObject:name];}
  for(id value in values)symmetryProcessingScalar(value,[rawType unsignedIntValue]==GL_INT);
 }
 NSMutableSet *seen=[NSMutableSet new];for(id item in parameters){
  INPUT([item isKindOfClass:NSDictionary.class],@"Processing parameter must be a record");id name=item[@"name"];INPUT(symmetryMatchedName(name)&&![seen containsObject:name],@"Processing parameter name invalid or duplicate");
  bytes+=symmetryNameBytes(name)+32;symmetryProcessingBudget(retained,packetBytes,bytes);symmetryProcessingScalar(item[@"value"],NO);[seen addObject:name];
 }return bytes;
}
static NSDictionary *parseSymmetryProcessing(FrameReader *r,uint64_t retained){
 NSUInteger automaticCount=[r word],parameterCount=[r word];uint64_t bytes=symmetryProcessingBaseBytes(automaticCount,parameterCount),aliases=0,scalars=parameterCount;
 INPUT((uint64_t)automaticCount*21+(uint64_t)parameterCount*9<=r.data.length-r.offset,@"Processing collections exceed remaining packet");symmetryProcessingBudget(retained,r.data.length,bytes);NSMutableArray *automatic=[NSMutableArray new],*parameters=[NSMutableArray new];
 for(NSUInteger i=0;i<automaticCount;i++){
  NSUInteger n=count(r,5);aliases+=n;INPUT(n>0&&aliases<=65536,@"Processing alias capacity");NSMutableArray *names=[NSMutableArray new];
  for(NSUInteger j=0;j<n;j++){NSString *name=[r text];INPUT(symmetryBindingName(name),@"Processing alias invalid");bytes+=symmetryNameBytes(name);symmetryProcessingBudget(retained,r.data.length,bytes);[names addObject:name];}
  uint32_t type=[r word];NSUInteger width=symmetryProcessingWidth(type),values=count(r,4);INPUT(width&&values==width,@"Processing setter value shape invalid");scalars+=values;INPUT(scalars<=65536,@"Processing scalar capacity");bytes+=256+values*32;symmetryProcessingBudget(retained,r.data.length,bytes);NSMutableArray *numbers=[NSMutableArray new];
  for(NSUInteger j=0;j<values;j++)[numbers addObject:type==GL_INT?@((int32_t)[r word]):@([r number])];[automatic addObject:@{@"names":names,@"type":@(type),@"values":numbers}];
 }
 for(NSUInteger i=0;i<parameterCount;i++){NSString *name=[r text];INPUT(symmetryMatchedName(name),@"Processing parameter name invalid");bytes+=symmetryNameBytes(name)+32;symmetryProcessingBudget(retained,r.data.length,bytes);[parameters addObject:@{@"name":name,@"value":@([r number])}];}
 symmetryProcessingBytes(automatic,parameters,retained,r.data.length);return @{@"automatic":automatic,@"parameters":parameters};
}
#endif
