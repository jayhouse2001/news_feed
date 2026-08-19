import { handler, json, requireUser, readJson, newId, nowIso, HttpError } from '../../_lib/util.js';
import { rowToTracker, rowToEvent, validateTracker } from '../../_lib/tracker.js';

// The list view needs counts, not timelines. Pulling every event for every
// issue would send megabytes to render a few cards.
export const onRequestGet = handler(async ({ request, env }) => {
  const user = await requireUser(env, request);
  const { results } = await env.DB.prepare(
    `SELECT t.*,
            (SELECT COUNT(*) FROM events e WHERE e.tracker_id = t.id) AS n_events,
            (SELECT MIN(date) FROM events e WHERE e.tracker_id = t.id) AS first_date,
            (SELECT MAX(date) FROM events e WHERE e.tracker_id = t.id) AS last_date,
            (SELECT COUNT(*) FROM events e
              WHERE e.tracker_id = t.id AND e.is_note = 0
                AND e.added_at > COALESCE(t.seen_at, '')) AS n_new
       FROM trackers t
      WHERE t.user_id = ?
      ORDER BY t.updated_at DESC`
  ).bind(user.id).all();

  return json({
    trackers: results.map((r) => ({
      ...rowToTracker(r),
      counts: {
        events: r.n_events,
        unseen: r.n_new,
        firstDate: r.first_date,
        lastDate: r.last_date,
      },
    })),
  });
});

export const onRequestPost = handler(async ({ request, env }) => {
  const user = await requireUser(env, request);
  const body = await readJson(request);
  let t;
  try {
    t = validateTracker(body);
  } catch (e) {
    throw new HttpError(e.message, 400);
  }

  const id = newId();
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO trackers
       (id, user_id, name, kw_all, kw_any, query_kr, query_en, from_date,
        status, per_day, all_sources, sort_order, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, user.id, t.name, JSON.stringify(t.all), JSON.stringify(t.any),
         t.kr, t.en, t.from, t.status, t.perDay, t.allSources ? 1 : 0,
         t.order, ts, ts).run();

  // The article the issue was started from arrives with it, so the timeline is
  // never empty on creation even before the first sweep runs.
  const seed = body.seed;
  if (seed && seed.url && seed.title) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO events
         (tracker_id, date, title, source, url, coverage, is_manual, added_at)
       VALUES (?,?,?,?,?,?,1,?)`
    ).bind(id, seed.date || ts.slice(0, 10), String(seed.title).slice(0, 500),
           String(seed.source || '').slice(0, 120), String(seed.url),
           Number(seed.coverage) || 0, ts).run();
  }

  const row = await env.DB.prepare('SELECT * FROM trackers WHERE id = ?').bind(id).first();
  const { results } = await env.DB.prepare(
    'SELECT * FROM events WHERE tracker_id = ? ORDER BY date DESC'
  ).bind(id).all();
  return json({ tracker: rowToTracker(row, results.map(rowToEvent)) }, 201);
});
