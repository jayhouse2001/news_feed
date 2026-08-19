// Collect publisher and Google News feeds, normalize items, score importance.
// Runtime-neutral: only fetch and string handling, so the same code runs under
// Node (scripts/fetch-news.mjs) and inside a Cloudflare Worker. Nothing here
// touches a filesystem — the caller decides where the result is stored.

const EDITION = 'hl=ko&gl=KR&ceid=KR:ko';
const TOPIC = (t) => `https://news.google.com/rss/headlines/section/topic/${t}?${EDITION}`;

const US_EDITION = 'hl=en-US&gl=US&ceid=US:en';
const US_TOPIC = (t) => `https://news.google.com/rss/headlines/section/topic/${t}?${US_EDITION}`;

const CATEGORIES = [
  { id: 'top', name: '주요', url: `https://news.google.com/rss?${EDITION}` },
  { id: 'politics', name: '정치', url: `https://news.google.com/rss/search?q=${encodeURIComponent('정치 when:1d')}&${EDITION}` },
  { id: 'business', name: '경제', url: TOPIC('BUSINESS') },
  { id: 'tech', name: 'IT', url: TOPIC('TECHNOLOGY') },
  { id: 'science', name: '과학', url: TOPIC('SCIENCE') },
  { id: 'world', name: '세계', url: TOPIC('WORLD') },
  { id: 'nation', name: '사회', url: TOPIC('NATION') },
  { id: 'sports', name: '스포츠', url: TOPIC('SPORTS') },
  { id: 'entertainment', name: '연예', url: TOPIC('ENTERTAINMENT') },
  { id: 'health', name: '건강', url: TOPIC('HEALTH') },
  // foreign feeds (US edition); titles get translated client-side
  { id: 'intl', name: '해외', url: `https://news.google.com/rss?${US_EDITION}`, lang: 'en' },
  { id: 'intl_world', name: '해외 세계', url: US_TOPIC('WORLD'), lang: 'en' },
  { id: 'intl_business', name: '해외 경제', url: US_TOPIC('BUSINESS'), lang: 'en' },
  { id: 'intl_tech', name: '해외 IT', url: US_TOPIC('TECHNOLOGY'), lang: 'en' },
  { id: 'intl_science', name: '해외 과학', url: US_TOPIC('SCIENCE'), lang: 'en' },
  { id: 'intl_health', name: '해외 건강', url: US_TOPIC('HEALTH'), lang: 'en' },
  { id: 'intl_sports', name: '해외 스포츠', url: US_TOPIC('SPORTS'), lang: 'en' },
  { id: 'intl_ent', name: '해외 연예', url: US_TOPIC('ENTERTAINMENT'), lang: 'en' },
];

// Google's feed carries no images and its links never resolve to the
// publisher, so a thumbnail can only come from a publisher's own RSS. These
// feeds are fetched alongside and matched to the headlines by title.
// Measured 2026-08-09: ~1300 images collected, covering ~13% of the feed —
// most outlets Google aggregates simply do not publish one.
// Feeds carried only for their pictures. Every other publisher feed is already
// fetched for its articles and indexed from the same response — fetching all of
// them twice is what pushed a run past the Workers subrequest ceiling.
const IMAGE_ONLY_FEEDS = [
  'https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER',
  'https://www.mk.co.kr/rss/50200011/',
  'https://abcnews.go.com/abcnews/internationalheadlines',
  'https://feeds.nbcnews.com/nbcnews/public/world',
];

const IMAGE_MATCH_THRESHOLD = 0.55;

// Publisher feeds are also read as article sources, not just as a picture
// bank: they carry a thumbnail on nearly every item and link straight to the
// publisher instead of through Google's redirect. Google's aggregate is kept
// on top of them for the breadth it brings — roughly three hundred outlets
// against the two dozen that publish a usable feed.
const PUBLISHER_SOURCES = [
  { cat: 'top', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/news.xml' },
  { cat: 'top', name: 'SBS', url: 'https://news.sbs.co.kr/news/headlineRssFeed.do?plink=RSSREADER' },
  { cat: 'top', name: '동아일보', url: 'https://rss.donga.com/total.xml' },
  { cat: 'politics', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/politics.xml' },
  { cat: 'politics', name: 'SBS', url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01&plink=RSSREADER' },
  { cat: 'business', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/economy.xml' },
  { cat: 'business', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/industry.xml' },
  { cat: 'business', name: 'SBS', url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02&plink=RSSREADER' },
  { cat: 'business', name: '아시아경제', url: 'https://www.asiae.co.kr/rss/all.htm' },
  { cat: 'business', name: '매일경제', url: 'https://www.mk.co.kr/rss/30000001/' },
  { cat: 'nation', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/society.xml' },
  { cat: 'nation', name: 'SBS', url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03&plink=RSSREADER' },
  { cat: 'world', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/international.xml' },
  { cat: 'world', name: 'SBS', url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=08&plink=RSSREADER' },
  { cat: 'sports', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/sports.xml' },
  { cat: 'entertainment', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/culture.xml' },
  { cat: 'health', name: '연합뉴스', url: 'https://www.yna.co.kr/rss/health.xml' },
  { cat: 'health', name: '뉴시스', url: 'https://newsis.com/RSS/health.xml' },
  { cat: 'tech', name: '매일경제', url: 'https://www.mk.co.kr/rss/50100032/' },
  // No Korean science outlet publishes an image in its feed, so 과학 keeps
  // running on the aggregate alone.
  // foreign categories; titles are translated client-side
  { cat: 'intl', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { cat: 'intl', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  { cat: 'intl', name: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
  { cat: 'intl_world', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { cat: 'intl_world', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss' },
  { cat: 'intl_world', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  { cat: 'intl_world', name: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml' },
  { cat: 'intl_world', name: 'The Independent', url: 'https://www.independent.co.uk/news/world/rss' },
  { cat: 'intl_business', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  { cat: 'intl_business', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml' },
  { cat: 'intl_tech', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { cat: 'intl_tech', name: 'The Guardian', url: 'https://www.theguardian.com/uk/technology/rss' },
  { cat: 'intl_tech', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml' },
  { cat: 'intl_tech', name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { cat: 'intl_tech', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { cat: 'intl_science', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { cat: 'intl_science', name: 'The Guardian', url: 'https://www.theguardian.com/science/rss' },
  { cat: 'intl_science', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml' },
  { cat: 'intl_science', name: 'Phys.org', url: 'https://phys.org/rss-feed/' },
  { cat: 'intl_science', name: 'Space Daily', url: 'https://www.spacedaily.com/spacedaily.xml' },
  { cat: 'intl_health', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
  { cat: 'intl_health', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml' },
  { cat: 'intl_sports', name: 'BBC', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { cat: 'intl_sports', name: 'The Guardian', url: 'https://www.theguardian.com/uk/sport/rss' },
  { cat: 'intl_sports', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml' },
  { cat: 'intl_ent', name: 'The Guardian', url: 'https://www.theguardian.com/uk/culture/rss' },
  { cat: 'intl_ent', name: 'Variety', url: 'https://variety.com/feed/' },
  { cat: 'intl_ent', name: 'Deadline', url: 'https://deadline.com/feed/' },
];

// Two sources per category now, and the reader pages through them 15 at a
// time, so the cap is what a category can hold rather than what fits a screen.
const MAX_ITEMS_PER_CATEGORY = 120;
const RECENCY_HALF_LIFE_HOURS = 12;
const SIMILARITY_THRESHOLD = 0.5;

const UA = 'Mozilla/5.0 (compatible; news-feed-collector/1.0)';

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!m) return '';
  let v = m[1].trim();
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) v = cdata[1].trim();
  return decodeEntities(v);
}

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    let title = tag(block, 'title');
    const link = tag(block, 'link');
    const pubDate = tag(block, 'pubDate');
    const srcMatch = block.match(/<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const sourceUrl = srcMatch ? decodeEntities(srcMatch[1]) : '';
    const source = srcMatch ? decodeEntities(srcMatch[2]).trim() : '';
    // Google appends " - <source>" to titles; strip it
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    // related coverage list appears as <li> entries in description
    const desc = tag(block, 'description');
    const related = (desc.match(/<li>/g) || []).length;
    if (!title || !link) continue;
    items.push({ title, link, source, sourceUrl, pubDate, related });
  }
  return items;
}

function tokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)
  );
}

function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// Group near-duplicate stories; coverage = distinct sources + related list size.
function clusterAndScore(items, now, imageIndex) {
  // a publisher feed already supplied its own image; only look one up for
  // the aggregated items that arrived without one
  for (const item of items) {
    if (!item.image) item.image = findImage(imageIndex, item.title);
  }
  const clusters = [];
  for (const item of items) {
    const tk = tokens(item.title);
    let target = null;
    for (const c of clusters) {
      if (jaccard(tk, c.tokens) >= SIMILARITY_THRESHOLD) { target = c; break; }
    }
    if (target) {
      target.members.push(item);
    } else {
      clusters.push({ tokens: tk, members: [item] });
    }
  }
  const out = [];
  for (const c of clusters) {
    c.members.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    // When several outlets covered the same story, show the one that came
    // with a picture rather than merely the newest.
    const rep = c.members.find((m) => m.image) || c.members[0];
    const image = rep.image || c.members.find((m) => m.image)?.image || null;
    const sources = new Set(c.members.map((m) => m.source).filter(Boolean));
    const coverage = Math.max(1, sources.size, rep.related);
    const ageHours = Math.max(0, (now - new Date(rep.pubDate).getTime()) / 3600000);
    const score = coverage * Math.exp((-ageHours * Math.LN2) / RECENCY_HALF_LIFE_HOURS);
    out.push({
      id: `${rep.sourceUrl}|${rep.title}`.slice(0, 200),
      title: rep.title,
      link: rep.link,
      source: rep.source,
      sourceUrl: rep.sourceUrl,
      pubDate: rep.pubDate ? new Date(rep.pubDate).toISOString() : null,
      coverage,
      score: Math.round(score * 1000) / 1000,
      ...(image ? { image } : {}),
    });
  }
  out.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return out.slice(0, MAX_ITEMS_PER_CATEGORY);
}

// Publishers advertise the image in whichever element their CMS emits, and
// some only inline an <img> in the escaped description.
function itemImage(block) {
  const m =
    block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/) ||
    block.match(/<media:content[^>]+url=["']([^"']+)["']/) ||
    block.match(/<enclosure[^>]+url=["']([^"']+)["']/) ||
    block.match(/&lt;img[^&]*?src=&quot;([^&]+)&quot;/) ||
    block.match(/<img[^>]+src=["']([^"']+)["']/);
  if (!m) return null;
  const url = decodeEntities(m[1]).trim();
  // http images would be blocked on the https site
  return /^https:\/\//i.test(url) ? url : null;
}

function parseImageFeed(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item[ >][\s\S]*?<\/item>/g)) {
    const block = m[0];
    const title = tag(block, 'title');
    const img = itemImage(block);
    if (title && img) out.push({ title, img });
  }
  return out;
}

const titleKey = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// Publisher feeds carry no <source> tag — the outlet is known from the feed
// itself — and some use <entry>/<link href> instead of <item>/<link>.
function parsePublisherRss(xml, source) {
  const items = [];
  for (const m of xml.matchAll(/<item[ >][\s\S]*?<\/item>|<entry[ >][\s\S]*?<\/entry>/g)) {
    const block = m[0];
    const title = tag(block, 'title');
    let link = tag(block, 'link');
    if (!link) {
      const href = block.match(/<link[^>]+href=["']([^"']+)["']/);
      if (href) link = decodeEntities(href[1]);
    }
    const pubDate = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated');
    if (!title || !/^https?:\/\//i.test(link)) continue;
    let host = '';
    try { host = new URL(link).origin; } catch { host = ''; }
    items.push({
      title,
      link,
      source,
      sourceUrl: host,
      pubDate,
      related: 0,
      image: itemImage(block),
    });
  }
  return items;
}

// One request per feed, parsed twice: once for the category's articles and once
// for the image index. Fetching the same 47 urls again for pictures is what put
// a run over the Workers subrequest ceiling.
async function fetchFeedTexts(feeds) {
  const entries = await Promise.all(feeds.map(async (f) => {
    try {
      const res = await fetch(f.url, {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { f, xml: await res.text() };
    } catch (err) {
      console.error(`[pub fail] ${f.name} ${f.url.slice(8, 44)}: ${err.message}`);
      return null;
    }
  }));
  return entries.filter(Boolean);
}

function feedsForCategory(catId) {
  return PUBLISHER_SOURCES.filter((f) => f.cat === catId);
}

// Builds the title -> image lookup from feed bodies already in hand. Nothing is
// fetched here: the caller passes what it downloaded for the articles.
export function buildImageIndex(texts) {
  const rows = [];
  for (const { xml } of texts) rows.push(...parseImageFeed(xml));
  const exact = new Map();
  for (const r of rows) if (!exact.has(titleKey(r.title))) exact.set(titleKey(r.title), r.img);
  console.log(`[img] ${rows.length} images from ${texts.length} feed bodies`);
  return { exact, tokens: rows.map((r) => ({ tk: tokens(r.title), img: r.img })) };
}


export function findImage(index, title) {
  if (!index) return null;
  const hit = index.exact.get(titleKey(title));
  if (hit) return hit;
  const tk = tokens(title);
  let best = 0;
  let img = null;
  for (const row of index.tokens) {
    const s = jaccard(tk, row.tk);
    if (s > best) { best = s; img = row.img; }
  }
  return best >= IMAGE_MATCH_THRESHOLD ? img : null;
}

async function fetchCategory(cat, now, imageIndex, pub) {
  // Publisher items are passed in, already parsed: they come from the same
  // responses the image index was built from.
  let google = [];
  let error = null;
  try {
    const res = await fetch(cat.url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    google = parseRss(await res.text());
  } catch (err) {
    error = err.message;
    console.error(`[fail] ${cat.name} (google): ${err.message}`);
  }

  if (!pub.length && !google.length) {
    return {
      id: cat.id, name: cat.name, lang: cat.lang || 'ko', items: [],
      error: error || 'no items',
    };
  }

  const items = clusterAndScore([...pub, ...google], now, imageIndex);
  const withImage = items.filter((i) => i.image).length;
  console.log(`[ok] ${cat.name}: ${items.length} items `
    + `(pub ${pub.length} + google ${google.length}, ${withImage} with image)`);
  return { id: cat.id, name: cat.name, lang: cat.lang || 'ko', items };
}
// A Worker invocation may make at most 50 outbound requests on the free plan,
// and a full collection wants 65 even after the image feeds stop being fetched
// twice. So the work is done in slices: the caller runs each slice and merges.
// Measured: publisher feeds answer in 40ms from the edge, so slicing costs
// almost nothing in wall time.
export const SLICE_COUNT = 2;

export function categorySlice(index, count = SLICE_COUNT) {
  return CATEGORIES.filter((_, i) => i % count === index);
}

// Collects one slice of categories. Requests made: one Google topic feed plus
// that slice's publisher feeds — around 33 for half of them.
export async function collectSlice(index, count = SLICE_COUNT, sharedIndex = null) {
  const cats = categorySlice(index, count);
  const feeds = [];
  const seen = new Set();
  // The picture-only feeds ride along with the first slice: they carry no
  // articles for any category, but their images match articles from elsewhere.
  if (index === 0) {
    for (const url of IMAGE_ONLY_FEEDS) {
      seen.add(url);
      feeds.push({ url, name: '', cat: null });
    }
  }
  for (const cat of cats) {
    for (const f of feedsForCategory(cat.id)) {
      // one url can serve several categories; fetch it once
      if (seen.has(f.url)) continue;
      seen.add(f.url);
      feeds.push(f);
    }
  }
  const texts = await fetchFeedTexts(feeds);
  // A shared index is passed in when the caller collects every slice, so a
  // picture found in one slice can still be matched to an article in another.
  const imageIndex = sharedIndex || buildImageIndex(texts);

  // group the parsed items by the category each feed belongs to
  const byCat = new Map();
  for (const { f, xml } of texts) {
    const items = parsePublisherRss(xml, f.name);
    for (const cat of cats) {
      if (!feedsForCategory(cat.id).some((x) => x.url === f.url)) continue;
      if (!byCat.has(cat.id)) byCat.set(cat.id, []);
      byCat.get(cat.id).push(...items);
    }
  }

  const now = Date.now();
  const categories = await Promise.all(
    cats.map((c) => fetchCategory(c, now, imageIndex, byCat.get(c.id) || []))
  );
  return { categories, texts };
}

// Builds the whole payload in slices. The caller stores it: a file under Node,
// a KV entry in the Worker.
export async function collectNews() {
  const now = Date.now();
  const all = [];
  const pooled = [];
  // First pass gathers the feed bodies from every slice; the second scores each
  // category against the pooled image index. Splitting it this way keeps each
  // slice inside the subrequest ceiling without narrowing the picture pool.
  const slices = [];
  for (let i = 0; i < SLICE_COUNT; i++) {
    const r = await collectSlice(i);
    slices.push(r);
    pooled.push(...r.texts);
  }
  const imageIndex = buildImageIndex(pooled);
  for (const r of slices) {
    for (const cat of r.categories) {
      if (cat.error || !cat.items.length) { all.push(cat); continue; }
      // only the picture is revisited; ranking and dedup already happened
      for (const it of cat.items) {
        if (!it.image) {
          const img = findImage(imageIndex, it.title);
          if (img) it.image = img;
        }
      }
      all.push(cat);
    }
  }
  // put the categories back in their declared order
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  all.sort((a, b) => order.get(a.id) - order.get(b.id));
  const okCount = all.filter((c) => !c.error).length;
  if (okCount === 0) throw new Error('all categories failed');
  return {
    data: { updatedAt: new Date(now).toISOString(), categories: all },
    okCount,
    total: all.length,
  };
}
