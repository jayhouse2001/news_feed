import { handler, json, currentUser, clearCookie } from '../../_lib/util.js';

export const onRequestPost = handler(async ({ request, env }) => {
  const user = await currentUser(env, request);
  if (user) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(user.sessionId).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
});
