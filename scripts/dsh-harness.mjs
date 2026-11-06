import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hostTarget} from '../plugin/platform.mjs';

// Shared real-DSH harness for the profile, lifecycle and automatic checks.
// Each caller still owns its controlled model service, patch content and
// assertions; only the isolated home, install/boot/stop and console session
// exchange are shared here.
export const root = path.resolve(import.meta.dirname, '..');
export const dsh = process.env.DSH_BINARY || (existsSync('/usr/local/bin/dsh') ? '/usr/local/bin/dsh' : 'dsh');
export const packageSpec = process.env.DSH_PLUGIN_PACKAGE || root;

export function backendBinary() {
  const {goos, goarch, suffix} = hostTarget();
  const local = path.join(root, 'bin', `quality-check${suffix}`);
  return process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY ||
    (existsSync(local) ? local : path.join(root, 'bin', `quality-check-${goos}-${goarch}${suffix}`));
}

export function pluginConfigOverride() {
  if (!process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY) return '';
  return `- id: dsh-intelligence-check\n  config:\n    binaryPath: ${JSON.stringify(backendBinary())}\n`;
}

export async function createDshHarness({prefix, env: extraEnv = {}, readyTimeout = 60000, stopTimeout = 10000}) {
  const home = await mkdtemp(path.join(os.tmpdir(), `${prefix}-home-`));
  const work = await mkdtemp(path.join(os.tmpdir(), `${prefix}-work-`));
  const env = {...process.env, DSH_HOME: home, DSH_INTELLIGENCE_CHECK_DESKTOP: '1', ...extraEnv};
  const hosts = [];

  function dshRun(args) {
    return spawnSync(dsh, args, {env, cwd: work, encoding: 'utf8', timeout: 180000});
  }

  async function installProfile(name, patch) {
    const init = dshRun(['--profile', name, '--from-default-profile', 'web', '--dump-config']);
    assert.equal(init.status, 0, init.stdout + init.stderr);
    const added = dshRun(['plugin', '--profile', name, 'add', packageSpec]);
    assert.equal(added.status, 0, added.stdout + added.stderr);
    await writeFile(path.join(home, 'profiles', name, 'cordis.patch.yml'), patch);
  }

  async function bootProfile(name, bootEnv = env, {readyMarker = '[dsh-intelligence-check] backend ready'} = {}) {
    const child = spawn(dsh, ['--profile', name, '--no-open', '--port', '0'], {
      env: bootEnv, cwd: work, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    let login = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`profile ${name} 启动超时：${errors.slice(-1500)}`)), readyTimeout);
      const check = () => {
        login ||= output.match(/dsh web: (http:\/\/\S+)/)?.[1] || '';
        if (login && (output + errors).includes(readyMarker)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on('data', chunk => { output += chunk; check(); });
      child.stderr.on('data', chunk => { errors += chunk; check(); });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(`profile ${name} 提前退出（${code}）：${errors.slice(-1500)}`));
      });
    });
    const host = {name, child, login: () => login, origin: () => new URL(login).origin};
    hosts.push(host);
    await ready;
    return host;
  }

  async function stopHost(host) {
    if (host.child.exitCode !== null) return;
    const exited = new Promise(resolve => host.child.once('exit', resolve));
    host.child.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, stopTimeout))]);
  }

  return {home, work, env, hosts, dshRun, installProfile, bootProfile, stopHost};
}

export function cookieHeader(response) {
  return (response.headers.getSetCookie?.() || [response.headers.get('set-cookie')])
    .filter(Boolean).map(value => value.split(';')[0]).join('; ');
}

export async function openConsoleSession(host, {requireLogin = false} = {}) {
  const origin = host.origin();
  if (requireLogin) {
    const refused = await fetch(origin + '/dsh-intelligence-check/api/state');
    assert.equal(refused.status, 401, '宿主入口未要求登录');
  }
  const login = await fetch(host.login(), {redirect: 'manual'});
  assert.equal(login.status, 303, '宿主登录链接未建立浏览器会话');
  const session = cookieHeader(login);
  const client = {origin, session};
  const payload = await getState(client);
  return {console: client, client, payload};
}

export async function postJSON(client, pathname, body) {
  const response = await fetch(client.origin + '/dsh-intelligence-check' + pathname, {
    method: 'POST',
    headers: {cookie: client.session, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {status: response.status, text: await response.text()};
}

export async function getState(client) {
  const response = await fetch(client.origin + '/dsh-intelligence-check/api/state', {headers: {cookie: client.session}});
  assert.equal(response.status, 200, `page API state failed with ${response.status}`);
  return response.json();
}
