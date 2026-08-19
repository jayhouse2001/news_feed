// Serves the collected feed from KV. The file at /data/news.json stays in the
// deploy as a fallback, so a reader whose request lands before the first cron
// run — or during a KV hiccup — still sees news rather than an empty app.

const NEWS_KEY = 'news:latest';
const STATUS_KEY = 'cron:last';

export async function onRequestGet({ env, request }) {
  if (!env.NEWS) {
    return fallback(request, 'no-binding');
  }
  let body;
  try {
    body = await env.NEWS.get(NEWS_KEY);
  } catch (e) {
    console.error('KV read failed', e.message);
    return fallback(request, 'kv-error', env);
  }
  if (!body) return fallback(request, 'kv-empty', env);

  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // The cron writes every 30 minutes; caching for 5 keeps repeat opens off
      // KV without letting the feed go visibly stale.
      'Cache-Control': 'public, max-age=300',
      'X-News-Source': 'kv',
    },
  });
}

// Reads the deployed file over the same origin rather than importing it, so this
// stays a Function and not a bundle carrying a megabyte of news. The reason is
// reported in a header, which is why it is ascii — header values are Latin-1,
// and a Korean one throws when the Response is constructed.
async function fallback(request, why, env) {
  const url = new URL('/data/news.json', new URL(request.url).origin);
  const res = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!res.ok) {
    return new Response(JSON.stringify({ updatedAt: null, categories: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'X-News-Source': `file (${why})`,
  };
  // An empty KV means the cron has not written yet — either it never ran or it
  // failed. The Worker records both, so say which rather than leaving the two
  // indistinguishable. Ascii and truncated: header values are Latin-1.
  if (env && env.NEWS) {
    try {
      const last = await env.NEWS.get(STATUS_KEY);
      headers['X-Cron-Last'] = last
        ? last.replace(/[^ -~]/g, '?').slice(0, 500)
        : 'never-ran';
    } catch {
      // a status read failure is not worth failing the response over
    }
  }
  return new Response(res.body, { headers });
}
