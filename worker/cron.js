// The scheduled half of the app. Pages Functions answer requests but cannot
// hold a cron trigger, so everything periodic lives here: the news collection
// that used to run in GitHub Actions, and the per-issue tracker sweeps.
//
// Both are in one Worker because they share a cadence and a failure mode — if
// the edge cannot reach a feed, neither job can — and because splitting them
// would mean two deploys to keep in step.

import { collectSlice, buildImageIndex, findImage, SLICE_COUNT } from '../shared/collect-news.js';
import { matchArticles } from '../functions/_lib/match.js';

export const NEWS_KEY = 'news:latest';

// Every run leaves a record here, successful or not. A Worker that throws on a
// scheduled invocation is invisible otherwise: nothing writes, the app keeps
// serving its fallback, and the failure looks identical to a trigger that never
// fired. This is the only way to tell those two apart without log access.
export const STATUS_KEY = 'cron:last';

// Each slice is its own invocation, because the 50-subrequest ceiling is per
// invocation and a whole collection wants about 69. The finished slices are
// held in KV until the last one lands, then merged and published together —
// publishing each slice as it arrives would leave the app showing half a feed.
const SLICE_KEY = (i) => `news:slice:${i}`;

async function collectAndStore(env, sliceArg) {
  const started = Date.now();

  // A cron invocation picks its slice from the clock, so consecutive runs cover
  // every slice in turn without needing to remember where they left off.
  const slice = sliceArg != null ? sliceArg
    : Math.floor(Date.now() / (30 * 60 * 1000)) % SLICE_COUNT;

  const { categories, texts } = await collectSlice(slice);
  await env.NEWS.put(SLICE_KEY(slice), JSON.stringify({
    at: new Date().toISOString(), categories, texts,
  }));

  // Merge whatever slices are on hand. A missing one keeps its previous
  // categories rather than blanking them.
  const stored = await Promise.all(
    Array.from({ length: SLICE_COUNT }, (_, i) => env.NEWS.get(SLICE_KEY(i)))
  );
  const parts = stored.map((v) => (v ? JSON.parse(v) : null));
  const have = parts.filter(Boolean).length;
  if (have < SLICE_COUNT) {
    return { slice, sliceOnly: true, have, of: SLICE_COUNT, ms: Date.now() - started };
  }

  const pooled = parts.flatMap((p) => p.texts);
  const imageIndex = buildImageIndex(pooled);
  const merged = [];
  for (const part of parts) {
    for (const cat of part.categories) {
      for (const it of cat.items || []) {
        if (!it.image) {
          const img = findImage(imageIndex, it.title);
          if (img) it.image = img;
        }
      }
      merged.push(cat);
    }
  }
  const okCount = merged.filter((c) => !c.error).length;
  if (okCount === 0) throw new Error('all categories failed');

  // Trackers are matched against what was just collected. This is the whole
  // reason it happens here: the articles are already in memory, so keeping
  // timelines current costs no requests at all.
  let matched = null;
  try {
    matched = await matchArticles(env, merged.flatMap((c) => c.items || []));
  } catch (e) {
    console.error('match failed', e.message);
    matched = { error: e.message };
  }
  const data = { updatedAt: new Date().toISOString(), categories: merged };
  const total = merged.length;
  const body = JSON.stringify(data);
  // KV, not D1: this is one blob read whole on every page load, which is what
  // KV is for. A row store would charge per row to answer the same question.
  await env.NEWS.put(NEWS_KEY, body, {
    metadata: { updatedAt: data.updatedAt, categories: okCount },
  });
  return {
    slice,
    matched,
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

// Tracker collection itself now rides along with the news run, so all that is
// left on its own schedule is expiry. Google cannot be searched from here at
// all (503 to Cloudflare egress), which is why history stays a browser job.
async function maintain(env) {
  const started = Date.now();
  await purgeExpired(env);
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS c FROM trackers WHERE status = 'active'`
  ).first();
  return { active: n ? n.c : 0, ms: Date.now() - started };
}

async function run(env, trigger, slice) {
  // News is the job every reader depends on, so a tracker failure must not
  // take it down, or vice versa. They are reported together and settled apart.
  const [news, trackers] = await Promise.allSettled([
    collectAndStore(env, slice),
    maintain(env),
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
    const sliceParam = url.searchParams.get('slice');
    let summary;
    if (only === 'news') {
      summary = { news: await collectAndStore(env, sliceParam != null ? Number(sliceParam) : null) };
    }
    else if (only === 'trackers') summary = { trackers: await maintain(env) };
    else summary = await run(env, 'manual', sliceParam != null ? Number(sliceParam) : null);
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
