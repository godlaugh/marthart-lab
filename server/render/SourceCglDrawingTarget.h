#ifndef SOURCE_CGL_DRAWING_TARGET_H
#define SOURCE_CGL_DRAWING_TARGET_H
/** A private complete frame target. No cross-frame ink/history is retained. */
@interface SourceCglDrawingTarget:NSObject {
 GLuint _fb,_resolved,_color,_multiColor,_depth; CGLContextObj _context;
 GLsizei _width,_height,_samples; BOOL _completion,_prepared,_finished,_disposed;
 NSArray *_clear;
}
-(instancetype)initWithFrame:(NSDictionary*)frame;
-(void)prepare:(uint64_t)retained;
-(void)bind;
-(NSData*)read;
-(NSData*)finish;
-(NSData*)finishWithPrefix:(NSUInteger)prefix;
-(void)dispose;
@end
@implementation SourceCglDrawingTarget
-(instancetype)initWithFrame:(NSDictionary*)frame{self=[super init];if(self){_context=CGLGetCurrentContext();RUNTIME(_context!=NULL,@"Frame target requires context");_width=[frame[@"width"]intValue];_height=[frame[@"height"]intValue];_samples=[frame[@"samples"]intValue];_completion=[frame[@"completion"]boolValue];_clear=frame[@"clear"];}return self;}
-(void)bind{
 RUNTIME(!_disposed&&CGLGetCurrentContext()==_context,@"Frame target context unavailable");glBindFramebuffer(GL_FRAMEBUFFER,_fb);glDrawBuffer(GL_COLOR_ATTACHMENT0);glReadBuffer(GL_COLOR_ATTACHMENT0);glViewport(0,0,_width,_height);
 if(_samples)glEnable(GL_MULTISAMPLE);else glDisable(GL_MULTISAMPLE);
 glDisable(GL_SAMPLE_ALPHA_TO_COVERAGE);glDisable(GL_SAMPLE_ALPHA_TO_ONE);glDisable(GL_SAMPLE_COVERAGE);glDisable(GL_SAMPLE_MASK);glDisable(GL_SCISSOR_TEST);glDisable(GL_DITHER);glDisable(GL_FRAMEBUFFER_SRGB);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);
}
-(void)prepare:(uint64_t)retained{
 INPUT(!_prepared&&!_disposed,@"Frame target already prepared");GLint maxTexture=0,maxRender=0,maxViewport[2]={0},maxSamples=0;
 glGetIntegerv(GL_MAX_TEXTURE_SIZE,&maxTexture);glGetIntegerv(GL_MAX_RENDERBUFFER_SIZE,&maxRender);glGetIntegerv(GL_MAX_VIEWPORT_DIMS,maxViewport);glGetIntegerv(GL_MAX_SAMPLES,&maxSamples);
 ensure(_width<=MIN(maxTexture,maxRender)&&_height<=MIN(maxTexture,maxRender)&&_width<=maxViewport[0]&&_height<=maxViewport[1],@"unsupported",@"Frame exceeds native dimensions");ensure(_samples<=maxSamples,@"unsupported",@"Requested sample count exceeds native limit");
 ensure(retained+(uint64_t)_width*_height*(12+(uint64_t)8*_samples)<=Budget,@"capacity",@"Retained state and frame targets exceed budget");
 glGenFramebuffers(1,&_fb);glBindFramebuffer(GL_FRAMEBUFFER,_fb);glGenTextures(1,&_color);glActiveTexture(GL_TEXTURE0);glBindTexture(GL_TEXTURE_2D,_color);glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,_width,_height,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,_color,0);
 if(_samples){_resolved=_fb;glGenFramebuffers(1,&_fb);glBindFramebuffer(GL_FRAMEBUFFER,_fb);glGenRenderbuffers(1,&_multiColor);glBindRenderbuffer(GL_RENDERBUFFER,_multiColor);glRenderbufferStorageMultisample(GL_RENDERBUFFER,_samples,GL_RGBA8,_width,_height);glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_RENDERBUFFER,_multiColor);GLint actual=0;glGetRenderbufferParameteriv(GL_RENDERBUFFER,GL_RENDERBUFFER_SAMPLES,&actual);ensure(glGetError()==GL_NO_ERROR,@"gpu-allocation",@"Multisample color allocation failed");ensure(actual==_samples,@"unsupported",@"Driver rounded the requested color sample count");}
 glGenRenderbuffers(1,&_depth);glBindRenderbuffer(GL_RENDERBUFFER,_depth);if(_samples)glRenderbufferStorageMultisample(GL_RENDERBUFFER,_samples,GL_DEPTH_COMPONENT24,_width,_height);else glRenderbufferStorage(GL_RENDERBUFFER,GL_DEPTH_COMPONENT24,_width,_height);
 GLint actualDepth=0;glGetRenderbufferParameteriv(GL_RENDERBUFFER,GL_RENDERBUFFER_SAMPLES,&actualDepth);ensure(glGetError()==GL_NO_ERROR,@"gpu-allocation",@"Depth allocation failed");ensure(actualDepth==_samples,@"unsupported",@"Driver rounded the requested depth sample count");glFramebufferRenderbuffer(GL_FRAMEBUFFER,GL_DEPTH_ATTACHMENT,GL_RENDERBUFFER,_depth);ensure(glCheckFramebufferStatus(GL_FRAMEBUFFER)==GL_FRAMEBUFFER_COMPLETE,@"gpu-allocation",@"Incomplete framebuffer");
 [self bind];glDepthMask(GL_TRUE);glClearColor([_clear[0]floatValue],[_clear[1]floatValue],[_clear[2]floatValue],[_clear[3]floatValue]);glClearDepth(1);glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);ensure(glGetError()==GL_NO_ERROR,@"gpu-allocation",@"Frame clear failed");_prepared=YES;
}
-(NSData*)read{INPUT(_prepared&&!_disposed,@"Frame target not prepared");return readFrame(_fb,_resolved,_width,_height);}
-(NSData*)finish{return[self finishWithPrefix:0];}
-(NSData*)finishWithPrefix:(NSUInteger)prefix{INPUT(_prepared&&!_finished&&!_disposed,@"Frame target already finished");[self bind];if(_completion){glColorMask(GL_FALSE,GL_FALSE,GL_FALSE,GL_TRUE);glClearColor(0,0,0,1);glClear(GL_COLOR_BUFFER_BIT);glColorMask(GL_TRUE,GL_TRUE,GL_TRUE,GL_TRUE);}NSData *pixels=readFramePrefix(_fb,_resolved,_width,_height,prefix);_finished=YES;return pixels;}
-(void)dispose{if(_disposed)return;RUNTIME(CGLGetCurrentContext()==_context,@"Cannot release another context's frame target");glBindFramebuffer(GL_FRAMEBUFFER,0);glBindRenderbuffer(GL_RENDERBUFFER,0);if(_fb)glDeleteFramebuffers(1,&_fb);if(_resolved)glDeleteFramebuffers(1,&_resolved);if(_color)glDeleteTextures(1,&_color);if(_multiColor)glDeleteRenderbuffers(1,&_multiColor);if(_depth)glDeleteRenderbuffers(1,&_depth);RUNTIME(glGetError()==GL_NO_ERROR,@"Frame target cleanup failed");_fb=_resolved=_color=_multiColor=_depth=0;_disposed=YES;}
@end
#endif
