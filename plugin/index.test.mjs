import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {apply, isDesktopHost, sharedDataDir} from './index.mjs';
import {hostTarget} from './platform.mjs';

const root = path.resolve(import.meta.dirname, '..');
const {goos, goarch, suffix} = hostTarget();
const local = path.join(root, 'bin', `quality-check${suffix}`);
const binaryPath = process.env.DSH_INTELLIGENCE_CHECK_TEST_BINARY ||
  (existsSync(local) ? local : path.join(root, 'bin', `quality-check-${goos}-${goarch}${suffix}`));

function catalogFor(prefix) {
  return {
    providers: [{id: prefix, name: prefix}],
    models: {[prefix]: [{provider: prefix, id: 'shared-model', name: 'Shared Model'}]},
  };
}

function profile(options = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-profile-'));
  const disposers = [];
  const routes = [];
  const injections = [];
  const commands = [];
  const listeners = new Map();
  let catalogReads = 0;
  let catalog = options.catalog || catalogFor('provider-one');
  const ctx = {
    profileContext: {name: path.basename(dir), dir},
    effect(fn) {
      const dispose = fn();
      disposers.push(dispose);
      return dispose;
    },
    on(event, handler) {
      listeners.set(event, [...(listeners.get(event) || []), handler]);
      return () => {};
    },
    inject(services, fn) { injections.push({services, fn}); },
    commands: {register(definition) { commands.push(definition); return () => {}; }},
    llm: {
      listProviders() { catalogReads++; return [...catalog.providers]; },
      listModels: async provider => (catalog.models[provider] || []).map(entry => ({...entry})),
      stream: async function* () {
        yield {type: 'text-delta', index: 0, text: '46.24 inches'};
        yield {type: 'finish', reason: {kind: 'stop'}};
      },
    },
    injectRoutes(rejection = 0) {
      for (const {fn} of injections) {
        fn({
          effect(nested) { const dispose = nested(); disposers.push(dispose); return dispose; },
          webServer: {register(route) { routes.push(route); return () => {}; }},
          connection: {requestRejection: () => rejection},
        });
      }
      return routes;
    },
    async dispose() {
      while (disposers.length > 0) await disposers.pop()();
      rmSync(dir, {recursive: true, force: true});
    },
  };
  return {
    dir, ctx, routes, commands,
    get catalogReads() { return catalogReads; },
    setCatalog(next) { catalog = next; },
    async emit(event) {
      for (const handler of listeners.get(event) || []) await handler();
    },
  };
}

async function serve(route) {
  const server = createServer((request, response) => route.handler(request, response));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function processes(dataDir) {
  return execFileSync('ps', ['-axo', 'pid=,command='], {encoding: 'utf8'})
    .split('\n').filter(line => line.includes(dataDir));
}

async function waitUntil(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}

test('desktop detection and the shared user-level data directory', () => {
  assert.equal(isDesktopHost({}), false);
  assert.equal(isDesktopHost({DSH_CLIENT_VERSION: '0.2.2'}), true);
  assert.equal(isDesktopHost({DSH_INTELLIGENCE_CHECK_DESKTOP: '1'}), true);
  assert.equal(isDesktopHost({}, {desktop: true}), true);
  assert.equal(sharedDataDir({DSH_HOME: '/tmp/home'}), '/tmp/home/dsh-intelligence-check');
  assert.equal(sharedDataDir({DSH_HOME: '/tmp/home'}, {dataDir: '/tmp/explicit'}), '/tmp/explicit');
  assert.equal(sharedDataDir({DSH_HOME: '/tmp/home', DSH_INTELLIGENCE_CHECK_DATA_DIR: '/tmp/env'}), '/tmp/env');
});

test('a CLI host registers the native page API but never starts the backend', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-cli-data-'));
  const marker = path.join(dataDir, 'started');
  const fixture = path.join(dataDir, 'backend.mjs');
  await writeFile(fixture, `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, 'started');
process.stdout.write(JSON.stringify({origin: 'http://127.0.0.1:9', control: 'x'}) + '\\n');
setInterval(() => {}, 1000);
`, {mode: 0o700});
  const p = profile();
  try {
    await apply(p.ctx, {binaryPath: fixture, dataDir});
    assert.equal(existsSync(marker), false, 'CLI host started the desktop backend');
    assert.equal(p.commands.length, 0, 'the removed slash command was still registered');
    assert.equal(p.catalogReads, 0, 'CLI host pushed a model catalog');
    const [route] = p.ctx.injectRoutes();
    assert.equal(route.path, '/dsh-intelligence-check');
    assert.equal(route.kind, 'prefix');
    const server = await serve(route);
    try {
      const response = await fetch(server.origin + '/dsh-intelligence-check/api/state');
      assert.equal(response.status, 503, await response.text());
    } finally {
      await server.close();
    }
  } finally {
    assert.equal(existsSync(marker), false);
    await p.ctx.dispose();
    rmSync(dataDir, {recursive: true, force: true});
  }
});

test('profiles share one backend, one catalog authority, and keep working when the owner leaves', {
  skip: process.platform === 'win32' ? '该共享后台回归使用 POSIX 进程观测' : false,
  timeout: 30000,
}, async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-shared-'));
  const first = profile({catalog: catalogFor('provider-one')});
  const second = profile({catalog: catalogFor('provider-two')});
  let firstServer, secondServer;
  try {
    await apply(first.ctx, {binaryPath, dataDir, desktop: true});
    assert.equal(first.commands.length, 0);
    const [firstRoute] = first.ctx.injectRoutes();
    firstServer = await serve(firstRoute);
    let state = await (await fetch(firstServer.origin + '/dsh-intelligence-check/api/state')).json();
    assert.deepEqual(state.state.targets, []);
    assert.deepEqual(state.catalog.map(entry => entry.provider), ['provider-one']);

    await apply(second.ctx, {binaryPath, dataDir, desktop: true});
    const [secondRoute] = second.ctx.injectRoutes();
    secondServer = await serve(secondRoute);
    const shared = await (await fetch(secondServer.origin + '/dsh-intelligence-check/api/state')).json();
    assert.deepEqual(shared.catalog.map(entry => entry.provider), ['provider-one'],
      'a joined profile overwrote the desktop model catalog');

    const added = await fetch(secondServer.origin + '/dsh-intelligence-check/api/target', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({provider: 'provider-one', model: 'shared-model', enabled: false}),
    });
    assert.equal(added.status, 200, await added.text());
    state = await (await fetch(firstServer.origin + '/dsh-intelligence-check/api/state')).json();
    assert.deepEqual(state.state.targets.map(target => target.provider), ['provider-one'],
      'the second profile did not see the first profile state');
    assert.equal(processes(dataDir).length, 1, 'more than one backend process is running');

    // The first host exits. The remaining profile re-elects over the same
    // SQLite state and becomes the catalog authority for its desktop config.
    await first.ctx.dispose();
    assert.ok(await waitUntil(() => processes(dataDir).length === 0, 8000), 'owner backend did not stop');
    const recovered = await fetch(secondServer.origin + '/dsh-intelligence-check/api/state');
    assert.equal(recovered.status, 200, await recovered.clone().text());
    const afterTakeover = await recovered.json();
    assert.deepEqual(afterTakeover.state.targets.map(target => target.provider), ['provider-one'],
      'takeover lost the shared state');
    assert.deepEqual(afterTakeover.catalog.map(entry => entry.provider), ['provider-two'],
      'takeover did not publish the remaining desktop catalog');
    assert.equal(processes(dataDir).length, 1, 'takeover did not leave exactly one backend');

    // The host that took over keeps publishing later model-catalog updates.
    second.setCatalog(catalogFor('provider-three'));
    await second.emit('llm/models-updated');
    const updated = await (await fetch(secondServer.origin + '/dsh-intelligence-check/api/state')).json();
    assert.deepEqual(updated.catalog.map(entry => entry.provider), ['provider-three'],
      'catalog updates stopped after takeover');

    await second.ctx.dispose();
    assert.ok(await waitUntil(() => processes(dataDir).length === 0, 8000), 'backend survived the last host');
  } finally {
    await firstServer?.close();
    await secondServer?.close();
    await first.ctx.dispose().catch(() => {});
    await second.ctx.dispose().catch(() => {});
    rmSync(dataDir, {recursive: true, force: true});
  }
});

test('a CLI host joins the running desktop backend without starting or overriding it', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-cli-join-'));
  const desktop = profile({catalog: catalogFor('provider-one')});
  const cli = profile({catalog: catalogFor('provider-two')});
  let desktopServer, cliServer;
  try {
    await apply(desktop.ctx, {binaryPath, dataDir, desktop: true});
    desktopServer = await serve(desktop.ctx.injectRoutes()[0]);
    await apply(cli.ctx, {binaryPath, dataDir});
    cliServer = await serve(cli.ctx.injectRoutes()[0]);

    const shared = await fetch(cliServer.origin + '/dsh-intelligence-check/api/state');
    assert.equal(shared.status, 200, await shared.clone().text());
    const body = await shared.json();
    assert.deepEqual(body.catalog.map(entry => entry.provider), ['provider-one'],
      'the CLI host overrode the desktop model catalog');
    assert.equal(cli.catalogReads, 0, 'the CLI host published its own model catalog');
    assert.equal(processes(dataDir).length, 1, 'the CLI host started an extra backend');

    await desktop.ctx.dispose();
    assert.ok(await waitUntil(() => processes(dataDir).length === 0, 8000), 'owner backend did not stop');
    const unavailable = await fetch(cliServer.origin + '/dsh-intelligence-check/api/state');
    assert.equal(unavailable.status, 503, 'the CLI host kept serving after the desktop backend exited');
    assert.equal(processes(dataDir).length, 0, 'the CLI host started or took over the backend');
  } finally {
    await desktopServer?.close();
    await cliServer?.close();
    await desktop.ctx.dispose().catch(() => {});
    await cli.ctx.dispose().catch(() => {});
    rmSync(dataDir, {recursive: true, force: true});
  }
});

test('the page API forwards preview isolation response headers', async () => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-headers-'));
  const upstream = createServer((request, response) => {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; sandbox allow-scripts",
      'permissions-policy': 'camera=(), microphone=()',
      'x-preview-candidates': '1',
    });
    response.end('<p>preview</p>');
  });
  await new Promise((resolve, reject) => {
    upstream.once('error', reject);
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const fixture = path.join(dataDir, 'backend.mjs');
  await writeFile(fixture, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({origin: 'http://127.0.0.1:${upstream.address().port}', control: 'fixture'}) + '\\n');
setInterval(() => {}, 1000);
`, {mode: 0o700});
  const p = profile();
  let server;
  try {
    await apply(p.ctx, {binaryPath: fixture, dataDir, desktop: true});
    server = await serve(p.ctx.injectRoutes()[0]);
    const response = await fetch(server.origin + '/dsh-intelligence-check/api/results/html/preview');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox allow-scripts");
    assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=()');
    assert.equal(response.headers.get('x-preview-candidates'), '1');
  } finally {
    await server?.close();
    await p.ctx.dispose().catch(() => {});
    await new Promise(resolve => upstream.close(resolve));
    rmSync(dataDir, {recursive: true, force: true});
  }
});

test('the native page API rejects unauthenticated host requests', async () => {
  const p = profile();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'dsh-ic-reject-'));
  try {
    await apply(p.ctx, {binaryPath, dataDir, desktop: true});
    const [route] = p.ctx.injectRoutes(401);
    const server = await serve(route);
    try {
      const response = await fetch(server.origin + '/dsh-intelligence-check/api/state');
      assert.equal(response.status, 401);
    } finally {
      await server.close();
    }
  } finally {
    await p.ctx.dispose();
    rmSync(dataDir, {recursive: true, force: true});
  }
});
