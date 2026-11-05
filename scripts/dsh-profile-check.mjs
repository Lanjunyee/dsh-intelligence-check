import assert from 'node:assert/strict';
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dsh = process.env.DSH_BINARY || (existsSync('/usr/local/bin/dsh') ? '/usr/local/bin/dsh' : 'dsh');
const suffix = process.platform === 'win32' ? '.exe' : '';
const localBinary = path.join(root, 'bin', `quality-check${suffix}`);
const platformBinary = path.join(root, 'bin', `quality-check-${({win32: 'windows'})[process.platform] || process.platform}-${({x64: 'amd64', arm64: 'arm64'})[process.arch] || process.arch}${suffix}`);
const backend = process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY || (existsSync(localBinary) ? localBinary : platformBinary);
const packageSpec = process.env.DSH_PLUGIN_PACKAGE || root;
assert.ok(existsSync(backend), `缺少后台二进制，请先构建：go build -o bin/quality-check ./cmd/quality-check（或设置 DSH_INTELLIGENCE_CHECK_TEST_BINARY）`);
const home = await mkdtemp(path.join(os.tmpdir(), 'dsh-ic-home-'));
const work = await mkdtemp(path.join(os.tmpdir(), 'dsh-ic-work-'));
const env = {...process.env, DSH_HOME: home};
const hosts = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function dshRun(args) {
  return spawnSync(dsh, args, {env, cwd: work, encoding: 'utf8', timeout: 180000});
}

async function installProfile(name) {
  const init = dshRun(['--profile', name, '--from-default-profile', 'web', '--dump-config']);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const added = dshRun(['plugin', '--profile', name, 'add', packageSpec]);
  assert.equal(added.status, 0, added.stdout + added.stderr);
  if (process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY) {
    await writeFile(path.join(home, 'profiles', name, 'cordis.patch.yml'),
      `- id: dsh-intelligence-check\n  config:\n    binaryPath: ${JSON.stringify(backend)}\n`);
  }
}

async function uninstallProfile(name) {
  const removed = dshRun(['plugin', '--profile', name, 'remove', 'dsh-intelligence-check']);
  assert.equal(removed.status, 0, removed.stdout + removed.stderr);
  const profile = JSON.parse(await readFile(path.join(home, 'profiles', name, 'package.json'), 'utf8'));
  assert.equal(profile.dependencies?.['dsh-intelligence-check'], undefined, '卸载后 profile 依赖仍在');
  assert.ok(!profile.dsh?.profile?.bundles?.includes('dsh-intelligence-check'), '卸载后 bundle 层仍在');
  const dump = dshRun(['--profile', name, '--dump-config']);
  assert.equal(dump.status, 0, dump.stdout + dump.stderr);
  assert.ok(!dump.stdout.includes('# == dsh-intelligence-check'), '卸载后配置仍包含插件层');
}

async function bootProfile(name) {
  const child = spawn(dsh, ['--profile', name, '--no-open', '--port', '0'], {
    env, cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  let login = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`profile ${name} 启动超时：${errors.slice(-1000)}`)), 45000);
    const check = () => {
      login ||= output.match(/dsh web: (http:\/\/\S+)/)?.[1] || '';
      if (login && (output + errors).includes('[dsh-intelligence-check] backend ready')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', chunk => {
      output += chunk;
      check();
    });
    child.stderr.on('data', chunk => {
      errors += chunk;
      check();
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`profile ${name} 提前退出（${code}）：${errors.slice(-1000)}`));
    });
  });
  const host = {name, child, ready, login: () => login, origin: () => new URL(login).origin};
  hosts.push(host);
  await ready;
  return host;
}

async function cookieJar(response) {
  const values = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')];
  return values.filter(Boolean).map(value => value.split(';')[0]).join('; ');
}

async function hostSession(origin) {
  const login = hosts.find(host => host.origin() === origin).login();
  const response = await fetch(login, {redirect: 'manual'});
  assert.equal(response.status, 303, '宿主登录链接未建立浏览器会话');
  return cookieJar(response);
}

async function openEntry(host) {
  const origin = host.origin();
  const cookies = await hostSession(origin);
  const refused = await fetch(origin + '/dsh-intelligence-check', {redirect: 'manual'});
  assert.equal(refused.status, 401, '宿主入口未要求登录');
  const entry = await fetch(origin + '/dsh-intelligence-check', {redirect: 'manual', headers: {cookie: cookies}});
  assert.equal(entry.status, 302, '宿主入口未跳转控制台');
  const location = entry.headers.get('location');
  assert.match(location, /\/open\/[0-9a-f]{48}$/);
  const opened = await fetch(location, {redirect: 'manual'});
  assert.equal(opened.status, 303, '控制台管理链接未完成交换');
  const session = await cookieJar(opened);
  const state = await fetch(new URL('/api/state', location), {headers: {cookie: session}});
  assert.equal(state.status, 200, '控制台状态不可读取');
  return {location, session, state: (await state.json()).state};
}

async function setTarget(console, model) {
  const response = await fetch(new URL('/api/target', console.location), {
    method: 'POST',
    headers: {cookie: console.session, 'content-type': 'application/json'},
    body: JSON.stringify({model, enabled: false}),
  });
  assert.equal(response.status, 200);
}

async function stopHost(host) {
  if (host.child.exitCode !== null) return;
  const exited = new Promise(resolve => host.child.once('exit', resolve));
  host.child.kill('SIGTERM');
  await Promise.race([exited, wait(6000)]);
}

function processes(dataDir) {
  return execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(dataDir));
}

try {
  const version = dshRun(['--version']).stdout.trim();
  assert.match(version, /^\d+\.\d+\.\d+/);
  await installProfile('check-a');
  await installProfile('check-b');
  const a = await bootProfile('check-a');
  const b = await bootProfile('check-b');
  const dataA = path.join(home, 'profiles', 'check-a', 'dsh-intelligence-check');
  const dataB = path.join(home, 'profiles', 'check-b', 'dsh-intelligence-check');
  assert.ok(existsSync(path.join(dataA, 'check.db')), 'profile A 未使用自己的数据目录');
  assert.ok(existsSync(path.join(dataB, 'check.db')), 'profile B 未使用自己的数据目录');
  assert.notEqual(a.origin(), b.origin());

  const first = await openEntry(a);
  const second = await openEntry(a);
  await setTarget(first, 'shared-model');
  const shared = await fetch(new URL('/api/state', second.location), {headers: {cookie: second.session}});
  assert.equal((await shared.json()).state.targets['shared-model'].model, 'shared-model', '同一 profile 的会话未共享记录');
  const isolated = await openEntry(b);
  assert.deepEqual(isolated.state.targets, {}, '跨 profile 数据串用');

  const owned = processes(dataA);
  assert.equal(owned.length, 1, 'profile A 应只有一个后台进程');
  await stopHost(a);
  await stopHost(b);
  for (let i = 0; i < 50 && (processes(dataA).length || processes(dataB).length); i++) await wait(100);
  assert.equal(processes(dataA).length + processes(dataB).length, 0, '宿主退出后残留后台进程');
  await assert.rejects(fetch(a.origin() + '/health'));
  await uninstallProfile('check-b');
  console.log(`PASS: DSH ${version} 隔离 profile 安装 ${path.basename(packageSpec)}、宿主入口、同 profile 共享、跨 profile 隔离、退出清理与卸载`);
} finally {
  for (const host of hosts) await stopHost(host);
  await rm(home, {recursive: true, force: true});
  await rm(work, {recursive: true, force: true});
}
