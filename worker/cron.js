// The scheduled half of the app. Pages Functions answer requests but cannot
// hold a cron trigger, so collection lives in this Worker; it binds the same
// D1 database the API writes to.

import { rowToTracker } from '../functions/_lib/tracker.js';
import { sweepTracker } from '../functions/_lib/sweep.js';

// Issues are swept oldest-first by last sweep time, so a run that hits the
// ceiling leaves the freshest ones for next time rather than always starving
// the same tail of the list.
const MAX_TRACKERS_PER_RUN = 40;

// Sessions and login tokens are the only rows that expire on a clock; nothing
// reads them once past, and D1's free tier is measured in rows.
async function purgeExpired(env) {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_tokens WHERE expires_at <= ?').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
  ]);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },

  // Same work, reachable by hand. Guarded by a secret so the endpoint cannot
  // be used to burn through the Google News rate limit from outside.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/run') return new Response('not found', { status: 404 });
    if (!env.CRON_SECRET || url.searchParams.get('key') !== env.CRON_SECRET) {
      return new Response('forbidden', { status: 403 });
    }
    const summary = await run(env);
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function run(env) {
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
  const details = [];

  for (const row of results) {
    try {
      const r = await sweepTracker(env, rowToTracker(row));
      added += r.added || 0;
      details.push({ id: row.id, name: row.name, ...r });
    } catch (e) {
      failed++;
      console.error('sweep failed', row.id, e.message);
      details.push({ id: row.id, name: row.name, error: e.message });
    }
  }

  const summary = {
    trackers: results.length,
    added,
    failed,
    ms: Date.now() - started,
  };
  console.log('cron', JSON.stringify(summary));
  return { ...summary, details };
}
