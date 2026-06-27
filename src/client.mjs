// GraphQL client for ErgZone. Zero dependencies: uses the global fetch (Node >=18).
// Token resolution order:
//   1. ERGZONE_SESSION_TOKEN (explicit, used as-is)
//   2. ERGZONE_LOGBOOK_EMAIL + ERGZONE_LOGBOOK_PASSWORD (headless auto-login, cached)
// On an auth failure with Logbook credentials, the token is refreshed once and the call retried.

import { getSessionToken, clearCachedToken, AuthError } from './auth.mjs';

const ENDPOINT = process.env.ERGZONE_ENDPOINT || 'https://production.erg.zone/api';

const EXPLICIT_TOKEN = process.env.ERGZONE_SESSION_TOKEN || null;
const LOGBOOK = {
  email: process.env.ERGZONE_LOGBOOK_EMAIL || null,
  password: process.env.ERGZONE_LOGBOOK_PASSWORD || null,
};

export const WRITE_ENABLED = process.env.ERGZONE_ALLOW_WRITE !== 'false';

// Normalized error: kind = config | network | auth | infra | graphql
export class ErgzoneError extends Error {
  constructor(message, { kind = 'graphql', detail } = {}) {
    super(message);
    this.name = 'ErgzoneError';
    this.kind = kind;
    this.detail = detail;
  }
}

const hasLogbook = () => Boolean(LOGBOOK.email && LOGBOOK.password);

let cachedToken = EXPLICIT_TOKEN;

// Resolve a usable session token. force=true triggers a fresh Logbook login.
async function resolveToken(force = false) {
  if (EXPLICIT_TOKEN) return EXPLICIT_TOKEN;
  if (!hasLogbook()) {
    throw new ErgzoneError(
      'No credentials: set ERGZONE_SESSION_TOKEN, or ERGZONE_LOGBOOK_EMAIL + ERGZONE_LOGBOOK_PASSWORD.',
      { kind: 'config' },
    );
  }
  if (force) clearCachedToken(LOGBOOK.email);
  if (!cachedToken || force) {
    try {
      cachedToken = await getSessionToken({ ...LOGBOOK, force });
    } catch (e) {
      if (e instanceof AuthError) throw new ErgzoneError(`Login failed: ${e.message}`, { kind: 'auth', detail: e.step });
      throw e;
    }
  }
  return cachedToken;
}

// Single GraphQL POST with a given token. Returns { data } or throws ErgzoneError.
async function postGraphQL(token, query, variables) {
  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new ErgzoneError(`Network error: ${e.message}`, { kind: 'network' });
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    // ErgZone returns HTML (non-JSON) when the token is expired or on infra errors.
    if (res.status === 401 || res.status === 403 || /login|sign\s*in/i.test(text)) {
      throw new ErgzoneError('Token expired or invalid.', { kind: 'auth', detail: `HTTP ${res.status}` });
    }
    throw new ErgzoneError(`Non-JSON response (HTTP ${res.status}).`, { kind: 'infra', detail: text.slice(0, 200) });
  }

  if (json.errors && json.errors.length) {
    throw new ErgzoneError(json.errors.map((e) => e.message).join('; '), { kind: 'graphql', detail: json.errors });
  }
  return json.data;
}

export async function gql(query, variables = {}) {
  const token = await resolveToken(false);
  try {
    return await postGraphQL(token, query, variables);
  } catch (e) {
    // Refresh once on auth failure, but only when we can re-login (Logbook creds present).
    if (e instanceof ErgzoneError && e.kind === 'auth' && !EXPLICIT_TOKEN && hasLogbook()) {
      const fresh = await resolveToken(true);
      return postGraphQL(fresh, query, variables);
    }
    if (e instanceof ErgzoneError && e.kind === 'auth' && EXPLICIT_TOKEN) {
      throw new ErgzoneError(
        'Token expired or invalid. Update ERGZONE_SESSION_TOKEN, or switch to ERGZONE_LOGBOOK_EMAIL/PASSWORD for auto-login.',
        { kind: 'auth' },
      );
    }
    throw e;
  }
}

// Today's date as a Date scalar "YYYY-MM-DD".
export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Resolve the track to use, in order: explicit arg -> ERGZONE_TRACK_ID -> auto-discover
// the user's personal "My Workouts" track. Discovery result is cached in memory.
let trackIdCache = null;
export async function resolveTrackId(explicit) {
  if (explicit) return explicit;
  if (process.env.ERGZONE_TRACK_ID) return process.env.ERGZONE_TRACK_ID;
  if (trackIdCache) return trackIdCache;

  const data = await gql('query{ tracks(onlyAdmin:true){ id name trackMode type isOwner } }');
  const tracks = data.tracks || [];
  const personal =
    tracks.find((t) => t.trackMode === 'single-user' && t.isOwner) ||
    tracks.find((t) => t.type === 'private') ||
    tracks[0];
  if (!personal) {
    throw new ErgzoneError('No personal track found. Set ERGZONE_TRACK_ID.', { kind: 'config' });
  }
  trackIdCache = personal.id;
  return trackIdCache;
}
