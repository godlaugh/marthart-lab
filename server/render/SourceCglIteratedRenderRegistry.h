// Composition of exact ink/state identities in the shared context. A binding
// remains registered until its ink owner confirms successful disposal.
static uint64_t iteratedInkRetained(NSDictionary<NSData*,NSDictionary*> *inks){uint64_t bytes=0;for(NSDictionary *record in inks.allValues)bytes+=[record[@"owner"]retainedBytes];return bytes;}
static NSUInteger iteratedInkDependents(NSDictionary<NSData*,NSDictionary*> *inks,NSData *stateResource){NSUInteger n=0;for(NSDictionary *record in inks.allValues)if([record[@"stateResource"]isEqual:stateResource])n++;return n;}
static NSData *iteratedRenderReply(NSDictionary *operation,NSDictionary *record,uint32_t disposition,NSData *pixels){
 SourceCglIteratedInk *owner=record[@"owner"];uint32_t kind=[operation[@"kind"]unsignedIntValue],words[32]={0};words[0]=3;words[1]=kind;words[12]=disposition;
 if(owner){words[10]=owner.lastIndex;words[11]=owner.displays;words[13]=owner.count;words[14]=owner.width;words[15]=owner.height;
  NSDictionary *facts=owner.lastFacts;if(kind==2){uint64_t invalid=[facts[@"invalid"]unsignedLongLongValue];words[16]=(uint32_t)invalid;words[17]=(uint32_t)(invalid>>32);words[18]=[facts[@"accepted"]unsignedIntValue];words[19]=[facts[@"clipped"]unsignedIntValue];words[20]=[facts[@"sampleInvalid"]unsignedIntValue];}
  if(kind==3){words[21]=[facts[@"occupiedPixels"]unsignedIntValue];float maximum=[facts[@"maxCount"]floatValue];memcpy(&words[22],&maximum,4);}
 }
 for(int i=0;i<32;i++)words[i]=CFSwapInt32HostToLittle(words[i]);memcpy((uint8_t*)words+8,[operation[@"resource"]bytes],16);if(owner)memcpy((uint8_t*)words+24,[record[@"stateResource"]bytes],16);
 NSMutableData *result=[NSMutableData dataWithBytes:words length:128];if(pixels)[result appendData:pixels];return result;
}
static NSData *renderIteratedOperation(NSDictionary *frame,NSMutableDictionary<NSData*,NSDictionary*> *inks,NSDictionary<NSData*,id<SourceCglIteratedStateOwner>> *states,uint64_t retained){
 NSDictionary *op=frame[@"iteratedRender"];uint32_t kind=[op[@"kind"]unsignedIntValue],width=[frame[@"width"]unsignedIntValue],height=[frame[@"height"]unsignedIntValue];uint64_t packet=[frame[@"packetBytes"]unsignedLongLongValue];NSData *resource=op[@"resource"];NSDictionary *record=inks[resource];SourceCglIteratedInk *owner=record[@"owner"];
 if(kind==4){uint32_t disposition=owner?1:2;[owner dispose];NSData *reply=iteratedRenderReply(op,record,disposition,nil);[inks removeObjectForKey:resource];return reply;}
 NSData *stateResource=op[@"stateResource"];uint32_t index=[op[@"index"]unsignedIntValue],particles=[op[@"count"]unsignedIntValue],displays=[op[@"displays"]unsignedIntValue];
 if(kind==1){ensure(!owner&&inks.count<4&&iteratedInkDependents(inks,stateResource)<2,@"capacity",@"Iterated ink token or resource capacity is already owned");id<SourceCglIteratedStateOwner> state=states[stateResource];ensure(state!=nil,@"state-lost",@"Iterated compute owner is absent");INPUT([state.diagnosticUnit isEqual:@"iteration"],@"This ink protocol requires iteration diagnostics");INPUT(index==state.index&&particles==state.count&&displays==0,@"Iterated ink creation differs from compute checkpoint/count");
  owner=[[SourceCglIteratedInk alloc]initWithState:state programs:op[@"programs"] width:width height:height];record=@{@"owner":owner,@"stateResource":stateResource};inks[resource]=record;
  @try{iteratedStateBudget(retained+owner.retainedBytes,packet,128);[owner prepareWithRetained:retained+packet*6+128];}
  @catch(NSException *e){[owner dispose];[inks removeObjectForKey:resource];@throw;}
  return iteratedRenderReply(op,record,0,nil);
 }
 ensure(owner!=nil,@"state-lost",@"Iterated ink owner is absent after release or context loss");
 INPUT([record[@"stateResource"]isEqual:stateResource]&&particles==owner.count&&width==owner.width&&height==owner.height&&displays==owner.displays,@"Iterated ink identity/dimensions/display checkpoint differ");
 if(kind==5){INPUT(index==owner.lastIndex,@"Iterated program replacement differs from last drawn checkpoint");iteratedStateBudget(retained+[op[@"programBytes"]unsignedLongLongValue],packet,128);[owner replacePrograms:op[@"programs"] retained:retained+packet*6+128];return iteratedRenderReply(op,record,0,nil);}
 if(kind==2){id<SourceCglIteratedStateOwner> state=states[stateResource];ensure(state!=nil,@"state-lost",@"Iterated compute owner is absent");INPUT(index==state.index&&particles==state.count,@"Iterated draw compute checkpoint/count differ");iteratedStateBudget(retained,packet,128);[owner accumulateAtIndex:index plan:op[@"plan"] clear:[op[@"clear"]boolValue] decay:[op[@"decay"]floatValue] record:[op[@"record"]boolValue] retained:retained+packet*6+128];return iteratedRenderReply(op,record,0,nil);}
 INPUT(index==owner.lastIndex&&displays>0,@"Iterated presentation differs from last drawn checkpoint");iteratedStateBudget(retained,packet,128+(uint64_t)width*height*12);
 NSData *pixels=[owner present:op[@"plan"] retained:retained+packet*6+128];return iteratedRenderReply(op,record,0,pixels);
}
static void disposeIteratedInks(NSMutableDictionary<NSData*,NSDictionary*> *inks){for(NSData *key in [inks.allKeys copy]){[inks[key][@"owner"]dispose];[inks removeObjectForKey:key];}}
