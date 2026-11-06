import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBackend, resolveBinary} from './backend.mjs';

export const name = 'dsh-intelligence-check';
export const inject = ['commands', 'llm'];

const root = fileURLToPath(new URL('../', import.meta.url));
const linkText = url => `质量检测控制台：${url}\n复制链接后在浏览器打开。链接十分钟内有效且只能使用一次。`;

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

export async function apply(ctx, config = {}) {
  const profile = ctx.profileContext;
  if (!profile?.dir) throw new Error('dsh-intelligence-check 必须在 DSH profile 中运行');
  const backend = createBackend({
    binaryPath: resolveBinary(root, config),
    dataDir: path.join(profile.dir, 'dsh-intelligence-check'),
  });
  ctx.effect(() => () => backend.stop());
  await backend.start();
  const syncCatalog = () => readCatalog(ctx.llm).then(
    models => backend.setCatalog(models),
    error => console.error(`[dsh-intelligence-check] 模型目录读取失败：${error.message}`),
  );
  ctx.on('llm/adapters-updated', syncCatalog);
  ctx.on('llm/models-updated', syncCatalog);
  await syncCatalog();
  console.error(`[dsh-intelligence-check] backend ready, profile=${profile.name}`);
  ctx.commands.register({
    name,
    description: '打开独立的质量检测控制台',
    handler: () => backend.consoleUrl().then(
      url => ({kind: 'success', text: linkText(url)}),
      error => ({kind: 'error', text: `质量检测后台不可用：${error.message}`}),
    ),
  });

  ctx.inject(['webServer', 'connection'], child => {
    child.effect(() => child.webServer.register({
      kind: 'exact',
      path: '/dsh-intelligence-check',
      handler: (req, res) => {
        const rejection = child.connection.requestRejection(req);
        if (rejection) {
          res.statusCode = rejection;
          res.end();
          return;
        }
        backend.consoleUrl().then(
          url => {
            res.writeHead(302, {location: url, 'cache-control': 'no-store'});
            res.end();
          },
          error => {
            res.writeHead(503, {'content-type': 'text/plain; charset=utf-8'});
            res.end(`质量检测后台不可用：${error.message}`);
          },
        );
      },
    }));
  });
}
