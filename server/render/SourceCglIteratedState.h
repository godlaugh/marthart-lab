// Retained source calculate_next TF state. Included after Budget, ensure,
// INPUT/RUNTIME and nameValid. The host owns admission/registry identity; this
// owner retains its exact CGL context and all provisional GL handles.
#include "SourceCglIteratedSupport.h"

@interface SourceCglIteratedState:NSObject <SourceCglIteratedStateOwner> {
 CGLContextObj _context;
 GLuint _program,_diagnosticProgram,_shaders[4],_seed,_positions[2],_metadata[2],_vao,_feedback,_framebuffer,_colorBuffer;
 uint32_t _count,_uploaded,_index,_current,_metadataCurrent;
 uint64_t _observationSteps;
 uint64_t _programBytes;
 BOOL _prepared,_failed,_disposed,_sourcePrefix,_seedActive;
 NSString *_vertex,*_fragment,*_diagnosticVertex,*_diagnosticFragment;
 NSDictionary<NSString*,NSNumber*> *_floatLocations;
 GLint _stepsLocation,_resetLocation,_dimensionLocation,_diagnosticResetLocation,_observeLocation;
 GLuint _viewPositions,_viewMetadata;
 uint32_t _viewIndex;
 uint64_t _viewRetainedBytes;
 BOOL _viewValid,_viewBindingsSaved;
 GLint _viewTextureBinding,_viewUnpackBuffer,_viewUnpackAlignment,_viewUnpackRowLength,_viewUnpackSkipRows,_viewUnpackSkipPixels,_viewUnpackSwapBytes;
}
@property(readonly) uint64_t retainedBytes;
// Total allocation needed for the view, whether or not it exists yet.
@property(readonly) uint64_t drawViewAllocationBytes;
@property(readonly) uint32_t count,uploaded,index;
-(instancetype)initWithOperation:(NSDictionary*)operation;
-(void)prepare:(NSDictionary*)operation;
// retained includes this owner and every other owner in the shared context.
// packetBytes is the original decoded wire packet length, not a re-encoding.
-(void)upload:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
// Bounded diagnostic only: little-endian {float32[4],uint32 invalid,validity}.
-(NSData*)read:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
// retained includes the current view, if present, but not a prospective view.
-(SourceCglIteratedDrawView)drawViewAtIndex:(uint32_t)index retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)dispose;
@end

@implementation SourceCglIteratedState
-(uint64_t)retainedBytes{return _disposed?0:(uint64_t)_count*64+_programBytes+IteratedStateFixedBytes+_viewRetainedBytes;}
-(NSString*)executionProfile{return @"transform-feedback";}
-(NSString*)diagnosticUnit{return @"iteration";}
-(uint32_t)drawViewWidth{return MIN(2048,_count);}
-(uint32_t)drawViewHeight{uint32_t width=[self drawViewWidth];return width?(_count+width-1)/width:0;}
-(uint64_t)drawViewAllocationBytes{return (uint64_t)[self drawViewWidth]*[self drawViewHeight]*24;}
-(uint32_t)count{return _count;}-(uint32_t)uploaded{return _uploaded;}-(uint32_t)index{return _index;}
-(instancetype)initWithOperation:(NSDictionary*)operation{
 self=[super init];if(!self)return nil;
 _count=iteratedStateWord(operation,@"count");INPUT(_count>0&&_count<=8*1000*1000,@"Invalid iterated particle count");_programBytes=iteratedStateProgramBytes(operation);
 ensure(self.retainedBytes<=Budget,@"capacity",@"Iterated retained state exceeds memory budget");
 ensure(CFByteOrderGetCurrent()==CFByteOrderLittleEndian,@"unsupported",@"Iterated CGL upload requires a little-endian host");
 _sourcePrefix=[operation[@"kind"]unsignedIntValue]==6;
 _vertex=[operation[@"vertex"]copy];_fragment=[operation[@"fragment"]copy];_diagnosticVertex=[operation[@"diagnosticVertex"]copy];_diagnosticFragment=[operation[@"diagnosticFragment"]copy];
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
-(void)restoreDrawViewBindings{
 if(!_viewBindingsSaved)return;
 glBindTexture(GL_TEXTURE_2D,_viewTextureBinding);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,_viewUnpackBuffer);
 glPixelStorei(GL_UNPACK_ALIGNMENT,_viewUnpackAlignment);glPixelStorei(GL_UNPACK_ROW_LENGTH,_viewUnpackRowLength);glPixelStorei(GL_UNPACK_SKIP_ROWS,_viewUnpackSkipRows);glPixelStorei(GL_UNPACK_SKIP_PIXELS,_viewUnpackSkipPixels);glPixelStorei(GL_UNPACK_SWAP_BYTES,_viewUnpackSwapBytes);
 [self checkGl];_viewBindingsSaved=NO;
}
-(void)unbind{
 RUNTIME(CGLGetCurrentContext()==_context,@"Cannot unbind iterated state in another context");
 [self restoreDrawViewBindings];
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
// Named ABI profiles describe active GL inputs, never shader-text heuristics.
// 0 is the legacy combined program, 1 pure source math, 2 diagnostics.
-(void)inspectProgram:(GLuint)program profile:(int)profile{
 GLint varyingCount=0,mode=0;glGetProgramiv(program,GL_TRANSFORM_FEEDBACK_VARYINGS,&varyingCount);glGetProgramiv(program,GL_TRANSFORM_FEEDBACK_BUFFER_MODE,&mode);
 const GLint expected=profile==0?2:1;RUNTIME(varyingCount==expected&&mode==GL_SEPARATE_ATTRIBS,@"Iterated TF layout mismatch");
 const char *names[]={profile==2?"newMetadata":"newState","newMetadata"};const GLenum types[]={profile==2?GL_UNSIGNED_INT_VEC2:GL_FLOAT_VEC4,GL_UNSIGNED_INT_VEC2};
 for(GLuint i=0;i<(GLuint)expected;i++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetTransformFeedbackVarying(program,i,sizeof(name),&length,&size,&type,name);RUNTIME(strcmp(name,names[i])==0&&size==1&&type==types[i],@"Iterated TF output type/order mismatch");}
 GLint attributes=0;glGetProgramiv(program,GL_ACTIVE_ATTRIBUTES,&attributes);
 for(GLint i=0;i<attributes;i++){char name[128]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(program,i,sizeof(name),&length,&size,&type,name);
  if(strcmp(name,"gl_VertexID")==0&&type==GL_INT&&size==1)continue;
  BOOL position=strcmp(name,"oldState")==0,metadata=profile!=1&&strcmp(name,"oldMetadata")==0;
  RUNTIME(size==1&&((position&&type==GL_FLOAT_VEC4&&glGetAttribLocation(program,name)==0)||(metadata&&type==GL_UNSIGNED_INT_VEC2&&glGetAttribLocation(program,name)==1)),@"Iterated shader requires an unowned vertex attribute");
 }
 // Pure source formulas can optimize their input away (for example x=1,y=2).
 // Active attributes remain exact; legacy and diagnostics must retain both.
 if(profile!=1)RUNTIME(glGetAttribLocation(program,"oldState")==0&&glGetAttribLocation(program,"oldMetadata")==1,@"Iterated shader must consume both owned state attributes");
 GLint uniforms=0,nameCapacity=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&uniforms);glGetProgramiv(program,GL_ACTIVE_UNIFORM_MAX_LENGTH,&nameCapacity);[self checkGl];
 RUNTIME(uniforms>=0&&nameCapacity>=0&&(uint64_t)nameCapacity<=_programBytes/3+1,@"Iterated active uniform name capacity mismatch");
 NSMutableData *nameBuffer=[NSMutableData dataWithLength:MAX(1,nameCapacity)];NSMutableDictionary *locations=[NSMutableDictionary new];
 if(profile==2)_diagnosticResetLocation=_observeLocation=-1;else _stepsLocation=_resetLocation=_dimensionLocation=-1;
 for(GLint i=0;i<uniforms;i++){
  GLsizei length=0;GLint size=0;GLenum type=0;char *name=nameBuffer.mutableBytes;glGetActiveUniform(program,i,nameCapacity,&length,&size,&type,name);
  RUNTIME(length>0&&length<nameCapacity&&size==1,@"Iterated active uniform must be scalar");NSString *key=[[NSString alloc]initWithBytes:name length:(NSUInteger)length encoding:NSUTF8StringEncoding];RUNTIME(key&&nameValid(key),@"Iterated active uniform name is invalid");GLint location=glGetUniformLocation(program,name);RUNTIME(location>=0,@"Iterated active uniform location is absent");
  if(profile==2){RUNTIME(type==GL_INT&&([key isEqual:@"resetCounter"]||[key isEqual:@"observe"]),@"Iterated diagnostic uniform ABI mismatch");if([key isEqual:@"resetCounter"])_diagnosticResetLocation=location;else _observeLocation=location;}
  else if([key isEqual:@"steps"]||[key isEqual:@"dimension"]||(profile==0&&[key isEqual:@"resetCounter"])){RUNTIME(type==GL_INT,@"Iterated fixed uniform must be int");if([key isEqual:@"steps"])_stepsLocation=location;else if([key isEqual:@"resetCounter"])_resetLocation=location;else _dimensionLocation=location;}
  else{RUNTIME(type==GL_FLOAT&&!(profile==1&&([key isEqual:@"resetCounter"]||[key isEqual:@"observe"])),@"Iterated field uniform must be scalar float");locations[key]=@(location);}
 }
 if(profile==2)RUNTIME(_diagnosticResetLocation>=0&&_observeLocation>=0,@"Iterated diagnostic control uniform is missing");else _floatLocations=[locations copy];[self checkGl];
}
-(void)linkProgram:(GLuint*)program shaders:(GLuint*)shaders vertex:(NSString*)vertex fragment:(NSString*)fragment profile:(int)profile{
 iteratedStateCompile(&shaders[0],GL_VERTEX_SHADER,vertex);iteratedStateCompile(&shaders[1],GL_FRAGMENT_SHADER,fragment);
 *program=glCreateProgram();RUNTIME(*program!=0,@"Iterated program allocation failed");glAttachShader(*program,shaders[0]);glAttachShader(*program,shaders[1]);const char *names[]={profile==2?"newMetadata":"newState","newMetadata"};glTransformFeedbackVaryings(*program,profile==0?2:1,names,GL_SEPARATE_ATTRIBS);glLinkProgram(*program);
 GLint linked=0;glGetProgramiv(*program,GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(*program,sizeof(log),NULL,log);RUNTIME(NO,[NSString stringWithUTF8String:log]?:@"Iterated program link failed");}
 [self checkGl];[self inspectProgram:*program profile:profile];
 for(int i=0;i<2;i++){glDetachShader(*program,shaders[i]);[self checkGl];glDeleteShader(shaders[i]);[self checkGl];shaders[i]=0;}
}
-(GLuint)currentPositionBuffer{return _seedActive?_seed:_positions[_current];}
-(void)prepare:(NSDictionary*)operation{
 INPUT(!_prepared&&!_failed&&!_disposed,@"Iterated state cannot be prepared twice");RUNTIME(CGLGetCurrentContext()==_context,@"Iterated preparation context mismatch");
 INPUT(([operation[@"kind"]unsignedIntValue]==6)==_sourcePrefix&&(!_sourcePrefix||([_diagnosticVertex isEqual:operation[@"diagnosticVertex"]]&&[_diagnosticFragment isEqual:operation[@"diagnosticFragment"]])),@"Iterated preparation profile differs from creation");
 INPUT(iteratedStateWord(operation,@"count")==_count&&iteratedStateProgramBytes(operation)==_programBytes&&[_vertex isEqual:operation[@"vertex"]]&&[_fragment isEqual:operation[@"fragment"]],@"Iterated preparation differs from its owned creation");
 [self perform:^{
  GLint attributes=0,components=0,separate=0;glGetIntegerv(GL_MAX_VERTEX_ATTRIBS,&attributes);glGetIntegerv(GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS,&components);glGetIntegerv(GL_MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS,&separate);[self checkGl];ensure(attributes>=2&&components>=4&&separate>=2,@"unsupported",@"Native iterated TF capacity unavailable");
  [self linkProgram:&self->_program shaders:self->_shaders vertex:self->_vertex fragment:self->_fragment profile:self->_sourcePrefix?1:0];
  if(self->_sourcePrefix)[self linkProgram:&self->_diagnosticProgram shaders:self->_shaders+2 vertex:self->_diagnosticVertex fragment:self->_diagnosticFragment profile:2];
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
 for(id key in uniforms){INPUT([key isKindOfClass:NSString.class]&&nameValid(key),@"Iterated uniform name is invalid");INPUT(![key isEqual:@"steps"]&&![key isEqual:@"resetCounter"]&&![key isEqual:@"dimension"]&&(!_sourcePrefix||![key isEqual:@"observe"]),@"Iterated fixed uniforms belong to the state owner");id value=uniforms[key];INPUT([value isKindOfClass:NSNumber.class]&&CFGetTypeID((__bridge CFTypeRef)value)!=CFBooleanGetTypeID(),@"Iterated field uniform must be numeric float");double number=[value doubleValue];INPUT(isfinite(number)&&isfinite((float)number),@"Iterated field uniform exceeds finite Float32");}
 for(NSString *key in _floatLocations)INPUT(uniforms[key]!=nil,([@"Missing active iterated float uniform: " stringByAppendingString:key]));
 // Inactive fields are legal, as in WebGL's optimized-away uniform locations.
 // Their parsed names/values are still validated; no source text is re-parsed.
 return uniforms;
}
// Execute one bounded transform feedback pass. Input/output roles are explicit;
// math reads the frozen advance input while diagnostics read a landed prefix.
-(void)sourcePassFrom:(GLuint)positions metadata:(GLuint)metadata to:(GLuint)output stride:(uint32_t)stride{
 glBindFramebuffer(GL_FRAMEBUFFER,_framebuffer);glDrawBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,1,1);glBindVertexArray(_vao);
 glBindBuffer(GL_ARRAY_BUFFER,positions);glEnableVertexAttribArray(0);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,0,NULL);
 if(metadata){glBindBuffer(GL_ARRAY_BUFFER,metadata);glEnableVertexAttribArray(1);glVertexAttribIPointer(1,2,GL_UNSIGNED_INT,0,NULL);}else glDisableVertexAttribArray(1);
 glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,_feedback);glBindBufferBase(GL_TRANSFORM_FEEDBACK_BUFFER,1,0);glEnable(GL_RASTERIZER_DISCARD);[self checkGl];
 for(uint32_t first=0;first<_count;first+=IteratedStateChunk){uint32_t n=MIN(IteratedStateChunk,_count-first);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,output,(GLintptr)first*stride,(GLsizeiptr)n*stride);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,(GLint)first,(GLsizei)n);glEndTransformFeedback();[self checkGl];}
}
-(void)classifyPositions:(GLuint)positions reset:(BOOL)reset observe:(BOOL)observe{
 const uint32_t next=1-_metadataCurrent;
 glUseProgram(_diagnosticProgram);glUniform1i(_diagnosticResetLocation,reset);glUniform1i(_observeLocation,observe);[self checkGl];
 [self sourcePassFrom:positions metadata:_metadata[_metadataCurrent] to:_metadata[next] stride:8];_metadataCurrent=next;
}
-(void)advanceSourceSteps:(uint32_t)steps reset:(BOOL)reset resetCounter:(BOOL)resetCounter dimension:(uint32_t)dimension uniforms:(NSDictionary*)uniforms{
 [self perform:^{
  if(reset){[self initializeMetadataAt:0 count:self->_count];self->_metadataCurrent=0;}
  if(steps==0){
   // The math program has a positive-step source clamp. A zero-step command
   // must never run it; the seed remains a first-class authoritative buffer.
   if(reset)self->_seedActive=YES;
   else if(resetCounter)[self classifyPositions:[self currentPositionBuffer] reset:YES observe:NO];
   return;
  }
  const GLuint input=reset?self->_seed:[self currentPositionBuffer];const uint32_t next=1-self->_current;
  for(uint32_t prefix=1;prefix<=steps;prefix++){
   glUseProgram(self->_program);glUniform1i(self->_stepsLocation,(GLint)prefix);glUniform1i(self->_dimensionLocation,(GLint)dimension);for(NSString *key in self->_floatLocations)glUniform1f([self->_floatLocations[key]intValue],[uniforms[key]floatValue]);[self checkGl];
   [self sourcePassFrom:input metadata:0 to:self->_positions[next] stride:16];
   [self classifyPositions:self->_positions[next] reset:resetCounter&&prefix==1 observe:YES];
  }
  self->_current=next;self->_seedActive=NO;
 }];
}
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self ready];uint32_t index=iteratedStateWord(operation,@"index"),reset=iteratedStateWord(operation,@"reset"),dimension=iteratedStateWord(operation,@"dimension"),steps=iteratedStateWord(operation,@"steps");
 // Internal callers may start a new invalid-counter interval without restoring
 // particle positions. The v6 wire omits this field and keeps its old default.
 uint32_t resetCounter=operation[@"resetCounter"]?iteratedStateWord(operation,@"resetCounter"):reset;
 INPUT(index==_index&&index<UINT32_MAX,@"Iterated advance checkpoint mismatch");INPUT(reset<=1&&(dimension==2||dimension==3)&&steps<=(_sourcePrefix?16u:256u),@"Invalid iterated advance controls");
 INPUT(resetCounter<=1&&(!reset||resetCounter==1),@"Invalid iterated counter reset policy");
 uint64_t observations=resetCounter?steps:_observationSteps+steps;INPUT(!_sourcePrefix||observations<=UINT32_MAX,@"Iterated diagnostic interval exhausted; reset the counter before advancing");
 NSDictionary *uniforms=[self validatedUniforms:operation[@"uniforms"]];INPUT(retained>=self.retainedBytes,@"Iterated advance accounting excludes its owned state");iteratedStateBudget(retained,packetBytes,0);
 // The existing vec4 TF layout stores XYZ and the final metric for both
 // dimensions. Source shader semantics alone clear Z for 2D; never reseed.
 // All controls and active field coverage are validated before reset can touch
 // a retained seed/state buffer. Unknown partial success poisons this owner.
 if(_sourcePrefix){[self advanceSourceSteps:steps reset:reset resetCounter:resetCounter dimension:dimension uniforms:uniforms];_observationSteps=observations;_index++;return;}
 [self perform:^{
  glUseProgram(self->_program);glUniform1i(self->_stepsLocation,(GLint)steps);glUniform1i(self->_resetLocation,(GLint)resetCounter);glUniform1i(self->_dimensionLocation,(GLint)dimension);for(NSString *key in self->_floatLocations)glUniform1f([self->_floatLocations[key]intValue],[uniforms[key]floatValue]);[self checkGl];
  if(reset)[self initializeMetadataAt:0 count:self->_count];
  // Reset reads the immutable seed directly. TF writes a distinct mutable
  // position/metadata side even for zero steps; no GPU copy or seed mutation.
  // Counter-only resets keep the current trajectory as their position input.
  const uint32_t input=reset?0:self->_current,next=1-input;
  const GLuint inputPositions=reset?self->_seed:self->_positions[input];
  glBindFramebuffer(GL_FRAMEBUFFER,self->_framebuffer);glDrawBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,1,1);glBindVertexArray(self->_vao);glBindBuffer(GL_ARRAY_BUFFER,inputPositions);glEnableVertexAttribArray(0);glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,0,NULL);glBindBuffer(GL_ARRAY_BUFFER,self->_metadata[input]);glEnableVertexAttribArray(1);glVertexAttribIPointer(1,2,GL_UNSIGNED_INT,0,NULL);glBindTransformFeedback(GL_TRANSFORM_FEEDBACK,self->_feedback);glEnable(GL_RASTERIZER_DISCARD);[self checkGl];
  for(uint32_t first=0;first<self->_count;first+=IteratedStateChunk){uint32_t n=MIN(IteratedStateChunk,self->_count-first);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,0,self->_positions[next],(GLintptr)first*16,(GLsizeiptr)n*16);glBindBufferRange(GL_TRANSFORM_FEEDBACK_BUFFER,1,self->_metadata[next],(GLintptr)first*8,(GLsizeiptr)n*8);glBeginTransformFeedback(GL_POINTS);glDrawArrays(GL_POINTS,(GLint)first,(GLsizei)n);glEndTransformFeedback();[self checkGl];}
  self->_current=next;self->_metadataCurrent=next;
 }];
 _index++;
}
-(SourceCglIteratedDrawView)drawViewAtIndex:(uint32_t)index retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self ready];INPUT(index==_index,@"Iterated draw view checkpoint mismatch");INPUT(retained>=self.retainedBytes,@"Iterated view accounting excludes its owned state");
 uint64_t allocation=self.drawViewAllocationBytes,additional=_viewRetainedBytes?0:allocation;
 iteratedStateBudget(retained,packetBytes,additional);
 uint32_t width=[self drawViewWidth],height=[self drawViewHeight];
 if(!_viewValid||_viewIndex!=index){
  [self perform:^{
   GLint maximum=0;glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maximum);[self checkGl];ensure(maximum>0&&width<=(uint32_t)maximum&&height<=(uint32_t)maximum,@"unsupported",@"Iterated draw view exceeds native texture size");
   // Reserve before any allocation: partial failure retains both ownership and
   // the admitted storage until dispose succeeds. Compute-only stays 64N.
   self->_viewRetainedBytes=allocation;
   glGetIntegerv(GL_TEXTURE_BINDING_2D,&self->_viewTextureBinding);glGetIntegerv(GL_PIXEL_UNPACK_BUFFER_BINDING,&self->_viewUnpackBuffer);glGetIntegerv(GL_UNPACK_ALIGNMENT,&self->_viewUnpackAlignment);glGetIntegerv(GL_UNPACK_ROW_LENGTH,&self->_viewUnpackRowLength);glGetIntegerv(GL_UNPACK_SKIP_ROWS,&self->_viewUnpackSkipRows);glGetIntegerv(GL_UNPACK_SKIP_PIXELS,&self->_viewUnpackSkipPixels);glGetIntegerv(GL_UNPACK_SWAP_BYTES,&self->_viewUnpackSwapBytes);[self checkGl];self->_viewBindingsSaved=YES;
   glPixelStorei(GL_UNPACK_ALIGNMENT,1);glPixelStorei(GL_UNPACK_ROW_LENGTH,0);glPixelStorei(GL_UNPACK_SKIP_ROWS,0);glPixelStorei(GL_UNPACK_SKIP_PIXELS,0);glPixelStorei(GL_UNPACK_SWAP_BYTES,GL_FALSE);
   GLuint *textures[]={&self->_viewPositions,&self->_viewMetadata};const GLuint buffers[]={[self currentPositionBuffer],self->_metadata[self->_metadataCurrent]};const GLint formats[]={GL_RGBA32F,GL_RG32UI};const GLenum channels[]={GL_RGBA,GL_RG_INTEGER},types[]={GL_FLOAT,GL_UNSIGNED_INT};const uint32_t strides[]={16,8};
   for(int side=0;side<2;side++){
    if(!*textures[side]){glGenTextures(1,textures[side]);[self checkGl];RUNTIME(*textures[side]!=0,@"Iterated draw view texture allocation failed");glBindTexture(GL_TEXTURE_2D,*textures[side]);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glTexImage2D(GL_TEXTURE_2D,0,formats[side],(GLsizei)width,(GLsizei)height,0,channels[side],types[side],NULL);[self checkGl];}
    else glBindTexture(GL_TEXTURE_2D,*textures[side]);
    glBindBuffer(GL_PIXEL_UNPACK_BUFFER,buffers[side]);
    uint32_t rows=self->_count/width,rowsPerChunk=MAX(1,IteratedStateChunk/width);
    for(uint32_t row=0;row<rows;row+=rowsPerChunk){uint32_t n=MIN(rowsPerChunk,rows-row);uintptr_t offset=(uintptr_t)row*width*strides[side];glTexSubImage2D(GL_TEXTURE_2D,0,0,(GLint)row,(GLsizei)width,(GLsizei)n,channels[side],types[side],(const void*)offset);[self checkGl];}
    uint32_t tail=self->_count%width;
    if(tail){uintptr_t offset=(uintptr_t)rows*width*strides[side];glTexSubImage2D(GL_TEXTURE_2D,0,0,(GLint)rows,(GLsizei)tail,1,channels[side],types[side],(const void*)offset);[self checkGl];}
   }
  }];
  // Only a fully uploaded view with successful binding restoration is valid.
  _viewIndex=index;_viewValid=YES;
 }
 return (SourceCglIteratedDrawView){_viewPositions,_viewMetadata,width,height,_count,_viewIndex};
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
  for(uint32_t first=0;first<count;first+=IteratedStateScratch){uint32_t n=MIN(IteratedStateScratch,count-first);glBindBuffer(GL_COPY_READ_BUFFER,[self currentPositionBuffer]);glGetBufferSubData(GL_COPY_READ_BUFFER,(GLintptr)(offset+first)*16,(GLsizeiptr)n*16,states);[self checkGl];glBindBuffer(GL_COPY_READ_BUFFER,self->_metadata[self->_metadataCurrent]);glGetBufferSubData(GL_COPY_READ_BUFFER,(GLintptr)(offset+first)*8,(GLsizeiptr)n*8,metadata);[self checkGl];
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
 ITERATED_DROP(_viewPositions,glDeleteTextures(1,&_viewPositions));ITERATED_DROP(_viewMetadata,glDeleteTextures(1,&_viewMetadata));
 ITERATED_DROP(_framebuffer,glDeleteFramebuffers(1,&_framebuffer));ITERATED_DROP(_colorBuffer,glDeleteRenderbuffers(1,&_colorBuffer));
 ITERATED_DROP(_vao,glDeleteVertexArrays(1,&_vao));ITERATED_DROP(_feedback,glDeleteTransformFeedbacks(1,&_feedback));ITERATED_DROP(_seed,glDeleteBuffers(1,&_seed));
 for(int i=0;i<2;i++){ITERATED_DROP(_positions[i],glDeleteBuffers(1,&_positions[i]));ITERATED_DROP(_metadata[i],glDeleteBuffers(1,&_metadata[i]));}
 ITERATED_DROP(_program,glDeleteProgram(_program));ITERATED_DROP(_diagnosticProgram,glDeleteProgram(_diagnosticProgram));for(int i=0;i<4;i++){ITERATED_DROP(_shaders[i],glDeleteShader(_shaders[i]));}
 #undef ITERATED_DROP
 // Keep count/uploaded/index for the successful release reply.
 _floatLocations=nil;_vertex=nil;_fragment=nil;_diagnosticVertex=nil;_diagnosticFragment=nil;_viewValid=NO;_disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
