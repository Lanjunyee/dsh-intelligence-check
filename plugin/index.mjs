import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createBackend, resolveBinary} from './backend.mjs';
import {createBridge} from './bridge.mjs';

export const name = 'dsh-intelligence-check';
export const inject = ['llm'];

const root = fileURLToPath(new URL('../', import.meta.url));
const ROUTE = '/dsh-intelligence-check';
const SAFE_HEADERS = new Set([
  'content-type', 'cache-control', 'content-disposition', 'x-preview-candidates', 'x-preview-combined',
  'content-security-policy', 'permissions-policy',
]);

async function readCatalog(llm) {
  const providers = llm.listProviders();
  const settled = await Promise.allSettled(providers.map(provider => llm.listModels(provider.id)));
  const models = [];
  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const provider = providers[index];
    for (const model of result.value) {
      models.push({
        provider: provider.id,
        provider_name: provider.name,
        model: model.id,
        name: model.name,
      });
    }
  });
  return models;
}

// The Desktop Host is the only place that owns the shared check service. Its
// environment carries DSH_CLIENT_VERSION; a plain `dsh` CLI launch does not.
export function isDesktopHost(env = process.env, config = {}) {
  if (config.desktop === true) return true;
  if (env.DSH_INTELLIGENCE_CHECK_DESKTOP === '1') return true;
  return typeof env.DSH_CLIENT_VERSION === 'string' && env.DSH_CLIENT_VERSION !== '';
}

// One user-level store for every working directory and profile; never inside a
// profile directory, so old per-profile databases stay untouched.
export function sharedDataDir(env = process.env, config = {}) {
  if (config.dataDir) return path.resolve(config.dataDir);
  if (env.DSH_INTELLIGENCE_CHECK_DATA_DIR) return path.resolve(env.DSH_INTELLIGENCE_CHECK_DATA_DIR);
  return path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-intelligence-check');
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length === 0 ? undefined : Buffer.concat(chunks);
}

function unavailable(response, error) {
  response.writeHead(503, {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'});
  response.end(`质量检测后台不可用：${error?.message || '请通过 DSH 桌面应用打开'}`);
}

export async function apply(ctx, config = {}) {
  const desktop = isDesktopHost(process.env, config);
  let backend;
  let bridge;
  if (desktop) {
    bridge = await createBridge(ctx.llm);
    backend = createBackend({
      binaryPath: resolveBinary(root, config),
      dataDir: sharedDataDir(process.env, config),
      bridge,
      shared: true,
    });
    ctx.effect(() => async () => {
      await backend.stop();
      await bridge.close();
    });
    try {
      await backend.start();
    } catch (error) {
      await bridge.close();
      throw error;
    }
  } else {
    // A CLI/Web host joins a running desktop backend read-only and never
    // starts or takes over the process.
    backend = createBackend({
      binaryPath: resolveBinary(root, config),
      dataDir: sharedDataDir(process.env, config),
      shared: true,
      manage: false,
    });
    await backend.attach();
  }
  const syncCatalog = () => {
    // A joined instance never overwrites the owner's desktop model catalog.
    if (!backend?.owner) return Promise.resolve();
    return readCatalog(ctx.llm).then(
      models => backend.setCatalog(models),
      error => console.error(`[dsh-intelligence-check] 模型目录读取失败：${error.message}`),
    );
  };
  if (desktop) {
    // Subscribe even when this instance starts as a joiner, so the catalog
    // keeps updating after it takes over ownership.
    ctx.on('llm/adapters-updated', syncCatalog);
    ctx.on('llm/models-updated', syncCatalog);
    await syncCatalog();
    console.error(`[dsh-intelligence-check] backend ready, shared=${backend.origin}, owner=${backend.owner}`);
  } else {
    console.error(backend.origin
      ? `[dsh-intelligence-check] CLI host detected; joined shared desktop backend ${backend.origin}`
      : '[dsh-intelligence-check] CLI host detected; the shared desktop backend is not running');
  }

  // Native page API: the page calls same-origin, and this host half forwards to
  // the single shared backend with the owner control token.
  ctx.inject(['webServer', 'connection'], child => {
    child.effect(() => child.webServer.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (request, response) => {
        const rejection = child.connection.requestRejection(request);
        if (rejection) {
          response.statusCode = rejection;
          response.end();
          return;
        }
        const suffix = (request.url || '').slice(ROUTE.length);
        if (!suffix.startsWith('/api/') && !suffix.startsWith('/modeltrace/')) {
          response.writeHead(404);
          response.end();
          return;
        }
        if (!backend?.origin) {
          unavailable(response, new Error('请通过 DSH 桌面应用打开'));
          return;
        }
        try {
          const headers = {authorization: 'Bearer ' + backend.control};
          for (const name of ['content-type', 'accept']) {
            if (request.headers[name]) headers[name] = request.headers[name];
          }
          const body = request.method === 'GET' || request.method === 'HEAD'
            ? undefined
            : await readBody(request);
          const forward = () => fetch(backend.origin + suffix, {
            method: request.method,
            headers,
            body,
            redirect: 'manual',
          });
          let upstream;
          try {
            upstream = await forward();
          } catch {
            // The desktop owner may have exited while this profile stayed open.
            if (!(await backend.ensure())) throw new Error('检测后台无法重新连接');
            if (backend.owner) await syncCatalog();
            headers.authorization = 'Bearer ' + backend.control;
            upstream = await forward();
          }
          response.statusCode = upstream.status;
          for (const [header, value] of upstream.headers) {
            if (SAFE_HEADERS.has(header)) response.setHeader(header, value);
          }
          if (request.method === 'HEAD' || !upstream.body) {
            response.end();
            return;
          }
          Readable.fromWeb(upstream.body).pipe(response);
        } catch (error) {
          unavailable(response, error);
        }
      },
    }), 'dsh-intelligence-check: native page API');
  });
}
