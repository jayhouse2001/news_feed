// The scheduled half of the app. Pages Functions answer requests but cannot
// hold a cron trigger, so everything periodic lives here: the news collection
// that used to run in GitHub Actions, and the per-issue tracker sweeps.
//
// Both are in one Worker because they share a cadence and a failure mode — if
// the edge cannot reach a feed, neither job can — and because splitting them
// would mean two deploys to keep in step.

import { collectNews } from '../shared/collect-news.js';
import { rowToTracker } from '../functions/_lib/tracker.js';
import { sweepTracker } from '../functions/_lib/sweep.js';

export const NEWS_KEY = 'news:latest';

// Every run leaves a record here, successful or not. A Worker that throws on a
// scheduled invocation is invisible otherwise: nothing writes, the app keeps
// serving its fallback, and the failure looks identical to a trigger that never
// fired. This is the only way to tell those two apart without log access.
export const STATUS_KEY = 'cron:last';

// Issues are swept oldest-sweep-first, so a run that hits the ceiling leaves
// the freshest for next time instead of starving the same tail every time.
const MAX_TRACKERS_PER_RUN = 40;

async function collectAndStore(env) {
  const started = Date.now();
  const { data, okCount, total } = await collectNews();
  const body = JSON.stringify(data);
  // KV, not D1: this is one blob read whole on every page load, which is what
  // KV is for. A row store would charge per row to answer the same question.
  await env.NEWS.put(NEWS_KEY, body, {
    metadata: { updatedAt: data.updatedAt, categories: okCount },
  });
  return {
    categories: `${okCount}/${total}`,
    items: data.categories.reduce((n, c) => n + c.items.length, 0),
    bytes: body.length,
    ms: Date.now() - started,
  };
}

// Sessions and login tokens are the only rows that expire on a clock, and
// nothing reads them once past.
async function purgeExpired(env) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ]);
}

async function sweepTrackers(env) {
  const started = Date.now();
  await purgeExpired(env);

  const { results } = await env.DB.prepare(
    `SELECT * FROM trackers
      WHERE status = 'active'
      ORDER BY COALESCE(swept_at, '') ASC
      LIMIT ?`
  ).bind(MAX_TRACKERS_PER_RUN).all();

  let added = 0;
  let failed = 0;
  for (const row of results) {
    try {
      const r = await sweepTracker(env, rowToTracker(row));
      added += r.added || 0;
    } catch (e) {
      failed++;
      console.error('sweep failed', row.id, e.message);
    }
  }
  return { trackers: results.length, added, failed, ms: Date.now() - started };
}

async function run(env, trigger) {
  // News is the job every reader depends on, so a tracker failure must not
  // take it down, or vice versa. They are reported together and settled apart.
  const [news, trackers] = await Promise.allSettled([
    collectAndStore(env),
    sweepTrackers(env),
  ]);
  const summary = {
    at: new Date().toISOString(),
    trigger: trigger || 'unknown',
    news: news.status === 'fulfilled' ? news.value : { error: news.reason.message },
    trackers: trackers.status === 'fulfilled' ? trackers.value
      : { error: trackers.reason.message },
  };
  console.log('cron', JSON.stringify(summary));
  // Written last and separately: if the news put failed, this still records why.
  if (env.NEWS) {
    try {
      await env.NEWS.put(STATUS_KEY, JSON.stringify(summary));
    } catch (e) {
      console.error('status write failed', e.message);
    }
  }
  return summary;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env, 'cron').catch(async (e) => {
      console.error('cron threw', e.message);
      if (env.NEWS) {
        await env.NEWS.put(STATUS_KEY, JSON.stringify({
          at: new Date().toISOString(), trigger: 'cron', fatal: e.message,
        })).catch(() => {});
      }
    }));
  },

  // The same work, reachable by hand for a first fill or a check. Guarded by a
  // secret: without one this would let anyone spend the Worker's request
  // budget and hammer the upstream feeds.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') return new Response('not found', { status: 404 });
    if (!env.CRON_SECRET || url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const only = url.searchParams.get('only');
    let summary;
    if (only === 'news') summary = { news: await collectAndStore(env) };
    else if (only === 'trackers') summary = { trackers: await sweepTrackers(env) };
    else summary = await run(env, 'manual');
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
