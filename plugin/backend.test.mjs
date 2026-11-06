import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createBackend} from './backend.mjs';

for (const signal of ['SIGTERM', 'SIGKILL']) {
  test(`backend cleanup completes after its process exits with ${signal}`, {
    skip: process.platform === 'win32' ? '该信号退出回归使用 POSIX 子进程' : false,
    timeout: 10000,
  }, async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-ic-backend-exit-'));
    const fixture = path.join(dir, 'backend.mjs');
    // 子进程自行终止；测试只观察自己创建的进程，不结束其他工作负载。
    await writeFile(fixture, `#!/usr/bin/env node
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
const dir = process.argv[process.argv.indexOf('-data') + 1];
writeFileSync(path.join(dir, 'pid'), String(process.pid));
const marker = path.join(dir, 'terminate');
const timer = setInterval(() => {
  if (!existsSync(marker)) return;
  clearInterval(timer);
  process.kill(process.pid, readFileSync(marker, 'utf8').trim());
}, 10);
process.stdout.write(JSON.stringify({origin: 'http://127.0.0.1:1', control: 'fixture'}) + '\\n');
`, {mode: 0o700});
    const backend = createBackend({binaryPath: fixture, dataDir: dir});
    try {
      await backend.start();
      const pid = (await readFile(path.join(dir, 'pid'), 'utf8')).trim();
      await writeFile(path.join(dir, 'terminate'), signal);
      let exited = false;
      for (let i = 0; i < 100; i++) {
        if (spawnSync('ps', ['-p', pid, '-o', 'pid=']).status !== 0) {
          exited = true;
          break;
        }
        await delay(10);
      }
      assert.equal(exited, true, '测试子进程未结束');
      await Promise.race([
        backend.stop(),
        delay(500).then(() => assert.fail('后台已经退出，清理仍未完成')),
      ]);
      await backend.stop();
    } finally {
      await rm(dir, {recursive: true, force: true});
    }
  });
}
