import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 15000;
const STOP_GRACE_MS = 3000;

export function resolveBinary(root, config = {}) {
  if (config.binaryPath) return path.resolve(config.binaryPath);
  const platform = ({win32: 'windows'})[process.platform] || process.platform;
  const arch = ({x64: 'amd64', arm64: 'arm64'})[process.arch] || process.arch;
  const suffix = platform === 'windows' ? '.exe' : '';
  const bundled = path.join(root, 'bin', `quality-check-${platform}-${arch}${suffix}`);
  if (existsSync(bundled)) return bundled;
  return path.join(root, 'bin', `quality-check${suffix}`);
}

export function createBackend({binaryPath, dataDir, bridge}) {
  let child;
  let ready;
  let origin = '';
  let control = '';
  let failure = '';

  function start() {
    ready ??= new Promise((resolve, reject) => {
      const args = ['-data', dataDir, '-owned'];
      if (bridge) args.push('-bridge', bridge.url, '-bridge-token', bridge.token);
      child = spawn(binaryPath, args, {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
      child.stdin.on('error', () => {});
      child.stderr.on('data', chunk => {
        failure = (failure + chunk).slice(-4096);
      });
      let output = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('质量检测后台启动超时'));
      }, TIMEOUT_MS);
      const fail = error => {
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(error);
      };
      child.stdout.on('data', chunk => {
        output += chunk;
        const end = output.indexOf('\n');
        if (end < 0) return;
        clearTimeout(timer);
        let info;
        try {
          info = JSON.parse(output.slice(0, end));
        } catch {
          fail(new Error('质量检测后台启动信息无效'));
          return;
        }
        if (typeof info?.origin !== 'string' || typeof info?.control !== 'string') {
          fail(new Error('质量检测后台启动信息无效'));
          return;
        }
        origin = info.origin;
        control = info.control;
        resolve();
      });
      child.once('error', error => fail(new Error(`无法启动质量检测后台：${error.message}`)));
      child.once('exit', () => {
        if (origin === '') fail(new Error(`质量检测后台已退出${failure ? `：${failure.trim()}` : ''}`));
      });
    });
    return ready;
  }

  async function consoleUrl() {
    const response = await fetch(origin + '/api/console', {
      method: 'POST',
      headers: {authorization: 'Bearer ' + control, 'content-type': 'application/json'},
      body: '{}',
    });
    if (!response.ok) throw new Error((await response.text()).trim() || `控制台入口签发失败（HTTP ${response.status}）`);
    const {url} = await response.json();
    if (typeof url !== 'string' || !url.startsWith(origin + '/open/')) throw new Error('控制台入口地址无效');
    return url;
  }

  async function setCatalog(models) {
    const response = await fetch(origin + '/api/catalog', {
      method: 'POST',
      headers: {authorization: 'Bearer ' + control, 'content-type': 'application/json'},
      body: JSON.stringify({models}),
    });
    if (!response.ok) throw new Error((await response.text()).trim() || `模型目录同步失败（HTTP ${response.status}）`);
  }

  async function stop() {
    const running = child;
    if (!running || running.exitCode !== null) return;
    const exited = new Promise(resolve => running.once('exit', resolve));
    running.stdin.end();
    running.kill('SIGTERM');
    const timer = setTimeout(() => {
      if (running.exitCode === null) running.kill('SIGKILL');
    }, STOP_GRACE_MS);
    await exited;
    clearTimeout(timer);
  }

  return {start, consoleUrl, setCatalog, stop};
}
