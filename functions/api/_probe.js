// Narrowing "all categories failed": individual publisher feeds are reachable
// from the edge, so the suspect is fan-out. A Worker caps simultaneous outbound
// connections (6), and the collector opens 51 image feeds at once before any
// category runs, then 47 publisher feeds and 18 Google topics.
export async function onRequestGet({ request }) {
  const n = Number(new URL(request.url).searchParams.get('n') || 12);
  const UA = 'Mozilla/5.0 (compatible; news-feed-collector/1.0)';
  const feeds = [
    'https://www.yna.co.kr/rss/news.xml',
    'https://www.khan.co.kr/rss/rssdata/total_news.xml',
    'https://feeds.bbci.co.uk/news/world/rss.xml',
    'https://www.hani.co.kr/rss/',
    'https://rss.nocutnews.co.kr/nocutnews.xml',
    'https://www.mk.co.kr/rss/30000001/',
    'https://www.hankyung.com/feed/all-news',
    'https://www.sedaily.com/RSS/S1N1.xml',
    'https://www.newsis.com/RSS/politics.xml',
    'https://www.kmib.co.kr/rss/data/kmibRssAll.xml',
    'https://www.seoul.co.kr/xml/rss/rss_politics.xml',
    'https://www.segye.com/Articles/RSSList/segye_recent.xml',
  ];
  const targets = [];
  for (let i = 0; i < n; i++) targets.push(feeds[i % feeds.length]);

  const t0 = Date.now();
  const results = await Promise.all(targets.map(async (url, i) => {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.text();
      return { i, status: res.status, items: (body.match(/<item>/g) || []).length };
    } catch (e) {
      return { i, error: `${e.name}: ${e.message}` };
    }
  }));
  const failed = results.filter((r) => r.error);
  return new Response(JSON.stringify({
    requested: n,
    ms: Date.now() - t0,
    ok: results.length - failed.length,
    failed: failed.length,
    errors: [...new Set(failed.map((f) => f.error))].slice(0, 5),
  }, null, 2), { headers: { 'Content-Type': 'application/json' } });
}
