import { handler, readJson, json, err, newId, nowIso, isoIn,
         normalizeEmail, looksLikeEmail, TOKEN_MINUTES } from '../../_lib/util.js';
import { sendLoginMail } from '../../_lib/mail.js';

// Rate limit per address, not per IP: the cost being guarded against is
// mailing a stranger repeatedly, and that is keyed to the address.
const MIN_SECONDS_BETWEEN = 60;

export const onRequestPost = handler(async ({ request, env }) => {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!looksLikeEmail(email)) return err('메일 주소를 확인해 주세요.');

  const recent = await env.DB.prepare(
    `SELECT created_at FROM login_tokens
      WHERE email = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();
  if (recent && Date.now() - Date.parse(recent.created_at) < MIN_SECONDS_BETWEEN * 1000) {
    return err('방금 메일을 보냈습니다. 1분 뒤에 다시 시도해 주세요.', 429);
  }

  // Superseding earlier tokens means a forwarded older mail stops working.
  await env.DB.prepare('DELETE FROM login_tokens WHERE email = ?').bind(email).run();

  const token = newId();
  await env.DB.prepare(
    'INSERT INTO login_tokens (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, email, nowIso(), isoIn(TOKEN_MINUTES * 60 * 1000)).run();

  const origin = new URL(request.url).origin;
  const link = `${origin}/api/auth/verify?token=${token}`;
  const sent = await sendLoginMail(env, email, link);

  // The response never says whether the address is already registered — that
  // would turn this endpoint into a way to test who has an account here.
  return json({ ok: true, dev: sent.dev ? link : undefined });
});
