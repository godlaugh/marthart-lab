/* Execute original ProjectState import/export plus Map/Symmetry config and seed methods.
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
 fprintf(stderr,"JVM created\n");FILE*f=fopen(argv[3],"rb");if(!f)return 3;fseek(f,0,SEEK_END);long size=ftell(f);if(size>4000000)return 3;rewind(f);char*text=calloc(size+1,1);if(fread(text,1,size,f)!=(size_t)size)return 3;fclose(f);


 jclass json=cl("processing/data/JSONObject"),arr=cl("processing/data/JSONArray"),project=cl("mathart/ui/state/ProjectState"),map=cl("java/util/Map"),set=cl("java/util/Set"),iterator=cl("java/util/Iterator"),entry=cl("java/util/Map$Entry");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");jobject root=(*e)->CallStaticObjectMethod(e,json,parse,(*e)->NewStringUTF(e,text));ck("parse");
 jmethodID ja=mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),jo=mid(json,"getJSONObject","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),asize=mid(arr,"size","()I"),getobj=mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),js=mid(json,"getString","(Ljava/lang/String;)Ljava/lang/String;"),setstr=mid(json,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;"),setobj=mid(json,"setJSONObject","(Ljava/lang/String;Lprocessing/data/JSONObject;)Lprocessing/data/JSONObject;"),setarr=mid(json,"setJSONArray","(Ljava/lang/String;Lprocessing/data/JSONArray;)Lprocessing/data/JSONObject;"),appendobj=mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;"),append=mid(arr,"append","(Ljava/lang/String;)Lprocessing/data/JSONArray;");
 jobject cases=(*e)->CallObjectMethod(e,root,ja,(*e)->NewStringUTF(e,"cases")),results=obj(arr);jint n=(*e)->CallIntMethod(e,cases,asize);
 for(int i=0;i<n;i++){
  (*e)->PushLocalFrame(e,4096);jobject input=(*e)->CallObjectMethod(e,cases,getobj,i),document=(*e)->CallObjectMethod(e,input,jo,(*e)->NewStringUTF(e,"document")),result=obj(json),stages=obj(arr);jstring id=(*e)->CallObjectMethod(e,input,js,(*e)->NewStringUTF(e,"id"));(*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"id"),id);
  jstring family=(*e)->CallObjectMethod(e,document,js,(*e)->NewStringUTF(e,"type"));const char*ft=(*e)->GetStringUTFChars(e,family,0);int isMap=strcmp(ft,"MAP_ATTRACTOR")==0;(*e)->ReleaseStringUTFChars(e,family,ft);
  jclass config=cl(isMap?"mathart/mapattractor/config/JsonMapAttractorConfig":"mathart/symmetrychaos/config/JsonSymmetryChaosConfig"),moc=cl(isMap?"mathart/mapattractor/MapAttractorMobject":"mathart/symmetrychaos/SymmetryChaosMobject");
  jmethodID ctor=mid(config,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V");
  jobject state=obj(project);(*e)->CallVoidMethod(e,state,mid(project,"fromJson","(Lprocessing/data/JSONObject;)V"),document);ck("project import");
  for(int stage=0;stage<3;stage++){
   jobject record=obj(json),doc=document;(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"route"),(*e)->NewStringUTF(e,stage==0?"direct runtime config":stage==1?"ProjectState.fromJson/toJson then config (Apply)":"same ProjectState.toJson then config again (same-value Apply)"));
   if(stage){doc=(*e)->CallObjectMethod(e,state,mid(project,"toJson","()Lprocessing/data/JSONObject;"));ck("project export");(*e)->CallObjectMethod(e,record,setobj,(*e)->NewStringUTF(e,"export"),doc);}
   if(stage){
    jobject ep=(*e)->CallObjectMethod(e,state,mid(project,"getParameters","()Landroidx/compose/runtime/snapshots/SnapshotStateMap;")),eo=obj(arr),ev=obj(json),ek=(*e)->CallObjectMethod(e,ep,mid(map,"entrySet","()Ljava/util/Set;")),ei=(*e)->CallObjectMethod(e,ek,mid(set,"iterator","()Ljava/util/Iterator;"));
    while((*e)->CallBooleanMethod(e,ei,mid(iterator,"hasNext","()Z"))){jobject en=(*e)->CallObjectMethod(e,ei,mid(iterator,"next","()Ljava/lang/Object;")),key=(*e)->CallObjectMethod(e,en,mid(entry,"getKey","()Ljava/lang/Object;")),val=(*e)->CallObjectMethod(e,en,mid(entry,"getValue","()Ljava/lang/Object;"));(*e)->CallObjectMethod(e,eo,append,key);(*e)->CallObjectMethod(e,ev,setstr,key,(*e)->CallObjectMethod(e,val,mid(cl("java/lang/Object"),"toString","()Ljava/lang/String;")));}
    (*e)->CallObjectMethod(e,record,setarr,(*e)->NewStringUTF(e,"editorParameterOrder"),eo);(*e)->CallObjectMethod(e,record,setobj,(*e)->NewStringUTF(e,"editorParameters"),ev);ck("editor snapshot");
   }
   jobject cfg=(*e)->NewObject(e,config,ctor,obj(cl("processing/core/PApplet")),doc);jthrowable error=(*e)->ExceptionOccurred(e);
   if(error){(*e)->ExceptionClear(e);(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"error"),(*e)->CallObjectMethod(e,error,mid(cl("java/lang/Throwable"),"toString","()Ljava/lang/String;")));}
   else{
    jobject mo=(*e)->NewObject(e,moc,mid(moc,"<init>",isMap?"(Lprocessing/core/PApplet;Lmathart/mapattractor/config/MapAttractorConfig;)V":"(Lprocessing/core/PApplet;Lmathart/symmetrychaos/config/SymmetryChaosConfig;)V"),NULL,cfg);ck("mobject constructor without GL");
    jlong seed=(*e)->CallLongMethod(e,mo,mid(moc,"computeInitialStateSeed","()J"));ck("native seed");char st[32];snprintf(st,sizeof(st),"%lld",(long long)seed);(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,"seed"),(*e)->NewStringUTF(e,st));
    if(isMap){const char*strings[]={"RawEquationXNext","RawEquationYNext","RawEquationZNext"};for(int k=0;k<3;k++){char getter[64];snprintf(getter,sizeof(getter),"get%s",strings[k]);(*e)->CallObjectMethod(e,record,setstr,(*e)->NewStringUTF(e,strings[k]),(*e)->CallObjectMethod(e,cfg,mid(config,getter,"()Ljava/lang/String;")));}}
    jobject params=isMap?(*e)->CallObjectMethod(e,cfg,mid(config,"getParameters","()Ljava/util/Map;")):(*e)->GetObjectField(e,mo,(*e)->GetFieldID(e,moc,"runtimeEquationParams","Ljava/util/LinkedHashMap;")),order=obj(arr),values=obj(json),keys=(*e)->CallObjectMethod(e,params,mid(map,"entrySet","()Ljava/util/Set;")),it=(*e)->CallObjectMethod(e,keys,mid(set,"iterator","()Ljava/util/Iterator;"));
    while((*e)->CallBooleanMethod(e,it,mid(iterator,"hasNext","()Z"))){jobject en=(*e)->CallObjectMethod(e,it,mid(iterator,"next","()Ljava/lang/Object;")),key=(*e)->CallObjectMethod(e,en,mid(entry,"getKey","()Ljava/lang/Object;")),val=(*e)->CallObjectMethod(e,en,mid(entry,"getValue","()Ljava/lang/Object;"));(*e)->CallObjectMethod(e,order,append,key);(*e)->CallObjectMethod(e,values,setstr,key,(*e)->CallObjectMethod(e,val,mid(cl("java/lang/Object"),"toString","()Ljava/lang/String;")));}
    (*e)->CallObjectMethod(e,record,setarr,(*e)->NewStringUTF(e,"parameterOrder"),order);(*e)->CallObjectMethod(e,record,setobj,(*e)->NewStringUTF(e,"parameters"),values);ck("snapshot");
   }
   (*e)->CallObjectMethod(e,stages,appendobj,record);
  }
  (*e)->CallObjectMethod(e,result,setarr,(*e)->NewStringUTF(e,"stages"),stages);(*e)->CallObjectMethod(e,results,appendobj,result);(*e)->PopLocalFrame(e,NULL);
 }
 jstring output=(*e)->CallObjectMethod(e,results,mid(arr,"toString","()Ljava/lang/String;"));ck("serialize");puts("REA_ORACLE_JSON");const jchar*data=(*e)->GetStringChars(e,output,0);jsize length=(*e)->GetStringLength(e,output);for(jsize i=0;i<length;i++){if(data[i]<128)putchar(data[i]);else printf("\\u%04x",data[i]);}putchar(10);(*e)->ReleaseStringChars(e,output,data);fflush(stdout);(*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
