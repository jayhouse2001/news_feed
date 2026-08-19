// Shared helpers for the Pages Functions. Nothing here touches the DOM or the
// news feed; this half of the app only knows about accounts and trackers.

export const SESSION_COOKIE = 'nf_session';
export const SESSION_DAYS = 180;
export const TOKEN_MINUTES = 15;

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function err(message, status = 400) {
  return json({ error: message }, status);
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoIn(ms) {
  return new Date(Date.now() + ms).toISOString();
}

// crypto.randomUUID is available in Workers; the token is only ever compared
// for equality, so a UUID's entropy is plenty and the format stays URL-safe.
export function newId() {
  return crypto.randomUUID();
}

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

// Deliberately permissive: the address either receives the link or it does
// not, and rejecting valid-but-unusual addresses is the worse failure.
export function looksLikeEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(id, maxAgeSeconds) {
  // HttpOnly keeps the session out of reach of any script on the page, and
  // SameSite=Lax still lets the emailed link arrive with the cookie set.
  return `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Returns the user row, or null. Expired sessions are deleted on sight so the
// table does not accumulate rows nothing will ever read again.
export async function currentUser(env, req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (!sid) return null;
  const row = await env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.id, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`
  ).bind(sid).first();
  if (!row) return null;
  if (row.expires_at <= nowIso()) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
    return null;
  }
  return { id: row.id, email: row.email, sessionId: row.sid };
}

export async function requireUser(env, req) {
  const user = await currentUser(env, req);
  if (!user) throw new HttpError('로그인이 필요합니다.', 401);
  return user;
}

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// For endpoints that never touch the database. The AI relay is one: the key
// comes from the caller and nothing is persisted, so a missing D1 binding is
// irrelevant to it and refusing the request over one would be wrong.
export function plainHandler(fn) {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return err(e.message, e.status);
      console.error(e);
      return err('서버 오류가 발생했습니다.', 500);
    }
  };
}

// Every handler is wrapped so a thrown HttpError becomes its status and
// anything else becomes a 500 without leaking a stack trace to the client.
export function handler(fn) {
  return async (ctx) => {
    // A missing D1 binding is the one failure that is certain to happen at
    // least once — the API deploys with the code, but the binding is added by
    // hand afterwards. Saying so beats a generic 500 the reader cannot act on.
    if (!ctx.env || !ctx.env.DB) {
      return err('데이터베이스가 연결되지 않았습니다. Cloudflare 설정에서 D1 바인딩(DB)을 추가해 주세요.', 503);
    }
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return err(e.message, e.status);
      // A binding that exists but has no tables fails the same way for the
      // same reason: setup is unfinished, not broken.
      if (/no such table/i.test(e.message || '')) {
        return err('데이터베이스에 테이블이 없습니다. migrations/0001_init.sql 을 적용해 주세요.', 503);
      }
      console.error(e);
      return err('서버 오류가 발생했습니다.', 500);
    }
  };
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError('잘못된 요청입니다.', 400);
  }
}
