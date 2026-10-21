/* Execute original ProjectState import/export and Map presentation config getters.
 * No application entry point, window, graphics, network, or persisted app state. */
#include "jni.h"
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static JNIEnv *e;
static void ck(const char *stage){if((*e)->ExceptionCheck(e)){fprintf(stderr,"failed: %s\n",stage);(*e)->ExceptionDescribe(e);exit(2);}}
static jclass cl(const char*n){jclass c=(*e)->FindClass(e,n);ck(n);return c;}
static jmethodID mid(jclass c,const char*n,const char*s){jmethodID m=(*e)->GetMethodID(e,c,n,s);ck(n);return m;}
static jobject obj(jclass c){jobject o=(*e)->NewObject(e,c,mid(c,"<init>","()V"));ck("constructor");return o;}
int main(int argc,char**argv){
 if(argc!=4)return 1;void *lib=dlopen(argv[1],RTLD_NOW|RTLD_GLOBAL);if(!lib){fprintf(stderr,"%s\n",dlerror());return 1;}fprintf(stderr,"JVM library loaded\n");
 jint(*create)(JavaVM**,void**,void*)=dlsym(lib,"JNI_CreateJavaVM");char*cp=malloc(strlen(argv[2])+24);sprintf(cp,"-Djava.class.path=%s",argv[2]);
 JavaVMOption opts[]={{cp,0},{"-Djava.awt.headless=true",0},{"-Xmx256m",0}};JavaVMInitArgs args={JNI_VERSION_1_8,3,opts,JNI_FALSE};JavaVM*vm;if(create(&vm,(void**)&e,&args)!=JNI_OK)return 2;
 fprintf(stderr,"JVM created\n");FILE*f=fopen(argv[3],"rb");if(!f)return 3;fseek(f,0,SEEK_END);long size=ftell(f);if(size<0||size>4000000)return 3;rewind(f);char*text=calloc(size+1,1);if(fread(text,1,size,f)!=(size_t)size)return 3;fclose(f);


 jclass json=cl("processing/data/JSONObject"),arr=cl("processing/data/JSONArray"),config=cl("mathart/mapattractor/config/JsonMapAttractorConfig"),project=cl("mathart/ui/state/ProjectState");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");jobject root=(*e)->CallStaticObjectMethod(e,json,parse,(*e)->NewStringUTF(e,text));ck("parse");
 jmethodID ja=mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),jo=mid(json,"getJSONObject","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),asize=mid(arr,"size","()I"),getobj=mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),js=mid(json,"getString","(Ljava/lang/String;)Ljava/lang/String;"),setstr=mid(json,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;"),setobj=mid(json,"setJSONObject","(Ljava/lang/String;Lprocessing/data/JSONObject;)Lprocessing/data/JSONObject;"),setarr=mid(json,"setJSONArray","(Ljava/lang/String;Lprocessing/data/JSONArray;)Lprocessing/data/JSONObject;"),appendobj=mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;"),ctor=mid(config,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V");
 jobject cases=(*e)->CallObjectMethod(e,root,ja,(*e)->NewStringUTF(e,"cases")),results=obj(arr);jint n=(*e)->CallIntMethod(e,cases,asize);
 for(int i=0;i<n;i++){
  (*e)->PushLocalFrame(e,4096);jobject input=(*e)->CallObjectMethod(e,cases,getobj,i),document=(*e)->CallObjectMethod(e,input,jo,(*e)->NewStringUTF(e,"document")),result=obj(json),stages=obj(arr);jstring id=(*e)->CallObjectMethod(e,input,js,(*e)->NewStringUTF(e,"id"));(*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"id"),id);
  for(int stage=0;stage<2;stage++){
   jobject record=obj(json),doc=document;(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"route"),(*e)->NewStringUTF(e,stage?"ProjectState.fromJson/toJson then config":"direct config"));
   if(stage){jobject state=obj(project);(*e)->CallVoidMethod(e,state,mid(project,"fromJson","(Lprocessing/data/JSONObject;)V"),document);ck("project import");doc=(*e)->CallObjectMethod(e,state,mid(project,"toJson","()Lprocessing/data/JSONObject;"));if((*e)->ExceptionCheck(e)){jthrowable error=(*e)->ExceptionOccurred(e);(*e)->ExceptionClear(e);(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"error"),(*e)->CallObjectMethod(e,error,mid(cl("java/lang/Throwable"),"toString","()Ljava/lang/String;")));(*e)->CallObjectMethod(e,stages,appendobj,record);continue;}(*e)->CallObjectMethod(e,record,setobj,(*e)->NewStringUTF(e,"export"),doc);}
   jobject cfg=(*e)->NewObject(e,config,ctor,obj(cl("processing/core/PApplet")),doc);jthrowable error=(*e)->ExceptionOccurred(e);
   if(error){(*e)->ExceptionClear(e);(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"error"),(*e)->CallObjectMethod(e,error,mid(cl("java/lang/Throwable"),"toString","()Ljava/lang/String;")));}
   else{
    char bg[64];snprintf(bg,sizeof(bg),"%u",(unsigned)(*e)->CallIntMethod(e,cfg,mid(config,"getBackgroundColor","()I")));(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"BackgroundColor"),(*e)->NewStringUTF(e,bg));
    const char*floats[]={"Brightness","Contrast","Gamma","DynamicRange","Saturation","AccumulationDecay"};for(int k=0;k<6;k++){char getter[64],v[64];snprintf(getter,sizeof(getter),"get%s",floats[k]);snprintf(v,sizeof(v),"%.17g",(*e)->CallFloatMethod(e,cfg,mid(config,getter,"()F")));(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,floats[k]),(*e)->NewStringUTF(e,v));}
    ck("snapshot");
   }
   (*e)->CallObjectMethod(e,stages,appendobj,record);
  }
  (*e)->CallObjectMethod(e,result,setarr,(*e)->NewStringUTF(e,"stages"),stages);(*e)->CallObjectMethod(e,results,appendobj,result);(*e)->PopLocalFrame(e,NULL);
 }
 jstring output=(*e)->CallObjectMethod(e,results,mid(arr,"toString","()Ljava/lang/String;"));ck("serialize");puts("REA_ORACLE_JSON");const jchar*data=(*e)->GetStringChars(e,output,0);jsize length=(*e)->GetStringLength(e,output);for(jsize i=0;i<length;i++){if(data[i]<128)putchar(data[i]);else printf("\\u%04x",data[i]);}putchar(10);(*e)->ReleaseStringChars(e,output,data);fflush(stdout);(*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
