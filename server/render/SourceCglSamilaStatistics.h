// Owned integer statistics reduction. Sample shaders, draw order and packet ABI
// stay unchanged. The protocol's mirrored byte charges are checked against this
// native owner by the real CGL lifecycle test.
enum {SamilaChunk=65532,SamilaStatsSide=256,SamilaStatsReduceSide=64,SamilaStatsSummaryWidth=32,SamilaStatsMaxChunks=(8000000*6+SamilaChunk-1)/SamilaChunk,SamilaStatsSummaryHeight=(SamilaStatsMaxChunks+SamilaStatsSummaryWidth-1)/SamilaStatsSummaryWidth};
static const uint64_t SamilaStatsReadbackBytes=4*sizeof(uint32_t);
static const uint64_t SamilaStatsStorageBytes=(uint64_t)SamilaStatsSide*SamilaStatsSide*32+(uint64_t)SamilaStatsReduceSide*SamilaStatsReduceSide*32+(uint64_t)SamilaStatsSummaryWidth*SamilaStatsSummaryHeight*16; // 2240000 bytes
static NSString *const SamilaStatsVertex=@"void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}";
static NSString *const SamilaStatsFragment=@"uniform usampler2D values;uniform ivec2 sourceSize;uniform int count;uniform bool validateSamples;layout(location=0)out uvec4 result;void main(){ivec2 at=ivec2(gl_FragCoord.xy)*4;uvec4 total=uvec4(0u);for(int y=0;y<4;y++)for(int x=0;x<4;x++){ivec2 p=at+ivec2(x,y);if(any(greaterThanEqual(p,sourceSize))||p.y*sourceSize.x+p.x>=count)continue;uvec4 v=texelFetch(values,p,0);if(validateSamples){bool valid=v.x<=1u&&v.y==0u&&v.z<=1u&&v.w<=1u&&v.x+v.z+v.w==1u;v=valid?uvec4(v.x,0u,v.z,v.w):uvec4(0u,1u,0u,0u);}total+=v;}result=total;}";
static uint64_t samilaStatsProgramBytes(void){return 3*([SamilaStatsVertex lengthOfBytesUsingEncoding:NSUTF8StringEncoding]+[SamilaStatsFragment lengthOfBytesUsingEncoding:NSUTF8StringEncoding]);}
