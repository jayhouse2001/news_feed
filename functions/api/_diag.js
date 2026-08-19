// Temporary: Google answers 503 "Sorry..." from the edge while the same URL
// works from a desktop. Tries several shapes to tell a header problem from an
// IP-reputation block, and checks whether other feed hosts are reachable.
export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams.get('q') || '이란';
  const gnews = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;

  const browserUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    + ' (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  const cases = [
    ['google: no headers', gnews, {}],
    ['google: browser UA', gnews, { 'User-Agent': browserUA }],
    ['google: UA + lang', gnews, {
      'User-Agent': browserUA,
      'Accept': 'application/rss+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    }],
    ['google: top stories', 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko',
      { 'User-Agent': browserUA }],
    // A publisher feed is the obvious fallback if Google stays shut
    ['yonhap rss', 'https://www.yna.co.kr/rss/news.xml', { 'User-Agent': browserUA }],
    ['bing news rss', `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=RSS`,
      { 'User-Agent': browserUA }],
  ];

  const out = [];
  for (const [label, url, headers] of cases) {
    try {
      const res = await fetch(url, { headers });
      const body = await res.text();
      out.push({
        label, status: res.status, bytes: body.length,
        items: (body.match(/<item>/g) || []).length,
      });
    } catch (e) {
      out.push({ label, error: e.message });
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
