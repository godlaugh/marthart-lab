/* Execute original ProjectState import/export plus Symmetry config/seed methods.
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

 jclass json=cl("processing/data/JSONObject"),arr=cl("processing/data/JSONArray"),project=cl("mathart/ui/state/ProjectState"),mc=cl("mathart/symmetrychaos/SymmetryChaosMobject"),cc=cl("mathart/symmetrychaos/config/JsonSymmetryChaosConfig"),pr=cl("mathart/color/PaletteRuntime");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),ja=mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),jo=mid(json,"getJSONObject","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),asize=mid(arr,"size","()I"),getobj=mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),js=mid(json,"getString","(Ljava/lang/String;)Ljava/lang/String;"),jd=mid(json,"getDouble","(Ljava/lang/String;D)D"),af=mid(arr,"getFloat","(I)F"),has=mid(json,"hasKey","(Ljava/lang/String;)Z"),append=mid(arr,"append","(D)Lprocessing/data/JSONArray;"),appendobj=mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;"),setarr=mid(json,"setJSONArray","(Ljava/lang/String;Lprocessing/data/JSONArray;)Lprocessing/data/JSONObject;"),setstr=mid(json,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;"),setobj=mid(json,"setJSONObject","(Ljava/lang/String;Lprocessing/data/JSONObject;)Lprocessing/data/JSONObject;");
 jobject root=(*e)->CallStaticObjectMethod(e,json,parse,(*e)->NewStringUTF(e,text));ck("parse input");jobject cases=(*e)->CallObjectMethod(e,root,ja,(*e)->NewStringUTF(e,"cases")),results=obj(arr);jint n=(*e)->CallIntMethod(e,cases,asize);
 for(int i=0;i<n;i++){
  (*e)->PushLocalFrame(e,8192);jobject input=(*e)->CallObjectMethod(e,cases,getobj,i),doc=(*e)->CallObjectMethod(e,input,jo,(*e)->NewStringUTF(e,"document")),state=obj(project),result=obj(json);
  (*e)->CallVoidMethod(e,state,mid(project,"fromJson","(Lprocessing/data/JSONObject;)V"),doc);ck("ProjectState.fromJson");jobject output=(*e)->CallObjectMethod(e,state,mid(project,"toJson","()Lprocessing/data/JSONObject;"));ck("ProjectState.toJson");
  jobject cfg=(*e)->NewObject(e,cc,mid(cc,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V"),obj(cl("processing/core/PApplet")),output);ck("config");jobject mo=(*e)->NewObject(e,mc,mid(mc,"<init>","(Lprocessing/core/PApplet;Lmathart/symmetrychaos/config/SymmetryChaosConfig;)V"),NULL,cfg);ck("mobject");
  jdouble offset=(*e)->CallDoubleMethod(e,input,jd,(*e)->NewStringUTF(e,"offset"),0.0);jfieldID of=(*e)->GetFieldID(e,mc,"paletteOffset","D");ck("offset field");(*e)->SetDoubleField(e,mo,of,offset);
  if((*e)->CallBooleanMethod(e,input,has,(*e)->NewStringUTF(e,"cosine"))){jobject cosine=(*e)->CallObjectMethod(e,input,jo,(*e)->NewStringUTF(e,"cosine"));jfloatArray vectors[4];const char*names[]={"a","b","c","d"};for(int v=0;v<4;v++){jobject list=(*e)->CallObjectMethod(e,cosine,ja,(*e)->NewStringUTF(e,names[v]));jfloat values[3];for(int k=0;k<3;k++)values[k]=(*e)->CallFloatMethod(e,list,af,k);vectors[v]=(*e)->NewFloatArray(e,3);(*e)->SetFloatArrayRegion(e,vectors[v],0,3,values);}(*e)->CallVoidMethod(e,mo,mid(mc,"updateCosinePalette","(Z[F[F[F[F)V"),JNI_TRUE,vectors[0],vectors[1],vectors[2],vectors[3]);ck("updateCosinePalette");}
  jobject pc=(*e)->CallObjectMethod(e,mo,mid(mc,"buildPaletteConfig","()Lmathart/color/PaletteRuntime$PaletteConfig;"));ck("buildPaletteConfig");jfloatArray lut=(*e)->NewFloatArray(e,3072);jmethodID write=(*e)->GetStaticMethodID(e,pr,"writeGradientLut","(Lmathart/color/PaletteRuntime$PaletteConfig;[FI)V");ck("writeGradientLut method");(*e)->CallStaticVoidMethod(e,pr,write,pc,lut,1024);ck("writeGradientLut");jfloat values[3072];(*e)->GetFloatArrayRegion(e,lut,0,3072,values);jobject data=obj(arr);for(int j=0;j<3072;j++)(*e)->CallObjectMethod(e,data,append,(jdouble)values[j]);
  (*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"id"),(*e)->CallObjectMethod(e,input,js,(*e)->NewStringUTF(e,"id")));(*e)->CallObjectMethod(e,result,setobj,(*e)->NewStringUTF(e,"projectOutput"),output);(*e)->CallObjectMethod(e,result,setarr,(*e)->NewStringUTF(e,"lut"),data);(*e)->CallObjectMethod(e,results,appendobj,result);ck("result");(*e)->PopLocalFrame(e,NULL);
 }
 jstring output=(*e)->CallObjectMethod(e,results,mid(arr,"toString","()Ljava/lang/String;"));ck("serialize");puts("REA_ORACLE_JSON");const jchar*data=(*e)->GetStringChars(e,output,0);jsize length=(*e)->GetStringLength(e,output);for(jsize i=0;i<length;i++){if(data[i]<128)putchar(data[i]);else printf("\\u%04x",data[i]);}putchar(10);(*e)->ReleaseStringChars(e,output,data);fflush(stdout);(*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
