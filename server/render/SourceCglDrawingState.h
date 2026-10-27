#ifndef SOURCE_CGL_DRAWING_STATE_H
#define SOURCE_CGL_DRAWING_STATE_H
@interface SourceCglDrawingState:NSObject {
 NSDictionary *_frame,*_metadata; NSArray *_schedule; NSMutableDictionary *_cache;
 SourceCglDrawingTarget *_target; CGLContextObj _context;
 uint32_t _index,_chunks,_maximum,_metadataLimit,_command; BOOL _failed,_finished,_disposed;
}
@property(readonly) uint32_t index,chunks,width,height;
@property(readonly) BOOL finished;
@property(readonly) uint64_t retainedBytes;
-(instancetype)initWithFrame:(NSDictionary*)frame;
-(void)prepare;
-(void)append:(NSDictionary*)frame;
-(NSData*)finish:(NSDictionary*)frame;
-(void)fail;
-(void)dispose;
@end
static NSDictionary *drawingMetadata(NSDictionary *d,NSArray *textures){NSMutableArray *layout=[NSMutableArray new];for(NSDictionary *a in d[@"attributes"])[layout addObject:@{@"name":a[@"name"],@"size":a[@"size"],@"divisor":a[@"divisor"]}];return @{@"vertex":d[@"vertex"],@"fragment":d[@"fragment"],@"flags":d[@"flags"],@"uniforms":d[@"uniforms"],@"textures":textures,@"layout":layout,@"indexType":d[@"indexType"]};}
static uint64_t drawingMetadataBytes(NSDictionary *d){uint64_t n=256+([d[@"vertex"]length]+[d[@"fragment"]length])*3;for(NSDictionary *t in d[@"textures"])n+=[t[@"pixels"]length]+128;for(NSDictionary *u in d[@"uniforms"])n+=[u[@"name"]length]*3+[u[@"bytes"]length]+96;for(NSDictionary *a in d[@"layout"])n+=[a[@"name"]length]*3+96;return n;}
@implementation SourceCglDrawingState
-(uint32_t)index{return _index;}-(uint32_t)chunks{return _chunks;}-(uint32_t)width{return[_frame[@"width"]unsignedIntValue];}-(uint32_t)height{return[_frame[@"height"]unsignedIntValue];}-(BOOL)finished{return _finished;}
-(uint64_t)retainedBytes{return _disposed?0:(uint64_t)self.width*self.height*(12+(uint64_t)8*[_frame[@"samples"]unsignedIntValue])+(uint64_t)_metadataLimit*3+_schedule.count*512;}
-(instancetype)initWithFrame:(NSDictionary*)frame{self=[super init];if(self){_context=CGLGetCurrentContext();NSDictionary *op=frame[@"drawing"];_frame=@{@"width":frame[@"width"],@"height":frame[@"height"],@"samples":frame[@"samples"],@"clear":frame[@"clear"],@"completion":frame[@"completion"],@"viewport":frame[@"viewport"],@"drawingEnvelope":frame[@"drawingEnvelope"]};_schedule=op[@"schedule"];_chunks=[op[@"chunks"]unsignedIntValue];_maximum=[op[@"maximum"]unsignedIntValue];_metadataLimit=[op[@"metadata"]unsignedIntValue];_command=UINT32_MAX;_cache=[NSMutableDictionary new];_target=[[SourceCglDrawingTarget alloc]initWithFrame:frame];}return self;}
-(void)prepare{ensure(self.retainedBytes+(uint64_t)8*((uint64_t)_maximum+[_frame[@"drawingEnvelope"]unsignedIntValue])<=Budget,@"capacity",@"Drawing target, metadata and maximum chunk exceed capacity");[_target prepare:(uint64_t)_metadataLimit*3+_schedule.count*512];}
-(void)check:(NSDictionary*)frame{INPUT(!_failed&&!_finished&&!_disposed,@"Drawing transaction is failed or finished");RUNTIME(CGLGetCurrentContext()==_context,@"Drawing transaction context changed");for(NSString *key in @[@"width",@"height",@"samples",@"clear",@"completion",@"viewport",@"drawingEnvelope"])INPUT([_frame[key]isEqual:frame[key]],@"Drawing frame target identity changed");}
-(void)clearCache{
 RUNTIME(CGLGetCurrentContext()==_context,@"Drawing program context changed");NSData *ids=_cache[@"textures"];if(ids.length)glDeleteTextures((GLsizei)(ids.length/sizeof(GLuint)),ids.bytes);GLuint p=[_cache[@"program"]unsignedIntValue],vs=[_cache[@"vs"]unsignedIntValue],fs=[_cache[@"fs"]unsignedIntValue];if(p)glDeleteProgram(p);if(vs)glDeleteShader(vs);if(fs)glDeleteShader(fs);RUNTIME(glGetError()==GL_NO_ERROR,@"Drawing command cleanup failed");[_cache removeAllObjects];_metadata=nil;
}
-(void)append:(NSDictionary*)frame{
 [self check:frame];NSDictionary *op=frame[@"drawing"];INPUT([op[@"index"]unsignedIntValue]==_index&&_index<_chunks&&[op[@"packetBytes"]unsignedIntValue]<=_maximum,@"Unexpected drawing chunk ordinal or size");
 uint32_t local=_index;NSDictionary *s=nil;for(NSDictionary *candidate in _schedule){uint32_t n=[candidate[@"perPass"]unsignedIntValue]*(uint32_t)[candidate[@"passes"]count];if(local<n){s=candidate;break;}local-=n;}INPUT(s!=nil,@"Drawing schedule exhausted");
 uint32_t command=[s[@"command"]unsignedIntValue],per=[s[@"perPass"]unsignedIntValue],pass=local/per,offset=(local%per)*[s[@"size"]unsignedIntValue],total=[s[@"total"]unsignedIntValue],n=MIN([s[@"size"]unsignedIntValue],total-offset),range=[s[@"range"]unsignedIntValue];
 INPUT([op[@"command"]unsignedIntValue]==command&&[op[@"pass"]unsignedIntValue]==pass&&[op[@"range"]unsignedIntValue]==range&&[op[@"offset"]unsignedIntValue]==offset&&[op[@"count"]unsignedIntValue]==n&&[op[@"total"]unsignedIntValue]==total,@"Drawing chunk does not match admitted pass/range");
 NSDictionary *d=op[@"drawing"][@"draws"][0];NSArray *textures=op[@"drawing"][@"textures"];INPUT([d[@"passes"][0]isEqual:s[@"passes"][pass]]&&([d[@"flags"]unsignedIntValue]&8)==0,@"Drawing face or primitive changed");
 if(range==1)INPUT([d[@"instances"]unsignedIntValue]==n,@"Drawing instance range differs");
 if(range==2)INPUT([d[@"first"]unsignedIntValue]==0&&[d[@"count"]unsignedIntValue]==n&&[d[@"instances"]unsignedIntValue]==1&&! [d[@"indexType"]unsignedIntValue],@"Drawing vertex range differs");
 NSDictionary *metadata=drawingMetadata(d,textures);ensure(drawingMetadataBytes(metadata)<=_metadataLimit,@"capacity",@"Drawing metadata exceeds admitted storage");ensure(self.retainedBytes+(uint64_t)8*((uint64_t)[op[@"packetBytes"]unsignedIntValue]+[_frame[@"drawingEnvelope"]unsignedIntValue])<=Budget,@"capacity",@"Drawing chunk exceeds retained budget");
 if(command!=_command){[self clearCache];_metadata=metadata;_command=command;}else INPUT([_metadata isEqual:metadata],@"Immutable drawing metadata changed between chunks");
 [_target bind];drawCached(d,textures,_cache);_index++;
}
-(NSData*)finish:(NSDictionary*)frame{[self check:frame];INPUT([frame[@"drawing"][@"index"]unsignedIntValue]==_index&&_index==_chunks,@"Drawing frame is incomplete");NSData *pixels=[_target finishWithPrefix:64];_finished=YES;return pixels;}
-(void)fail{_failed=YES;}
-(void)dispose{if(_disposed)return;[self clearCache];[_target dispose];_disposed=YES;}
@end
static NSData *drawingReply(NSDictionary *op,SourceCglDrawingState *owner,uint32_t disposition,uint32_t width,uint32_t height,NSData *pixels){
 NSMutableData *out=pixels?(NSMutableData*)pixels:[NSMutableData dataWithLength:64];uint32_t words[16]={5,[op[@"kind"]unsignedIntValue],0,0,0,0,owner?owner.index:0,disposition,width,height,owner?owner.chunks:0,owner&&owner.finished?1:0,0,0,0,0};for(int i=0;i<16;i++)words[i]=CFSwapInt32HostToLittle(words[i]);memcpy(out.mutableBytes,words,64);memcpy((uint8_t*)out.mutableBytes+8,[op[@"resource"]bytes],16);return out;
}
#endif
