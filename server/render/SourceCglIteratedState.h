// Retained source calculate_next TF state. Included after Budget, ensure,
// INPUT/RUNTIME and nameValid. The host owns admission/registry identity; this
// owner retains its exact CGL context and all provisional GL handles.
@interface SourceCglIteratedState:NSObject {
 CGLContextObj _context;
 GLuint _program,_shaders[2],_seed,_positions[2],_metadata[2],_vao,_feedback,_framebuffer,_colorBuffer;
 uint32_t _count,_uploaded,_index,_current;
 uint64_t _programBytes;
 BOOL _prepared,_failed,_disposed;
 NSString *_vertex,*_fragment;
 NSDictionary<NSString*,NSNumber*> *_floatLocations;
 GLint _stepsLocation,_resetLocation,_dimensionLocation;
}
@property(readonly) uint64_t retainedBytes;
@property(readonly) uint32_t count,uploaded,index;
-(instancetype)initWithOperation:(NSDictionary*)operation;
-(void)prepare:(NSDictionary*)operation;
// retained includes this owner and every other owner in the shared context.
// packetBytes is the original decoded wire packet length, not a re-encoding.
-(void)upload:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
// Bounded diagnostic only: little-endian {float32[4],uint32 invalid,validity}.
-(NSData*)read:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)dispose;
@end

static const uint32_t IteratedStateChunk=65536,IteratedStateScratch=4096;
static const uint64_t IteratedStateFixedBytes=1024*1024;
static uint32_t iteratedStateWord(NSDictionary *operation,NSString *key){
 id value=operation[key];INPUT([value isKindOfClass:NSNumber.class],([@"Missing iterated word: " stringByAppendingString:key]));
 double number=[value doubleValue];INPUT(isfinite(number)&&number>=0&&number<=UINT32_MAX&&floor(number)==number,([@"Invalid iterated word: " stringByAppendingString:key]));return [value unsignedIntValue];
}
static uint64_t iteratedStateProgramBytes(NSDictionary *operation){
 uint64_t bytes=0;
 for(NSString *key in @[@"vertex",@"fragment"]){
  id source=operation[key];INPUT([source isKindOfClass:NSString.class],@"Iterated shader must be UTF-8 text");
  NSString *text=source;NSUInteger length=[text lengthOfBytesUsingEncoding:NSUTF8StringEncoding];const char *utf8=text.UTF8String;
  INPUT(length>0&&utf8&&memchr(utf8,0,length)==NULL, @"Invalid iterated shader UTF-8/NUL");
  // Accept the same explicit first-line profile as the wire producer. No
  // source/precision/operation rewriting occurs at this boundary.
  INPUT([text hasPrefix:@"#version 410 core\n"],@"Iterated shader requires explicit GL 4.1 core profile");
  ensure(length<=Budget/3&&bytes<=Budget-(uint64_t)length*3,@"capacity",@"Iterated program exceeds memory budget");bytes+=(uint64_t)length*3;
 }
 id declared=operation[@"programBytes"];INPUT([declared isKindOfClass:NSNumber.class]&&[declared doubleValue]==(double)bytes,@"Iterated program storage identity mismatch");return bytes;
}
static void iteratedStateBudget(uint64_t retained,uint64_t packetBytes,uint64_t readBytes){
 ensure(retained<=Budget&&packetBytes<=Budget/6&&readBytes<=Budget&&retained+packetBytes*6+readBytes<=Budget,@"capacity",@"Iterated state, shared owners and transfer copies exceed memory budget");
}
static void iteratedStateCompile(GLuint *shader,GLenum stage,NSString *source){
 *shader=glCreateShader(stage);RUNTIME(*shader!=0,@"Iterated shader allocation failed");
 const char *text=source.UTF8String;GLint length=(GLint)[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding];glShaderSource(*shader,1,&text,&length);glCompileShader(*shader);
 GLint compiled=0;glGetShaderiv(*shader,GL_COMPILE_STATUS,&compiled);if(!compiled){char log[8192]={0};glGetShaderInfoLog(*shader,sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Iterated shader compilation failed");}
}

@implementation SourceCglIteratedState
-(uint64_t)retainedBytes{return _disposed?0:(uint64_t)_count*64+_programBytes+IteratedStateFixedBytes;}
-(uint32_t)count{return _count;}-(uint32_t)uploaded{return _uploaded;}-(uint32_t)index{return _index;}
-(instancetype)initWithOperation:(NSDictionary*)operation{
 self=[super init];if(!self)return nil;
 _count=iteratedStateWord(operation,@"count");INPUT(_count>0&&_count<=8*1000*1000,@"Invalid iterated particle count");_programBytes=iteratedStateProgramBytes(operation);
 ensure(self.retainedBytes<=Budget,@"capacity",@"Iterated retained state exceeds memory budget");
 ensure(CFByteOrderGetCurrent()==CFByteOrderLittleEndian,@"unsupported",@"Iterated CGL upload requires a little-endian host");
 _vertex=[operation[@"vertex"]copy];_fragment=[operation[@"fragment"]copy];
 _context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Iterated state requires a current owned context");_context=CGLRetainContext(_context);RUNTIME(_context!=NULL,@"Cannot retain iterated context");return self;
}
-(void)checkGl{
 GLenum error=glGetError();if(error!=GL_NO_ERROR){_failed=YES;RUNTIME(NO,([NSString stringWithFormat:@"Iterated GL operation failed (%u)",error]));}
}
-(void)check{
 INPUT(_prepared&&!_disposed,@"Iterated state is not prepared");RUNTIME(!_failed,@"Iterated state cannot continue after a failed operation");
 RUNTIME(CGLGetCurrentContext()==_context,@"Iterated state belongs to another context");
}
-(void)ready{[self check];INPUT(_uploaded==_count,@"Iterated initial seed upload is incomplete");}
-(void)unbind{
 RUNTIME(CGLGetCurrentContext()==_context,@"Cannot unbind iterated state in another context");
 GLint bound=0;GLboolean active=GL_FALSE;glGetIntegerv(GL_TRANSFORM_FEEDBACK_BINDING,&bound);glGetBooleanv(GL_TRANSFORM_FEEDBACK_BUFFER_ACTIVE,&active);[self checkGl];
 RUNTIME(!active||(_feedback!=0&&(GLuint)bound==_feedback),@"Another owner has active transform feedback");
 if(active){glEndTransformFeedback();[self checkGl];}
 glDisable(GL_RASTERIZER_DISCARD);
 if(_feedback){glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,_feedback);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,0,0);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,1,0);}
 glBindFramebuffer(GL_FRAMEBUFFER,0);glBindRenderbuffer(GL_RENDERBUFFER,0);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,0);glBindBuffer(GL_TRANSFORM_FEEDBACK_BUFFER,0);glBindBuffer(GL_COPY_READ_BUFFER,0);glBindBuffer(GL_COPY_WRITE_BUFFER,0);glBindBuffer(GL_ARRAY_BUFFER,0);glBindVertexArray(0);glUseProgram(0);[self checkGl];
}
// Preserve the primary error when restoring GL bindings also fails. Handles
// remain owned and the failed state is never silently retried as a new state.
-(void)perform:(void (^)(void))work{
 NSException *failure=nil;
 @try{work();}@catch(NSException *error){_failed=YES;failure=error;}
 @try{[self unbind];}@catch(NSException *cleanup){_failed=YES;if(failure)failure=[NSException exceptionWithName:@"runtime" reason:[NSString stringWithFormat:@"%@ (%@); iterated binding cleanup also failed: %@ (%@)",failure.reason,failure.name,cleanup.reason,cleanup.name] userInfo:@{@"primary":failure,@"cleanup":cleanup}];else failure=cleanup;}
 if(failure)@throw failure;
}
-(void)inspectProgram{
 GLint varyingCount=0,mode=0;glGetProgramiv(_program,GL_TRANSFORM_FEEDBACK_VARYINGS,&varyingCount);glGetProgramiv(_program,GL_TRANSFORM_FEEDBACK_BUFFER_MODE,&mode);
 RUNTIME(varyingCount==2&&mode==GL_SEPARATE_ATTRIBS,@"Iterated TF layout mismatch");
 const char *names[]={"newState","newMetadata"};const GLenum types[]={GL_FLOAT_VEC4,GL_UNSIGNED_INT_VEC2};
 for(GLuint i=0;i<2;i++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetTransformFeedbackVarying(_program,i,sizeof(name),&length,&size,&type,name);RUNTIME(strcmp(name,names[i])==0&&size==1&&type==types[i],@"Iterated TF output type/order mismatch");}
 GLint attributes=0;glGetProgramiv(_program,GL_ACTIVE_ATTRIBUTES,&attributes);
 for(GLint i=0;i<attributes;i++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(_program,i,sizeof(name),&length,&size,&type,name);
  if(strcmp(name,"gl_VertexID")==0&&type==GL_INT&&size==1)continue;
  BOOL position=strcmp(name,"oldState")==0,metadata=strcmp(name,"oldMetadata")==0;
  RUNTIME(size==1&&((position&&type==GL_FLOAT_VEC4&&glGetAttribLocation(_program,name)==0)||(metadata&&type==GL_UNSIGNED_INT_VEC2&&glGetAttribLocation(_program,name)==1)),@"Iterated shader requires an unowned vertex attribute");
 }
 RUNTIME(glGetAttribLocation(_program,"oldState")==0&&glGetAttribLocation(_program,"oldMetadata")==1,@"Iterated shader must consume both owned state attributes");
 GLint uniforms=0,nameCapacity=0;glGetProgramiv(_program,GL_ACTIVE_UNIFORMS,&uniforms);glGetProgramiv(_program,GL_ACTIVE_UNIFORM_MAX_LENGTH,&nameCapacity);[self checkGl];
 RUNTIME(uniforms>=0&&nameCapacity>=0&&(uint64_t)nameCapacity<=_programBytes/3+1,@"Iterated active uniform name capacity mismatch");
 NSMutableData *nameBuffer=[NSMutableData dataWithLength:MAX(1,nameCapacity)];NSMutableDictionary *locations=[NSMutableDictionary new];
 _stepsLocation=_resetLocation=_dimensionLocation=-1;
 for(GLint i=0;i<uniforms;i++){
  GLsizei length=0;GLint size=0;GLenum type=0;char *name=nameBuffer.mutableBytes;glGetActiveUniform(_program,i,nameCapacity,&length,&size,&type,name);
  RUNTIME(length>0&&length<nameCapacity&&size==1,@"Iterated active uniform must be scalar");NSString *key=[[NSString alloc]initWithBytes:name length:(NSUInteger)length encoding:NSUTF8StringEncoding];RUNTIME(key&&nameValid(key),@"Iterated active uniform name is invalid");GLint location=glGetUniformLocation(_program,name);RUNTIME(location>=0,@"Iterated active uniform location is absent");
  if([key isEqual:@"steps"]||[key isEqual:@"resetCounter"]||[key isEqual:@"dimension"]){RUNTIME(type==GL_INT,@"Iterated fixed uniform must be int");if([key isEqual:@"steps"])_stepsLocation=location;else if([key isEqual:@"resetCounter"])_resetLocation=location;else _dimensionLocation=location;}
  else{RUNTIME(type==GL_FLOAT,@"Iterated field uniform must be scalar float");locations[key]=@(location);}
 }
 _floatLocations=[locations copy];[self checkGl];
}
-(void)prepare:(NSDictionary*)operation{
 INPUT(!_prepared&&!_failed&&!_disposed,@"Iterated state cannot be prepared twice");RUNTIME(CGLGetCurrentContext()==_context,@"Iterated preparation context mismatch");
 INPUT(iteratedStateWord(operation,@"count")==_count&&iteratedStateProgramBytes(operation)==_programBytes&&[_vertex isEqual:operation[@"vertex"]]&&[_fragment isEqual:operation[@"fragment"]],@"Iterated preparation differs from its owned creation");
 [self perform:^{
  GLint attributes=0,components=0,separate=0;glGetIntegerv(GL_MAX_VERTEX_ATTRIBS,&attributes);glGetIntegerv(GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS,&components);glGetIntegerv(GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS,&separate);[self checkGl];ensure(attributes>=2&&components>=4&&separate>=2,@"unsupported",@"Native iterated TF capacity unavailable");
  iteratedStateCompile(&self->_shaders[0],GL_VERTEX_SHADER,self->_vertex);iteratedStateCompile(&self->_shaders[1],GL_FRAGMENT_SHADER,self->_fragment);
  self->_program=glCreateProgram();RUNTIME(self->_program!=0,@"Iterated program allocation failed");glAttachShader(self->_program,self->_shaders[0]);glAttachShader(self->_program,self->_shaders[1]);const char *names[]={"newState","newMetadata"};glTransformFeedbackVaryings(self->_program,2,names,GL_SEPARATE_ATTRIBS);glLinkProgram(self->_program);
  GLint linked=0;glGetProgramiv(self->_program,GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(self->_program,sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Iterated program link failed");}
  [self checkGl];[self inspectProgram];
  for(int i=0;i<2;i++){glDetachShader(self->_program,self->_shaders[i]);[self checkGl];glDeleteShader(self->_shaders[i]);[self checkGl];self->_shaders[i]=0;}
  // A windowless CGL context has no complete default framebuffer. Apple's
  // actual TF draw still validates framebuffer completeness with rasterizer
  // discard enabled. This private 1x1 target fits the fixed 1 MiB reserve.
  glGenFramebuffers(1,&self->_framebuffer);glGenRenderbuffers(1,&self->_colorBuffer);[self checkGl];RUNTIME(self->_framebuffer&&self->_colorBuffer,@"Iterated TF target allocation failed");
  glBindFramebuffer(GL_FRAMEBUFFER,self->_framebuffer);glBindRenderbuffer(GL_RENDERBUFFER,self->_colorBuffer);glRenderbufferStorage(GL_RENDERBUFFER,GL_RGBA8,1,1);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_RENDERBUFFER,self->_colorBuffer);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);[self checkGl];RUNTIME(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"Iterated TF target is incomplete");
  glGenVertexArrays(1,&self->_vao);glGenTransformFeedbacks(1,&self->_feedback);glGenBuffers(1,&self->_seed);glGenBuffers(2,self->_positions);glGenBuffers(2,self->_metadata);[self checkGl];
  RUNTIME(self->_vao&&self->_feedback&&self->_seed&&self->_positions[0]&&self->_positions[1]&&self->_metadata[0]&&self->_metadata[1],@"Iterated state allocation failed");
  glBindBuffer(GL_COPY_WRITE_BUFFER,self->_seed);glBufferData(GL_COPY_WRITE_BUFFER,(GLsizeiptr)self->_count*16,NULL,GL_STATIC_COPY);
  for(int i=0;i<2;i++){glBindBuffer(GL_COPY_WRITE_BUFFER,self->_positions[i]);glBufferData(GL_COPY_WRITE_BUFFER,(GLsizeiptr)self->_count*16,NULL,GL_DYNAMIC_COPY);glBindBuffer(GL_COPY_WRITE_BUFFER,self->_metadata[i]);glBufferData(GL_COPY_WRITE_BUFFER,(GLsizeiptr)self->_count*8,NULL,GL_DYNAMIC_COPY);}
  [self checkGl];self->_prepared=YES;
 }];
}
-(void)initializeMetadataAt:(uint32_t)offset count:(uint32_t)count{
 uint32_t words[4096*2];for(uint32_t i=0;i<IteratedStateScratch;i++){words[i*2]=0;words[i*2+1]=1;}
 for(uint32_t first=0;first<count;first+=IteratedStateScratch){uint32_t n=MIN(IteratedStateScratch,count-first);for(int side=0;side<2;side++){glBindBuffer(GL_COPY_WRITE_BUFFER,_metadata[side]);glBufferSubData(GL_COPY_WRITE_BUFFER,(GLintptr)(offset+first)*8,(GLsizeiptr)n*8,words);}[self checkGl];}
}
-(void)upload:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self check];uint32_t index=iteratedStateWord(operation,@"index"),offset=iteratedStateWord(operation,@"offset");id input=operation[@"positions"];INPUT([input isKindOfClass:NSData.class],@"Iterated seed upload requires packed bytes");NSData *positions=input;
 INPUT(index==0&&_index==0&&offset==_uploaded&&_uploaded<_count&&positions.length>0&&positions.length%16==0&&positions.length/16<=IteratedStateChunk&&positions.length/16<=_count-_uploaded,@"Iterated seed upload must be the next bounded contiguous range");
 INPUT(retained>=self.retainedBytes&&packetBytes>=positions.length,@"Iterated upload accounting excludes its owned state or input");iteratedStateBudget(retained,packetBytes,0);uint32_t count=(uint32_t)(positions.length/16);
 [self perform:^{
  const GLuint buffers[]={self->_seed,self->_positions[0],self->_positions[1]};for(int i=0;i<3;i++){glBindBuffer(GL_COPY_WRITE_BUFFER,buffers[i]);glBufferSubData(GL_COPY_WRITE_BUFFER,(GLintptr)offset*16,positions.length,positions.bytes);[self checkGl];}
  [self initializeMetadataAt:offset count:count];
 }];
 _uploaded+=count;
}
-(NSDictionary<NSString*,NSNumber*>*)validatedUniforms:(id)raw{
 INPUT([raw isKindOfClass:NSDictionary.class],@"Iterated float uniform table is invalid");NSDictionary *uniforms=raw;
 for(id key in uniforms){INPUT([key isKindOfClass:NSString.class]&&nameValid(key),@"Iterated uniform name is invalid");INPUT(![key isEqual:@"steps"]&&![key isEqual:@"resetCounter"]&&![key isEqual:@"dimension"],@"Iterated fixed uniforms belong to the state owner");id value=uniforms[key];INPUT([value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID(),@"Iterated field uniform must be numeric float");double number=[value doubleValue];INPUT(isfinite(number)&&isfinite((float)number),@"Iterated field uniform exceeds finite Float32");}
 for(NSString *key in _floatLocations)INPUT(uniforms[key]!=nil,([@"Missing active iterated float uniform: " stringByAppendingString:key]));
 // Inactive fields are legal, as in WebGL's optimized-away uniform locations.
 // Their parsed names/values are still validated; no source text is re-parsed.
 return uniforms;
}
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self ready];uint32_t index=iteratedStateWord(operation,@"index"),reset=iteratedStateWord(operation,@"reset"),dimension=iteratedStateWord(operation,@"dimension"),steps=iteratedStateWord(operation,@"steps");
 INPUT(index==_index&&index<UINT32_MAX,@"Iterated advance checkpoint mismatch");INPUT(reset<=1&&dimension==2&&steps<=256,@"Invalid iterated advance controls");
 NSDictionary *uniforms=[self validatedUniforms:operation[@"uniforms"]];INPUT(retained>=self.retainedBytes,@"Iterated advance accounting excludes its owned state");iteratedStateBudget(retained,packetBytes,0);
 // All controls and active field coverage are validated before reset can touch
 // a retained seed/state buffer. Unknown partial success poisons this owner.
 [self perform:^{
  glUseProgram(self->_program);glUniform1i(self->_stepsLocation,(GLint)steps);glUniform1i(self->_resetLocation,(GLint)reset);glUniform1i(self->_dimensionLocation,(GLint)dimension);for(NSString *key in self->_floatLocations)glUniform1f([self->_floatLocations[key]intValue],[uniforms[key]floatValue]);[self checkGl];
  if(reset){glBindBuffer(GL_COPY_READ_BUFFER,self->_seed);glBindBuffer(GL_COPY_WRITE_BUFFER,self->_positions[0]);glCopyBufferSubData(GL_COPY_READ_BUFFER,GL_COPY_WRITE_BUFFER,0,0,(GLsizeiptr)self->_count*16);[self checkGl];[self initializeMetadataAt:0 count:self->_count];self->_current=0;}
  uint32_t next=1-self->_current;glBindFramebuffer(GL_FRAMEBUFFER,self->_framebuffer);glDrawBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,1,1);glBindVertexArray(self->_vao);glBindBuffer(GL_ARRAY_BUFFER,self->_positions[self->_current]);glEnableVertexAttribArray(0);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,0,NULL);glBindBuffer(GL_ARRAY_BUFFER,self->_metadata[self->_current]);glEnableVertexAttribArray(1);glVertexAttribIPointer(1,2,GL_UNSIGNED_INT,0,NULL);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,self->_feedback);glEnable(GL_RASTERIZER_DISCARD);[self checkGl];
  for(uint32_t first=0;first<self->_count;first+=IteratedStateChunk){uint32_t n=MIN(IteratedStateChunk,self->_count-first);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,self->_positions[next],(GLintptr)first*16,(GLsizeiptr)n*16);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,1,self->_metadata[next],(GLintptr)first*8,(GLsizeiptr)n*8);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,(GLint)first,(GLsizei)n);glEndTransformFeedback();[self checkGl];}
  self->_current=next;
 }];
 _index++;
}
-(NSData*)read:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self ready];uint32_t index=iteratedStateWord(operation,@"index"),offset=iteratedStateWord(operation,@"offset"),count=iteratedStateWord(operation,@"count");
 INPUT(index==_index&&count>0&&count<=IteratedStateChunk&&offset<=_count&&count<=_count-offset,@"Iterated read checkpoint/range mismatch");
 INPUT(retained>=self.retainedBytes,@"Iterated read accounting excludes its owned state");iteratedStateBudget(retained,packetBytes,(uint64_t)count*48);
 NSMutableData *output=[NSMutableData dataWithLength:(NSUInteger)count*24];RUNTIME(output!=nil,@"Iterated readback allocation failed");
 [self perform:^{
  // The 96 KiB scratch fits the fixed 1 MiB reserve; only the bounded 24N
  // result and its reply copy use the separately admitted readCount*48 bytes.
  uint32_t states[4096*4],metadata[4096*2];uint8_t *bytes=output.mutableBytes;
  for(uint32_t first=0;first<count;first+=IteratedStateScratch){uint32_t n=MIN(IteratedStateScratch,count-first);glBindBuffer(GL_COPY_READ_BUFFER,self->_positions[self->_current]);glGetBufferSubData(GL_COPY_READ_BUFFER,(GLintptr)(offset+first)*16,(GLsizeiptr)n*16,states);[self checkGl];glBindBuffer(GL_COPY_READ_BUFFER,self->_metadata[self->_current]);glGetBufferSubData(GL_COPY_READ_BUFFER,(GLintptr)(offset+first)*8,(GLsizeiptr)n*8,metadata);[self checkGl];
   for(uint32_t i=0;i<n;i++){uint8_t *record=bytes+(NSUInteger)(first+i)*24;memcpy(record,states+i*4,16);memcpy(record+16,metadata+i*2,8);}
  }
 }];return output;
}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose iterated state in another context");
 // Prior command errors have already failed their request. Establish a clean
 // deletion boundary without clearing any ownership slot on failed cleanup.
 for(int i=0;i<16;i++){GLenum error=glGetError();if(error==GL_NO_ERROR)break;RUNTIME(i<15,@"Cannot establish clean iterated disposal state");}
 [self unbind];
 #define ITERATED_DROP(handle,operation) if(handle){operation;RUNTIME(glGetError()==GL_NO_ERROR,@"Iterated cleanup failed; owner retained");handle=0;}
 ITERATED_DROP(_framebuffer,glDeleteFramebuffers(1,&_framebuffer));ITERATED_DROP(_colorBuffer,glDeleteRenderbuffers(1,&_colorBuffer));
 ITERATED_DROP(_vao,glDeleteVertexArrays(1,&_vao));ITERATED_DROP(_feedback,glDeleteTransformFeedbacks(1,&_feedback));ITERATED_DROP(_seed,glDeleteBuffers(1,&_seed));
 for(int i=0;i<2;i++){ITERATED_DROP(_positions[i],glDeleteBuffers(1,&_positions[i]));ITERATED_DROP(_metadata[i],glDeleteBuffers(1,&_metadata[i]));}
 ITERATED_DROP(_program,glDeleteProgram(_program));for(int i=0;i<2;i++){ITERATED_DROP(_shaders[i],glDeleteShader(_shaders[i]));}
 #undef ITERATED_DROP
 // Keep count/uploaded/index for the successful release reply.
 _floatLocations=nil;_vertex=nil;_fragment=nil;_disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
