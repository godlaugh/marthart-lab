/* Original MathArt pure formula-label methods via bounded JNI. No scene,
 * PApplet, TeX, renderer, graphics, host, recording or encoder construction. */
#include "jni.h"
#include <dlfcn.h>
#include <float.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static JNIEnv *e;
static void check(const char *where) {
  if ((*e)->ExceptionCheck(e)) {
    fprintf(stderr, "FAIL %s\n", where);
    (*e)->ExceptionDescribe(e);
    exit(2);
  }
}
static jclass cls(const char *name) {
  jclass c = (*e)->FindClass(e, name); check(name); return c;
}
static jmethodID method(jclass c, const char *name, const char *signature) {
  jmethodID m = (*e)->GetMethodID(e, c, name, signature); check(name); return m;
}
static void string(const char *s) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)s; *p; ++p) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}
static void java_string(jstring s) {
  check("formatter result");
  if (!s) { fputs("null", stdout); return; }
  const char *chars = (*e)->GetStringUTFChars(e, s, NULL);
  string(chars); (*e)->ReleaseStringUTFChars(e, s, chars);
}
static void number(double value) {
  uint64_t bits; memcpy(&bits, &value, sizeof(bits));
  fputs("{\"value\":", stdout);
  if (isfinite(value)) printf("%.17g", value);
  else string(isnan(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity");
  printf(",\"bits\":\"%016llx\"}", (unsigned long long)bits);
}
struct Real { const char *id; double value; };
struct Complex { const char *id; int length; double values[3]; };
struct Formula { const char *id; const char *input; };

int main(int argc, char **argv) {
  if (argc != 3) return 1;
  void *library = dlopen(argv[1], RTLD_NOW | RTLD_GLOBAL);
  if (!library) { fputs(dlerror(), stderr); return 1; }
  jint (*create)(JavaVM **, void **, void *) = dlsym(library, "JNI_CreateJavaVM");
  if (!create) return 1;
  char *classpath = malloc(strlen(argv[2]) + 24);
  sprintf(classpath, "-Djava.class.path=%s", argv[2]);
  JavaVMOption options[] = {{classpath, 0}, {"-Djava.awt.headless=true", 0}, {"-Xmx256m", 0}};
  JavaVMInitArgs args = {JNI_VERSION_1_8, 3, options, JNI_FALSE};
  JavaVM *vm;
  if (create(&vm, (void **)&e, &args)) return 2;
  jclass logging = cls("org/apache/logging/log4j/core/config/Configurator");
  jclass level = cls("org/apache/logging/log4j/Level");
  jfieldID off = (*e)->GetStaticFieldID(e, level, "OFF", "Lorg/apache/logging/log4j/Level;");
  jmethodID quiet = (*e)->GetStaticMethodID(e, logging, "setRootLevel", "(Lorg/apache/logging/log4j/Level;)V");
  (*e)->CallStaticVoidMethod(e, logging, quiet, (*e)->GetStaticObjectField(e, level, off)); check("logging");
  jclass config_class = cls("mathart/fractal/config/JsonComplexFractalConfig");
  jobject config = (*e)->AllocObject(e, config_class); check("AllocObject config");
  jmethodID real = method(config_class, "formatReal", "(D)Ljava/lang/String;");
  jmethodID complex = method(config_class, "formatComplex", "([D)Ljava/lang/String;");

  const struct Real reals[] = {
    {"zero", 0}, {"negative-zero", -0.0}, {"integer", 3}, {"negative-integer", -3},
    {"ordinary", 3.141592653589793}, {"ordinary-negative", -3.141592653589793},
    {"nan", NAN}, {"positive-infinity", INFINITY}, {"negative-infinity", -INFINITY},
    {"positive-min-subnormal", DBL_TRUE_MIN}, {"negative-min-subnormal", -DBL_TRUE_MIN},
    {"epsilon-below", nextafter(1e-6, 0)}, {"epsilon-exact", 1e-6}, {"epsilon-above", nextafter(1e-6, INFINITY)},
    {"negative-epsilon-below", -nextafter(1e-6, 0)}, {"negative-epsilon-exact", -1e-6}, {"negative-epsilon-above", -nextafter(1e-6, INFINITY)},
    {"integer-plus-near", 1 + .999999e-6}, {"integer-plus-threshold", 1 + 1e-6}, {"integer-plus-far", 1 + 1.000001e-6},
    {"integer-minus-near", 1 - .999999e-6}, {"integer-minus-threshold", 1 - 1e-6}, {"integer-minus-far", 1 - 1.000001e-6},
    {"negative-integer-near", -1 - .999999e-6}, {"negative-integer-threshold", -1 - 1e-6}, {"negative-integer-far", -1 - 1.000001e-6},
    {"half-1.23445-below", nextafter(1.23445, 0)}, {"half-1.23445", 1.23445}, {"half-1.23445-above", nextafter(1.23445, INFINITY)},
    {"half-1.23455-below", nextafter(1.23455, 0)}, {"half-1.23455", 1.23455}, {"half-1.23455-above", nextafter(1.23455, INFINITY)},
    {"negative-half-1.23445-below", nextafter(-1.23445, -INFINITY)}, {"negative-half-1.23445", -1.23445}, {"negative-half-1.23445-above", nextafter(-1.23445, 0)},
    {"negative-half-1.23455", -1.23455},
    {"half-2.67505-below", nextafter(2.67505, 0)}, {"half-2.67505", 2.67505}, {"half-2.67505-above", nextafter(2.67505, INFINITY)},
    {"half-.10005-below", nextafter(.10005, 0)}, {"half-.10005", .10005}, {"half-.10005-above", nextafter(.10005, INFINITY)},
    {"half-.00005-below", nextafter(.00005, 0)}, {"half-.00005", .00005}, {"half-.00005-above", nextafter(.00005, INFINITY)},
    {"negative-half-.00005-below", -nextafter(.00005, 0)}, {"negative-half-.00005", -.00005}, {"negative-half-.00005-above", -nextafter(.00005, INFINITY)},
    {"half-.00015", .00015}, {"negative-half-.00015", -.00015}, {"half-9.99995", 9.99995}, {"negative-half-9.99995", -9.99995},
    {"one-point-five", 1.5}, {"negative-one-point-five", -1.5}, {"trim-zeroes", 12.3400},
    {"half-1.00005-below", nextafter(1.00005, 0)}, {"half-1.00005", 1.00005}, {"half-1.00005-above", nextafter(1.00005, INFINITY)},
    {"relaxation-double-below", nextafter(1.00015, 0)}, {"relaxation-double", 1.00015}, {"relaxation-double-above", nextafter(1.00015, INFINITY)},
    {"relaxation-float32", (double)(float)1.00015},
    {"large-fraction", 1000000000.12345}, {"safe-integer-max", 9007199254740991.0},
    {"long-max-below", nextafter(0x1p63, 0)}, {"long-max-rounded-double", 0x1p63}, {"long-max-above", nextafter(0x1p63, INFINITY)},
    {"long-min", -0x1p63}, {"long-min-below", nextafter(-0x1p63, -INFINITY)}, {"long-min-above", nextafter(-0x1p63, 0)},
    {"largest-finite", DBL_MAX}, {"negative-largest-finite", -DBL_MAX}
  };
  const struct Complex complexes[] = {
    {"null", -1, {0}}, {"empty", 0, {0}}, {"one-element", 1, {3}},
    {"zero", 2, {0, 0}}, {"negative-zero", 2, {-0.0, -0.0}},
    {"real", 2, {3.141592653589793, 0}}, {"imaginary-one", 2, {0, 1}}, {"imaginary-negative-one", 2, {0, -1}},
    {"both-positive", 2, {3, .25}}, {"negative-imaginary", 2, {3, -.25}}, {"both-negative", 2, {-3, -.25}},
    {"imaginary-epsilon-below", 2, {3, nextafter(1e-6, 0)}}, {"imaginary-epsilon", 2, {3, 1e-6}},
    {"imaginary-negative-epsilon", 2, {3, -1e-6}}, {"real-epsilon-below", 2, {nextafter(1e-6, 0), 1}},
    {"real-epsilon", 2, {1e-6, 1}}, {"both-small", 2, {1e-6, -1e-6}},
    {"half-rounding", 2, {1.23445, -1.23455}}, {"third-component-ignored", 3, {3, .25, 9}},
    {"nan-real", 2, {NAN, 1}}, {"nan-imaginary", 2, {3, NAN}},
    {"infinite-real", 2, {INFINITY, 1}}, {"infinite-imaginary", 2, {3, -INFINITY}}
  };
  const struct Formula formulas[] = {
    {"newton-no-parameters", "{\"fractal\":{\"formula_id\":\"newton\"}}"},
    {"newton-empty-parameters", "{\"fractal\":{\"formula_id\":\"newton\",\"parameters\":{}}}"},
    {"newton-config-parameters", "{\"fractal\":{\"formula_id\":\"newton\",\"parameters\":{\"exponent\":[2.718281828459045,0.33335],\"relaxation\":1.00015}}}"},
    {"newton-legacy-power-does-not-supply-label", "{\"fractal\":{\"formula_id\":\"newton\",\"power\":9,\"formula_params\":{\"power\":7}}}"},
    {"newton-negative-initial-parameter-clamped", "{\"fractal\":{\"formula_id\":\"newton\",\"parameters\":{\"exponent\":[3,-1],\"relaxation\":-2}}}"},
    {"nova-no-parameters", "{\"fractal\":{\"formula_id\":\"nova\"}}"},
    {"nova-legacy-julia-does-not-supply-label", "{\"fractal\":{\"formula_id\":\"nova\",\"julia_constant\":[0.7,-0.8]}}"},
    {"nova-config-parameters", "{\"fractal\":{\"formula_id\":\"nova\",\"parameters\":{\"exponent\":[3,0.25],\"relaxation\":0.12345,\"julia_seed\":[0,-1]}}}"},
    {"nova-mandelbrot-label-uses-julia-seed-not-start", "{\"fractal\":{\"formula_id\":\"nova\",\"type\":\"MANDELBROT\",\"parameters\":{\"exponent\":[3,0],\"start_value\":[2,0.75],\"julia_seed\":[-0.4,0.6]}}}"},
    {"fallback-default", "{\"fractal\":{}}"},
    {"fallback-unknown-id-escapes-underscore", "{\"fractal\":{\"formula_id\":\"unknown_registry_id\",\"formula\":\"z_n^9 + c\"}}"}
  };
  puts("REA_FORMULA_LABELS_ORACLE_JSON");
  fputs("{\"real\":[", stdout);
  for (size_t i = 0; i < sizeof(reals) / sizeof(reals[0]); ++i) {
    if (i) putchar(','); fputs("{\"id\":", stdout); string(reals[i].id);
    fputs(",\"input\":", stdout); number(reals[i].value); fputs(",\"output\":", stdout);
    java_string((*e)->CallObjectMethod(e, config, real, reals[i].value)); putchar('}');
  }
  fputs("],\"complex\":[", stdout);
  for (size_t i = 0; i < sizeof(complexes) / sizeof(complexes[0]); ++i) {
    const struct Complex *c = &complexes[i];
    jdoubleArray input = c->length < 0 ? NULL : (*e)->NewDoubleArray(e, c->length);
    if (c->length > 0) (*e)->SetDoubleArrayRegion(e, input, 0, c->length, c->values);
    if (i) putchar(','); fputs("{\"id\":", stdout); string(c->id); fputs(",\"input\":", stdout);
    if (c->length < 0) fputs("null", stdout);
    else { putchar('['); for (int j = 0; j < c->length; ++j) { if (j) putchar(','); number(c->values[j]); } putchar(']'); }
    fputs(",\"output\":", stdout); java_string((*e)->CallObjectMethod(e, config, complex, input)); putchar('}');
    if (input) (*e)->DeleteLocalRef(e, input);
  }
  jclass json_class = cls("processing/data/JSONObject");
  jmethodID parse = (*e)->GetStaticMethodID(e, json_class, "parse", "(Ljava/lang/String;)Lprocessing/data/JSONObject;"); check("JSON parse method");
  jmethodID constructor = method(config_class, "<init>", "(Lprocessing/core/PApplet;Lprocessing/data/JSONObject;)V");
  jmethodID build = method(config_class, "buildFractalLatex", "()Ljava/lang/String;");
  fputs("],\"formula\":[", stdout);
  for (size_t i = 0; i < sizeof(formulas) / sizeof(formulas[0]); ++i) {
    (*e)->PushLocalFrame(e, 256);
    jobject raw = (*e)->CallStaticObjectMethod(e, json_class, parse, (*e)->NewStringUTF(e, formulas[i].input)); check("config JSON");
    jobject instance = (*e)->NewObject(e, config_class, constructor, NULL, raw); check("pure config constructor");
    if (i) putchar(','); fputs("{\"id\":", stdout); string(formulas[i].id);
    printf(",\"input\":%s,\"output\":", formulas[i].input);
    java_string((*e)->CallObjectMethod(e, instance, build)); putchar('}');
    (*e)->PopLocalFrame(e, NULL);
  }
  puts("]}"); fflush(stdout);
  (*vm)->DestroyJavaVM(vm); free(classpath); return 0;
}
