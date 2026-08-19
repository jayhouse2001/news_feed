import { handler, json, requireUser, readJson, nowIso, HttpError } from '../../../_lib/util.js';
import { rowToEvent } from '../../../_lib/tracker.js';

async function owned(env, user, id) {
  const row = await env.DB.prepare(
    'SELECT id FROM trackers WHERE id = ? AND user_id = ?'
  ).bind(id, user.id).first();
  if (!row) throw new HttpError('이슈를 찾을 수 없습니다.', 404);
  return row;
}

// Adding by hand: a pinned article or a written note. Unlike a sweep, this
// skips the title-similarity check — the user chose this specific entry, so
// the automatic rule does not get to overrule them.
export const onRequestPost = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  await owned(env, user, params.id);
  const b = await readJson(request);

  const title = String(b.title || '').trim();
  if (!title) throw new HttpError('내용이 필요합니다.', 400);
  const isNote = !b.url;
  const url = b.url ? String(b.url) : `note:${crypto.randomUUID()}`;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : nowIso().slice(0, 10);

  // pinning by hand overrides an earlier removal
  await env.DB.prepare('DELETE FROM excluded_urls WHERE tracker_id = ? AND url = ?')
    .bind(params.id, url).run();

  await env.DB.prepare(
    `INSERT INTO events (tracker_id, date, title, source, url, coverage, is_note, is_manual, added_at)
     VALUES (?,?,?,?,?,?,?,1,?)
     ON CONFLICT(tracker_id, url) DO UPDATE SET
       date = excluded.date, title = excluded.title, source = excluded.source`
  ).bind(params.id, date, title.slice(0, 500), String(b.source || '').slice(0, 120),
         url, Number(b.coverage) || 0, isNote ? 1 : 0, nowIso()).run();

  const row = await env.DB.prepare(
    'SELECT * FROM events WHERE tracker_id = ? AND url = ?'
  ).bind(params.id, url).first();
  return json({ event: rowToEvent(row) }, 201);
});

// Removal records the url so the next sweep does not bring it straight back.
export const onRequestDelete = handler(async ({ request, env, params }) => {
  const user = await requireUser(env, request);
  await owned(env, user, params.id);
  const b = await readJson(request);
  const url = String(b.url || '');
  if (!url) throw new HttpError('url 이 필요합니다.', 400);

  await env.DB.prepare('DELETE FROM events WHERE tracker_id = ? AND url = ?')
    .bind(params.id, url).run();
  if (!url.startsWith('note:')) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO excluded_urls (tracker_id, url, reason) VALUES (?,?,'dropped')`
    ).bind(params.id, url).run();
  }
  return json({ ok: true });
});
