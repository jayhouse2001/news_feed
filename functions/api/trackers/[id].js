import { handler, json, requireUser, readJson, nowIso, HttpError } from '../../_lib/util.js';
import { rowToTracker, rowToEvent, validateTracker } from '../../_lib/tracker.js';

// Every handler here loads the tracker by id AND user_id. Filtering on the
// owner in the query — not after fetching — is what stops one account reading
// another's issue by guessing a uuid.
async function owned(env, user, id) {
  const row = await env.DB.prepare(
    'SELECT * FROM trackers WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first();
  if (!row) throw new HttpError('이슈를 찾을 수 없습니다.', 404);
  return row;
}

export const onRequestGet = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  const row = await owned(env, user, params.id);
  const { results } = await env.DB.prepare(
    'SELECT * FROM events WHERE tracker_id = ? ORDER BY date DESC, id DESC'
  ).bind(params.id).all();
  return json({ tracker: rowToTracker(row, results.map(rowToEvent)) });
});

export const onRequestPatch = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  await owned(env, user, params.id);
  const body = await readJson(request);

  // A sort-order flip is a single-field write from the timeline; requiring the
  // whole tracker for it would make the UI resend keywords on every tap.
  if (Object.keys(body).length === 1 && (body.order === 'asc' || body.order === 'desc')) {
    await env.DB.prepare('UPDATE trackers SET sort_order = ?, updated_at = ? WHERE id = ?')
      .bind(body.order, nowIso(), params.id).run();
  } else if (Object.keys(body).length === 1 && body.seen === true) {
    await env.DB.prepare('UPDATE trackers SET seen_at = ? WHERE id = ?')
      .bind(nowIso(), params.id).run();
  } else {
    let t;
    try {
      t = validateTracker(body);
    } catch (e) {
      throw new HttpError(e.message, 400);
    }
    await env.DB.prepare(
      `UPDATE trackers SET name=?, kw_all=?, kw_any=?, query_kr=?, query_en=?,
              from_date=?, status=?, per_day=?, all_sources=?, sort_order=?, updated_at=?
        WHERE id = ?`
    ).bind(t.name, JSON.stringify(t.all), JSON.stringify(t.any), t.kr, t.en,
           t.from, t.status, t.perDay, t.allSources ? 1 : 0, t.order,
           nowIso(), params.id).run();
  }

  const row = await env.DB.prepare('SELECT * FROM trackers WHERE id = ?').bind(params.id).first();
  return json({ tracker: rowToTracker(row) });
});

export const onRequestDelete = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  await owned(env, user, params.id);
  // events and excluded_urls carry ON DELETE CASCADE
  await env.DB.prepare('DELETE FROM trackers WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
});
