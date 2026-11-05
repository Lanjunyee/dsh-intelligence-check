import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await fs.readFile(path.join(root,'dist/manifest.json'),'utf8'));
for(const item of manifest.artifacts){
 const bytes=await fs.readFile(path.join(root,'dist',item.name));assert.equal(bytes.length,item.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.name);
 if(item.name.endsWith('.tgz')){
  const listing=spawnSync('tar',['-tzf',path.join(root,'dist',item.name)],{encoding:'utf8'});assert.equal(listing.status,0);
  for(const name of ['package.json','cordis.patch.yml','assets/icon.png','plugin/index.mjs','plugin/backend.mjs','third_party/cloudflared/LICENSE','README.md'])assert.ok(listing.stdout.includes('/'+name),`${item.name} missing ${name}`);
  assert.ok(!listing.stdout.includes('gate.middleware.js'),`${item.name} contains gate middleware`);
  const metadata=spawnSync('tar',['-xOzf',path.join(root,'dist',item.name),item.name.slice(0,-4)+'/package.json'],{encoding:'utf8'});assert.equal(metadata.status,0);
  const pkg=JSON.parse(metadata.stdout);assert.equal(pkg.magpie,undefined);assert.equal(pkg.dsh.bundle.patch,'./cordis.patch.yml');
 }
}
console.log(`PASS: ${manifest.artifacts.length} checksummed artifacts, native DSH bundle metadata, no business gate middleware`);
