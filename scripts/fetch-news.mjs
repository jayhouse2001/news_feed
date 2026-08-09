// Collect Google News RSS feeds per category, normalize items,
// compute importance score, and write site/data/news.json.
// Zero dependencies — runs on Node 18+ (global fetch).

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const IMAGE_FEEDS = [
  'https://www.yna.co.kr/rss/news.xml',
  'https://www.yna.co.kr/rss/international.xml',
  'https://www.yna.co.kr/rss/politics.xml',
  'https://www.yna.co.kr/rss/economy.xml',
  'https://www.yna.co.kr/rss/industry.xml',
  'https://www.yna.co.kr/rss/society.xml',
  'https://www.yna.co.kr/rss/sports.xml',
  'https://www.yna.co.kr/rss/culture.xml',
  'https://www.yna.co.kr/rss/health.xml',
  'https://news.sbs.co.kr/news/headlineRssFeed.do?plink=RSSREADER',
  'https://news.sbs.co.kr/news/newsflashRssFeed.do?plink=RSSREADER',
  'https://rss.donga.com/total.xml',
  'https://www.mk.co.kr/rss/30000001/',
  'https://www.mk.co.kr/rss/50100032/',
  'https://www.mk.co.kr/rss/50200011/',
  // English feeds for the intl_* categories; these publish an image on
  // essentially every item, unlike most of what Google aggregates.
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/business/rss.xml',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
  'https://feeds.bbci.co.uk/news/health/rss.xml',
  'https://feeds.bbci.co.uk/sport/rss.xml',
  'https://www.theguardian.com/world/rss',
  'https://www.theguardian.com/uk/technology/rss',
  'https://www.theguardian.com/science/rss',
  'https://www.theguardian.com/uk/sport/rss',
  'https://www.theguardian.com/uk/culture/rss',
  'https://abcnews.go.com/abcnews/internationalheadlines',
  'https://feeds.npr.org/1004/rss.xml',
  'https://variety.com/feed/',
];

const IMAGE_MATCH_THRESHOLD = 0.55;

const MAX_ITEMS_PER_CATEGORY = 50;
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
  for (const item of items) item.image = findImage(imageIndex, item.title);
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

async function collectImages() {
  const results = await Promise.all(IMAGE_FEEDS.map(async (url) => {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseImageFeed(await res.text());
    } catch (err) {
      console.error(`[img fail] ${url}: ${err.message}`);
      return [];
    }
  }));
  const rows = results.flat();
  const exact = new Map();
  for (const r of rows) if (!exact.has(titleKey(r.title))) exact.set(titleKey(r.title), r.img);
  console.log(`[img] ${rows.length} images from ${IMAGE_FEEDS.length} publisher feeds`);
  return { exact, tokens: rows.map((r) => ({ tk: tokens(r.title), img: r.img })) };
}

function findImage(index, title) {
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

async function fetchCategory(cat, now, imageIndex) {
  try {
    const res = await fetch(cat.url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = clusterAndScore(parseRss(xml), now, imageIndex);
    console.log(`[ok] ${cat.name}: ${items.length} items`);
    return { id: cat.id, name: cat.name, lang: cat.lang || 'ko', items };
  } catch (err) {
    console.error(`[fail] ${cat.name}: ${err.message}`);
    return { id: cat.id, name: cat.name, lang: cat.lang || 'ko', items: [], error: err.message };
  }
}

async function main() {
  const now = Date.now();
  const imageIndex = await collectImages();
  const categories = await Promise.all(CATEGORIES.map((c) => fetchCategory(c, now, imageIndex)));
  const okCount = categories.filter((c) => !c.error).length;
  if (okCount === 0) {
    console.error('all categories failed');
    process.exit(1);
  }
  const data = {
    updatedAt: new Date(now).toISOString(),
    categories,
  };
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.join(root, 'site', 'data');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'news.json'), JSON.stringify(data, null, 1), 'utf8');
  console.log(`done: ${okCount}/${categories.length} categories`);
}

main();
