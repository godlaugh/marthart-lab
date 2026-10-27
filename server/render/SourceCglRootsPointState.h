#ifndef SOURCE_CGL_ROOTS_POINT_STATE_H
#define SOURCE_CGL_ROOTS_POINT_STATE_H
// Persistent color history, short exclusive frame transactions, bounded uploads.
// There is deliberately no numerical state or second point ring in this owner.
@interface SourceCglRootsPointState:NSObject {
 CGLContextObj _context; NSData *_session; uint32_t _target,_width,_height;
 GLuint _programs[2],_shaders[4],_frame,_color,_palette,_vbo,_pointVao,_fadeVao;
 uint64_t _programBytes; GLfloat _pointRange[2];
 uint32_t _display,_phase,_received,_total,_nextChunk,_totalChunks,_pointDraws,_fadeDraws,_clears,_chunkPoints;
 NSArray *_ranges; BOOL _prepared,_disposed,_transaction;
}
@property(readonly) NSData *session;
@property(readonly) uint32_t target,width,height,display,phase,received,total,nextChunk,totalChunks,pointDraws,fadeDraws,clears;
@property(readonly) float pointMinimum,pointMaximum;
@property(readonly) uint64_t retainedBytes;
@property(readonly) BOOL transaction;
-(instancetype)initWithFrame:(NSDictionary*)frame;
-(void)prepare:(NSDictionary*)op;
-(void)begin:(NSDictionary*)frame retained:(uint64_t)retained packetBytes:(uint64_t)packet;
-(void)append:(NSDictionary*)frame retained:(uint64_t)retained packetBytes:(uint64_t)packet;
-(NSData*)finish:(NSDictionary*)frame retained:(uint64_t)retained packetBytes:(uint64_t)packet;
-(void)fail;
-(void)dispose;
@end
static void rootsPointProfile(GLuint program,BOOL point){
 NSDictionary *abi=point?rootsPointUniformKinds():@{@"fillColor":@6};GLint active=0;glGetProgramiv(program,GL_ACTIVE_UNIFORMS,&active);
 for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveUniform(program,i,sizeof(name),&length,&size,&type,name);NSNumber *kind=abi[@(name)];ensure(length>0&&length<1023&&size==1&&kind&&type==uniformType(kind.unsignedIntValue),@"gpu-link",@"Roots point program has an unowned uniform ABI");}
 glGetProgramiv(program,GL_ACTIVE_ATTRIBUTES,&active);for(GLint i=0;i<active;i++){char name[1024]={0};GLsizei length=0;GLint size=0;GLenum type=0;glGetActiveAttrib(program,i,sizeof(name),&length,&size,&type,name);if(strcmp(name,"gl_VertexID")==0&&size==1&&type==GL_INT)continue;BOOL valid=point&&size==1&&((strcmp(name,"rootPosition")==0&&type==GL_FLOAT_VEC3&&glGetAttribLocation(program,name)==0)||(strcmp(name,"pointMetric")==0&&type==GL_FLOAT&&glGetAttribLocation(program,name)==1));ensure(length>0&&length<1023&&valid,@"gpu-link",@"Roots point program has an unowned attribute ABI");}
 if(point)ensure(glGetAttribLocation(program,"rootPosition")==0&&glGetAttribLocation(program,"pointMetric")==1,@"gpu-link",@"Roots point packed attributes must own locations zero and one");
 else ensure(glGetUniformLocation(program,"fillColor")>=0,@"gpu-link",@"Roots point fade requires fillColor");
 ensure(glGetFragDataLocation(program,point?"fragColor":"pixel")==0,@"gpu-link",@"Roots point program must own color attachment zero");
}
@implementation SourceCglRootsPointState
-(NSData*)session{return _session;}-(uint32_t)target{return _target;}-(uint32_t)width{return _width;}-(uint32_t)height{return _height;}-(uint32_t)display{return _display;}-(uint32_t)phase{return _phase;}-(uint32_t)received{return _received;}-(uint32_t)total{return _total;}-(uint32_t)nextChunk{return _nextChunk;}-(uint32_t)totalChunks{return _totalChunks;}-(uint32_t)pointDraws{return _pointDraws;}-(uint32_t)fadeDraws{return _fadeDraws;}-(uint32_t)clears{return _clears;}-(float)pointMinimum{return _pointRange[0];}-(float)pointMaximum{return _pointRange[1];}-(BOOL)transaction{return _transaction;}
-(uint64_t)retainedBytes{return _disposed?0:rootsPointResident(_width,_height,_programBytes);}
-(instancetype)initWithFrame:(NSDictionary*)frame{self=[super init];if(self){NSDictionary *op=frame[@"rootsPoint"];_session=op[@"session"];_target=[op[@"target"]unsignedIntValue];_width=[frame[@"width"]unsignedIntValue];_height=[frame[@"height"]unsignedIntValue];_programBytes=[op[@"programBytes"]unsignedLongLongValue];_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Roots point requires a current owned context");_context=CGLRetainContext(_context);RUNTIME(_context!=NULL,@"Cannot retain Roots point context");}return self;}
-(void)gl:(NSString*)kind reason:(NSString*)reason{ensure(glGetError()==GL_NO_ERROR,kind,reason);}
-(void)unbind{glUseProgram(0);glBindVertexArray(0);glBindBuffer(GL_ARRAY_BUFFER,0);glBindBuffer(GL_PIXEL_PACK_BUFFER,0);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glBindFramebuffer(GL_FRAMEBUFFER,0);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,0);glDisable(GL_PROGRAM_POINT_SIZE);[self gl:@"runtime" reason:@"Roots point binding cleanup failed; owner retained"];}
-(void)perform:(void(^)(void))work{NSException *failure=nil;@try{work();}@catch(NSException *e){_phase=2;failure=e;}@try{[self unbind];}@catch(NSException *e){_phase=2;failure=failure?[NSException exceptionWithName:failure.name reason:[NSString stringWithFormat:@"%@; Roots point cleanup also failed: %@",failure.reason,e.reason] userInfo:@{@"primary":failure,@"cleanup":e}]:e;}if(failure)@throw failure;}
-(void)bind{samilaRaster(_width,_height);glBindSampler(0,0);glBindFramebuffer(GL_FRAMEBUFFER,_frame);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);}
-(void)prepare:(NSDictionary*)op{
 INPUT(!_prepared&&!_disposed&&_phase==0,@"Roots point target already prepared");RUNTIME(CGLGetCurrentContext()==_context,@"Roots point preparation context changed");
 [self perform:^{
  GLint maxTexture=0,viewport[2]={0};GLfloat range[2]={0};glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maxTexture);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,viewport);glGetFloatv(GL_POINT_SIZE_RANGE,range);[self gl:@"gpu-context" reason:@"Roots point device facts unavailable"];
  ensure(maxTexture>0&&viewport[0]>0&&viewport[1]>0&&_width<=(uint32_t)maxTexture&&_height<=(uint32_t)maxTexture&&_width<=(uint32_t)viewport[0]&&_height<=(uint32_t)viewport[1]&&isfinite(range[0])&&isfinite(range[1])&&range[0]>0&&range[1]>=MAX(1,range[0]),@"unsupported",@"Roots point target dimensions or point range unavailable");memcpy(_pointRange,range,sizeof(range));
  NSArray *keys=@[@"pointVertex",@"pointFragment",@"fadeVertex",@"fadeFragment"];
  for(uint32_t i=0;i<2;i++){
   // Reuse the retained full-source compiler; unlike generic v3, this profile
   // supplies its complete header at the producer boundary.
   attractorCompile(&_shaders[i*2],GL_VERTEX_SHADER,op[keys[i*2]]);attractorCompile(&_shaders[i*2+1],GL_FRAGMENT_SHADER,op[keys[i*2+1]]);
   _programs[i]=glCreateProgram();ensure(_programs[i]!=0,@"gpu-allocation",@"Roots point program allocation failed");glAttachShader(_programs[i],_shaders[i*2]);glAttachShader(_programs[i],_shaders[i*2+1]);glLinkProgram(_programs[i]);GLint linked=0;glGetProgramiv(_programs[i],GL_LINK_STATUS,&linked);if(!linked){char log[8192]={0};glGetProgramInfoLog(_programs[i],sizeof(log),NULL,log);ensure(NO,@"gpu-link",[NSString stringWithUTF8String:log]?:@"Roots point program link failed");}rootsPointProfile(_programs[i],i==0);
  }
  samilaRaster(_width,_height);glActiveTexture(GL_TEXTURE0);glGenTextures(1,&_color);ensure(_color!=0,@"gpu-allocation",@"Roots point color allocation failed");glBindTexture(GL_TEXTURE_2D,_color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,_width,_height,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);
  glGenFramebuffers(1,&_frame);ensure(_frame!=0,@"gpu-allocation",@"Roots point framebuffer allocation failed");glBindFramebuffer(GL_FRAMEBUFFER,_frame);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,_color,0);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);ensure(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"gpu-allocation",@"Roots point framebuffer is incomplete");
  glGenTextures(1,&_palette);ensure(_palette!=0,@"gpu-allocation",@"Roots point palette allocation failed");glBindTexture(GL_TEXTURE_2D,_palette);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,256,1,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_BASE_LEVEL,0);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAX_LEVEL,0);
  glGenVertexArrays(1,&_pointVao);glGenVertexArrays(1,&_fadeVao);glGenBuffers(1,&_vbo);ensure(_pointVao&&_fadeVao&&_vbo,@"gpu-allocation",@"Roots point geometry allocation failed");glBindVertexArray(_pointVao);glBindBuffer(GL_ARRAY_BUFFER,_vbo);glBufferData(GL_ARRAY_BUFFER,RootsPointVboBytes,NULL,GL_STREAM_DRAW);glEnableVertexAttribArray(0);glVertexAttribPointer(0,3,GL_FLOAT,GL_FALSE,16,(void*)0);glVertexAttribDivisor(0,0);glEnableVertexAttribArray(1);glVertexAttribPointer(1,1,GL_FLOAT,GL_FALSE,16,(void*)12);glVertexAttribDivisor(1,0);[self gl:@"gpu-allocation" reason:@"Roots point storage allocation failed"];
 }];_prepared=YES;
}
-(void)check:(NSDictionary*)frame phase:(uint32_t)phase{
 INPUT(_prepared&&!_disposed&&_phase==phase,@"Roots point target is unprepared, failed or in another transaction phase");RUNTIME(CGLGetCurrentContext()==_context,@"Roots point context changed");INPUT([frame[@"width"]unsignedIntValue]==_width&&[frame[@"height"]unsignedIntValue]==_height,@"Roots point target dimensions changed");INPUT([frame[@"rootsPoint"][@"display"]unsignedIntValue]==_display,@"Roots point display checkpoint differs");
}
-(void)begin:(NSDictionary*)frame retained:(uint64_t)retained packetBytes:(uint64_t)packet{
 [self check:frame phase:0];NSDictionary *op=frame[@"rootsPoint"];rootsPointBudget(retained,0,packet,RootsPointReplyBytes);rootsPointBudget(retained,0,92,RootsPointReplyBytes+(uint64_t)_width*_height*4);uint32_t chunk=[op[@"chunk"]unsignedIntValue];float pointSize=samilaFloat(op[@"uniforms"],@"pointSize");double diameter=MAX(1.0,MIN((double)pointSize,(double)_pointRange[1])),footprint=MIN((double)_width,ceil(diameter)+2)*MIN((double)_height,ceil(diameter)+2);uint32_t maximum=(uint32_t)MAX(1.0,MIN(65536.0,floor(8000000.0/MAX(1.0,footprint))));ensure(chunk<=maximum,@"capacity",@"Roots point chunk exceeds actual native raster work bound");
 // Append and finish are different phases: each must fit independently before
 // the first clear/fade. The parser owns the maximum actual append byte count.
 uint64_t appendBytes=[op[@"appendBytes"]unsignedLongLongValue];if(appendBytes)rootsPointBudget(retained,0,appendBytes,RootsPointReplyBytes);
 // All admission and metadata checks precede any history mutation.
 _ranges=op[@"ranges"];_chunkPoints=chunk;_total=[op[@"total"]unsignedIntValue];_totalChunks=[op[@"chunks"]unsignedIntValue];_received=_nextChunk=_pointDraws=_fadeDraws=_clears=0;
 [self perform:^{
  glUseProgram(_programs[0]);applyUniforms(_programs[0],op[@"uniforms"]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_palette);glBindBuffer(GL_PIXEL_UNPACK_BUFFER,0);glPixelStorei(GL_UNPACK_ALIGNMENT,1);glPixelStorei(GL_UNPACK_ROW_LENGTH,0);glPixelStorei(GL_UNPACK_SKIP_ROWS,0);glPixelStorei(GL_UNPACK_SKIP_PIXELS,0);glTexSubImage2D(GL_TEXTURE_2D,0,0,0,256,1,GL_RGBA,GL_UNSIGNED_BYTE,[op[@"palette"]bytes]);[self gl:@"gpu-render" reason:@"Roots point frame metadata upload failed"];
  _transaction=YES;_phase=1;[self bind];uint32_t flags=[op[@"flags"]unsignedIntValue];
  if(flags&1){const GLfloat *color=[op[@"clear"]bytes];glDisable(GL_BLEND);glClearColor(color[0],color[1],color[2],color[3]);glClear(GL_COLOR_BUFFER_BIT);[self gl:@"gpu-render" reason:@"Roots point clear failed"];_clears++;}
  if(flags&2){glDisable(GL_PROGRAM_POINT_SIZE);glUseProgram(_programs[1]);NSArray *uniforms=@[@{@"name":@"fillColor",@"kind":@6,@"count":@1,@"bytes":op[@"fade"]}];applyUniforms(_programs[1],uniforms);glBindVertexArray(_fadeVao);glEnable(GL_BLEND);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,GL_ONE,GL_ONE);glDrawArrays(GL_TRIANGLES,0,3);[self gl:@"gpu-render" reason:@"Roots point fade failed"];_fadeDraws++;}
 }];
}
-(void)append:(NSDictionary*)frame retained:(uint64_t)retained packetBytes:(uint64_t)packet{
 [self check:frame phase:1];NSDictionary *op=frame[@"rootsPoint"];rootsPointBudget(retained,0,packet,RootsPointReplyBytes);INPUT([op[@"ordinal"]unsignedIntValue]==_nextChunk&&_nextChunk<_totalChunks,@"Roots point append ordinal differs");uint32_t local=_nextChunk,range=0;for(;range<_ranges.count;range++){uint32_t chunks=([_ranges[range]unsignedIntValue]+_chunkPoints-1)/_chunkPoints;if(local<chunks)break;local-=chunks;}INPUT(range<_ranges.count,@"Roots point range schedule exhausted");uint32_t offset=local*_chunkPoints,n=MIN(_chunkPoints,[_ranges[range]unsignedIntValue]-offset);INPUT([op[@"rangeIndex"]unsignedIntValue]==range&&[op[@"rangeOffset"]unsignedIntValue]==offset&&[op[@"count"]unsignedIntValue]==n,@"Roots point append does not match complete range order");
 [self perform:^{[self bind];glUseProgram(_programs[0]);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_palette);glBindVertexArray(_pointVao);glBindBuffer(GL_ARRAY_BUFFER,_vbo);glBufferSubData(GL_ARRAY_BUFFER,0,[op[@"points"]length],[op[@"points"]bytes]);glEnable(GL_PROGRAM_POINT_SIZE);glEnable(GL_BLEND);glBlendEquationSeparate(GL_FUNC_ADD,GL_FUNC_ADD);glBlendFuncSeparate(GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA,GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA);glDrawArrays(GL_POINTS,0,n);[self gl:@"gpu-render" reason:@"Roots point draw failed"];_pointDraws++;_received+=n;_nextChunk++;}];
}
-(NSData*)finish:(NSDictionary*)frame retained:(uint64_t)retained packetBytes:(uint64_t)packet{
 [self check:frame phase:1];INPUT(_received==_total&&_nextChunk==_totalChunks,@"Roots point frame coverage is incomplete");rootsPointBudget(retained,0,packet,RootsPointReplyBytes+(uint64_t)_width*_height*4);__block NSData *pixels=nil;[self perform:^{[self bind];pixels=readFramePrefix(_frame,0,_width,_height,RootsPointReplyBytes);}];_display++;_phase=0;_transaction=NO;return pixels;
}
-(void)fail{if(!_disposed)_phase=2;}
-(void)dispose{
 if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot release Roots point in another context");[self unbind];
 #define ROOTS_POINT_DROP(handle,operation) if(handle){operation;[self gl:@"runtime" reason:@"Roots point cleanup failed; owner retained"];handle=0;}
 ROOTS_POINT_DROP(_frame,glDeleteFramebuffers(1,&_frame));ROOTS_POINT_DROP(_color,glDeleteTextures(1,&_color));ROOTS_POINT_DROP(_palette,glDeleteTextures(1,&_palette));ROOTS_POINT_DROP(_vbo,glDeleteBuffers(1,&_vbo));ROOTS_POINT_DROP(_pointVao,glDeleteVertexArrays(1,&_pointVao));ROOTS_POINT_DROP(_fadeVao,glDeleteVertexArrays(1,&_fadeVao));for(int i=0;i<2;i++){ROOTS_POINT_DROP(_programs[i],glDeleteProgram(_programs[i]));}for(int i=0;i<4;i++){ROOTS_POINT_DROP(_shaders[i],glDeleteShader(_shaders[i]));}
 #undef ROOTS_POINT_DROP
 _disposed=YES;_transaction=NO;CGLReleaseContext(_context);_context=NULL;_ranges=nil;
}
@end
static uint64_t rootsPointRetained(NSDictionary<NSData*,SourceCglRootsPointState*> *owners){uint64_t n=0;for(SourceCglRootsPointState *owner in owners.allValues)n+=owner.retainedBytes;return n;}
static NSData *rootsPointTransaction(NSDictionary<NSData*,SourceCglRootsPointState*> *owners){for(NSData *key in owners)if(owners[key].transaction)return key;return nil;}
static void rootsPointCreateOwnership(NSDictionary<NSData*,SourceCglRootsPointState*> *owners,NSDictionary *op){ensure(owners[op[@"resource"]]==nil,@"ownership",@"Roots point resource token already owned");for(SourceCglRootsPointState *owner in owners.allValues)ensure(!([owner.session isEqual:op[@"session"]]&&owner.target==[op[@"target"]unsignedIntValue]),@"ownership",@"Roots point session target is already owned");}
static NSData *rootsPointReply(NSDictionary *op,SourceCglRootsPointState *owner,uint32_t disposition,NSData *pixels){
 uint32_t words[24]={7,[op[@"kind"]unsignedIntValue],0,0,0,0,owner?owner.display:0,disposition,owner?owner.width:1,owner?owner.height:1,owner?owner.phase:0,owner?owner.received:0,owner?owner.total:0,owner?owner.nextChunk:0,owner?owner.totalChunks:0,owner?owner.pointDraws:0,owner?owner.fadeDraws:0,owner?owner.clears:0,0,0,owner?1:0,0,0,0};float minimum=owner?owner.pointMinimum:0,maximum=owner?owner.pointMaximum:0;memcpy(&words[18],&minimum,4);memcpy(&words[19],&maximum,4);for(int i=0;i<24;i++)words[i]=CFSwapInt32HostToLittle(words[i]);NSMutableData *out=pixels?(NSMutableData*)pixels:[NSMutableData dataWithLength:RootsPointReplyBytes];memcpy(out.mutableBytes,words,RootsPointReplyBytes);memcpy((uint8_t*)out.mutableBytes+8,[op[@"resource"]bytes],16);return out;
}
#endif
