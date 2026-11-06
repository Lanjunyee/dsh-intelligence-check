import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';

const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_TOKENS = 8192;

function authorized(header, token) {
  const expected = Buffer.from('Bearer ' + token);
  const supplied = Buffer.from(header || '');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function usageOf(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const input = usage.inputTokens;
  const output = usage.outputTokens;
  const total = usage.totalTokens;
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  // The host adapter fills all-zero counts when the provider reported no
  // usage. A non-empty request cannot legitimately consume zero tokens, so
  // this is absence, not a reported zero.
  if (input === 0 && output === 0 && !total) return undefined;
  const normalized = {input_tokens: input, output_tokens: output};
  if (Number.isFinite(total)) normalized.total_tokens = total;
  return normalized;
}

function finishOf(chunk) {
  const kind = chunk.reason?.kind || 'error';
  if (kind !== 'error' && kind !== 'aborted') return {type: 'finish', reason: kind};
  return {
    type: 'finish',
    reason: kind,
    error: {
      code: chunk.reason?.failure?.code || (kind === 'aborted' ? 'ABORTED' : 'ERROR'),
      message: chunk.reason?.failure?.message || (kind === 'aborted' ? 'Request was aborted' : '模型调用失败'),
    },
  };
}

function validRequest(request) {
  return typeof request?.request_id === 'string' && request.request_id !== '' &&
    typeof request?.target?.provider === 'string' && request.target.provider !== '' &&
    typeof request?.target?.model === 'string' && request.target.model !== '' &&
    typeof request?.prompt === 'string';
}

// The bridge is the only boundary where the Go backend can reach host-hosted
// model credentials. It carries request identity, target, input, parameters,
// deltas, optional usage, a terminal finish or error, and abort on disconnect.
export async function createBridge(llm) {
  const token = randomBytes(24).toString('hex');
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/generate') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (!authorized(request.headers.authorization, token)) {
      response.writeHead(403);
      response.end();
      return;
    }
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > MAX_REQUEST_BYTES) {
        response.writeHead(413);
        response.end();
        return;
      }
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    if (!validRequest(input)) {
      response.writeHead(400);
      response.end();
      return;
    }
    response.writeHead(200, {'content-type': 'application/x-ndjson', 'cache-control': 'no-store'});
    let finished = false;
    const controller = new AbortController();
    response.on('close', () => {
      if (!finished && !response.writableEnded) controller.abort();
    });
    const write = event => {
      if (!response.writableEnded) response.write(JSON.stringify({request_id: input.request_id, ...event}) + '\n');
    };
    try {
      const stream = llm.stream({
        provider: input.target.provider,
        model: input.target.model,
        messages: [{role: 'user', content: [{type: 'text', text: input.prompt}]}],
        maxTokens: Number.isInteger(input.params?.max_tokens) && input.params.max_tokens > 0
          ? input.params.max_tokens
          : DEFAULT_MAX_TOKENS,
        signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && chunk.text) write({type: 'delta', text: chunk.text});
        else if (chunk.type === 'usage') {
          const usage = usageOf(chunk.usage);
          if (usage) write({type: 'usage', usage});
        } else if (chunk.type === 'finish') {
          write(finishOf(chunk));
          finished = true;
          break;
        }
      }
      if (!finished) {
        write({type: 'finish', reason: 'error', error: {code: 'NO_FINISH', message: '宿主未返回完成事件'}});
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        write({type: 'finish', reason: 'error', error: {code: 'STREAM_ERROR', message: error?.message || String(error)}});
      }
    }
    finished = true;
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const {port} = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    async close() {
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
