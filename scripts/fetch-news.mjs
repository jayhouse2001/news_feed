// Collect Google News RSS feeds per category, normalize items,
// compute importance score, and write site/data/news.json.
// Zero dependencies — runs on Node 18+ (global fetch).

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDITION = 'hl=ko&gl=KR&ceid=KR:ko';
const TOPIC = (t) => `https://news.google.com/rss/headlines/section/topic/${t}?${EDITION}`;

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
];

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
function clusterAndScore(items, now) {
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
    const rep = c.members[0];
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
    });
  }
  out.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return out.slice(0, MAX_ITEMS_PER_CATEGORY);
}

async function fetchCategory(cat, now) {
  try {
    const res = await fetch(cat.url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = clusterAndScore(parseRss(xml), now);
    console.log(`[ok] ${cat.name}: ${items.length} items`);
    return { id: cat.id, name: cat.name, items };
  } catch (err) {
    console.error(`[fail] ${cat.name}: ${err.message}`);
    return { id: cat.id, name: cat.name, items: [], error: err.message };
  }
}

async function main() {
  const now = Date.now();
  const categories = await Promise.all(CATEGORIES.map((c) => fetchCategory(c, now)));
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
