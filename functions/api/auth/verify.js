import { handler, newId, nowIso, isoIn, sessionCookie,
         SESSION_DAYS } from '../../_lib/util.js';

// Opening the emailed link lands here. It redirects rather than returning
// JSON: the user clicked a link in a mail client and expects to arrive at the
// app, not at a page of text.
export const onRequestGet = handler(async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const home = (status) => Response.redirect(`${url.origin}/?login=${status}`, 302);

  if (!token) return home('bad');

  const row = await env.DB.prepare(
    'SELECT email, expires_at FROM login_tokens WHERE token = ?'
  ).bind(token).first();
  // Consumed on sight, valid or not, so a link cannot be replayed.
  await env.DB.prepare('DELETE FROM login_tokens WHERE token = ?').bind(token).run();

  if (!row) return home('bad');
  if (row.expires_at <= nowIso()) return home('expired');

  let user = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(row.email).first();
  if (!user) {
    // First sign-in is the sign-up; there is no separate registration step.
    const id = newId();
    await env.DB.prepare(
      'INSERT INTO users (id, email, created_at, last_seen_at) VALUES (?, ?, ?, ?)'
    ).bind(id, row.email, nowIso(), nowIso()).run();
    user = { id };
  } else {
    await env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?')
      .bind(nowIso(), user.id).run();
  }

  const sid = newId();
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(sid, user.id, nowIso(), isoIn(maxAge * 1000)).run();

  return new Response(null, {
    status: 302,
    headers: { Location: `${url.origin}/?login=ok`, 'Set-Cookie': sessionCookie(sid, maxAge) },
  });
});
