/* Execute original replay helpers and non-GL lifecycle methods only.
 * No update/display/advanceReplaySession call, window, or application main.
 * paletteLUTDirty is explicitly cleared before trigger probes to observe writes. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static JNIEnv *e;
static jclass json,arr,mc;
static void ck(const char *s){if((*e)->ExceptionCheck(e)){fprintf(stderr,"failed: %s\n",s);(*e)->ExceptionDescribe(e);exit(2);}}
static jstring str(const char*s){return (*e)->NewStringUTF(e,s);}
static jclass cl(const char*s){jclass c=(*e)->FindClass(e,s);ck(s);return c;}
static jmethodID mid(jclass c,const char*n,const char*s){jmethodID m=(*e)->GetMethodID(e,c,n,s);ck(n);return m;}
static jmethodID sid(const char*n,const char*s){jmethodID m=(*e)->GetStaticMethodID(e,mc,n,s);ck(n);return m;}
static jobject obj(jclass c){jobject o=(*e)->NewObject(e,c,mid(c,"<init>","()V"));ck("constructor");return o;}
static jfieldID field(const char*n,const char*s){jfieldID f=(*e)->GetFieldID(e,mc,n,s);ck(n);return f;}
static void number(jobject o,const char*k,double v){(*e)->CallObjectMethod(e,o,mid(json,"setDouble","(Ljava/lang/String;D)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static void boolean(jobject o,const char*k,int v){(*e)->CallObjectMethod(e,o,mid(json,"setBoolean","(Ljava/lang/String;Z)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static void member(jobject o,const char*k,jobject v){(*e)->CallObjectMethod(e,o,mid(json,"setJSONObject","(Ljava/lang/String;Lprocessing/data/JSONObject;)Lprocessing/data/JSONObject;"),str(k),v);ck(k);}
static jobject snapshot(jobject mo){
 jobject out=obj(json);
 const char*ints[]={"remainingBurnInSteps","remainingReplaySteps","replayFrameIndex","targetRevealFrames","burnInBudgetPerFrame","accumulationSampleCount"};
 const char*flags[]={"replayActive","replayRebuildPending","paletteLUTDirty","warmupApplied"};
 const char*offsets[]={"paletteOffset","insideGradientOffset","outsideGradientOffset"};
 for(int i=0;i<6;i++)number(out,ints[i],(*e)->GetIntField(e,mo,field(ints[i],"I")));
 for(int i=0;i<4;i++)boolean(out,flags[i],(*e)->GetBooleanField(e,mo,field(flags[i],"Z")));
 for(int i=0;i<3;i++)number(out,offsets[i],(*e)->GetDoubleField(e,mo,field(offsets[i],"D")));
 return out;
}
int main(int argc,char**argv){
 if(argc!=4)return 1;
 void *lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fprintf(stderr,"%s\n",dlerror());return 1;}
 jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");if(!create)return 1;
 char*cp=malloc(strlen(argv[2])+24);if(!cp)return 1;sprintf(cp,"-Djava.class.path=%s",argv[2]);
 JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};
 JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args)!=JNI_OK)return 2;
 FILE*f=fopen(argv[3],"rb");if(!f)return 3;if(fseek(f,0,SEEK_END))return 3;long size=ftell(f);if(size<0||size>4000000)return 3;rewind(f);
 char*text=calloc((size_t)size+1,1);if(!text||fread(text,1,(size_t)size,f)!=(size_t)size)return 3;fclose(f);
 json=cl("processing/data/JSONObject");arr=cl("processing/data/JSONArray");mc=cl("mathart/symmetrychaos/SymmetryChaosMobject");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");ck("parse method");
 jobject root=(*e)->CallStaticObjectMethod(e,json,parse,str(text));ck("input");
 jobject cases=(*e)->CallObjectMethod(e,root,mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),str("cases")),results=obj(arr);ck("cases");
 int n=(*e)->CallIntMethod(e,cases,mid(arr,"size","()I"));if(n<0||n>4096)return 3;
 for(int i=0;i<n;i++){
  if((*e)->PushLocalFrame(e,256))return 3;
  jobject row=(*e)->CallObjectMethod(e,cases,mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),i);
  jstring method=(*e)->CallObjectMethod(e,row,mid(json,"getString","(Ljava/lang/String;)Ljava/lang/String;"),str("method"));ck("method");
  const char*name=(*e)->GetStringUTFChars(e,method,0);
  jobject values=(*e)->CallObjectMethod(e,row,mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),str("args"));ck("args");
  int len=(*e)->CallIntMethod(e,values,mid(arr,"size","()I"));if(len<0||len>4)return 3;
  double v[4]={0};for(int k=0;k<len;k++)v[k]=(*e)->CallDoubleMethod(e,values,mid(arr,"getDouble","(I)D"),k);ck("values");
  if(!strcmp(name,"lifecycle")){
   jobject settings=obj(json),doc=obj(json);number(settings,"burn_in_steps",v[0]);number(settings,"batch_size",8);member(doc,"settings",settings);
   jclass cc=cl("mathart/symmetrychaos/config/JsonSymmetryChaosConfig");
   jobject cfg=(*e)->NewObject(e,cc,mid(cc,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V"),obj(cl("processing/core/PApplet")),doc);ck("config");
   jobject mo=(*e)->NewObject(e,mc,mid(mc,"<init>","(Lprocessing/core/PApplet;Lmathart/symmetrychaos/config/SymmetryChaosConfig;)V"),NULL,cfg);ck("mobject");
   member(row,"constructed",snapshot(mo));
   (*e)->CallVoidMethod(e,mo,mid(mc,"startReplaySession","()V"));ck("startReplaySession");
   (*e)->SetBooleanField(e,mo,field("paletteLUTDirty","Z"),JNI_FALSE);
   member(row,"beforeTrigger",snapshot(mo));
   int action=(int)v[1];
   if(action==1||action==2||action==3){
    jintArray colors=action==1?NULL:action==2?(*e)->NewIntArray(e,0):(*e)->GetObjectField(e,mo,field("runtimePalette","[I"));
    (*e)->CallVoidMethod(e,mo,mid(mc,"updatePalette","([I)V"),colors);
   }else if(action==4){
    const char*fs[]={"runtimeScaleX","runtimeScaleY","runtimeScaleZ","runtimeOffsetX","runtimeOffsetY","runtimeOffsetZ"};jfloat fv[6];for(int k=0;k<6;k++)fv[k]=(*e)->GetFloatField(e,mo,field(fs[k],"F"));
    (*e)->CallVoidMethod(e,mo,mid(mc,"updateTransform","(FFFFFF)V"),(double)fv[0],(double)fv[1],(double)fv[2],(double)fv[3],(double)fv[4],(double)fv[5]);
   }else if(action==5){
    (*e)->CallVoidMethod(e,mo,mid(mc,"updateCosinePalette","(Z[F[F[F[F)V"),JNI_FALSE,NULL,NULL,NULL,NULL);
   }else if(action==6||action==7){
    jobject frame=NULL;if(action==7){jclass gc=cl("mathart/animation/gradient/GradientFrame");frame=(*e)->NewObject(e,gc,mid(gc,"<init>","(DDD)V"),v[2],v[2],v[2]);}
    (*e)->CallVoidMethod(e,mo,mid(mc,"applyGradientFrame","(Lmathart/animation/gradient/GradientFrame;)V"),frame);
   }else if(action!=0)return 3;
   ck("trigger");member(row,"afterTrigger",snapshot(mo));
  }else if(!strcmp(name,"computeTargetRevealFrames"))number(row,"result",(*e)->CallStaticIntMethod(e,mc,sid(name,"(FI)I"),(double)(jfloat)v[0],(jint)v[1]));
  else if(!strcmp(name,"shouldClearAccumulationForParameterChange")||!strcmp(name,"shouldClearAccumulationForCameraProjectionChange")||!strcmp(name,"shouldClearAccumulationForCameraChange"))boolean(row,"result",(*e)->CallStaticBooleanMethod(e,mc,sid(name,"(ZZZZ)Z"),(int)v[0],(int)v[1],(int)v[2],(int)v[3]));
  else if(!strcmp(name,"isReplayComplete"))boolean(row,"result",(*e)->CallStaticBooleanMethod(e,mc,sid(name,"(II)Z"),(jint)v[0],(jint)v[1]));
  else if(!strcmp(name,"computeReplayAccumulationSamples"))number(row,"result",(*e)->CallStaticIntMethod(e,mc,sid(name,"(I)I"),(jint)v[0]));
  else if(!strcmp(name,"consumeReplayBudget")||!strcmp(name,"accumulateReplaySamples"))number(row,"result",(*e)->CallStaticIntMethod(e,mc,sid(name,"(II)I"),(jint)v[0],(jint)v[1]));
  else if(!strcmp(name,"computeReplayRebuildSteps")||!strcmp(name,"computeReplayBudgetForFrame")||!strcmp(name,"clampReplayBudgetPerFrame"))number(row,"result",(*e)->CallStaticIntMethod(e,mc,sid(name,"(III)I"),(jint)v[0],(jint)v[1],(jint)v[2]));
  else return 3;
  ck(name);(*e)->ReleaseStringUTFChars(e,method,name);
  (*e)->CallObjectMethod(e,results,mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;"),row);ck("result");(*e)->PopLocalFrame(e,NULL);
 }
 jstring output=(*e)->CallObjectMethod(e,results,mid(arr,"toString","()Ljava/lang/String;"));ck("serialize");
 const char*out=(*e)->GetStringUTFChars(e,output,0);puts("REA_ORACLE_JSON");puts(out);(*e)->ReleaseStringUTFChars(e,output,out);fflush(stdout);
 (*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
