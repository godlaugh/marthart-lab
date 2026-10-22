/* Execute original FastExpression.toLatex and Surface configuration labels.
 * Headless PApplet construction only; no graphics, Scene, GUI or encoder. */
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


 jclass json=cl("processing/data/JSONObject"),arr=cl("processing/data/JSONArray"),parser=cl("mathart/core/FastExpressionParser"),expr=cl("mathart/core/FastExpression"),map=cl("java/util/LinkedHashMap"),integer=cl("java/lang/Integer");
 jmethodID parse=(*e)->GetStaticMethodID(e,json,"parse","(Ljava/lang/String;)Lprocessing/data/JSONObject;");
 jobject root=(*e)->CallStaticObjectMethod(e,json,parse,(*e)->NewStringUTF(e,text));ck("parse input");
 jmethodID ja=mid(json,"getJSONArray","(Ljava/lang/String;)Lprocessing/data/JSONArray;"),asize=mid(arr,"size","()I"),getobj=mid(arr,"getJSONObject","(I)Lprocessing/data/JSONObject;"),getstr=mid(arr,"getString","(I)Ljava/lang/String;"),js=mid(json,"getString","(Ljava/lang/String;)Ljava/lang/String;"),appendobj=mid(arr,"append","(Lprocessing/data/JSONObject;)Lprocessing/data/JSONArray;"),setstr=mid(json,"setString","(Ljava/lang/String;Ljava/lang/String;)Lprocessing/data/JSONObject;");
 jmethodID put=mid(map,"put","(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;"),compile=mid(parser,"parse","(Ljava/lang/String;Ljava/util/Map;)Lmathart/core/FastExpression;"),latex=mid(expr,"toLatex","()Ljava/lang/String;");
 jobject parserObj=obj(parser),cases=(*e)->CallObjectMethod(e,root,ja,(*e)->NewStringUTF(e,"cases")),results=obj(arr);jint n=(*e)->CallIntMethod(e,cases,asize);
 for(int i=0;i<n;i++){
  (*e)->PushLocalFrame(e,1024);jobject input=(*e)->CallObjectMethod(e,cases,getobj,i),params=obj(map),result=obj(json),names=(*e)->CallObjectMethod(e,input,ja,(*e)->NewStringUTF(e,"names"));
  for(int j=0;j<(*e)->CallIntMethod(e,names,asize);j++)(*e)->CallObjectMethod(e,params,put,(*e)->CallObjectMethod(e,names,getstr,j),(*e)->NewObject(e,integer,mid(integer,"<init>","(I)V"),j));
  jstring id=(*e)->CallObjectMethod(e,input,js,(*e)->NewStringUTF(e,"id")),source=(*e)->CallObjectMethod(e,input,js,(*e)->NewStringUTF(e,"source"));ck("input");
  jobject ast=(*e)->CallObjectMethod(e,parserObj,compile,source,params);jthrowable error=(*e)->ExceptionOccurred(e);jstring output=NULL;
  if(!error){output=(*e)->CallObjectMethod(e,ast,latex);error=(*e)->ExceptionOccurred(e);}
  if(error){(*e)->ExceptionClear(e);jstring msg=(*e)->CallObjectMethod(e,error,mid(cl("java/lang/Throwable"),"toString","()Ljava/lang/String;"));(*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"error"),msg);}else (*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"latex"),output);
  (*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"id"),id);(*e)->CallObjectMethod(e,results,appendobj,result);ck("case output");(*e)->PopLocalFrame(e,NULL);
 }
 jobject applet=obj(cl("processing/core/PApplet"));
 jobject configs=(*e)->CallObjectMethod(e,root,ja,(*e)->NewStringUTF(e,"configs")),configResults=obj(arr);jclass config=cl("mathart/surface/config/JsonSurfaceConfig"),list=cl("java/util/List"),formula=cl("mathart/surface/config/FormulaConfig");
 jfieldID field=(*e)->GetFieldID(e,formula,"latex","Ljava/lang/String;");ck("formula field");
 for(int i=0;i<(*e)->CallIntMethod(e,configs,asize);i++){
  (*e)->PushLocalFrame(e,1024);jobject input=(*e)->CallObjectMethod(e,configs,getobj,i),result=obj(json);
  jobject instance=(*e)->NewObject(e,config,mid(config,"<init>","(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V"),applet,input);jthrowable error=(*e)->ExceptionOccurred(e);jstring output=NULL;
  if(!error){jobject forms=(*e)->CallObjectMethod(e,instance,mid(config,"getFormulas","()Ljava/util/List;"));if((*e)->CallIntMethod(e,forms,mid(list,"size","()I"))>0){jobject item=(*e)->CallObjectMethod(e,forms,mid(list,"get","(I)Ljava/lang/Object;"),0);output=(*e)->GetObjectField(e,item,field);}error=(*e)->ExceptionOccurred(e);}
  if(error){(*e)->ExceptionClear(e);jstring msg=(*e)->CallObjectMethod(e,error,mid(cl("java/lang/Throwable"),"toString","()Ljava/lang/String;"));(*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"error"),msg);}else if(output)(*e)->CallObjectMethod(e,result,setstr,(*e)->NewStringUTF(e,"latex"),output);
  (*e)->CallObjectMethod(e,configResults,appendobj,result);ck("config output");(*e)->PopLocalFrame(e,NULL);
 }
 jobject all=obj(json);jmethodID setarr=mid(json,"setJSONArray","(Ljava/lang/String;Lprocessing/data/JSONArray;)Lprocessing/data/JSONObject;");(*e)->CallObjectMethod(e,all,setarr,(*e)->NewStringUTF(e,"expressions"),results);(*e)->CallObjectMethod(e,all,setarr,(*e)->NewStringUTF(e,"configs"),configResults);
 jstring output=(*e)->CallObjectMethod(e,all,mid(json,"toString","()Ljava/lang/String;"));ck("serialize");puts("REA_ORACLE_JSON");const jchar*data=(*e)->GetStringChars(e,output,0);jsize length=(*e)->GetStringLength(e,output);for(jsize i=0;i<length;i++){if(data[i]<128)putchar(data[i]);else printf("\\u%04x",data[i]);}putchar(10);(*e)->ReleaseStringChars(e,output,data);fflush(stdout);(*vm)->DestroyJavaVM(vm);free(text);free(cp);return 0;
}
