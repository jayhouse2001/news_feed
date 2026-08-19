// Shared tracker logic. The browser has its own copy of the dedup rule in
// site/js/app.js; this is the server's, applied to what a sweep collects.

export function titleTokens(title) {
  return new Set(
    String(title).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/).filter((w) => w.length >= 2)
  );
}

export function similar(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export const DEDUP_SIM = 0.6;

export function dayOf(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

// Rows come out of D1 with column names; the app speaks the shape it always
// has, so the translation lives here rather than in every handler.
export function rowToTracker(r, events = []) {
  return {
    id: r.id,
    name: r.name,
    all: safeParse(r.kw_all, []),
    any: safeParse(r.kw_any, []),
    kr: r.query_kr || '',
    en: r.query_en || '',
    from: r.from_date || null,
    status: r.status,
    perDay: r.per_day,
    allSources: !!r.all_sources,
    order: r.sort_order,
    seenAt: r.seen_at || null,
    backfilledFrom: r.swept_from || null,
    backfilledTo: r.swept_to || null,
    backfilledAt: r.swept_at || null,
    events,
  };
}

export function rowToEvent(r) {
  return {
    date: r.date,
    title: r.title,
    source: r.source || '',
    url: r.url,
    coverage: r.coverage || 0,
    note: !!r.is_note,
    manual: !!r.is_manual,
    addedAt: r.added_at,
  };
}

function safeParse(s, fallback) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

// Rejects a tracker the app should never have sent. Returning a cleaned object
// rather than the input means a handler cannot forget to sanitise a field.
export function validateTracker(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('이슈 이름이 필요합니다.');
  if (name.length > 120) throw new Error('이슈 이름이 너무 깁니다.');

  const words = (v) => (Array.isArray(v) ? v : [])
    .map((w) => String(w).trim()).filter(Boolean).slice(0, 20);
  const all = words(body.all);
  const any = words(body.any);

  const status = body.status === 'closed' ? 'closed' : 'active';
  const order = body.order === 'asc' ? 'asc' : 'desc';
  const perDay = Math.min(50, Math.max(1, Number(body.perDay) || 8));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(body.from || '') ? body.from : monthsAgo(6);

  return {
    name,
    all,
    any,
    kr: String(body.kr || '').trim().slice(0, 200),
    en: String(body.en || '').trim().slice(0, 200),
    from,
    status,
    perDay,
    allSources: !!body.allSources,
    order,
  };
}

export function trackerMatches(tracker, title) {
  const t = String(title).toLowerCase();
  const all = (tracker.all || []).map((w) => w.toLowerCase());
  const any = (tracker.any || []).map((w) => w.toLowerCase());
  if (all.length && !all.every((w) => t.includes(w))) return false;
  if (any.length && !any.some((w) => t.includes(w))) return false;
  return all.length > 0 || any.length > 0;
}

export function searchQuery(tracker) {
  return (tracker.kr
    || (tracker.any.length ? tracker.any.join(' OR ') : tracker.all.join(' '))
    || '').trim();
}
