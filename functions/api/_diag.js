// Google blocks Cloudflare egress IPs (503 "Sorry..." regardless of headers).
// The browser already reaches it through public CORS relays, so the question
// is whether those relays work from the edge too.
export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams.get('q') || '이란';
  const target = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}`
    + '&hl=ko&gl=KR&ceid=KR:ko';

  const relays = [
    ['allorigins raw', (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`],
    ['allorigins get', (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`],
    ['codetabs',       (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`],
    ['corsproxy',      (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`],
    ['r.jina.ai',      (u) => `https://r.jina.ai/${u}`],
  ];

  const out = [];
  for (const [label, mk] of relays) {
    const t0 = Date.now();
    try {
      const res = await fetch(mk(target), { signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      out.push({
        label, status: res.status, ms: Date.now() - t0,
        bytes: body.length,
        items: (body.match(/<item>/g) || []).length,
      });
    } catch (e) {
      out.push({ label, error: e.name || e.message, ms: Date.now() - t0 });
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
