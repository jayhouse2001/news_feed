// Serves the collected feed from KV. The file at /data/news.json stays in the
// deploy as a fallback, so a reader whose request lands before the first cron
// run — or during a KV hiccup — still sees news rather than an empty app.

const NEWS_KEY = 'news:latest';

export async function onRequestGet({ env, request }) {
  if (!env.NEWS) {
    return fallback(request, 'no-binding');
  }
  let body;
  try {
    body = await env.NEWS.get(NEWS_KEY);
  } catch (e) {
    console.error('KV read failed', e.message);
    return fallback(request, 'kv-error');
  }
  if (!body) return fallback(request, 'kv-empty');

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
async function fallback(request, why) {
  const url = new URL('/data/news.json', new URL(request.url).origin);
  const res = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!res.ok) {
    return new Response(JSON.stringify({ updatedAt: null, categories: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-News-Source': `file (${why})`,
    },
  });
}
