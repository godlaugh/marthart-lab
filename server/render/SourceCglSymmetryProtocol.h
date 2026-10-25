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
static uint64_t symmetryNameBytes(NSString *name){return 256+(uint64_t)[name lengthOfBytesUsingEncoding:NSUTF8StringEncoding]*3;}
static NSArray *parseSymmetryNames(FrameReader *r,uint64_t retained){
 NSUInteger n=count(r,5);INPUT(n<=65536,@"Symmetry binding name capacity");NSMutableArray *names=[NSMutableArray new];NSMutableSet *seen=[NSMutableSet new];uint64_t bytes=0;
 for(NSUInteger i=0;i<n;i++){NSString *name=[r text];INPUT(symmetryBindingName(name)&&![seen containsObject:name],@"Symmetry binding name invalid or duplicate");bytes+=symmetryNameBytes(name);ensure(retained+r.data.length*6+bytes<=Budget,@"capacity",@"Symmetry binding names exceed memory budget");[names addObject:name];[seen addObject:name];}return names;
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
#endif
