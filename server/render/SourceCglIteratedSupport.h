#ifndef SOURCE_CGL_ITERATED_SUPPORT_H
#define SOURCE_CGL_ITERATED_SUPPORT_H
// Shared native state admission, compilation and borrowed drawing contract.
// Borrowed sampling handles for this exact checkpoint. A consumer must retain
// the owner, stay in its context, and neither mutate/delete these textures nor
// use the view after advance/dispose. Each concrete owner specifies padding semantics; consumers draw only count.
typedef struct {
 GLuint positions,metadata;
 uint32_t width,height,count,index;
} SourceCglIteratedDrawView;

@protocol SourceCglIteratedSampling <NSObject>
@property(readonly) uint64_t retainedBytes,drawViewAllocationBytes;
@property(readonly) uint32_t count,uploaded,index;
// Metadata R counts invalid observations in this explicit unit; G is final
// validity. A new adapter must preserve the unit rather than relabel counts.
@property(readonly) NSString *diagnosticUnit;
-(uint32_t)drawViewWidth;
-(uint32_t)drawViewHeight;
-(SourceCglIteratedDrawView)drawViewAtIndex:(uint32_t)index retained:(uint64_t)retained packetBytes:(uint64_t)packetBytes;
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
 for(NSString *key in ([operation[@"kind"]unsignedIntValue]==6?@[@"vertex",@"fragment",@"diagnosticVertex",@"diagnosticFragment"]:@[@"vertex",@"fragment"])){
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

#endif
