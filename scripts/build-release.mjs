import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, copyFile, readFile, writeFile, cp, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {PLATFORM_TARGETS, hostTarget} from '../plugin/platform.mjs';

const root=path.resolve(import.meta.dirname,'..');
const dist=path.join(root,'dist');
const platforms=PLATFORM_TARGETS;
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const artifacts=[];
await mkdir(dist,{recursive:true});
await mkdir(path.join(root,'bin'),{recursive:true});
for(const {goos,goarch} of platforms){
 const suffix=goos==='windows'?'.exe':'';
 const name=`quality-check-${goos}-${goarch}${suffix}`;
 const output=path.join(dist,name);
 const result=spawnSync('go',['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',output,'./cmd/quality-check'],{cwd:root,env:{...process.env,CGO_ENABLED:'0',GOOS:goos,GOARCH:goarch},stdio:'inherit'});
 if(result.status!==0)throw Error(`Build failed: ${name}`);
 await copyFile(output,path.join(root,'bin',name));
 const bytes=await readFile(output);
 artifacts.push({name,goos,goarch,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const bundles=[
 ...platforms.map(target=>({name:`dsh-intelligence-check-${target.goos}-${target.goarch}.tgz`,targets:[target]})),
 {name:'dsh-intelligence-check.tgz',targets:platforms},
];
for(const {name,targets} of bundles){
 const stage=await mkdtemp(path.join(os.tmpdir(),'dsh-ic-bundle-'));
 for(const entry of ['plugin','cordis.patch.yml','assets','third_party','package.json','screenshots.json','README.md','LICENSE'])await cp(path.join(root,entry),path.join(stage,entry),{recursive:true});
 await mkdir(path.join(stage,'bin'),{recursive:true});
 for(const {goos,goarch} of targets){
  const suffix=goos==='windows'?'.exe':'';
  const binary=`quality-check-${goos}-${goarch}${suffix}`;
  const packedBinary=targets.length===1?`quality-check${suffix}`:binary;
  await copyFile(path.join(dist,binary),path.join(stage,'bin',packedBinary));
 }
 const packed=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['pack',stage,'--pack-destination',dist,'--silent'],{cwd:root,encoding:'utf8'});
 if(packed.status!==0)throw Error(`Package failed: ${name}\n${packed.stderr}`);
 const produced=packed.stdout.trim().split('\n').pop();
 await rename(path.join(dist,produced),path.join(dist,name));
 await rm(stage,{recursive:true,force:true});
 const bytes=await readFile(path.join(dist,name));
 const target=targets.length===1?targets[0]:{platforms:targets};
 artifacts.push({name,...target,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(dist,'manifest.json'),JSON.stringify({version,artifacts},null,2)+'\n');
await writeFile(path.join(dist,'SHA256SUMS'),artifacts.map(item=>`${item.sha256}  ${item.name}`).join('\n')+'\n');
const current=hostTarget();
const local=platforms.find(target=>target.goos===current.goos&&target.goarch===current.goarch);
if(local)await copyFile(path.join(dist,`quality-check-${local.goos}-${local.goarch}${local.goos==='windows'?'.exe':''}`),path.join(root,'bin',local.goos==='windows'?'quality-check.exe':'quality-check'));
console.log('Release bundles, universal bundle, platform binaries and SHA-256 checksums generated in dist/');
