// MCP loop over stdio (JSON-RPC 2.0, newline-delimited messages).
// Implements: initialize, tools/list, tools/call, ping. Zero dependencies.

import readline from 'node:readline';
import { TOOLS } from './tools.mjs';
import { ErgzoneError, WRITE_ENABLED } from './client.mjs';

const SERVER_INFO = { name: 'ergzone-mcp', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function fail(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, data } });
}
function log(...args) {
  // stdout is reserved for the protocol: logs go to stderr.
  process.stderr.write('[ergzone-mcp] ' + args.join(' ') + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case 'notifications/initialized':
    case 'initialized':
      return; // notification, no response

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);

      if (tool.write && !WRITE_ENABLED) {
        return reply(id, {
          content: [{ type: 'text', text: 'Writes are disabled (ERGZONE_ALLOW_WRITE=false).' }],
          isError: true,
        });
      }

      try {
        const out = await tool.handler(params.arguments || {});
        const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        const text =
          e instanceof ErgzoneError ? `Error [${e.kind}]: ${e.message}` : `Error: ${e.message}`;
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }

    default:
      if (id !== undefined) return fail(id, -32601, `Unsupported method: ${method}`);
  }
}

export function serve() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try {
      msg = JSON.parse(s);
    } catch {
      return log('invalid JSON:', s.slice(0, 80));
    }
    try {
      await handle(msg);
    } catch (e) {
      log('handler crash:', e.message);
      if (msg && msg.id !== undefined) fail(msg.id, -32603, 'Internal error');
    }
  });
  // No process.exit() here: when stdin closes we let in-flight async calls drain;
  // Node exits on its own once the event loop is empty.
  log('started. write =', WRITE_ENABLED, 'endpoint =', process.env.ERGZONE_ENDPOINT || 'production');
}
