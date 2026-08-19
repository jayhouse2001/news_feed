// Server-side tracker collection from articles the news run already has.
//
// The sweep in sweep.js searches Google News for an issue's whole history, and
// that only works from a browser — Google answers 503 to Cloudflare egress. But
// keeping a timeline current does not need a search: the cron already downloads
// every publisher feed for the news feed itself, and a new article about a
// tracked issue is in there. Matching against those costs no extra requests,
// which matters because a Worker invocation may only make 50.
//
// So the two halves split by what they are for: history is searched from the
// device on demand, and today's news is matched on the server every half hour.

import { titleTokens, similar, DEDUP_SIM, rowToTracker, trackerMatches } from './tracker.js';

// Folds a batch of freshly collected articles into every active tracker.
// Articles arrive as the news collection's own items, so they carry the fields
// it produced — title, link, source, pubDate, coverage.
export async function matchArticles(env, articles) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM trackers WHERE status = 'active'`
  ).all();
  if (!results.length) return { trackers: 0, added: 0 };

  let added = 0;
  const perTracker = [];

  for (const row of results) {
    const tracker = rowToTracker(row);
    if (!tracker.all.length && !tracker.any.length) continue;

    const hits = articles.filter((a) => a.title && a.link
      && trackerMatches(tracker, a.title));
    if (!hits.length) continue;

    // What the timeline already holds, so a story is not added twice under a
    // second url. Same test as the browser: same day plus a near-identical
    // title, because the wires rewrite each other constantly.
    const [evRows, exRows] = await Promise.all([
      env.DB.prepare('SELECT date, title, url FROM events WHERE tracker_id = ?')
        .bind(tracker.id).all(),
      env.DB.prepare('SELECT url FROM excluded_urls WHERE tracker_id = ?')
        .bind(tracker.id).all(),
    ]);
    const seen = new Set(evRows.results.map((r) => r.url));
    for (const r of exRows.results) seen.add(r.url);

    const index = new Map();
    const perDayCount = new Map();
    for (const r of evRows.results) {
      if (!index.has(r.date)) index.set(r.date, []);
      index.get(r.date).push(titleTokens(r.title));
      perDayCount.set(r.date, (perDayCount.get(r.date) || 0) + 1);
    }

    const perDay = tracker.perDay || 8;
    const inserts = [];
    const ts = new Date().toISOString();

    for (const a of hits) {
      if (seen.has(a.link)) continue;
      const date = dayOfIso(a.pubDate);
      const tk = titleTokens(a.title);
      const dayIdx = index.get(date) || [];
      if ((perDayCount.get(date) || 0) >= perDay) continue;
      if (dayIdx.some((t) => similar(t, tk) >= DEDUP_SIM)) continue;
      seen.add(a.link);
      dayIdx.push(tk);
      index.set(date, dayIdx);
      perDayCount.set(date, (perDayCount.get(date) || 0) + 1);
      inserts.push({ date, title: a.title, source: a.source || '', url: a.link,
                     coverage: a.coverage || 0 });
    }

    if (inserts.length) {
      const stmt = env.DB.prepare(
        `INSERT OR IGNORE INTO events
           (tracker_id, date, title, source, url, coverage, added_at)
         VALUES (?,?,?,?,?,?,?)`
      );
      await env.DB.batch(inserts.map((c) => stmt.bind(
        tracker.id, c.date, c.title.slice(0, 500), c.source.slice(0, 120),
        c.url, c.coverage, ts)));
      added += inserts.length;
      perTracker.push({ name: tracker.name, added: inserts.length });
    }
  }

  return { trackers: results.length, added, detail: perTracker };
}

function dayOfIso(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
