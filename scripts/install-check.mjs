import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const platform={win32:'windows'}[process.platform]||process.platform;
const arch={x64:'amd64',arm64:'arm64'}[process.arch];
const name=`dsh-intelligence-check-${platform}-${arch}`;
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quality-install-'));
try{
 const unpack=spawnSync('tar',['-xzf',path.join(root,'dist',name+'.tgz'),'-C',dir],{stdio:'inherit'});assert.equal(unpack.status,0);
 const installed=path.join(dir,name);
 const check=spawnSync(process.execPath,[path.join(root,'scripts/plugin-check.mjs')],{env:{...process.env,PLUGIN_ROOT:installed},stdio:'inherit'});assert.equal(check.status,0);
 const pkg=JSON.parse(await fs.readFile(path.join(installed,'package.json'),'utf8'));assert.equal(pkg.magpie,undefined);assert.equal(pkg.dsh.bundle.patch,'./cordis.patch.yml');
 console.log('PASS: extracted release package loads as a native DSH bundle entry');
}finally{await fs.rm(dir,{recursive:true,force:true})}
