// GraphQL client per ErgZone. Zero dipendenze: usa fetch globale (Node >=18).

const ENDPOINT = process.env.ERGZONE_ENDPOINT || 'https://production.erg.zone/api';
const TOKEN = process.env.ERGZONE_SESSION_TOKEN;

export const DEFAULT_TRACK_ID = process.env.ERGZONE_TRACK_ID || '';
export const WRITE_ENABLED = process.env.ERGZONE_ALLOW_WRITE !== 'false';

// Errore normalizzato: kind = config | network | auth | infra | graphql
export class ErgzoneError extends Error {
  constructor(message, { kind = 'graphql', detail } = {}) {
    super(message);
    this.name = 'ErgzoneError';
    this.kind = kind;
    this.detail = detail;
  }
}

export async function gql(query, variables = {}) {
  if (!TOKEN) {
    throw new ErgzoneError('ERGZONE_SESSION_TOKEN non impostato.', { kind: 'config' });
  }

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new ErgzoneError(`Errore di rete: ${e.message}`, { kind: 'network' });
  }

  const text = await res.text();

  // ErgZone restituisce HTML (non-JSON) quando il token e' scaduto o per errori infra.
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (res.status === 401 || res.status === 403 || /login|sign\s*in/i.test(text)) {
      throw new ErgzoneError(
        'Token scaduto o non valido. Rifai login su admin.erg.zone e aggiorna ERGZONE_SESSION_TOKEN.',
        { kind: 'auth', detail: `HTTP ${res.status}` },
      );
    }
    throw new ErgzoneError(
      `Risposta non-JSON (HTTP ${res.status}). Query troppo grande o errore server.`,
      { kind: 'infra', detail: text.slice(0, 200) },
    );
  }

  if (json.errors && json.errors.length) {
    throw new ErgzoneError(json.errors.map((e) => e.message).join('; '), {
      kind: 'graphql',
      detail: json.errors,
    });
  }

  return json.data;
}

// Data odierna in formato Date scalar "YYYY-MM-DD".
export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
