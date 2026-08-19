import { handler, json, requireUser, HttpError } from '../../../_lib/util.js';
import { rowToTracker } from '../../../_lib/tracker.js';
import { sweepTracker } from '../../../_lib/sweep.js';

// The manual "update now" button. The cron keeps every issue current on its
// own, so this exists for the moment right after an issue is created, when
// waiting up to half an hour for a first timeline would feel broken.
export const onRequestPost = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  const row = await env.DB.prepare(
    'SELECT * FROM trackers WHERE id = ? AND user_id = ?'
  ).bind(params.id, user.id).first();
  if (!row) throw new HttpError('이슈를 찾을 수 없습니다.', 404);

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  const result = await sweepTracker(env, rowToTracker(row), { force });
  return json({ result });
});
