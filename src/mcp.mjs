// Loop MCP su stdio (JSON-RPC 2.0, messaggi delimitati da newline).
// Implementa: initialize, tools/list, tools/call, ping. Zero dipendenze.

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
  // stdout e' riservato al protocollo: i log vanno su stderr.
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
      return; // notifica, nessuna risposta

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
      if (!tool) return fail(id, -32602, `Tool sconosciuto: ${params?.name}`);

      if (tool.write && !WRITE_ENABLED) {
        return reply(id, {
          content: [{ type: 'text', text: 'Scrittura disabilitata (ERGZONE_ALLOW_WRITE=false).' }],
          isError: true,
        });
      }

      try {
        const out = await tool.handler(params.arguments || {});
        const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (e) {
        const text =
          e instanceof ErgzoneError ? `Errore [${e.kind}]: ${e.message}` : `Errore: ${e.message}`;
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }

    default:
      if (id !== undefined) return fail(id, -32601, `Metodo non supportato: ${method}`);
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
      return log('JSON invalido:', s.slice(0, 80));
    }
    try {
      await handle(msg);
    } catch (e) {
      log('crash handler:', e.message);
      if (msg && msg.id !== undefined) fail(msg.id, -32603, 'Errore interno');
    }
  });
  // Niente process.exit() qui: alla chiusura dello stdin lasciamo drenare le
  // chiamate async in corso; Node esce da solo quando l'event loop e' vuoto.
  log('avviato. write =', WRITE_ENABLED, 'endpoint =', process.env.ERGZONE_ENDPOINT || 'produzione');
}
