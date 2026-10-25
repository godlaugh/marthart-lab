import path from 'node:path';
import {cp,mkdir,readFile,readdir,realpath,rename,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

/** Build only from the caller's independent JDK and pinned upstream library.
 * No download, system installation or original-application discovery. */
export async function prepareDesktopGlyph({configuration,resources,root,run}){
 const selected=JSON.parse(await readFile(configuration,'utf8'));
 if(!selected||![selected.javaHome,selected.jarPath].every(p=>typeof p==='string'&&path.isAbsolute(p)))throw Error('Glyph build configuration requires absolute javaHome and jarPath');
 const build=path.join(resources,'glyph-build'),directory=path.join(resources,'formula-glyph'),runtime=path.join(directory,'runtime');
 await run(process.execPath,['scripts/build-formula-glyph.mjs','--java-home',selected.javaHome,'--jar',selected.jarPath,'--out',build]);
 const backend=JSON.parse(await readFile(path.join(build,'backend.json'),'utf8'));
 await mkdir(directory);
 await run(path.join(selected.javaHome,'bin/jlink'),['--add-modules','java.desktop','--strip-debug','--no-header-files','--no-man-pages','--output',runtime],{env:{PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',LC_ALL:'en_US.UTF-8'}});
 // packager's extraResource copy resolves symlinks to the staging tree. Make
 // the owned jlink output self-contained before that copy, including legal/.
 for(const entry of await readdir(runtime,{recursive:true,withFileTypes:true}))if(entry.isSymbolicLink()){
  const resolved=await realpath(path.join(entry.parentPath,entry.name));
  if(!resolved.startsWith(runtime+path.sep))throw Error('jlink output contains an external symlink');
 }
 const flat=path.join(directory,'runtime-flat');await cp(runtime,flat,{recursive:true,dereference:true});await rm(runtime,{recursive:true});await rename(flat,runtime);
 await cp(selected.jarPath,path.join(directory,'jlatexmath-1.0.7.jar'));
 await cp(backend.helperJarPath,path.join(directory,'mathart-lab-glyph.jar'));
 await cp(path.join(root,'server/glyph/FormulaGlyph.java'),path.join(directory,'FormulaGlyph.java'));
 const sha=b=>createHash('sha256').update(b).digest('hex');
 await writeFile(path.join(directory,'manifest.json'),JSON.stringify({schemaVersion:1,platform:process.platform,arch:process.arch,runtime:'runtime',jar:'jlatexmath-1.0.7.jar',helper:'mathart-lab-glyph.jar',helperJarSha256:sha(await readFile(path.join(directory,'mathart-lab-glyph.jar')))},null,2)+'\n');
 await writeFile(path.join(directory,'THIRD-PARTY-NOTICES.txt'),[
  'MathArt Lab local preview formula runtime',
  'Java runtime: jlink java.desktop image from the explicitly supplied independent JDK.',
  'Runtime version and module list: runtime/release. Included notices: runtime/legal/.',
  'Eclipse Temurin: https://github.com/adoptium/temurin21-binaries',
  'OpenJDK source: https://github.com/adoptium/jdk21u',
  'Unmodified JLaTeXMath 1.0.7: https://repo.maven.apache.org/maven2/org/scilab/forge/jlatexmath/1.0.7/',
  'Its library and font notices are preserved inside jlatexmath-1.0.7.jar (META-INF/LICENSE, META-INF/COPYING, org/scilab/forge/jlatexmath/fonts/licences/).',
  'JLaTeXMath source: https://github.com/opencollab/jlatexmath',
  'FormulaGlyph.java is the MathArt Lab helper source. No MathArt Studio application code or runtime is included.',
 ].join('\n')+'\n');
 return directory;
}
