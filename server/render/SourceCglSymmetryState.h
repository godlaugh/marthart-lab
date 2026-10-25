#ifndef SOURCE_CGL_SYMMETRY_STATE_H
#define SOURCE_CGL_SYMMETRY_STATE_H
#include "SourceCglIteratedSupport.h"
// Raw source-fragment state. The composition layer supplies parsed source
// bindings, including any Processing context uniforms. This owner never
// infers those values from text or silently initializes unmatched uniforms.
@interface SourceCglSymmetryState:NSObject <SourceCglIteratedStateOwner> {
 CGLContextObj _context;
 GLuint _program,_diagnostic,_shaders[4],_seed,_positions[2],_metadata[2],_framebuffer,_vao,_quad;
 uint32_t _count,_size,_uploaded,_index,_current,_metadataCurrent;
 uint64_t _programBytes,_observations,_bindingNameBytes;
 BOOL _prepared,_failed,_disposed;
 NSString *_vertex,*_fragment;NSArray<NSString*> *_bindingNames;NSDictionary *_activeUniforms;
}
@property(readonly) uint64_t retainedBytes,drawViewAllocationBytes;
@property(readonly) uint32_t count,uploaded,index;
@property(readonly) NSString *diagnosticUnit;
-(instancetype)initWithOperation:(NSDictionary*)operation;
-(void)prepare:(NSDictionary*)operation;
-(void)upload:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(NSData*)read:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(uint32_t)drawViewWidth;
-(uint32_t)drawViewHeight;
-(SourceCglIteratedDrawView)drawViewAtIndex:(uint32_t)index retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)dispose;
@end

static const char *SymmetryDiagnosticFragment=
 "#version 410 core\n"
 "uniform sampler2D landed;uniform usampler2D counters;uniform int resetCounter,observe;out uvec2 result;\n"
 "bool finiteFloat(float v){return (floatBitsToUint(v)&0x7f800000u)!=0x7f800000u;}\n"
 "void main(){ivec2 p=ivec2(gl_FragCoord.xy);uvec2 old=texelFetch(counters,p,0).rg;uint n=resetCounter==1?0u:old.r;"
 "if(observe==0){result=uvec2(n,old.g);return;}vec4 v=texelFetch(landed,p,0);"
 "bool ok=finiteFloat(v.x)&&finiteFloat(v.y)&&finiteFloat(v.z)&&finiteFloat(v.w);result=uvec2(n+uint(!ok),ok?1u:0u);}\n";
@implementation SourceCglSymmetryState
-(uint64_t)retainedBytes{return _disposed?0:(uint64_t)_size*_size*64+_programBytes+_bindingNameBytes+IteratedStateFixedBytes;}
-(uint64_t)drawViewAllocationBytes{return 0;}
-(NSString*)executionProfile{return @"source-fragment";}
-(NSString*)diagnosticUnit{return @"completed-pass";}
-(uint32_t)count{return _count;}-(uint32_t)uploaded{return _uploaded;}-(uint32_t)index{return _index;}
-(uint32_t)drawViewWidth{return _size;}-(uint32_t)drawViewHeight{return _size;}
-(instancetype)initWithOperation:(NSDictionary*)operation{
 self=[super init];if(!self)return nil;_count=iteratedStateWord(operation,@"count");INPUT(_count>0&&_count<=8000000,@"Invalid symmetry count");_size=(uint32_t)ceil(sqrt((double)_count));
 _programBytes=iteratedStateProgramBytes(operation);ensure(self.retainedBytes<=Budget,@"capacity",@"Symmetry square state exceeds memory budget");
 id names=operation[@"bindingNames"];INPUT([names isKindOfClass:NSArray.class]&&[(NSArray*)names count]<=65536,@"Symmetry matched bindings invalid");NSMutableSet *seen=[NSMutableSet new];
 for(id name in names){INPUT([name isKindOfClass:NSString.class]&&symmetryBindingName(name)&&![seen containsObject:name],@"Symmetry matched binding name invalid or duplicate");[seen addObject:name];_bindingNameBytes+=symmetryNameBytes(name);ensure(self.retainedBytes<=Budget,@"capacity",@"Symmetry names exceed memory budget");}
 _bindingNames=[names copy];_vertex=[operation[@"vertex"]copy];_fragment=[operation[@"fragment"]copy];
 ensure(CFByteOrderGetCurrent()==CFByteOrderLittleEndian,@"unsupported",@"Symmetry seed requires little-endian host");_context=CGLGetCurrentContext();RUNTIME(_context,@"Symmetry state needs current context");_context=CGLRetainContext(_context);RUNTIME(_context,@"Cannot retain symmetry context");return self;
}
-(void)checkGl{GLenum e=glGetError();if(e){_failed=YES;RUNTIME(NO,([NSString stringWithFormat:@"Symmetry state GL error %u",e]));}}
-(void)check{INPUT(_prepared&&!_disposed,@"Symmetry state is not prepared");RUNTIME(!_failed&&CGLGetCurrentContext()==_context,@"Symmetry state is failed or belongs to another context");}
-(void)ready{[self check];INPUT(_uploaded==_count,@"Symmetry seed upload incomplete");}
-(void)unbind{
 RUNTIME(CGLGetCurrentContext()==_context,@"Cannot unbind symmetry state in another context");glBindFramebuffer(GL_FRAMEBUFFER,0);glBindVertexArray(0);glBindBuffer(GL_ARRAY_BUFFER,0);glBindBuffer(GL_COPY_WRITE_BUFFER,0);glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glUseProgram(0);glDisable(GL_BLEND);
 for(int unit=0;unit<2;unit++){glActiveTexture(GL_TEXTURE0+unit);glBindTexture(GL_TEXTURE_2D,0);glBindSampler(unit,0);}glActiveTexture(GL_TEXTURE0);[self checkGl];
}
-(void)perform:(void (^)(void))work{
 NSException *failure=nil;@try{work();}@catch(NSException *e){_failed=YES;failure=e;}
 @try{[self unbind];}@catch(NSException *e){_failed=YES;failure=failure?[NSException exceptionWithName:@"runtime" reason:[NSString stringWithFormat:@"%@; symmetry cleanup also failed: %@",failure.reason,e.reason] userInfo:@{@"primary":failure,@"cleanup":e}]:e;}
 if(failure)@throw failure;
}
-(void)link:(GLuint*)program shaders:(GLuint*)shaders fragment:(NSString*)fragment output:(const char*)output{
 iteratedStateCompile(&shaders[0],GL_VERTEX_SHADER,_vertex);iteratedStateCompile(&shaders[1],GL_FRAGMENT_SHADER,fragment);*program=glCreateProgram();RUNTIME(*program,@"Symmetry program allocation failed");glAttachShader(*program,shaders[0]);glAttachShader(*program,shaders[1]);glBindAttribLocation(*program,0,"quadPosition");glBindFragDataLocation(*program,0,output);glLinkProgram(*program);
 GLint linked=0;glGetProgramiv(*program,GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(*program,sizeof(log),NULL,log);RUNTIME(NO,@(log));}
 GLint attributes=0;glGetProgramiv(*program,GL_ACTIVE_ATTRIBUTES,&attributes);for(GLint i=0;i<attributes;i++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(*program,i,sizeof(name),&length,&size,&type,name);RUNTIME(strcmp(name,"quadPosition")==0&&size==1&&type==GL_FLOAT_VEC2&&glGetAttribLocation(*program,name)==0,@"Symmetry vertex ABI mismatch");}
 GLint outputLocation=glGetFragDataLocation(*program,output);RUNTIME(outputLocation==0||(strcmp(output,"newState")==0&&outputLocation==-1),@"Symmetry output ABI mismatch");[self checkGl];for(int i=0;i<2;i++){glDetachShader(*program,shaders[i]);[self checkGl];glDeleteShader(shaders[i]);[self checkGl];shaders[i]=0;}
}
-(void)texture:(GLuint*)texture internal:(GLenum)internal format:(GLenum)format type:(GLenum)type{
 glGenTextures(1,texture);RUNTIME(*texture,@"Symmetry texture allocation failed");glBindTexture(GL_TEXTURE_2D,*texture);glTexImage2D(GL_TEXTURE_2D,0,internal,_size,_size,0,format,type,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);[self checkGl];
}
-(void)target:(GLuint)texture{glBindFramebuffer(GL_FRAMEBUFFER,_framebuffer);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Symmetry target incomplete");}
-(void)clearMetadata{const GLuint initial[]={0,1,0,0};for(int i=0;i<2;i++){[self target:_metadata[i]];glClearBufferuiv(GL_COLOR,0,initial);}[self checkGl];_metadataCurrent=0;}
-(void)prepare:(NSDictionary*)operation{
 INPUT(!_prepared&&!_failed&&!_disposed,@"Symmetry state cannot prepare twice");RUNTIME(CGLGetCurrentContext()==_context,@"Symmetry preparation context mismatch");INPUT(iteratedStateWord(operation,@"count")==_count&&iteratedStateProgramBytes(operation)==_programBytes&&[_vertex isEqual:operation[@"vertex"]]&&[_fragment isEqual:operation[@"fragment"]]&&[_bindingNames isEqual:operation[@"bindingNames"]],@"Symmetry preparation differs from creation");
 [self perform:^{
  GLint max=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&max);ensure(max>0&&self->_size<=(uint32_t)max,@"unsupported",@"Symmetry square exceeds texture capacity");samilaRaster(self->_size,self->_size);glDisable(GL_BLEND);glActiveTexture(GL_TEXTURE0);glBindSampler(0,0);glBindSampler(1,0);
  [self link:&self->_program shaders:self->_shaders fragment:self->_fragment output:"newState"];[self link:&self->_diagnostic shaders:self->_shaders+2 fragment:@(SymmetryDiagnosticFragment) output:"result"];
  GLint active=0,length=0;glGetProgramiv(self->_program,GL_ACTIVE_UNIFORMS,&active);glGetProgramiv(self->_program,GL_ACTIVE_UNIFORM_MAX_LENGTH,&length);RUNTIME(length>=0&&(uint64_t)length<=self->_programBytes/3+1,@"Symmetry uniform name budget");NSMutableData *nameBytes=[NSMutableData dataWithLength:MAX(1,length)];NSMutableDictionary *uniforms=[NSMutableDictionary new];
  for(GLint i=0;i<active;i++){GLsizei n=0;GLint size=0;GLenum type=0;glGetActiveUniform(self->_program,i,length,&n,&size,&type,nameBytes.mutableBytes);RUNTIME(n>0&&n<length&&size>0,@"Symmetry active uniform invalid");NSString *name=[[NSString alloc]initWithBytes:nameBytes.bytes length:n encoding:NSUTF8StringEncoding];GLint location=glGetUniformLocation(self->_program,nameBytes.bytes);RUNTIME(name&&location>=0,@"Symmetry uniform location invalid");NSString *binding=[name hasSuffix:@"[0]"]?[name substringToIndex:name.length-3]:name;RUNTIME(!uniforms[binding],@"Symmetry reflected binding collision");uniforms[binding]=@{@"sourceName":name,@"location":@(location),@"type":@(type),@"size":@(size)};}
  self->_activeUniforms=[uniforms copy];
  for(NSString *key in @[@"stateTex",@"iterations"]){NSDictionary *u=uniforms[key];if(u)RUNTIME([u[@"size"]intValue]==1&&[u[@"type"]unsignedIntValue]==([key isEqual:@"stateTex"]?GL_SAMPLER_2D:GL_INT),@"Symmetry fixed uniform ABI mismatch");}
  glGenFramebuffers(1,&self->_framebuffer);glGenVertexArrays(1,&self->_vao);glGenBuffers(1,&self->_quad);glGenBuffers(1,&self->_seed);RUNTIME(self->_framebuffer&&self->_vao&&self->_quad&&self->_seed,@"Symmetry state allocation failed");
  glBindVertexArray(self->_vao);glBindBuffer(GL_ARRAY_BUFFER,self->_quad);const GLfloat quad[]={-1,-1,1,-1,-1,1,1,1};glBufferData(GL_ARRAY_BUFFER,sizeof(quad),quad,GL_STATIC_DRAW);glEnableVertexAttribArray(0);glVertexAttribPointer(0,2,GL_FLOAT,GL_FALSE,0,NULL);
  for(int i=0;i<2;i++){[self texture:&self->_positions[i] internal:GL_RGBA32F format:GL_RGBA type:GL_FLOAT];[self texture:&self->_metadata[i] internal:GL_RG32UI format:GL_RG_INTEGER type:GL_UNSIGNED_INT];}
  // Only read side 0 is initialized. Original discard can expose the retained
  // write-side history; its first allocation contents are explicitly unknown.
  [self target:self->_positions[0]];const GLfloat zero[]={0,0,0,0};glClearBufferfv(GL_COLOR,0,zero);[self clearMetadata];
  glBindBuffer(GL_COPY_WRITE_BUFFER,self->_seed);glBufferData(GL_COPY_WRITE_BUFFER,(GLsizeiptr)self->_size*self->_size*16,NULL,GL_STATIC_COPY);uint32_t padding=self->_size*self->_size-self->_count;const uint32_t zeros[4096*4]={0};for(uint32_t at=0;at<padding;at+=4096){uint32_t n=MIN(4096,padding-at);glBufferSubData(GL_COPY_WRITE_BUFFER,(GLintptr)(self->_count+at)*16,(GLsizeiptr)n*16,zeros);}
  [self checkGl];self->_prepared=YES;
 }];
}
-(void)upload:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self check];uint32_t index=iteratedStateWord(operation,@"index"),offset=iteratedStateWord(operation,@"offset");id raw=operation[@"positions"];INPUT([raw isKindOfClass:NSData.class],@"Symmetry upload requires packed bytes");NSData *data=raw;INPUT(index==0&&_index==0&&offset==_uploaded&&data.length>0&&data.length%16==0&&data.length/16<=IteratedStateChunk&&data.length/16<=_count-_uploaded,@"Symmetry upload must be next bounded range");
 INPUT(retained>=self.retainedBytes&&packetBytes>=data.length,@"Symmetry upload omits owned storage");iteratedStateBudget(retained,packetBytes,0);for(NSUInteger i=0;i<data.length;i+=4){float f;memcpy(&f,(const uint8_t*)data.bytes+i,4);INPUT(isfinite(f),@"Symmetry seed must be finite");}
 [self perform:^{samilaRaster(self->_size,self->_size);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,self->_positions[0]);glPixelStorei(GL_UNPACK_SWAP_BYTES,GL_FALSE);glBindBuffer(GL_COPY_WRITE_BUFFER,self->_seed);glBufferSubData(GL_COPY_WRITE_BUFFER,(GLintptr)offset*16,data.length,data.bytes);
  for(uint32_t at=0;at<data.length/16;){uint32_t first=offset+at,x=first%self->_size,y=first/self->_size,n=MIN(self->_size-x,(uint32_t)data.length/16-at);glTexSubImage2D(GL_TEXTURE_2D,0,x,y,n,1,GL_RGBA,GL_FLOAT,(const uint8_t*)data.bytes+(NSUInteger)at*16);at+=n;}[self checkGl];
 }];_uploaded+=(uint32_t)data.length/16;
}
// Typed bindings are caller-owned parsed facts. Unbound active values keep GL
// link defaults; matched scalar names are mandatory and reset on every pass.
-(NSArray*)bindings:(id)raw{
 INPUT([raw isKindOfClass:NSArray.class]&&[(NSArray*)raw count]<=65536,@"Symmetry typed bindings invalid");NSMutableDictionary *byName=[NSMutableDictionary new];NSUInteger valueCount=0;
 for(id item in raw){INPUT([item isKindOfClass:NSDictionary.class],@"Symmetry binding must be a record");NSString *name=item[@"name"];INPUT([name isKindOfClass:NSString.class]&&nameValid(name)&&!byName[name]&&![name isEqual:@"stateTex"]&&![name isEqual:@"iterations"],@"Symmetry binding name invalid, duplicate or owner-controlled");GLenum type=iteratedStateWord(item,@"type");NSUInteger width=symmetryUniformWidth(type);NSArray *values=item[@"values"];INPUT(width&&[values isKindOfClass:NSArray.class]&&values.count>0&&values.count%width==0&&values.count<=65536,@"Symmetry binding shape invalid");
  valueCount+=values.count;INPUT(valueCount<=65536,@"Symmetry complete binding values exceed scratch budget");NSDictionary *active=_activeUniforms[name];INPUT(!active||([active[@"type"]unsignedIntValue]==type&&[active[@"size"]unsignedIntValue]>=values.count/width),@"Symmetry binding differs from linked type");BOOL integer=symmetryIntegerType(type);
  for(id value in values){INPUT([value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID(),@"Symmetry binding must be numeric");double n=[value doubleValue];INPUT(isfinite(n)&&isfinite((float)n)&&(!integer||(n>=INT32_MIN&&n<=INT32_MAX&&floor(n)==n)),@"Symmetry binding exceeds scalar range");if(type==GL_SAMPLER_2D)INPUT(n==0,@"Symmetry sampler must use owned state unit 0");if(type==GL_BOOL)INPUT(n==0||n==1,@"Symmetry boolean binding invalid");}byName[name]=item;
 }
 for(NSString *name in _bindingNames){NSDictionary *item=byName[name];INPUT(item&&[item[@"type"]unsignedIntValue]==GL_FLOAT&&[(NSArray*)item[@"values"]count]==1,@"Matched symmetry float must have an explicit value");}return raw;
}
-(void)bind:(NSArray*)bindings{
 for(NSDictionary *item in bindings){@autoreleasepool{NSDictionary *active=_activeUniforms[item[@"name"]];if(!active)continue;GLint location=[active[@"location"]intValue];GLenum type=[item[@"type"]unsignedIntValue];NSArray *values=item[@"values"];NSMutableData *data=[NSMutableData dataWithLength:values.count*4];GLfloat *f=data.mutableBytes;GLint *n=data.mutableBytes;BOOL integer=symmetryIntegerType(type);for(NSUInteger i=0;i<values.count;i++){if(integer)n[i]=[values[i]intValue];else f[i]=[values[i]floatValue];}GLsizei count=(GLsizei)(values.count/symmetryUniformWidth(type));
  switch(type){case GL_FLOAT:glUniform1fv(location,count,f);break;case GL_FLOAT_VEC2:glUniform2fv(location,count,f);break;case GL_FLOAT_VEC3:glUniform3fv(location,count,f);break;case GL_FLOAT_VEC4:glUniform4fv(location,count,f);break;case GL_FLOAT_MAT3:glUniformMatrix3fv(location,count,GL_FALSE,f);break;case GL_FLOAT_MAT4:glUniformMatrix4fv(location,count,GL_FALSE,f);break;case GL_INT_VEC2:glUniform2iv(location,count,n);break;case GL_INT_VEC3:glUniform3iv(location,count,n);break;case GL_INT_VEC4:glUniform4iv(location,count,n);break;default:glUniform1iv(location,count,n);}
 }}[self checkGl];
}
-(void)classify:(GLuint)landed reset:(BOOL)reset observe:(BOOL)observe{
 uint32_t next=1-_metadataCurrent;[self target:_metadata[next]];glUseProgram(_diagnostic);glUniform1i(glGetUniformLocation(_diagnostic,"landed"),0);glUniform1i(glGetUniformLocation(_diagnostic,"counters"),1);glUniform1i(glGetUniformLocation(_diagnostic,"resetCounter"),reset);glUniform1i(glGetUniformLocation(_diagnostic,"observe"),observe);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,landed);glActiveTexture(GL_TEXTURE1);glBindTexture(GL_TEXTURE_2D,_metadata[_metadataCurrent]);glDrawArrays(GL_TRIANGLE_STRIP,0,4);[self checkGl];_metadataCurrent=next;
}
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self ready];uint32_t index=iteratedStateWord(operation,@"index"),steps=iteratedStateWord(operation,@"steps"),reset=iteratedStateWord(operation,@"reset"),resetCounter=iteratedStateWord(operation,@"resetCounter");INPUT(index==_index&&index<UINT32_MAX&&steps<=16&&reset<=1&&resetCounter<=1&&(!reset||resetCounter),@"Symmetry advance checkpoint/controls invalid");uint64_t observed=steps?1:0,observations=resetCounter?observed:_observations+observed;INPUT(observations<=UINT32_MAX,@"Symmetry diagnostic interval exhausted");NSArray *bindings=[self bindings:operation[@"bindings"]];INPUT(retained>=self.retainedBytes,@"Symmetry advance omits state storage");uint64_t bindingBytes=262144;for(NSDictionary *item in bindings)bindingBytes+=symmetryNameBytes(item[@"name"])+[(NSArray*)item[@"values"]count]*32;iteratedStateBudget(retained,packetBytes,bindingBytes);
 [self perform:^{samilaRaster(self->_size,self->_size);glDisable(GL_BLEND);glPixelStorei(GL_UNPACK_SWAP_BYTES,GL_FALSE);glBindSampler(0,0);glBindSampler(1,0);glBindVertexArray(self->_vao);
  if(reset){glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,self->_positions[0]);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,self->_seed);glTexSubImage2D(GL_TEXTURE_2D,0,0,0,self->_size,self->_size,GL_RGBA,GL_FLOAT,NULL);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);[self clearMetadata];self->_current=0;[self checkGl];}
  if(!steps){if(!reset&&resetCounter)[self classify:self->_positions[self->_current] reset:YES observe:NO];return;}
  const GLuint input=self->_positions[self->_current],output=self->_positions[1-self->_current];
  // Submit the original pass exactly once. Custom bodies can read iterations,
  // use derivatives or discard; re-running with a shorter prefix is a different
  // program invocation. Diagnostics count invalid completed pass outputs, not
  // unobserved inner iterations, and never mutate the mathematical program.
  [self target:output];glUseProgram(self->_program);[self bind:bindings];glUniform1i(glGetUniformLocation(self->_program,"stateTex"),0);glUniform1i(glGetUniformLocation(self->_program,"iterations"),steps);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,input);glDrawArrays(GL_TRIANGLE_STRIP,0,4);[self checkGl];[self classify:output reset:resetCounter observe:YES];self->_current=1-self->_current;
 }];_observations=observations;_index++;
}
-(SourceCglIteratedDrawView)drawViewAtIndex:(uint32_t)index retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{[self ready];INPUT(index==_index&&retained>=self.retainedBytes,@"Symmetry draw view checkpoint/accounting mismatch");iteratedStateBudget(retained,packetBytes,0);return(SourceCglIteratedDrawView){_positions[_current],_metadata[_metadataCurrent],_size,_size,_count,_index};}
-(NSData*)read:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self ready];uint32_t index=iteratedStateWord(operation,@"index"),offset=iteratedStateWord(operation,@"offset"),count=iteratedStateWord(operation,@"count");INPUT(index==_index&&count>0&&count<=IteratedStateChunk&&offset<=_count&&count<=_count-offset&&retained>=self.retainedBytes,@"Symmetry read checkpoint/range/accounting mismatch");iteratedStateBudget(retained,packetBytes,(uint64_t)count*48);NSMutableData *out=[NSMutableData dataWithLength:(NSUInteger)count*24];
 [self perform:^{glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glPixelStorei(GL_PACK_ALIGNMENT,1);glPixelStorei(GL_PACK_ROW_LENGTH,0);glPixelStorei(GL_PACK_SKIP_ROWS,0);glPixelStorei(GL_PACK_SKIP_PIXELS,0);glPixelStorei(GL_PACK_SWAP_BYTES,GL_FALSE);uint32_t state[4096*4],metadata[4096*2];
  for(uint32_t at=0;at<count;){uint32_t first=offset+at,x=first%self->_size,y=first/self->_size,n=MIN(4096,MIN(self->_size-x,count-at));[self target:self->_positions[self->_current]];glReadPixels(x,y,n,1,GL_RGBA,GL_FLOAT,state);[self target:self->_metadata[self->_metadataCurrent]];glReadPixels(x,y,n,1,GL_RG_INTEGER,GL_UNSIGNED_INT,metadata);[self checkGl];for(uint32_t i=0;i<n;i++){uint8_t *record=(uint8_t*)out.mutableBytes+(NSUInteger)(at+i)*24;memcpy(record,state+i*4,16);memcpy(record+16,metadata+i*2,8);}at+=n;}
 }];return out;
}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose symmetry state in another context");for(int i=0;i<16;i++){if(glGetError()==GL_NO_ERROR)break;RUNTIME(i<15,@"Cannot establish symmetry deletion boundary");}[self unbind];
 #define SYMMETRY_DROP(handle,call) if(handle){call;RUNTIME(glGetError()==GL_NO_ERROR,@"Symmetry cleanup failed; exact handle retained");handle=0;}
 SYMMETRY_DROP(_framebuffer,glDeleteFramebuffers(1,&_framebuffer));SYMMETRY_DROP(_vao,glDeleteVertexArrays(1,&_vao));SYMMETRY_DROP(_quad,glDeleteBuffers(1,&_quad));SYMMETRY_DROP(_seed,glDeleteBuffers(1,&_seed));
 for(int i=0;i<2;i++){SYMMETRY_DROP(_positions[i],glDeleteTextures(1,&_positions[i]));SYMMETRY_DROP(_metadata[i],glDeleteTextures(1,&_metadata[i]));}SYMMETRY_DROP(_program,glDeleteProgram(_program));SYMMETRY_DROP(_diagnostic,glDeleteProgram(_diagnostic));for(int i=0;i<4;i++){SYMMETRY_DROP(_shaders[i],glDeleteShader(_shaders[i]));}
 #undef SYMMETRY_DROP
 _activeUniforms=nil;_bindingNames=nil;_vertex=nil;_fragment=nil;_disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
#endif
