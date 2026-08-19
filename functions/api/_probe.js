// Temporary: the cron reports "all categories failed" while the same collector
// succeeds from a desktop in 2.5s. This reports what the edge can actually
// reach, per source type, so the failure can be attributed rather than guessed.
export async function onRequestGet() {
  const UA = 'Mozilla/5.0 (compatible; news-feed-collector/1.0)';
  const targets = [
    ['google topic', 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=ko&gl=KR&ceid=KR:ko'],
    ['yna (publisher)', 'https://www.yna.co.kr/rss/news.xml'],
    ['ytn (publisher)', 'https://www.ytn.co.kr/nmb/rss/ytn_news.xml'],
    ['khan (publisher)', 'https://www.khan.co.kr/rss/rssdata/total_news.xml'],
    ['bbc (publisher)', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ];
  const out = [];
  for (const [label, url] of targets) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      const body = await res.text();
      out.push({ label, status: res.status, ms: Date.now() - t0,
                 bytes: body.length, items: (body.match(/<item>/g) || []).length });
    } catch (e) {
      out.push({ label, error: `${e.name}: ${e.message}`, ms: Date.now() - t0 });
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
