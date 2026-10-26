#ifndef SOURCE_CGL_ATTRACTOR_STATE_H
#define SOURCE_CGL_ATTRACTOR_STATE_H
@interface SourceCglAttractorState:NSObject {
 CGLContextObj _context;
 GLuint _programs[3],_shaders[6],_state[2],_stateFrames[2],_buffers[2],_pointVao,_quadVao;
 GLuint _targets[2],_targetFrames[2],_pendingTargets[2],_pendingFrames[2];
 uint32_t _count,_side,_operations,_uploaded,_index,_renderIndex,_renderedPassIndex,_current;
 uint32_t _width,_height,_accumWidth,_accumHeight;
 // ACK dimensions describe the last successful render; failed provisional
 // allocation remains charged separately until release.
 uint32_t _ackWidth,_ackHeight,_ackAccumWidth,_ackAccumHeight;
 uint64_t _programBytes,_pendingBytes,_work;
 BOOL _prepared,_failed,_disposed;
}
@property(readonly) uint64_t retainedBytes;
@property(readonly) uint32_t count,side,uploaded,index,renderIndex,renderedPassIndex,width,height,accumWidth,accumHeight;
-(instancetype)initWithOperation:(NSDictionary*)operation;
-(void)prepare:(NSDictionary*)operation;
-(void)upload:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)advance:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(NSData*)render:(NSDictionary*)operation width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(NSData*)read:(NSDictionary*)operation retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
-(void)dispose;
@end

static void attractorCompile(GLuint *shader,GLenum kind,NSString *source){
 *shader=glCreateShader(kind);ensure(*shader!=0,@"gpu-allocation",@"Attractor shader allocation failed");const char *text=source.UTF8String;GLint length=(GLint)[source lengthOfBytesUsingEncoding:NSUTF8StringEncoding];glShaderSource(*shader,1,&text,&length);glCompileShader(*shader);GLint compiled=0;glGetShaderiv(*shader,GL_COMPILE_STATUS,&compiled);if(!compiled){char log[8192]={0};glGetShaderInfoLog(*shader,sizeof(log),NULL,log);ensure(NO,@"gpu-compile",[NSString stringWithUTF8String:log]?:@"Attractor shader compilation failed");}
}
static void attractorProfile(GLuint program,uint32_t profile){
 NSArray *names=profile==0?@[@"posTex",@"steps",@"isWarmup",@"warmupBase",@"currentStepBase",@"staggerMin",@"staggerRange"]:profile==1?@[@"posTex",@"radius",@"scale",@"offset",@"projection",@"modelview"]:@[@"accumTex",@"backgroundRgb",@"exposure",@"contrast",@"gamma",@"saturation",@"densityScale"];
 NSArray *types=profile==0?@[@(GL_SAMPLER_2D),@(GL_INT),@(GL_BOOL),@(GL_INT),@(GL_INT),@(GL_INT),@(GL_INT)]:profile==1?@[@(GL_SAMPLER_2D),@(GL_FLOAT),@(GL_FLOAT_VEC3),@(GL_FLOAT_VEC3),@(GL_FLOAT_MAT4),@(GL_FLOAT_MAT4)]:@[@(GL_SAMPLER_2D),@(GL_FLOAT_VEC3),@(GL_FLOAT),@(GL_FLOAT),@(GL_FLOAT),@(GL_FLOAT),@(GL_FLOAT)];
 GLint active=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(program,i,sizeof(name),&length,&size,&type,name);NSUInteger at=[names indexOfObject:@(name)];ensure(length>0&&length<1023&&size==1&&at!=NSNotFound&&type==[types[at]unsignedIntValue],@"gpu-link",@"Attractor active uniform is outside the prepared ABI");}
 glGetProgramiv(program,GL_ACTIVE_ATTRIBUTES,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(program,i,sizeof(name),&length,&size,&type,name);if(strcmp(name,"gl_VertexID")==0&&size==1&&type==GL_INT)continue;BOOL valid=profile==1&&size==1&&((strcmp(name,"texIndex")==0&&type==GL_FLOAT_VEC2)||(strcmp(name,"color")==0&&type==GL_FLOAT_VEC4));ensure(valid,@"gpu-link",@"Attractor active attribute is not owned");}
 ensure(glGetFragDataLocation(program,profile==0?"newPos":"fragColor")==0,@"gpu-link",@"Attractor fragment output must own attachment zero");
}

@implementation SourceCglAttractorState
-(uint32_t)count{return _count;}-(uint32_t)side{return _side;}-(uint32_t)uploaded{return _uploaded;}-(uint32_t)index{return _index;}-(uint32_t)renderIndex{return _renderIndex;}-(uint32_t)renderedPassIndex{return _renderedPassIndex;}-(uint32_t)width{return _ackWidth;}-(uint32_t)height{return _ackHeight;}-(uint32_t)accumWidth{return _ackAccumWidth;}-(uint32_t)accumHeight{return _ackAccumHeight;}
-(uint64_t)retainedBytes{return _disposed?0:(uint64_t)_side*_side*32+(uint64_t)_count*24+_programBytes+AttractorFixedBytes+(uint64_t)_accumWidth*_accumHeight*16+(uint64_t)_width*_height*4+_pendingBytes;}
-(instancetype)initWithOperation:(NSDictionary*)op{self=[super init];if(self){_count=[op[@"count"]unsignedIntValue];_side=[op[@"side"]unsignedIntValue];_operations=[op[@"operations"]unsignedIntValue];_programBytes=[op[@"programBytes"]unsignedLongLongValue];_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Attractor requires the owned current context");_context=CGLRetainContext(_context);RUNTIME(_context!=NULL,@"Cannot retain Attractor context");}return self;}
-(void)gl:(NSString*)stage reason:(NSString*)reason{ensure(glGetError()==GL_NO_ERROR,stage,reason);}
-(void)unbind{glDisable(GL_PROGRAM_POINT_SIZE);glDisable(GL_SCISSOR_TEST);glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glBindFramebuffer(GL_FRAMEBUFFER,0);glBindVertexArray(0);glBindBuffer(GL_ARRAY_BUFFER,0);glUseProgram(0);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,0);[self gl:@"runtime" reason:@"Attractor binding cleanup failed; owner retained"];}
-(void)perform:(void(^)(void))work{
 NSException *failure=nil;@try{work();}@catch(NSException *error){_failed=YES;failure=error;}
 @try{[self unbind];}@catch(NSException *cleanup){_failed=YES;if(failure)failure=[NSException exceptionWithName:failure.name reason:[NSString stringWithFormat:@"%@; Attractor binding cleanup also failed: %@",failure.reason,cleanup.reason] userInfo:@{@"primary":failure,@"cleanup":cleanup}];else failure=cleanup;}
 if(failure)@throw failure;
}
-(void)check:(NSDictionary*)op complete:(BOOL)complete{
 INPUT(_prepared&&!_disposed,@"Attractor resource is not prepared");RUNTIME(!_failed&&CGLGetCurrentContext()==_context,@"Attractor resource is poisoned or its context changed; release required");
 INPUT([op[@"index"]unsignedIntValue]==_index&&[op[@"renderIndex"]unsignedIntValue]==_renderIndex&&[op[@"uploaded"]unsignedIntValue]==_uploaded&&[op[@"count"]unsignedIntValue]==_count&&[op[@"side"]unsignedIntValue]==_side,@"Attractor checkpoint or resource dimensions differ");
 if(complete)INPUT(_uploaded==(uint64_t)_side*_side,@"Attractor full-square seed upload is incomplete");
}
-(void)texture:(GLuint*)texture width:(uint32_t)width height:(uint32_t)height floating:(BOOL)floating linear:(BOOL)linear{
 glGenTextures(1,texture);ensure(*texture!=0,@"gpu-allocation",@"Attractor texture allocation failed");glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,*texture);glTexImage2D(GL_TEXTURE_2D,0,floating?GL_RGBA32F:GL_RGBA8,(GLsizei)width,(GLsizei)height,0,GL_RGBA,floating?GL_FLOAT:GL_UNSIGNED_BYTE,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,linear?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,linear?GL_LINEAR:GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);[self gl:@"gpu-allocation" reason:@"Attractor texture storage failed"];
}
-(void)framebuffer:(GLuint*)frame texture:(GLuint)texture{
 glGenFramebuffers(1,frame);ensure(*frame!=0,@"gpu-allocation",@"Attractor framebuffer allocation failed");glBindFramebuffer(GL_FRAMEBUFFER,*frame);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,texture,0);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);ensure(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"gpu-allocation",@"Attractor framebuffer incomplete");[self gl:@"gpu-allocation" reason:@"Attractor framebuffer storage failed"];
}
-(void)prepare:(NSDictionary*)op{
 INPUT(!_prepared&&!_failed&&!_disposed,@"Attractor resource already prepared");RUNTIME(CGLGetCurrentContext()==_context,@"Attractor preparation context mismatch");
 GLint maximum=0,viewport[2]={0};glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maximum);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,viewport);ensure(_side<=(uint32_t)maximum&&_side<=(uint32_t)viewport[0]&&_side<=(uint32_t)viewport[1],@"unsupported",@"Attractor state texture dimensions unavailable");
 [self perform:^{
  NSArray *keys=@[@"updateVertex",@"updateFragment",@"accumulateVertex",@"accumulateFragment",@"presentVertex",@"presentFragment"];
  for(uint32_t i=0;i<3;i++){
   attractorCompile(&_shaders[i*2],GL_VERTEX_SHADER,op[keys[i*2]]);attractorCompile(&_shaders[i*2+1],GL_FRAGMENT_SHADER,op[keys[i*2+1]]);_programs[i]=glCreateProgram();ensure(_programs[i]!=0,@"gpu-allocation",@"Attractor program allocation failed");glAttachShader(_programs[i],_shaders[i*2]);glAttachShader(_programs[i],_shaders[i*2+1]);glLinkProgram(_programs[i]);GLint linked=0;glGetProgramiv(_programs[i],GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(_programs[i],sizeof(log),NULL,log);ensure(NO,@"gpu-link",[NSString stringWithUTF8String:log]?:@"Attractor program link failed");}attractorProfile(_programs[i],i);
   for(uint32_t j=i*2;j<i*2+2;j++){glDetachShader(_programs[i],_shaders[j]);glDeleteShader(_shaders[j]);[self gl:@"runtime" reason:@"Attractor linked shader cleanup failed; owner retained"];_shaders[j]=0;}
  }
  samilaRaster(_side,_side);glDisable(GL_BLEND);const float zero[4]={0,0,0,0};for(int i=0;i<2;i++){[self texture:&_state[i] width:_side height:_side floating:YES linear:NO];[self framebuffer:&_stateFrames[i] texture:_state[i]];glClearBufferfv(GL_COLOR,0,zero);}[self gl:@"gpu-allocation" reason:@"Attractor state initialization failed"];
  glGenVertexArrays(1,&_quadVao);glGenVertexArrays(1,&_pointVao);ensure(_quadVao&&_pointVao,@"gpu-allocation",@"Attractor VAO allocation failed");glBindVertexArray(_pointVao);
  const char *names[]={"texIndex","color"};const uint32_t widths[]={2,4};for(int i=0;i<2;i++){glGenBuffers(1,&_buffers[i]);ensure(_buffers[i]!=0,@"gpu-allocation",@"Attractor geometry buffer allocation failed");glBindBuffer(GL_ARRAY_BUFFER,_buffers[i]);glBufferData(GL_ARRAY_BUFFER,(GLsizeiptr)((uint64_t)_count*widths[i]*4),NULL,GL_STATIC_DRAW);GLint location=glGetAttribLocation(_programs[1],names[i]);if(location>=0){glEnableVertexAttribArray((GLuint)location);glVertexAttribPointer((GLuint)location,(GLint)widths[i],GL_FLOAT,GL_FALSE,0,NULL);}}
  [self gl:@"gpu-allocation" reason:@"Attractor geometry storage failed"];
 }];_prepared=YES;
}
-(void)upload:(NSDictionary*)op retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self check:op complete:NO];INPUT(_index==0&&_renderIndex==0&&[op[@"offset"]unsignedIntValue]==_uploaded,@"Attractor upload phase or cursor mismatch");uint32_t number=[op[@"uploadCount"]unsignedIntValue];INPUT(number>0&&(uint64_t)_uploaded+number<=(uint64_t)_side*_side,@"Attractor upload exceeds square");attractorBudget(retained,0,packetBytes,AttractorReplyBytes);
 [self perform:^{
  samilaRaster(_side,_side);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_state[0]);const uint8_t *values=[op[@"positions"]bytes];uint32_t done=0;
  while(done<number){uint32_t at=_uploaded+done,x=at%_side,y=at/_side,w=MIN(number-done,_side-x),h=1;if(x==0&&number-done>=_side){h=(number-done)/_side;w=_side;}glTexSubImage2D(GL_TEXTURE_2D,0,(GLint)x,(GLint)y,(GLsizei)w,(GLsizei)h,GL_RGBA,GL_FLOAT,values+(NSUInteger)done*16);done+=w*h;}
  for(uint32_t i=0;i<2;i++){NSData *data=op[i?@"colors":@"texIndex"];if(data.length){glBindBuffer(GL_ARRAY_BUFFER,_buffers[i]);glBufferSubData(GL_ARRAY_BUFFER,(GLintptr)((uint64_t)_uploaded*(i?16:8)),(GLsizeiptr)data.length,data.bytes);}}
  [self gl:@"gpu-allocation" reason:@"Attractor seed or attribute upload failed"];
 }];_uploaded+=number;
}
-(void)advance:(NSDictionary*)op retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self check:op complete:YES];ensure(_index<10000,@"capacity",@"Attractor pass checkpoint exhausted");attractorBudget(retained,0,packetBytes,AttractorReplyBytes);
 int32_t steps=[op[@"steps"]intValue];uint64_t perStep=(uint64_t)_side*_side*((uint64_t)_operations*4+40),positive=steps>0?(uint32_t)steps:0;
 ensure(!positive||perStep<=1000000000ULL/positive,@"capacity",@"Attractor per-pass shader work exceeds capacity");uint64_t work=perStep*positive;ensure(_work<=64000000000ULL&&work<=64000000000ULL-_work,@"capacity",@"Attractor lifetime shader work exceeds capacity");uint32_t next=1-_current;
 [self perform:^{
  samilaRaster(_side,_side);glDisable(GL_BLEND);glDisable(GL_PROGRAM_POINT_SIZE);glUseProgram(_programs[0]);glBindVertexArray(_quadVao);glBindFramebuffer(GL_FRAMEBUFFER,_stateFrames[next]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_state[_current]);glUniform1i(glGetUniformLocation(_programs[0],"posTex"),0);
  for(NSString *name in @[@"steps",@"warmupBase",@"currentStepBase",@"staggerMin",@"staggerRange"])glUniform1i(glGetUniformLocation(_programs[0],name.UTF8String),[op[name]intValue]);glUniform1i(glGetUniformLocation(_programs[0],"isWarmup"),[op[@"warmup"]intValue]);glDrawArrays(GL_TRIANGLE_STRIP,0,4);[self gl:@"gpu-render" reason:@"Attractor update draw failed"];
 }];_current=next;_index++;_work+=work;
}
-(void)dropTargets:(GLuint*)targets frames:(GLuint*)frames{
 for(int i=0;i<2;i++){if(frames[i]){glDeleteFramebuffers(1,&frames[i]);[self gl:@"runtime" reason:@"Attractor framebuffer cleanup failed; owner retained"];frames[i]=0;}if(targets[i]){glDeleteTextures(1,&targets[i]);[self gl:@"runtime" reason:@"Attractor target cleanup failed; owner retained"];targets[i]=0;}}
}
-(void)resizeWidth:(uint32_t)width height:(uint32_t)height accumWidth:(uint32_t)aw accumHeight:(uint32_t)ah{
 _pendingBytes=(uint64_t)aw*ah*16+(uint64_t)width*height*4;[self texture:&_pendingTargets[0] width:aw height:ah floating:YES linear:YES];[self texture:&_pendingTargets[1] width:width height:height floating:NO linear:NO];for(int i=0;i<2;i++)[self framebuffer:&_pendingFrames[i] texture:_pendingTargets[i]];
 glBindFramebuffer(GL_FRAMEBUFFER,0);[self dropTargets:_targets frames:_targetFrames];memcpy(_targets,_pendingTargets,sizeof(_targets));memcpy(_targetFrames,_pendingFrames,sizeof(_targetFrames));memset(_pendingTargets,0,sizeof(_pendingTargets));memset(_pendingFrames,0,sizeof(_pendingFrames));_pendingBytes=0;_width=width;_height=height;_accumWidth=aw;_accumHeight=ah;
}
// Sentinel verification distinguishes an unwritten buffer from legal NaN/-0
// output. A repeated raw read compares bits, never numeric values.
-(void)readPixelsX:(uint32_t)x y:(uint32_t)y width:(uint32_t)width height:(uint32_t)height floating:(BOOL)floating into:(uint8_t*)output again:(uint8_t*)again{
 NSUInteger bytes=(NSUInteger)width*height*(floating?16:4);uint32_t marker=0x7fc0f00d,other=0xffc0e00e;if(floating){for(NSUInteger i=0;i<bytes;i+=4)memcpy(output+i,&marker,4);}else memset(output,0xa5,bytes);
 glReadPixels((GLint)x,(GLint)y,(GLsizei)width,(GLsizei)height,GL_RGBA,floating?GL_FLOAT:GL_UNSIGNED_BYTE,output);[self gl:@"gpu-readback" reason:@"Attractor readback failed"];BOOL verify=NO;
 if(floating){for(NSUInteger i=0;i<bytes;i+=4){uint32_t word;memcpy(&word,output+i,4);if(word==marker){verify=YES;break;}}}else for(NSUInteger i=0;i<bytes;i++)if(output[i]==0xa5){verify=YES;break;}
 if(verify){if(floating){for(NSUInteger i=0;i<bytes;i+=4)memcpy(again+i,&other,4);}else memset(again,0x5a,bytes);glReadPixels((GLint)x,(GLint)y,(GLsizei)width,(GLsizei)height,GL_RGBA,floating?GL_FLOAT:GL_UNSIGNED_BYTE,again);[self gl:@"gpu-readback" reason:@"Attractor repeated readback failed"];ensure(memcmp(output,again,bytes)==0,@"gpu-readback",@"Attractor incomplete readback");}
}
-(NSData*)render:(NSDictionary*)op width:(uint32_t)width height:(uint32_t)height retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self check:op complete:YES];INPUT(_renderIndex<UINT32_MAX,@"Attractor render checkpoint exhausted");uint32_t aw=[op[@"accumWidth"]unsignedIntValue],ah=[op[@"accumHeight"]unsignedIntValue];BOOL resize=width!=_width||height!=_height||aw!=_accumWidth||ah!=_accumHeight;uint64_t pixels=(uint64_t)width*height,response=AttractorReplyBytes+pixels*4,growth=resize?(uint64_t)aw*ah*16+pixels*4:0;attractorBudget(retained,growth,packetBytes,response);
 GLint maximum=0,viewport[2]={0};GLfloat range[2]={0};glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maximum);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,viewport);glGetFloatv(GL_POINT_SIZE_RANGE,range);float radius=[op[@"radius"]floatValue];ensure(MAX(width,aw)<=(uint32_t)maximum&&MAX(height,ah)<=(uint32_t)maximum&&MAX(width,aw)<=(uint32_t)viewport[0]&&MAX(height,ah)<=(uint32_t)viewport[1],@"unsupported",@"Attractor drawing target exceeds native texture/viewport capability");ensure(isfinite(range[1])&&range[1]>=1&&fmaxf(radius,1)<=range[1],@"unsupported",@"Attractor point size exceeds native capability; no clamp is applied");
 NSMutableData *output=[NSMutableData dataWithLength:(NSUInteger)response];ensure(output!=nil,@"capacity",@"Attractor output allocation failed");uint8_t *again=malloc((size_t)pixels*4);ensure(again!=NULL,@"capacity",@"Attractor verification buffer allocation failed");
 @try{[self perform:^{
  samilaRaster(width,height);if(resize)[self resizeWidth:width height:height accumWidth:aw accumHeight:ah];glBindFramebuffer(GL_FRAMEBUFFER,_targetFrames[0]);glViewport(0,0,(GLsizei)aw,(GLsizei)ah);glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);glEnable(GL_BLEND);glBlendEquation(GL_FUNC_ADD);glBlendFunc(GL_ONE,GL_ONE);glEnable(GL_PROGRAM_POINT_SIZE);glUseProgram(_programs[1]);glBindVertexArray(_pointVao);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_state[_current]);glUniform1i(glGetUniformLocation(_programs[1],"posTex"),0);glUniform1f(glGetUniformLocation(_programs[1],"radius"),radius);
  for(NSString *name in @[@"scale",@"offset"])glUniform3fv(glGetUniformLocation(_programs[1],name.UTF8String),1,[op[name]bytes]);for(NSString *name in @[@"projection",@"modelview"])glUniformMatrix4fv(glGetUniformLocation(_programs[1],name.UTF8String),1,GL_FALSE,[op[name]bytes]);glDrawArrays(GL_POINTS,0,(GLsizei)_count);[self gl:@"gpu-render" reason:@"Attractor accumulation draw failed"];
  glDisable(GL_BLEND);glDisable(GL_PROGRAM_POINT_SIZE);glBindFramebuffer(GL_FRAMEBUFFER,_targetFrames[1]);glViewport(0,0,(GLsizei)width,(GLsizei)height);glUseProgram(_programs[2]);glBindVertexArray(_quadVao);glBindTexture(GL_TEXTURE_2D,_targets[0]);glUniform1i(glGetUniformLocation(_programs[2],"accumTex"),0);glUniform3fv(glGetUniformLocation(_programs[2],"backgroundRgb"),1,[op[@"backgroundRgb"]bytes]);for(NSString *name in @[@"exposure",@"contrast",@"gamma",@"saturation",@"densityScale"])glUniform1f(glGetUniformLocation(_programs[2],name.UTF8String),[op[name]floatValue]);glDrawArrays(GL_TRIANGLE_STRIP,0,4);[self gl:@"gpu-render" reason:@"Attractor presentation draw failed"];glReadBuffer(GL_COLOR_ATTACHMENT0);[self readPixelsX:0 y:0 width:width height:height floating:NO into:(uint8_t*)output.mutableBytes+AttractorReplyBytes again:again];
 }];}@finally{free(again);}_renderIndex++;_renderedPassIndex=_index;_ackWidth=_width;_ackHeight=_height;_ackAccumWidth=_accumWidth;_ackAccumHeight=_accumHeight;return output;
}
-(NSData*)read:(NSDictionary*)op retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes{
 [self check:op complete:YES];uint32_t target=[op[@"target"]unsignedIntValue],offset=[op[@"offset"]unsignedIntValue],number=[op[@"readCount"]unsignedIntValue];if(target==2)INPUT(_renderIndex>0&&_renderedPassIndex==_index,@"Attractor accumulation is absent or belongs to an older pass");uint32_t width=target==1?_side:_accumWidth,height=target==1?_side:_accumHeight;uint64_t texels=(uint64_t)width*height;INPUT(offset<=texels&&number<=texels-offset,@"Attractor diagnostic read exceeds target");uint64_t response=AttractorReplyBytes+(uint64_t)number*16;attractorBudget(retained,0,packetBytes,response);
 NSMutableData *output=[NSMutableData dataWithLength:(NSUInteger)response];ensure(output!=nil,@"capacity",@"Attractor diagnostic output allocation failed");uint8_t *again=malloc((size_t)number*16);ensure(again!=NULL,@"capacity",@"Attractor diagnostic verification buffer allocation failed");
 @try{[self perform:^{samilaRaster(width,height);glBindFramebuffer(GL_FRAMEBUFFER,target==1?_stateFrames[_current]:_targetFrames[0]);glReadBuffer(GL_COLOR_ATTACHMENT0);uint32_t done=0;while(done<number){uint32_t at=offset+done,x=at%width,y=at/width,w=MIN(number-done,width-x),h=1;if(x==0&&number-done>=width){h=(number-done)/width;w=width;}[self readPixelsX:x y:y width:w height:h floating:YES into:(uint8_t*)output.mutableBytes+AttractorReplyBytes+(NSUInteger)done*16 again:again];done+=w*h;}}];}@finally{free(again);}return output;
}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot dispose Attractor in another context");for(int i=0;i<16;i++){if(glGetError()==GL_NO_ERROR)break;RUNTIME(i<15,@"Cannot establish clean Attractor disposal state");}[self unbind];[self dropTargets:_pendingTargets frames:_pendingFrames];[self dropTargets:_targets frames:_targetFrames];[self dropTargets:_state frames:_stateFrames];
 #define ATTRACTOR_DROP(handle,operation) if(handle){operation;[self gl:@"runtime" reason:@"Attractor cleanup failed; owner retained"];handle=0;}
 for(int i=0;i<2;i++){ATTRACTOR_DROP(_buffers[i],glDeleteBuffers(1,&_buffers[i]));}for(int i=0;i<6;i++){ATTRACTOR_DROP(_shaders[i],glDeleteShader(_shaders[i]));}for(int i=0;i<3;i++){ATTRACTOR_DROP(_programs[i],glDeleteProgram(_programs[i]));}ATTRACTOR_DROP(_pointVao,glDeleteVertexArrays(1,&_pointVao));ATTRACTOR_DROP(_quadVao,glDeleteVertexArrays(1,&_quadVao));
 #undef ATTRACTOR_DROP
 _disposed=YES;CGLReleaseContext(_context);_context=NULL;
}
@end
// Duplicate identity is an ownership failure even when the registry is full.
// The caller must never interpret it as uncertain creation and release it.
static void attractorCreateOwnership(NSDictionary *owners,NSData *resource){
 ensure(owners[resource]==nil,@"ownership",@"Attractor resource token already belongs to an owner");
 ensure(owners.count<2,@"capacity",@"Two Attractor resources are already owned");
}
static uint64_t attractorRetained(NSDictionary<NSData*,SourceCglAttractorState*> *owners){uint64_t bytes=0;for(SourceCglAttractorState *owner in owners.allValues)bytes+=owner.retainedBytes;return bytes;}
static NSData *attractorReply(NSDictionary *op,SourceCglAttractorState *owner,uint32_t disposition,NSData *pixels){
 uint32_t kind=[op[@"kind"]unsignedIntValue],words[24]={6,kind,0,0,0,0,owner?owner.index:0,owner?owner.renderIndex:0,owner?owner.uploaded:0,owner?owner.count:0,owner?owner.side:0,disposition,owner?owner.width:0,owner?owner.height:0,owner?owner.accumWidth:0,owner?owner.accumHeight:0,owner?owner.renderedPassIndex:0,kind==5?[op[@"target"]unsignedIntValue]:0,kind==5?[op[@"offset"]unsignedIntValue]:0,kind==5?[op[@"readCount"]unsignedIntValue]:0,0,0,0,0};for(int i=0;i<24;i++)words[i]=CFSwapInt32HostToLittle(words[i]);NSMutableData *result=pixels?(NSMutableData*)pixels:[NSMutableData dataWithLength:AttractorReplyBytes];memcpy(result.mutableBytes,words,AttractorReplyBytes);memcpy((uint8_t*)result.mutableBytes+8,[op[@"resource"]bytes],16);return result;
}
#endif
