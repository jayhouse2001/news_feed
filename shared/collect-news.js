// Collect publisher and Google News feeds, normalize items, score importance.
// Runtime-neutral: only fetch and string handling, so the same code runs under
// Node (scripts/fetch-news.mjs) and inside a Cloudflare Worker. Nothing here
// touches a filesystem — the caller decides where the result is stored.

const EDITION = 'hl=ko&gl=KR&ceid=KR:ko';
const TOPIC = (t) => `https://news.google.com/rss/headlines/section/topic/${t}?${EDITION}`;
const SEARCH = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${EDITION}`;

const US_EDITION = 'hl=en-US&gl=US&ceid=US:en';
const US_TOPIC = (t) => `https://news.google.com/rss/headlines/section/topic/${t}?${US_EDITION}`;
const US_SEARCH = (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${US_EDITION}`;

const CATEGORIES = [
  { id: 'top', name: '주요', url: `https://news.google.com/rss?${EDITION}` },
  { id: 'politics', name: '정치', url: `https://news.google.com/rss/search?q=${encodeURIComponent('정치 when:1d')}&${EDITION}` },
  { id: 'business', name: '경제', url: TOPIC('BUSINESS') },
  { id: 'tech', name: 'IT', url: TOPIC('TECHNOLOGY') },
  { id: 'science', name: '과학', url: TOPIC('SCIENCE'), science: true },
  // No Korean outlet publishes a space or earth-science feed — every institute RSS
  // tried was a 404 — so the subdivisions come from Google search instead. Measured
  // 100 items each and on topic. The publisher feeds above still carry 과학 itself.
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
  // Foreign science splits cleanly because the outlets already publish per-desk
  // feeds. Korean science has no such thing — there is no domestic space or
  // earth-science RSS at all — so 과학 stays one category.
  { id: 'intl_space', name: '해외 우주', url: US_TOPIC('SCIENCE'), lang: 'en' },
  { id: 'intl_earth', name: '해외 지구·환경', url: US_TOPIC('SCIENCE'), lang: 'en' },
  { id: 'intl_physics', name: '해외 물리', url: US_TOPIC('SCIENCE'), lang: 'en' },
  { id: 'intl_health', name: '해외 건강', url: US_TOPIC('HEALTH'), lang: 'en' },
  { id: 'intl_sports', name: '해외 스포츠', url: US_TOPIC('SPORTS'), lang: 'en' },
  { id: 'intl_ent', name: '해외 연예', url: US_TOPIC('ENTERTAINMENT'), lang: 'en' },
  // Disasters have no topic feed of their own, so this is a search. Google has
  // no "disaster" desk and the outlets that do publish one are dead -- the
  // Guardian's natural-disasters feed last updated in 2023 -- so the aggregate
  // is the only live source, filtered by isDisaster.
  { id: 'intl_disaster', name: '해외 재난', lang: 'en', disaster: true,
    url: US_SEARCH('earthquake OR wildfire OR flood OR hurricane OR typhoon OR volcano OR landslide OR tsunami OR "death toll" OR evacuated OR disaster when:1d') },
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
  { cat: 'health', name: '의학신문', url: 'https://www.bosa.co.kr/rss/allArticle.xml' },
  { cat: 'health', name: '청년의사', url: 'https://www.docdocdoc.co.kr/rss/allArticle.xml' },
  { cat: 'tech', name: '매일경제', url: 'https://www.mk.co.kr/rss/50100032/' },
  // IT ran on that one 매일경제 feed, which is not an IT desk: a Nepal flood and a
  // pineapple history both arrived under IT. These are actual technology desks.
  { cat: 'tech', name: '아이뉴스24', url: 'https://www.inews24.com/rss/news_it.xml' },
  { cat: 'tech', name: '전자신문', url: 'https://rss.etnews.com/Section901.xml' },
  { cat: 'tech', name: '전자신문', url: 'https://rss.etnews.com/Section902.xml' },
  { cat: 'tech', name: '한국경제', url: 'https://www.hankyung.com/feed/it' },
  { cat: 'tech', name: '전자부품전문미디어', url: 'https://www.thelec.kr/rss/allArticle.xml' },
  { cat: 'tech', name: 'AI타임스', url: 'https://www.aitimes.com/rss/allArticle.xml' },
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
  { cat: 'intl_science', name: 'Live Science', url: 'https://www.livescience.com/feeds/all' },
  { cat: 'intl_science', name: 'Quanta', url: 'https://www.quantamagazine.org/feed/' },
  { cat: 'intl_space', name: 'Phys.org', url: 'https://phys.org/rss-feed/space-news/' },
  { cat: 'intl_space', name: 'Space.com', url: 'https://www.space.com/feeds/all' },
  { cat: 'intl_space', name: 'SpaceNews', url: 'https://spacenews.com/feed/' },
  { cat: 'intl_space', name: 'NASA', url: 'https://science.nasa.gov/feed/' },
  { cat: 'intl_space', name: 'ESA', url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News' },
  { cat: 'intl_earth', name: 'Phys.org', url: 'https://phys.org/rss-feed/earth-news/' },
  { cat: 'intl_earth', name: 'NASA Earth', url: 'https://earthobservatory.nasa.gov/feeds/earth-observatory.rss' },
  { cat: 'intl_earth', name: 'The Guardian', url: 'https://www.theguardian.com/environment/climate-crisis/rss' },
  { cat: 'intl_physics', name: 'Phys.org', url: 'https://phys.org/rss-feed/physics-news/' },
  { cat: 'intl_physics', name: 'Quanta', url: 'https://www.quantamagazine.org/feed/' },
  { cat: 'intl_physics', name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/science' },
  { cat: 'intl_health', name: 'BBC', url: 'https://feeds.bbci.co.uk/news/health/rss.xml' },
  { cat: 'intl_health', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Health.xml' },
  { cat: 'intl_sports', name: 'BBC', url: 'https://feeds.bbci.co.uk/sport/rss.xml' },
  { cat: 'intl_sports', name: 'The Guardian', url: 'https://www.theguardian.com/uk/sport/rss' },
  { cat: 'intl_sports', name: 'NYT', url: 'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml' },
  { cat: 'intl_ent', name: 'The Guardian', url: 'https://www.theguardian.com/uk/culture/rss' },
  { cat: 'intl_ent', name: 'Variety', url: 'https://variety.com/feed/' },
  { cat: 'intl_ent', name: 'Deadline', url: 'https://deadline.com/feed/' },
  // Science had no publisher feed and so lived on Google alone — which meant an
  // empty category the moment collection moved to Cloudflare, where Google
  // answers 503. These are science and tech desks with working RSS; they carry
  // no images, which is why they were skipped originally, but a category with
  // no pictures beats a category with no articles. etnews was tried and dropped:
  // its only feeds are general-news sections, so sinkholes and crime stories
  // arrived under 과학.
  // 동아사이언스 puts a picture on nearly every item, which is what gives 과학
  // thumbnails at all. Its source name is deliberately distinct from 동아일보,
  // which is blocked by default.
  { cat: 'science', name: '동아사이언스', url: 'https://rss.donga.com/science.xml' },
  { cat: 'science', name: '헬로디디', url: 'https://www.hellodd.com/rss/allArticle.xml' },
  { cat: 'science', name: '로봇신문', url: 'https://www.irobotnews.com/rss/allArticle.xml' },
  // YouTube publishes a per-channel Atom feed with no key and a thumbnail on every
  // entry — the one source of pictures for 과학 besides 동아사이언스. Channel ids were
  // taken from each page's <link rel="canonical"> and confirmed against the
  // feed's own <author><name>. The "channelId" field on the page is NOT it — it
  // also matches sidebar channels, which is how a first pass ended up with
  // Kurzgesagt After Dark and PBS Documentaries. Only channel_id works; ?user= and
  // ?playlist_id= are both 404.
  { cat: 'science', name: '안될과학', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCMc4EmuDxnHPc6pgGW-QWvQ' },
  { cat: 'science', name: '과학드림', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCIk1-yPCTnFuzfgu4gyfWqw' },
  { cat: 'intl_science', name: 'Kurzgesagt', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q' },
  { cat: 'intl_science', name: 'Veritasium', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA' },
  { cat: 'intl_science', name: 'SciShow', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCZYTClx2T1of7BRZ86-8fow' },
  { cat: 'intl_space', name: 'PBS Space Time', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC7_gcs09iThXybpVgjHZ_7g' },
  { cat: 'intl_space', name: 'NASA', url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCLA_DiR1FfKNvjuUpBHmylQ' },
];

// Two sources per category now, and the reader pages through them 15 at a
// time, so the cap is what a category can hold rather than what fits a screen.
const MAX_ITEMS_PER_CATEGORY = 120;
// Measured: 20 keeps 동아사이언스 and the video channels visible without starving a
// category whose only busy feed is a wire service.
// None of the three Korean feeds behind 과학 is a science desk. 로봇신문 is a robotics
// trade paper, 헬로디디 covers research funding and policy, and 동아사이언스 publishes
// the paper's IT section under its science URL. Left alone they filled the category:
// 70 of 120 items were AI launches, phone reviews, lawsuits and share prices.
//
// Excluding the filler was not enough — the leftovers were still mostly industry —
// so a headline has to name a scientific subject to get in, and must not also read
// as a business or policy story. "AI가 설계하는 자율실험실" belongs here; "모두의 AI
// 사업자 선정" does not, and only the second test separates them.
const SCIENCE_SUBJECT = new RegExp([
  '우주|위성|누리호|로켓|천문|은하|블랙홀|행성|화성|천체|외계|소행성|궤도|망원경',
  '기후|지진|화산|빙하|온난화|해류|생태|미세먼지|화석|공룡|고생물|금성|목성|토성|태양',
  '물리|양자|입자|초전도|핵융합|플라즈마|가속기|나노|광학|신소재|촉매|화학|수학',
  '유전자|세포|단백질|바이러스|면역|뇌|신경|암|백신|치매|줄기세포|미생물|DNA|진화|복제',
  '미토콘드리아|신약|치료제|임상|증후군|노화|우울증|수명|항체|질환',
  '연구진|연구팀|논문|과학자|실험|규명|관측|탐사|학술지|네이처|사이언스|노벨상|발견',
].join('|'));

const TRADE_STORY = new RegExp([
  '출시|수주|합의|소송|가맹|분할|인수|계약|협약|MOU|입주|선정|지정|공모|세미나|간담회|포럼|박람회',
  '투자|매출|수출|시총|주가|증시|코스닥|코스피|실적|상장|스타트업|사업자|플랫폼|솔루션|브랜드',
  '장관|차관|국회|의원|예산|공약|사설|기고|칼럼|횡설수설|브리핑|취임|개원|위촉|표창|채용',
  '스마트폰|폴드|이어폰|게임|챗GPT|데이터센터|해커|보안|워터마크|세탁|뷰티|프로모션|분양|아파트',
  '^[가-힣]{2,8}(시|군|구|도|시의회|군의회|구의회|시청|도청)[,\s]',
].join('|'));

const isScience = (title) => SCIENCE_SUBJECT.test(title) && !TRADE_STORY.test(title);

// Same shape as the science pair, and for the same reason: a search answers the
// query rather than the subject. "crash" alone pulled in celebrity retrospectives
// and a seventy-five-year-old airshow, so the query names disasters and this
// keeps out the pieces that only borrow the words.
const DISASTER_EVENT = new RegExp([
  'earthquake|quake|aftershock|tsunami|volcan|erupt|magnitude \d',
  'flood|deluge|landslide|mudslide|avalanche|sinkhole|torrent|monsoon|downpour',
  'hurricane|typhoon|cyclone|tornado|tropical storm|storm surge|blizzard',
  'heatwave|heat wave|drought|wildfire|bushfire',
  // US wildfires are named rather than described: "Ross Fire explodes to 85,000 acres"
  '\b[A-Z][a-z]+ Fire\b|fire (?:burns|burning|scorches|explodes|grows|rages|destroys)',
  'acres burned|containment',
  'disaster|catastrophe|devastat|death toll|casualties|evacuat|displaced|stranded',
  'rescuer|rescue effort|state of emergency|missing after|unaccounted for',
  'derail|capsiz|shipwreck|collapse|explosion|blast|gas leak|chemical spill',
  'oil spill|radiation leak|meltdown',
  'famine|epidemic|pandemic|outbreak|cholera|ebola',
].join('|'), 'i');

const NOT_INCIDENT = new RegExp([
  'stock|shares|market|earnings|revenue|\bipo\b|bitcoin|crypto|bubble',
  'review|recap|trailer|season \d|episode|movie|film|series|album|anniversary',
  'lawsuit|verdict|sentenced|\btrial\b|indict|\bplea\b|settlement|deny responsibility',
  'years ago|decades ago|history of|looking back|throwback|tragic story',
  'recipe|fashion|celebrity|dating|wedding|divorce',
  'zip code|know your|how to prepare|guide to',
].join('|'), 'i');

const isDisaster = (title) => DISASTER_EVENT.test(title) && !NOT_INCIDENT.test(title);

const MAX_PER_SOURCE = 20;
const MAX_PER_SOURCE_WITH_MEDIA = 45;
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

// Google appends " - <publisher>" to every headline. The <source> element says the
// same thing, but the relay drops it, so the suffix is the only copy that survives
// both paths. Blocking a publisher depends on this name, so losing it would let a
// blocked outlet through rather than merely leave a label blank.
function splitTitleSource(title) {
  const i = title.lastIndexOf(' - ');
  if (i < 1) return { title, source: '' };
  const source = title.slice(i + 3).trim();
  // a real outlet name is short and carries no sentence punctuation; anything else
  // is part of the headline itself
  if (!source || source.length > 30 || /[.?!,;:]$/.test(source)) return { title, source: '' };
  return { title: title.slice(0, i).trim(), source };
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
    let source = srcMatch ? decodeEntities(srcMatch[2]).trim() : '';
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    } else if (!source) {
      // the relay path: no <source> element, so read it off the title
      const split = splitTitleSource(title);
      title = split.title;
      source = split.source;
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
      ...(rep.video ? { video: rep.video } : {}),
    });
  }
  out.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return capPerSource(out).slice(0, MAX_ITEMS_PER_CATEGORY);
}

// Recency alone lets one high-volume outlet take the whole category. 환경일보 posts
// 38 text-only items a day and pushed 동아사이언스 — the only Korean science feed that
// carries pictures — down to 24, cutting 과학 thumbnails from 47 to 22. Video
// channels publish a handful a week and lost every slot the same way.
//
// So each source keeps its newest MAX_PER_SOURCE, and what overflows is appended
// after the capped set rather than dropped: a category thin on sources still fills
// up, but no single feed crowds the top.
function capPerSource(items) {
  const count = new Map();
  const kept = [];
  const overflow = [];
  for (const it of items) {
    const key = it.source || '?';
    const n = (count.get(key) || 0) + 1;
    count.set(key, n);
    // An item with a picture or a clip gets a wider allowance. In 과학 exactly one
    // feed carries images, so capping it at the same number as five text-only feeds
    // is what decides whether the category has thumbnails at all.
    const limit = (it.image || it.video) ? MAX_PER_SOURCE_WITH_MEDIA : MAX_PER_SOURCE;
    (n <= limit ? kept : overflow).push(it);
  }
  return kept.concat(overflow);
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
    // A YouTube entry is a clip, not an article: it needs a play affordance and a
    // shorts badge, and it must never be treated as another outlet's coverage of
    // the same story when clustering.
    const video = /youtube\.com\/(watch\?v=|shorts\/)/.test(link)
      ? { video: /\/shorts\//.test(link) ? 'short' : 'video' }
      : null;
    items.push({
      title,
      link,
      source,
      sourceUrl: host,
      pubDate,
      related: 0,
      image: itemImage(block),
      ...(video || {}),
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
  console.log(`[img] ${rows.length} images from ${texts.length} feed bodies`);
  return indexFromRows(rows);
}

// The picture rows a slice contributes, as plain data. The Worker keeps these
// between runs instead of the feed bodies they came from: the XML runs 2-4MB a
// slice and exists only to be turned into this, so storing it made every merge
// read and reparse about 10MB to rebuild something five times smaller.
export function imageRows(texts) {
  const rows = [];
  for (const { xml } of texts) rows.push(...parseImageFeed(xml));
  return rows.map((r) => [r.title, r.img]);
}

// Accepts either the [title, img] pairs above or the row objects, so a slice
// stored by the previous shape still merges instead of erroring.
export function indexFromRows(rows) {
  const norm = rows.map((r) => (Array.isArray(r) ? { title: r[0], img: r[1] } : r));
  const exact = new Map();
  for (const r of norm) if (!exact.has(titleKey(r.title))) exact.set(titleKey(r.title), r.img);
  return { exact, tokens: norm.map((r) => ({ tk: tokens(r.title), img: r.img })) };
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

// Google answers a Cloudflare address with HTTP 200 and an empty body — not the
// 503 an earlier note recorded — so the failure never reached the error path and
// every category quietly lost its aggregate. These converters read the feed from
// their own address and hand back JSON. Measured 2026-08-28: 5/5 on both, 591
// items across twelve categories, newest item as fresh as a direct fetch.
const RELAYS = [
  'https://www.toptal.com/developers/feed2json/convert?url=',
  'https://feed2json.org/convert?url=',
];

// The relay parses the query string, and `when:1d` arrives double-encoded on the
// far side and matches nothing: `q=정치 when:1d` returns 0 where `q=정치` returns 104.
// Dropping the operator costs nothing — the feed is ordered by recency anyway and
// the collector scores on pubDate.
function relayUrl(base, feedUrl) {
  return base + encodeURIComponent(feedUrl.replace(/(\s|\+)when(:|%3A)1d/gi, ''));
}

// Shaped to look like the RSS the rest of the code expects, so parseRss stays the
// single place that knows what an item is.
function rssFromJsonFeed(json) {
  const items = Array.isArray(json.items) ? json.items : [];
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = items.map((it) => {
    const date = it.date_published || it.pubDate || '';
    return '<item>'
      + `<title>${esc(it.title)}</title>`
      + `<link>${esc(it.url || it.link || '')}</link>`
      + `<pubDate>${esc(date)}</pubDate>`
      + `<description>${esc(it.summary || it.content_html || '')}</description>`
      + '</item>';
  }).join('');
  return `<rss><channel>${body}</channel></rss>`;
}

// Tries each relay in turn. A relay that answers with no items counts as a failure:
// that is exactly what the direct fetch already does, and accepting it would put
// the silent-empty bug back in a new place.
async function fetchGoogleFeed(url) {
  let lastErr = 'no relay tried';
  for (const base of RELAYS) {
    try {
      const res = await fetch(relayUrl(base, url), {
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseRss(rssFromJsonFeed(await res.json()));
      if (!items.length) throw new Error('relay returned no items');
      return items;
    } catch (err) {
      lastErr = `${new URL(base).host}: ${err.message}`;
    }
  }
  throw new Error(lastErr);
}

async function fetchCategory(cat, now, imageIndex, pub) {
  // Publisher items are passed in, already parsed: they come from the same
  // responses the image index was built from.
  let google = [];
  let error = null;
  try {
    google = await fetchGoogleFeed(cat.url);
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

  // A search feed answers the query, not the subject: `우주 OR 위성` matched betting
  // spam and a university admissions notice. The same filter that keeps the
  // publisher feeds on topic is applied to the aggregate for the same reason.
  const onTopic = (list) => {
    if (cat.science) return list.filter((i) => isScience(i.title));
    if (cat.disaster) return list.filter((i) => isDisaster(i.title));
    return list;
  };
  const kept = cat.match ? google.filter((i) => cat.match.test(i.title)) : google;
  const items = clusterAndScore(onTopic([...pub, ...kept]), now, imageIndex);
  const withImage = items.filter((i) => i.image).length;
  console.log(`[ok] ${cat.name}: ${items.length} items `
    + `(pub ${pub.length} + google ${kept.length}, ${withImage} with image)`);
  return { id: cat.id, name: cat.name, lang: cat.lang || 'ko', items };
}
// A Worker invocation may make at most 50 outbound requests on the free plan, and
// a full collection wants far more. So the work is done in slices: the caller runs
// each slice and merges. Measured: publisher feeds answer in 40ms from the edge, so
// slicing costs almost nothing in wall time.
//
// Counted, not guessed. With 25 categories the widest slice needs 59 requests at 2
// slices and 48 at 3 — and 48 is not headroom, because a category whose first relay
// fails spends a second request. At 4 the widest is 31, which absorbs a relay
// falling through on every category in the slice and still clears the ceiling.
export const SLICE_COUNT = 4;

// The declared order, and the set of ids that currently exist. The Worker merges
// slices written by earlier runs, so a slice stored before a category was added or
// removed still carries the old list — this is what decides which of those survive
// and in what order.
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

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
      byCat.get(cat.id).push(...(cat.match ? items.filter((i) => cat.match.test(i.title)) : items));
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
  const order = new Map(CATEGORY_IDS.map((id, i) => [id, i]));
  all.sort((a, b) => order.get(a.id) - order.get(b.id));
  const okCount = all.filter((c) => !c.error).length;
  if (okCount === 0) throw new Error('all categories failed');
  return {
    data: { updatedAt: new Date(now).toISOString(), categories: all },
    okCount,
    total: all.length,
  };
}
