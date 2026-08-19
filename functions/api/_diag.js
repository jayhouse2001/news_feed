// Temporary: reports what Google News answers from the edge, so a sweep that
// reports `failed` can be told apart from one that simply found nothing.
export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '이란';
  const target = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const out = { target };
  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; news-feeder/1.0)' },
    });
    out.status = res.status;
    out.type = res.headers.get('content-type');
    const body = await res.text();
    out.bytes = body.length;
    out.items = (body.match(/<item>/g) || []).length;
    out.head = body.slice(0, 220);
  } catch (e) {
    out.error = e.message;
    out.name = e.name;
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
