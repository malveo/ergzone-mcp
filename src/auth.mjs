// Headless ErgZone login via Concept2 Logbook credentials.
// Pure Node fetch, zero dependencies. Small composable functions so the flow is
// easy to follow and to patch if ErgZone changes a single step.
//
// Flow (verified):
//   1. GET  log.concept2.com/login            -> CSRF _token + session cookie
//   2. POST log.concept2.com/login            -> authenticated session
//   3. GET  log.concept2.com/oauth/authorize  -> consent page + CSRF _token
//   4. POST log.concept2.com/oauth/authorize  -> 302 callback?code=...
//   5. GET  production.erg.zone/auth/logbook/callback?code -> session_id (the SESSION_TOKEN)

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// --- configuration (ErgZone's public OAuth client) ---

export const AUTH_CONFIG = {
  c2Base: 'https://log.concept2.com',
  ergApi: 'https://production.erg.zone/api',
  clientId: 'RDj8SvdqKgPdKAMcDQAuwLjIIOPCYrjHG9tJrqpJ',
  redirectUri: 'https://production.erg.zone/auth/logbook/callback',
  scope: 'user:read,results:write',
  userAgent: 'ergzone-mcp',
};

export function authorizeUrl(cfg = AUTH_CONFIG) {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: cfg.scope,
  });
  return `${cfg.c2Base}/oauth/authorize?${q}`;
}

// --- cookie jar (per-host, in memory) ---

export function createJar() {
  return { hosts: {} };
}

function hostOf(url) {
  return new URL(url).host;
}

export function storeCookies(jar, url, res) {
  const host = hostOf(url);
  const bag = (jar.hosts[host] ||= {});
  const list = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  for (const cookie of list) {
    const [pair] = cookie.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) bag[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

export function cookieHeader(jar, url) {
  const bag = jar.hosts[hostOf(url)] || {};
  return Object.entries(bag).map(([k, v]) => `${k}=${v}`).join('; ');
}

// One request with the jar, manual redirects (so we can read Location).
export async function jarFetch(jar, url, opts = {}) {
  const headers = {
    'User-Agent': AUTH_CONFIG.userAgent,
    Accept: 'text/html,application/json',
    ...(opts.headers || {}),
  };
  const cookie = cookieHeader(jar, url);
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  storeCookies(jar, url, res);
  return res;
}

// --- HTML parsing helpers (no DOM, regex on simple Laravel forms) ---

export function hiddenInput(html, name) {
  const re = new RegExp(`<input[^>]*name=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0] || '';
  return tag.match(/value=["']([^"']*)["']/i)?.[1] ?? null;
}

export function formAction(html, matcher) {
  const re = new RegExp(`<form[^>]*action=["']([^"']*${matcher}[^"']*)["']`, 'i');
  return html.match(re)?.[1]?.replace(/&amp;/g, '&') ?? null;
}

export class AuthError extends Error {
  constructor(message, step) {
    super(message);
    this.name = 'AuthError';
    this.step = step;
  }
}

// --- individual steps ---

// 1+2: authenticate against Concept2 Logbook. Mutates the jar with the session cookie.
export async function logbookSignIn(jar, { email, password }, cfg = AUTH_CONFIG) {
  const loginUrl = `${cfg.c2Base}/login`;
  const page = await jarFetch(jar, loginUrl);
  const html = await page.text();
  const token = hiddenInput(html, '_token');
  if (!token) throw new AuthError('CSRF token not found on login page', 'login-page');

  const body = new URLSearchParams({ _token: token, username: email, password, remember: '1' });
  const res = await jarFetch(jar, loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: loginUrl },
    body: body.toString(),
  });
  if (res.status !== 302) {
    throw new AuthError('Logbook sign-in failed (wrong credentials, captcha, or form change)', 'login-post');
  }
  return true;
}

// 3+4: approve the ErgZone OAuth consent, return the authorization code.
export async function authorizeErgZone(jar, cfg = AUTH_CONFIG) {
  const url = authorizeUrl(cfg);
  const page = await jarFetch(jar, url);

  // Already consented in this session -> immediate 302 with the code.
  if (page.status === 302) {
    const code = new URL(page.headers.get('location'), cfg.c2Base).searchParams.get('code');
    if (code) return code;
  }

  const html = await page.text();
  const token = hiddenInput(html, '_token');
  if (!token) throw new AuthError('CSRF token not found on consent page', 'consent-page');
  const action = formAction(html, 'authorize') || url;

  const body = new URLSearchParams({ _token: token, approve: 'Approve Erg Zone' });
  const res = await jarFetch(jar, action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url },
    body: body.toString(),
  });
  if (res.status !== 302) throw new AuthError('OAuth approve did not redirect', 'consent-post');

  const code = new URL(res.headers.get('location'), cfg.c2Base).searchParams.get('code');
  if (!code) throw new AuthError('No authorization code in callback redirect', 'consent-post');
  return code;
}

// 5: exchange the code at the ErgZone callback, return the session token.
export async function exchangeCode(jar, code, cfg = AUTH_CONFIG) {
  const res = await jarFetch(jar, `${cfg.redirectUri}?code=${encodeURIComponent(code)}`);
  const text = await res.text();
  // Webview callback embeds: ...postMessage(JSON.stringify({session_id:'SFMyNTY...'}))
  const token = text.match(/session_id\s*:\s*['"](SFMyNTY[^'"]+)['"]/)?.[1]
    || text.match(/\/auth\/(SFMyNTY[^/?#"'\\\s]+)/)?.[1];
  if (!token) throw new AuthError('Session token not found in callback response', 'callback');
  return token;
}

// Full chain: credentials -> session token.
export async function loginWithLogbook({ email, password }, cfg = AUTH_CONFIG) {
  if (!email || !password) throw new AuthError('Missing Logbook email/password', 'config');
  const jar = createJar();
  await logbookSignIn(jar, { email, password }, cfg);
  const code = await authorizeErgZone(jar, cfg);
  return exchangeCode(jar, code, cfg);
}

// --- token cache (file, 0600) ---

export function cacheDir() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'ergzone-mcp');
}

export function cachePath(email) {
  const tag = email ? createHash('sha256').update(email).digest('hex').slice(0, 12) : 'default';
  return join(cacheDir(), `token-${tag}`);
}

export function readCachedToken(email) {
  const file = cachePath(email);
  try {
    const t = readFileSync(file, 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

export function writeCachedToken(email, token) {
  const dir = cacheDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(cachePath(email), token, { mode: 0o600 });
}

export function clearCachedToken(email) {
  try {
    rmSync(cachePath(email));
  } catch {
    /* ignore */
  }
}

// Cached token if present, else a fresh login. force=true bypasses the cache.
export async function getSessionToken({ email, password, force = false }, cfg = AUTH_CONFIG) {
  if (!force) {
    const cached = readCachedToken(email);
    if (cached) return cached;
  }
  const token = await loginWithLogbook({ email, password }, cfg);
  writeCachedToken(email, token);
  return token;
}
