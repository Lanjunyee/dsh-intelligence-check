import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {PLATFORM_TARGETS} from '../plugin/platform.mjs';
const root=path.resolve(import.meta.dirname,'..');
const platforms=PLATFORM_TARGETS;
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.name,'dsh-intelligence-check');
assert.equal(pkg.license,'MIT');
assert.equal(pkg.magpie,undefined,'旧 Magpie 元数据仍在 package.json');
assert.equal(pkg.dsh?.bundle?.patch,'./cordis.patch.yml');
assert.deepEqual(pkg.dsh.bundle.platforms,['darwin','linux','win32']);
assert.equal(pkg.dsh?.client?.platform,'web');
assert.equal(pkg.exports?.['./client'],'./plugin/client.js');
assert.equal(pkg.engines?.dsh,'>=0.2.0 <0.3.0');
assert.equal(pkg.icon,'./assets/plugin-icon.png');
const icon=await fs.stat(path.join(root,pkg.icon));
assert.ok(icon.size>0&&icon.size<=256*1024,`图标大小 ${icon.size} 超过 DSH 256 KiB 限制`);
const shipped=['plugin/index.mjs','plugin/client.js','plugin/client-core.mjs','plugin/client-panel.js','plugin/backend.mjs','plugin/platform.mjs','cordis.patch.yml','assets/plugin-icon.png','README.md','LICENSE','third_party/cloudflared/LICENSE','third_party/modeltrace/LICENSE','third_party/fonts/SpaceGrotesk-OFL.txt','third_party/fonts/SpaceMono-OFL.txt','third_party/lucide/LICENSE'];
for(const name of shipped)assert.ok((await fs.readFile(path.join(root,name))).length>0,`缺少分发文件 ${name}`);
const manifest=JSON.parse(await fs.readFile(path.join(root,'dist/manifest.json'),'utf8'));
assert.equal(manifest.version,pkg.version);
const sums=await fs.readFile(path.join(root,'dist/SHA256SUMS'),'utf8');
const sumMap=new Map(sums.trim().split('\n').map(line=>{const [sha256,name]=line.split(/\s+/);return [name,sha256]}));
const byName=new Map(manifest.artifacts.map(item=>[item.name,item]));
for(const {goos,goarch} of platforms){
 const suffix=goos==='windows'?'.exe':'';
 const binary=`quality-check-${goos}-${goarch}${suffix}`;
 const archive=`dsh-intelligence-check-${goos}-${goarch}.tgz`;
 for(const name of [binary,archive]){
  const item=byName.get(name);assert.ok(item,`manifest 缺少 ${name}`);
  assert.equal(item.goos,goos);assert.equal(item.goarch,goarch);
  const bytes=await fs.readFile(path.join(root,'dist',name));
  assert.equal(bytes.length,item.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,name);
  assert.equal(sumMap.get(name),item.sha256,`SHA256SUMS 缺少 ${name}`);
  if(name.startsWith('quality-check-')){
   const checkedIn=await fs.readFile(path.join(root,'bin',name));
   assert.equal(createHash('sha256').update(checkedIn).digest('hex'),item.sha256,`checked-in bin/${name} 不是当前源码构建`);
  }
 }
 const file=path.join(root,'dist',archive);
 const listing=spawnSync('tar',['-tzf',file],{encoding:'utf8',maxBuffer:64*1024*1024});
 assert.equal(listing.status,0);
 const files=new Set(listing.stdout.split('\n').filter(Boolean));
 for(const name of ['package/package.json','package/cordis.patch.yml','package/plugin/index.mjs','package/plugin/client.js','package/plugin/backend.mjs','package/plugin/platform.mjs','package/assets/plugin-icon.png','package/README.md','package/LICENSE','package/third_party/cloudflared/LICENSE','package/third_party/modeltrace/LICENSE','package/third_party/fonts/SpaceGrotesk-OFL.txt','package/third_party/lucide/LICENSE'])
  assert.ok(files.has(name),`${archive} 缺少 ${name}`);
 const packedBin=`package/bin/quality-check${suffix}`;
 assert.ok(files.has(packedBin),`${archive} 缺少 ${packedBin}`);
 assert.deepEqual([...files].filter(name=>name.startsWith('package/bin/')&&!name.endsWith('/')),[packedBin],`${archive} 必须只含本平台后台二进制`);
 assert.ok(![...files].some(name=>name.endsWith('.go')||name.endsWith('go.mod')||name.endsWith('go.sum')),`${archive} 不应包含 Go 源码`);
 const meta=spawnSync('tar',['-xOzf',file,'package/package.json'],{encoding:'utf8'});
 assert.equal(meta.status,0);
 const packed=JSON.parse(meta.stdout);
 assert.equal(packed.name,pkg.name);assert.equal(packed.version,pkg.version);assert.equal(packed.license,'MIT');
 assert.equal(packed.magpie,undefined);assert.equal(packed.icon,'./assets/plugin-icon.png');
 assert.equal(packed.dsh.bundle.patch,'./cordis.patch.yml');
 assert.deepEqual(packed.dsh.bundle.platforms,['darwin','linux','win32']);
 assert.equal(packed.dsh?.client?.platform,'web');
 assert.equal(packed.exports?.['./client'],'./plugin/client.js');
 assert.equal(packed.engines.dsh,'>=0.2.0 <0.3.0');
 const unpacked=spawnSync('tar',['-xOzf',file,packedBin],{maxBuffer:64*1024*1024});
 assert.equal(unpacked.status,0);
 assert.equal(createHash('sha256').update(unpacked.stdout).digest('hex'),byName.get(binary).sha256,`${archive} 内二进制与 ${binary} 不一致`);
 const modes=spawnSync('tar',['-tvzf',file,packedBin],{encoding:'utf8'});
 assert.match(modes.stdout,/^-rwx/,`${archive} 内后台二进制不可执行`);
}
assert.equal(manifest.artifacts.length,platforms.length*2);
console.log(`PASS: ${platforms.length} 平台官方 bundle、包布局、图标、可执行位、checksum 与 Go 免安装分发检查`);
