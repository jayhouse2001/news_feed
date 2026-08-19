import { handler, json, requireUser, HttpError } from '../../../_lib/util.js';

// Searching an issue's history means asking Google News, and Google answers 503
// to Cloudflare egress — every relay refuses it from here too. So the server
// cannot do this, and saying so is better than returning an empty sweep that
// looks like "no articles found".
//
// The browser can reach Google, so the client runs the search itself and posts
// what it finds. Keeping timelines current is separate and does happen here:
// the cron matches new articles against every issue on each collection.
export const onRequestPost = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  const row = await env.DB.prepare(
    'SELECT id FROM trackers WHERE id = ? AND user_id = ?'
  ).bind(params.id, user.id).first();
  if (!row) throw new HttpError('이슈를 찾을 수 없습니다.', 404);

  return json({
    result: {
      clientSweep: true,
      reason: 'google-blocked-from-edge',
    },
  });
});
