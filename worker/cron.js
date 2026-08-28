// The scheduled half of the app. Pages Functions answer requests but cannot
// hold a cron trigger, so everything periodic lives here: the news collection
// that used to run in GitHub Actions, and the per-issue tracker sweeps.
//
// Both are in one Worker because they share a cadence and a failure mode — if
// the edge cannot reach a feed, neither job can — and because splitting them
// would mean two deploys to keep in step.

import {
  collectSlice, imageRows, indexFromRows, findImage, SLICE_COUNT, CATEGORY_IDS,
} from '../shared/collect-news.js';
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

// Keep in step with the cron trigger in wrangler.toml.
const CRON_PERIOD_MS = 5 * 60 * 1000;

async function collectAndStore(env, sliceArg) {
  const started = Date.now();

  // A cron invocation picks its slice from the clock, so consecutive runs cover
  // every slice in turn without needing to remember where they left off. The
  // divisor must be the cron period: it was left at 30 minutes when the trigger
  // moved to 10, which made three runs in a row collect the same slice and left
  // a full cycle still taking 90 minutes while spending three times the requests.
  const slice = sliceArg != null ? sliceArg
    : Math.floor(Date.now() / CRON_PERIOD_MS) % SLICE_COUNT;

  const { categories, texts } = await collectSlice(slice);
  // The pictures, not the pages they came from — see imageRows.
  await env.NEWS.put(SLICE_KEY(slice), JSON.stringify({
    at: new Date().toISOString(), categories, images: imageRows(texts),
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

  // A slice written before this change stored the feed bodies instead of the rows
  // drawn from them. Those are simply skipped: within one cycle every slice is
  // rewritten in the new shape, and the only cost meanwhile is that a few pictures
  // are matched from a smaller pool.
  const pooled = parts.flatMap((p) => p.images || []);
  const imageIndex = indexFromRows(pooled);

  // Keyed by id, not appended. A stored slice was written by whatever code was
  // deployed at the time, so after the category list changes the slices on hand
  // disagree about which categories exist: merging them by concatenation shipped
  // 24 categories with six duplicated, the stale copy of each winning the screen
  // because it came first. The newest slice to carry a category wins.
  const byId = new Map();
  const freshness = new Map();
  for (const part of parts) {
    for (const cat of part.categories) {
      for (const it of cat.items || []) {
        if (!it.image) {
          const img = findImage(imageIndex, it.title);
          if (img) it.image = img;
        }
      }
      const prev = freshness.get(cat.id);
      if (prev === undefined || part.at > prev) {
        freshness.set(cat.id, part.at);
        byId.set(cat.id, cat);
      }
    }
  }

  // A category dropped from the code must not linger in KV forever, and the
  // reader shows them in this order.
  const merged = CATEGORY_IDS.map((id) => byId.get(id)).filter(Boolean);
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

    // Read-only, so no secret: it spends nothing and touches no upstream feed.
    // Checking whether collection is healthy should not require the key that also
    // lets the caller trigger a full run.
    if (url.pathname === '/status') {
      const [last, ...slices] = await Promise.all([
        env.NEWS.get(STATUS_KEY),
        ...Array.from({ length: SLICE_COUNT }, (_, i) => env.NEWS.get(SLICE_KEY(i))),
      ]);
      const published = await env.NEWS.get(NEWS_KEY);
      const feed = published ? JSON.parse(published) : null;
      const ids = feed ? feed.categories.map((c) => c.id) : [];
      return Response.json({
        lastRun: last ? JSON.parse(last) : null,
        cronEveryMinutes: CRON_PERIOD_MS / 60000,
        sliceCount: SLICE_COUNT,
        fullCycleMinutes: (CRON_PERIOD_MS / 60000) * SLICE_COUNT,
        slicesStored: slices.map((v, i) => (v ? { slice: i, at: JSON.parse(v).at } : { slice: i, at: null })),
        publishedAt: feed ? feed.updatedAt : null,
        categories: ids.length,
        duplicates: ids.length - new Set(ids).size,
        withImage: feed ? feed.categories.reduce((n, c) => n + c.items.filter((i) => i.image).length, 0) : 0,
        withVideo: feed ? feed.categories.reduce((n, c) => n + c.items.filter((i) => i.video).length, 0) : 0,
        perCategory: feed ? feed.categories.map((c) => ({
          id: c.id, items: c.items.length,
          image: c.items.filter((i) => i.image).length,
          video: c.items.filter((i) => i.video).length,
        })) : [],
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

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
