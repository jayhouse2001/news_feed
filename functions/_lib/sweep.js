// Server-side collection. This is the browser's runBackfill() moved behind the
// API: same Google News source, same daily cap and title dedup, but without a
// CORS relay in the way — a Worker can call news.google.com directly, which is
// the single biggest reason to run this here rather than on the device.

import { titleTokens, similar, DEDUP_SIM, dayOf, trackerMatches, searchQuery,
         isBlockedSource } from './tracker.js';

const GNEWS_MAX = 100;

// Wires and broadcast first: they file the story, the rest rewrite it. A day's
// cap is filled in this order so the original survives and the rewrites drop.
const MAJOR_DOMAINS = [
  'yna.co.kr', 'yonhapnews.co.kr', 'ytn.co.kr', 'news.kbs.co.kr', 'imnews.imbc.com',
  'news.sbs.co.kr', 'news1.kr', 'newsis.com', 'nocutnews.co.kr',
  'hani.co.kr', 'khan.co.kr', 'hankookilbo.com', 'seoul.co.kr', 'segye.com',
  'munhwa.com', 'kmib.co.kr', 'pressian.com', 'ohmynews.com',
  'mk.co.kr', 'hankyung.com', 'edaily.co.kr', 'sedaily.com', 'asiae.co.kr',
];

const MAJOR_NAMES = [
  '연합뉴스', '연합뉴스TV', 'YTN', 'KBS', 'KBS 뉴스', 'MBC', 'MBC 뉴스', 'SBS', 'SBS 뉴스',
  '뉴스1', '뉴시스', 'CBS 노컷뉴스', '노컷뉴스', 'BBC News 코리아',
  '한겨레', '경향신문', '한국일보', '서울신문', '세계일보', '문화일보',
  '국민일보', '프레시안', '오마이뉴스',
  '매일경제', '한국경제', '이데일리', '서울경제', '아시아경제',
];

function isMajor(source) {
  if (!source) return false;
  const s = source.trim();
  if (MAJOR_NAMES.some((n) => s === n || s.startsWith(n))) return true;
  const d = s.toLowerCase().replace(/^(www|m|news|biz)\./, '');
  return MAJOR_DOMAINS.some((x) => {
    const base = x.replace(/^(www|m|news|biz)\./, '');
    return d === base || d.endsWith(`.${base}`) || s.toLowerCase() === x;
  });
}

function rank(source) {
  const d = (source || '').toLowerCase();
  const i = MAJOR_DOMAINS.findIndex((x) => d === x || d.endsWith(`.${x}`));
  if (i >= 0) return i;
  const j = MAJOR_NAMES.findIndex((n) => (source || '').startsWith(n));
  return j >= 0 ? j : MAJOR_DOMAINS.length + MAJOR_NAMES.length;
}

function gnewsUrl(query, from, to) {
  const q = `${query} after:${from} before:${to}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!t) return '';
      const cdata = t[1].trim().match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      return decodeEntities((cdata ? cdata[1] : t[1]).trim());
    };
    let title = pick('title');
    const link = pick('link');
    const pubDate = pick('pubDate');
    const srcM = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const source = srcM ? decodeEntities(srcM[1].trim()) : '';
    // Google appends " - <source>" to every headline
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    if (title && link) out.push({ title, link, source, pubDate });
  }
  return out;
}

async function fetchWindow(query, from, to) {
  const res = await fetch(gnewsUrl(query, from, to), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; news-feeder/1.0)' },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`google news ${res.status}`);
  return parseRss(await res.text());
}

function addMonths(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function midpoint(a, b) {
  const t = Date.parse(`${a}T00:00:00Z`)
    + (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 2;
  return new Date(t).toISOString().slice(0, 10);
}

function dayGap(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

// A cron invocation covers many issues, so one runaway sweep must not starve
// the rest. Requests are capped per tracker rather than per run.
const MAX_REQUESTS = 24;

// A busy keyword fills every window Google is asked for, so splitting on a
// full response alone recurses to single days and spends the whole request
// budget on one week. Measured on a live sweep: 24 requests over 20 days
// returned 60 keepers and 419 discards. Below this width the daily cap throws
// away most of what another split would buy, so the split stops paying for
// itself and the window is taken as-is.
const MIN_SPLIT_DAYS = 4;

export async function sweepTracker(env, tracker, { force = false } = {}) {
  const query = searchQuery(tracker);
  if (!query) return { added: 0, requests: 0, skipped: 'no-query' };

  const today = dayOf(null);
  const from = tracker.from || addMonths(today, -6);

  // Only the uncovered span. Moving the start date earlier exposes an older
  // window in front; everything between is already on the timeline.
  const spans = [];
  const done = force ? null : tracker.backfilledFrom;
  if (done && done > from) {
    spans.push([from, done]);
    spans.push([tracker.backfilledTo || done, today]);
  } else if (done && !force) {
    spans.push([tracker.backfilledTo || done, today]);
  } else {
    spans.push([from, today]);
  }

  const queue = [];
  for (const [a, b] of spans) {
    if (!a || !b || a >= b) continue;
    let cur = a;
    while (cur < b) {
      const next = addMonths(cur, 1);
      queue.push([cur, next > b ? b : next]);
      cur = next;
    }
  }
  if (!queue.length) return { added: 0, requests: 0, upToDate: true };

  const [exRows, evRows] = await Promise.all([
    env.DB.prepare('SELECT url FROM excluded_urls WHERE tracker_id = ?').bind(tracker.id).all(),
    env.DB.prepare('SELECT date, title, url FROM events WHERE tracker_id = ?').bind(tracker.id).all(),
  ]);
  const seen = new Set(evRows.results.map((r) => r.url));
  for (const r of exRows.results) seen.add(r.url);

  // Seeded with the timeline as it stands: without this a sweep re-adds a
  // story the live feed already collected under a different url.
  const index = new Map();
  const perDayCount = new Map();
  for (const r of evRows.results) {
    if (!index.has(r.date)) index.set(r.date, []);
    index.get(r.date).push(titleTokens(r.title));
    perDayCount.set(r.date, (perDayCount.get(r.date) || 0) + 1);
  }

  const candidates = [];
  let requests = 0;
  let truncated = 0;
  let failed = 0;

  while (queue.length && requests < MAX_REQUESTS) {
    const [ws, we] = queue.shift();
    requests++;
    let arts;
    try {
      arts = await fetchWindow(query, ws, we);
    } catch {
      failed++;
      continue;
    }

    // A full response means the window's older half was cut off; split it,
    // but only while the halves are still wide enough to be worth a request.
    if (arts.length >= GNEWS_MAX && dayGap(ws, we) > MIN_SPLIT_DAYS) {
      const mid = midpoint(ws, we);
      queue.unshift([ws, mid], [mid, we]);
      continue;
    }
    if (arts.length >= GNEWS_MAX) truncated++;

    for (const a of arts) {
      if (!a.link || seen.has(a.link)) continue;
      const title = a.title.trim();
      if (!title) continue;
      if ((tracker.all.length || tracker.any.length) && !trackerMatches(tracker, title)) continue;
      if (isBlockedSource(a.source)) continue;
      if (!tracker.allSources && !isMajor(a.source)) continue;
      seen.add(a.link);
      candidates.push({
        date: dayOf(a.pubDate ? new Date(a.pubDate).toISOString() : null),
        title,
        source: a.source || '',
        url: a.link,
      });
    }
  }

  // Keep the top few per day, counting what the day already holds.
  const byDay = new Map();
  for (const c of candidates) {
    if (!byDay.has(c.date)) byDay.set(c.date, []);
    byDay.get(c.date).push(c);
  }

  const perDay = tracker.perDay || 2;
  const inserts = [];
  const capped = [];
  const ts = new Date().toISOString();

  for (const [day, list] of byDay) {
    list.sort((a, b) => rank(a.source) - rank(b.source));
    let n = perDayCount.get(day) || 0;
    const dayIdx = index.get(day) || [];
    for (const c of list) {
      const tk = titleTokens(c.title);
      if (n >= perDay || dayIdx.some((t) => similar(t, tk) >= DEDUP_SIM)) {
        capped.push(c.url);
        continue;
      }
      dayIdx.push(tk);
      index.set(day, dayIdx);
      n++;
      inserts.push(c);
    }
  }

  if (inserts.length) {
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO events
         (tracker_id, date, title, source, url, coverage, added_at)
       VALUES (?,?,?,?,?,0,?)`
    );
    await env.DB.batch(inserts.map((c) =>
      stmt.bind(tracker.id, c.date, c.title.slice(0, 500), c.source.slice(0, 120), c.url, ts)));
  }
  if (capped.length) {
    const stmt = env.DB.prepare(
      `INSERT OR IGNORE INTO excluded_urls (tracker_id, url, reason) VALUES (?,?,'capped')`
    );
    await env.DB.batch(capped.map((u) => stmt.bind(tracker.id, u)));
  }

  // The covered range only advances when the queue actually drained; stopping
  // at MAX_REQUESTS leaves the rest for the next run.
  const complete = queue.length === 0;
  const sweptFrom = tracker.backfilledFrom && !force
    ? (from < tracker.backfilledFrom ? from : tracker.backfilledFrom)
    : from;
  await env.DB.prepare(
    'UPDATE trackers SET swept_from = ?, swept_to = ?, swept_at = ? WHERE id = ?'
  ).bind(sweptFrom, complete ? today : (tracker.backfilledTo || from), ts, tracker.id).run();

  return {
    added: inserts.length,
    capped: capped.length,
    requests,
    truncated,
    failed,
    complete,
  };
}
