/* Execute original static Symmetry tone normalization methods.
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


 jclass json=cl("processing/data/JSONObject"),arr=cl("processing/data/JSONArray"),mc=cl("mathart/symmetrychaos/SymmetryChaosMobject");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;"),ja=mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),asize=mid(arr,"size","()I"),getobj=mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),getint=mid(json,"getInt","(Ljava/lang/String;)I"),setdouble=mid(json,"setDouble","(Ljava/lang/String;D)Lprocessing/data/JSONObject;"),appendobj=mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;");
 jobject root=(*e)->CallStaticObjectMethod(e,json,parse,(*e)->NewStringUTF(e,text));ck("input");jobject cases=(*e)->CallObjectMethod(e,root,ja,(*e)->NewStringUTF(e,"cases")),results=obj(arr);jint n=(*e)->CallIntMethod(e,cases,asize);
 jmethodID reference=(*e)->GetStaticMethodID(e,mc,"computeToneMappingReferenceScaleFactor","(IIII)F"),scale=(*e)->GetStaticMethodID(e,mc,"computeToneMappingScale","(IIIIF)F");ck("methods");
 const char*names[]={"width","height","referenceWidth","referenceHeight","recordedPasses","batchSize"};
 for(int i=0;i<n;i++){(*e)->PushLocalFrame(e,128);jobject row=(*e)->CallObjectMethod(e,cases,getobj,i);jint v[6];for(int k=0;k<6;k++)v[k]=(*e)->CallIntMethod(e,row,getint,(*e)->NewStringUTF(e,names[k]));ck("values");jfloat factor=(*e)->CallStaticFloatMethod(e,mc,reference,v[0],v[1],v[2],v[3]);jfloat value=(*e)->CallStaticFloatMethod(e,mc,scale,v[4],v[5],v[0],v[1],factor);ck("normalization");(*e)->CallObjectMethod(e,row,setdouble,(*e)->NewStringUTF(e,"referenceScale"),(jdouble)factor);(*e)->CallObjectMethod(e,row,setdouble,(*e)->NewStringUTF(e,"scale"),(jdouble)value);(*e)->CallObjectMethod(e,results,appendobj,row);ck("result");(*e)->PopLocalFrame(e,NULL);}
 jstring output=(*e)->CallObjectMethod(e,results,mid(arr,"toString","()Ljava/lang/String;"));ck("serialize");puts("REA_ORACLE_JSON");const jchar*data=(*e)->GetStringChars(e,output,0);jsize length=(*e)->GetStringLength(e,output);for(jsize i=0;i<length;i++){if(data[i]<128)putchar(data[i]);else printf("\\u%04x",data[i]);}putchar(10);(*e)->ReleaseStringChars(e,output,data);fflush(stdout);(*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
