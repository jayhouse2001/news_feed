'use strict';

// ---------- settings (localStorage, per device) ----------

const LS_KEY = 'nf:settings:v1';

// Blocked out of the box at the owner's request. 동아사이언스 is deliberately
// left out — its science coverage is wanted.
const DEFAULT_BLOCKED = [
  '조선일보', 'Chosunbiz', '조선비즈', '헬스조선', '스포츠조선', 'TV조선', '주간조선', '월간조선',
  '중앙일보', '일간스포츠', 'JTBC', '중앙SUNDAY', '월간중앙',
  '동아일보', '스포츠동아', '채널A', '신동아',
  '국민일보', '더미션',
];

function defaultSettings() {
  return {
    blockedSources: [...DEFAULT_BLOCKED],
    blockedKeywords: [],
    preferredSources: [],
    categoryOrder: [],
    categoryDisabled: [],
    sortBy: {},
    widgets: [
      { id: 'w-weather', type: 'weather', config: {} },
      { id: 'w-important', type: 'important', config: { count: 5 } },
      { id: 'w-links', type: 'links', config: {} },
    ],
    links: [],
    place: null,
    openMode: 'same',
    defaultBlocksApplied: true,
  };
}

// how tapping an article behaves
const OPEN_MODES = {
  same: { label: '현재 창에서 열기', hint: '뒤로 가기(왼쪽 끝에서 스와이프)로 목록으로 돌아옵니다.' },
  newtab: { label: '새 창에서 열기', hint: '기사가 새 탭에서 열려 목록이 그대로 남습니다.' },
  reader: { label: '앱 안에서 읽기', hint: '앱을 벗어나지 않고 "◀ 목록" 버튼으로 돌아옵니다.' },
};

function openMode() {
  const m = S.openMode;
  if (m && OPEN_MODES[m]) return m;
  return 'same';
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultSettings();
    const stored = JSON.parse(raw);
    const s = Object.assign(defaultSettings(), stored);
    // apply the default block list once to devices saved before it existed
    // (check the stored copy — the defaults always carry the flag)
    if (!stored.defaultBlocksApplied) {
      for (const src of DEFAULT_BLOCKED) {
        if (!s.blockedSources.includes(src)) s.blockedSources.push(src);
      }
      s.defaultBlocksApplied = true;
    }
    return s;
  } catch {
    return defaultSettings();
  }
}

const S = loadSettings();

function save() {
  localStorage.setItem(LS_KEY, JSON.stringify(S));
}

let newsData = { updatedAt: null, categories: [] };

// ---------- helpers ----------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function addUnique(arr, v) {
  if (!arr.includes(v)) arr.push(v);
}

function moveItem(arr, from, to) {
  if (to < 0 || to >= arr.length) return;
  arr.splice(to, 0, arr.splice(from, 1)[0]);
}

// ---------- categories ----------

function orderedCategories() {
  const cats = newsData.categories;
  const byId = new Map(cats.map((c) => [c.id, c]));
  const seq = S.categoryOrder.map((id) => byId.get(id)).filter(Boolean);
  for (const c of cats) if (!seq.includes(c)) seq.push(c);
  return seq;
}

function enabledCategories() {
  return orderedCategories().filter((c) => !S.categoryDisabled.includes(c.id));
}

// ---------- blocking ----------

function isBlocked(item) {
  if (item.source && S.blockedSources.includes(item.source)) return true;
  const t = item.title.toLowerCase();
  return S.blockedKeywords.some((k) => t.includes(k.toLowerCase()));
}

function visibleItems(cat) {
  return cat.items.filter((i) => !isBlocked(i));
}

// ---------- sorting ----------

const SORT_LABEL = { latest: '최신순', score: '중요도순', preferred: '언론사 우선' };

function getSort(catId) {
  return S.sortBy[catId] || 'latest';
}

function sortItems(items, mode) {
  const arr = [...items];
  if (mode === 'score') {
    arr.sort((a, b) => b.score - a.score);
  } else if (mode === 'preferred') {
    const rank = new Map(S.preferredSources.map((s, i) => [s, i]));
    const r = (x) => (rank.has(x.source) ? rank.get(x.source) : Number.MAX_SAFE_INTEGER);
    arr.sort((a, b) => r(a) - r(b) || new Date(b.pubDate) - new Date(a.pubDate));
  } else {
    arr.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  }
  return arr;
}

// ---------- overlay: sheet + panel ----------

function overlayRoot() {
  return document.getElementById('overlay-root');
}

function closeOverlay() {
  const root = overlayRoot();
  root.hidden = true;
  root.textContent = '';
}

function openSheet(title, actions) {
  const root = overlayRoot();
  root.textContent = '';
  const back = el('div', 'sheet-backdrop');
  const sheet = el('div', 'sheet');
  if (title) sheet.appendChild(el('div', 's-title', title));
  for (const a of actions) {
    const b = el('button', 's-item', a.label);
    b.addEventListener('click', () => {
      closeOverlay();
      if (a.onClick) a.onClick();
    });
    sheet.appendChild(b);
  }
  const cancel = el('button', 's-item s-cancel', '취소');
  cancel.addEventListener('click', closeOverlay);
  sheet.appendChild(cancel);
  back.addEventListener('click', (e) => {
    if (e.target === back) closeOverlay();
  });
  back.appendChild(sheet);
  root.appendChild(back);
  root.hidden = false;
}

function openPanel(title, buildBody) {
  const root = overlayRoot();
  root.textContent = '';
  const panel = el('div', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('b', null, title));
  const done = el('button', 'panel-done', '완료');
  done.addEventListener('click', () => {
    closeOverlay();
    rebuildPages();
  });
  head.appendChild(done);
  panel.appendChild(head);
  const body = el('div', 'panel-body');
  panel.appendChild(body);
  buildBody(body);
  root.appendChild(panel);
  root.hidden = false;
}

// ---------- title translation (foreign feeds) ----------

// Unofficial Google gtx endpoint: no key, CORS-enabled. Falls back to the
// original title whenever it fails, so a blocked request is never fatal.
const TR_KEY = 'nf:tr:v1';

let trCache = {};
try {
  trCache = JSON.parse(localStorage.getItem(TR_KEY) || '{}');
} catch {
  trCache = {};
}

let trSaveTimer = 0;
function saveTrCache() {
  clearTimeout(trSaveTimer);
  trSaveTimer = setTimeout(() => {
    try {
      const keys = Object.keys(trCache);
      // keep the cache from growing without bound
      if (keys.length > 600) {
        const trimmed = {};
        for (const k of keys.slice(-400)) trimmed[k] = trCache[k];
        trCache = trimmed;
      }
      localStorage.setItem(TR_KEY, JSON.stringify(trCache));
    } catch {
      // storage full or unavailable; translations just won't persist
    }
  }, 800);
}

async function gtx(text) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=' +
    encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const t = j && j[0] ? j[0].map((s) => s[0]).join('') : '';
  if (!t) throw new Error('empty');
  return t;
}

// Translate the marked titles one at a time to avoid hammering the endpoint.
let trRunning = false;
async function translatePending(root) {
  if (trRunning) return;
  trRunning = true;
  try {
    const nodes = [...(root || document).querySelectorAll('[data-tr]')];
    for (const node of nodes) {
      const orig = node.getAttribute('data-tr');
      node.removeAttribute('data-tr');
      if (trCache[orig]) {
        node.textContent = trCache[orig];
        continue;
      }
      try {
        const t = await gtx(orig);
        trCache[orig] = t;
        node.textContent = t;
        saveTrCache();
      } catch {
        node.classList.add('untranslated');
      }
    }
  } finally {
    trRunning = false;
  }
}

// ---------- news item ----------

// Standalone (home-screen) mode keeps target=_blank inside the app shell,
// so force Safari with the x-safari- scheme there.
function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function newsItemNode(item, opts) {
  const li = el('li', 'news-item');
  const top = el('div', 'item-top');

  const a = el('a', 'item-link', item.title);
  a.href = item.link;
  a.rel = 'noreferrer';
  if (opts && opts.translate) {
    // show the original immediately; translatePending() swaps it in when ready
    a.setAttribute('data-tr', item.title);
    a.title = item.title;
  }

  const mode = openMode();
  if (mode === 'newtab') {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (isStandalone()) {
      // standalone mode swallows target=_blank inside the app shell
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.href = `x-safari-${item.link}`;
      });
    }
  } else if (mode === 'reader') {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openReader(item);
    });
  } else {
    // same tab: remember where we were so back lands on the same spot
    a.addEventListener('click', () => saveViewState());
  }
  top.appendChild(a);

  const more = el('button', 'more', '⋯');
  more.setAttribute('aria-label', '기사 옵션');
  more.addEventListener('click', () => openItemSheet(item));
  top.appendChild(more);
  li.appendChild(top);

  const meta = el('div', 'meta');
  if (item.coverage >= 5) {
    meta.appendChild(el('span', 'badge', `${item.coverage}곳 보도`));
  }
  if (opts && opts.categoryName) {
    meta.appendChild(el('span', 'badge cat-badge', opts.categoryName));
  }
  meta.appendChild(
    el('span', null, [item.source, relTime(item.pubDate)].filter(Boolean).join(' · '))
  );
  li.appendChild(meta);
  return li;
}

// In-app article viewer for standalone mode. Many publishers refuse framing,
// so offer Safari as the way out when the frame stays blank.
function openReader(item) {
  const root = overlayRoot();
  root.textContent = '';

  const view = el('div', 'reader');
  const head = el('div', 'reader-head');

  const back = el('button', 'reader-back', '◀ 목록');
  back.addEventListener('click', () => history.back());
  head.appendChild(back);
  head.appendChild(el('span', 'reader-src', item.source || ''));

  const openSafari = el('button', 'reader-open', 'Safari로 열기');
  openSafari.addEventListener('click', () => {
    window.location.href = `x-safari-${item.link}`;
  });
  head.appendChild(openSafari);
  view.appendChild(head);

  const frame = document.createElement('iframe');
  frame.className = 'reader-frame';
  frame.src = item.link;
  frame.referrerPolicy = 'no-referrer';
  view.appendChild(frame);

  const hint = el('div', 'reader-hint');
  hint.appendChild(el('p', null, '이 언론사는 앱 안에서 열리지 않습니다.'));
  const hintBtn = el('button', 'primary', 'Safari로 열기');
  hintBtn.addEventListener('click', () => {
    window.location.href = `x-safari-${item.link}`;
  });
  hint.appendChild(hintBtn);
  view.appendChild(hint);

  // if the frame never loads, surface the Safari fallback
  const timer = setTimeout(() => hint.classList.add('on'), 3500);
  frame.addEventListener('load', () => clearTimeout(timer));

  root.appendChild(view);
  root.hidden = false;

  // give the back gesture / button something to pop
  history.pushState({ reader: true }, '', location.href);
  const onPop = () => {
    clearTimeout(timer);
    closeOverlay();
    window.removeEventListener('popstate', onPop);
  };
  window.addEventListener('popstate', onPop);
}

function openItemSheet(item) {
  const actions = [];
  if (item.source) {
    actions.push({
      label: `🚫 '${item.source}' 언론사 차단`,
      onClick() {
        addUnique(S.blockedSources, item.source);
        save();
        rebuildPages();
      },
    });
  }
  actions.push({
    label: '🔇 키워드 차단…',
    onClick() {
      const k = prompt('차단할 키워드를 입력하세요');
      if (k && k.trim()) {
        addUnique(S.blockedKeywords, k.trim());
        save();
        rebuildPages();
      }
    },
  });
  openSheet('이 기사에 대해', actions);
}

// ---------- weather / air quality ----------

const WEATHER_CODES = {
  0: '맑음', 1: '대체로 맑음', 2: '구름 조금', 3: '흐림',
  45: '안개', 48: '착빙 안개',
  51: '약한 이슬비', 53: '이슬비', 55: '강한 이슬비',
  61: '약한 비', 63: '비', 65: '강한 비',
  71: '약한 눈', 73: '눈', 75: '강한 눈', 77: '진눈깨비',
  80: '소나기', 81: '소나기', 82: '강한 소나기',
  95: '뇌우', 96: '뇌우·우박', 99: '뇌우·우박',
};

const WEATHER_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 77: '🌨️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function pmGrade(pm25) {
  if (pm25 == null) return null;
  if (pm25 <= 15) return { label: '좋음', cls: 'good' };
  if (pm25 <= 35) return { label: '보통', cls: 'good' };
  if (pm25 <= 75) return { label: '나쁨', cls: 'bad' };
  return { label: '매우나쁨', cls: 'bad' };
}

let weatherCache = null;

// Resolve coordinates: device location first, fall back to the saved place.
function resolvePlace() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(S.place || { name: '서울', lat: 37.5665, lon: 126.978 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = {
          name: '현재 위치',
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
        };
        S.place = p;
        save();
        resolve(p);
      },
      () => resolve(S.place || { name: '서울', lat: 37.5665, lon: 126.978 }),
      { timeout: 8000, maximumAge: 600000 }
    );
  });
}

async function fetchWeather(place) {
  const key = `${place.lat},${place.lon}`;
  if (weatherCache && weatherCache.key === key) return weatherCache.data;

  const wx = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    '&current=temperature_2m,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=Asia%2FSeoul&forecast_days=7';
  const aq = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}` +
    '&current=pm10,pm2_5&timezone=Asia%2FSeoul&forecast_days=1';

  const [wxRes, aqRes] = await Promise.all([
    fetch(wx).then((r) => r.json()),
    fetch(aq).then((r) => r.json()).catch(() => null),
  ]);

  const daily = [];
  const d = wxRes.daily;
  if (d?.time) {
    for (let i = 0; i < d.time.length; i++) {
      daily.push({
        date: d.time[i],
        code: d.weather_code?.[i],
        max: d.temperature_2m_max?.[i],
        min: d.temperature_2m_min?.[i],
        rain: d.precipitation_probability_max?.[i],
      });
    }
  }

  const data = {
    temp: wxRes.current?.temperature_2m,
    code: wxRes.current?.weather_code,
    daily,
    pm10: aqRes?.current?.pm10,
    pm25: aqRes?.current?.pm2_5,
  };
  weatherCache = { key, data };
  return data;
}

function renderWeatherWidget(card) {
  const body = el('div', 'weather-body');
  body.appendChild(el('p', 'w-empty', '위치 확인 중…'));
  card.appendChild(body);

  const nameSlot = card.querySelector('.w-place');

  resolvePlace()
    .then((place) => {
      if (nameSlot) nameSlot.textContent = place.name;
      return fetchWeather(place);
    })
    .then((d) => {
      body.textContent = '';

      const row = el('div', 'weather-row');
      row.appendChild(el('span', 'wx-icon', WEATHER_ICONS[d.code] || '🌡️'));
      row.appendChild(el('span', 'temp', d.temp != null ? `${Math.round(d.temp)}°` : '—'));
      const today = d.daily[0];
      const cond = [
        WEATHER_CODES[d.code] || '',
        today && today.max != null ? `최고 ${Math.round(today.max)}° 최저 ${Math.round(today.min)}°` : '',
      ].filter(Boolean).join(' · ');
      row.appendChild(el('span', 'cond', cond));
      body.appendChild(row);

      const chips = el('div', 'chips');
      const grade = pmGrade(d.pm25);
      if (grade) {
        chips.appendChild(
          el('span', `chip ${grade.cls}`, `미세먼지 ${grade.label} · PM2.5 ${Math.round(d.pm25)}`)
        );
      }
      if (d.pm10 != null) chips.appendChild(el('span', 'chip', `PM10 ${Math.round(d.pm10)}`));
      if (today?.rain != null) chips.appendChild(el('span', 'chip', `강수 ${today.rain}%`));
      body.appendChild(chips);

      if (d.daily.length > 1) {
        const week = el('div', 'week');
        d.daily.forEach((day, i) => {
          const cell = el('div', 'wday' + (i === 0 ? ' today' : ''));
          const dt = new Date(day.date + 'T00:00:00');
          cell.appendChild(el('span', 'wd-name', i === 0 ? '오늘' : DAY_NAMES[dt.getDay()]));
          cell.appendChild(el('span', 'wd-icon', WEATHER_ICONS[day.code] || '🌡️'));
          cell.appendChild(el('span', 'wd-max', day.max != null ? `${Math.round(day.max)}°` : '—'));
          cell.appendChild(el('span', 'wd-min', day.min != null ? `${Math.round(day.min)}°` : '—'));
          week.appendChild(cell);
        });
        body.appendChild(week);
      }
    })
    .catch(() => {
      body.textContent = '';
      body.appendChild(el('p', 'w-empty', '날씨를 불러오지 못했습니다.'));
    });
}

// ---------- dashboard widgets ----------

const WIDGET_TYPES = {
  weather: { name: '날씨 · 미세먼지' },
  important: { name: '중요 뉴스' },
  links: { name: '바로가기' },
};

function widgetFrame(widget, index) {
  const card = el('div', 'widget');
  const head = el('div', 'w-head');
  head.appendChild(el('span', null, WIDGET_TYPES[widget.type]?.name || widget.type));

  const btns = el('span', 'w-btns');
  if (widget.type === 'weather') {
    btns.appendChild(el('span', 'w-place', '…'));
  }
  if (widget.type === 'important') {
    const cfg = el('button', 'w-btn', '설정');
    cfg.addEventListener('click', () => configureImportant(widget));
    btns.appendChild(cfg);
  }
  if (widget.type === 'links') {
    const edit = el('button', 'w-btn', '편집');
    edit.addEventListener('click', openLinkEditor);
    btns.appendChild(edit);
  }
  const menu = el('button', 'w-btn', '⋯');
  menu.addEventListener('click', () => {
    openSheet(WIDGET_TYPES[widget.type]?.name || widget.type, [
      { label: '△ 위로', onClick() { moveItem(S.widgets, index, index - 1); save(); rebuildPages(); } },
      { label: '▽ 아래로', onClick() { moveItem(S.widgets, index, index + 1); save(); rebuildPages(); } },
      { label: '✕ 위젯 삭제', onClick() { S.widgets.splice(index, 1); save(); rebuildPages(); } },
    ]);
  });
  btns.appendChild(menu);
  head.appendChild(btns);
  card.appendChild(head);
  return card;
}

function titleTokens(title) {
  return new Set(
    title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length >= 2)
  );
}

function similar(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function importantItems(count) {
  const pool = [];
  for (const cat of enabledCategories()) {
    for (const item of visibleItems(cat)) {
      pool.push({ item, catName: cat.name, translate: !!cat.lang && cat.lang !== 'ko' });
    }
  }
  pool.sort((a, b) => b.item.score - a.item.score);
  const picked = [];
  for (const cand of pool.slice(0, 120)) {
    const tk = titleTokens(cand.item.title);
    if (picked.some((p) => similar(p.tk, tk) >= 0.6)) continue;
    picked.push({ ...cand, tk });
    if (picked.length >= count) break;
  }
  return picked;
}

function renderImportantWidget(card, widget) {
  const count = widget.config?.count || 5;
  const ul = el('ul', 'news-list flat');
  for (const { item, catName, translate } of importantItems(count)) {
    ul.appendChild(newsItemNode(item, { categoryName: catName, translate }));
  }
  if (!ul.children.length) card.appendChild(el('p', 'w-empty', '표시할 뉴스가 없습니다.'));
  else card.appendChild(ul);
}

function configureImportant(widget) {
  openSheet('표시할 기사 수', [3, 5, 10].map((n) => ({
    label: (widget.config?.count === n ? '✓ ' : '') + `${n}건`,
    onClick() {
      widget.config = { ...widget.config, count: n };
      save();
      rebuildPages();
    },
  })));
}

function renderLinksWidget(card) {
  if (!S.links.length) {
    card.appendChild(el('p', 'w-empty', "링크가 없습니다. '편집'에서 추가하세요."));
    return;
  }
  const grid = el('div', 'linkgrid');
  for (const link of S.links) {
    const a = el('a', 'linkitem');
    a.href = link.url;
    a.appendChild(el('span', 'ic', [...link.name][0] || '?'));
    a.appendChild(el('span', 'lb', link.name));
    grid.appendChild(a);
  }
  card.appendChild(grid);
}

function buildDashboard() {
  const page = el('section', 'page');
  const inner = el('div', 'page-inner');
  S.widgets.forEach((widget, i) => {
    const card = widgetFrame(widget, i);
    if (widget.type === 'weather') renderWeatherWidget(card);
    else if (widget.type === 'important') renderImportantWidget(card, widget);
    else if (widget.type === 'links') renderLinksWidget(card);
    inner.appendChild(card);
  });
  const add = el('button', 'add-dashed', '＋ 위젯 추가');
  add.addEventListener('click', () => {
    openSheet('위젯 추가', Object.entries(WIDGET_TYPES).map(([type, def]) => ({
      label: def.name,
      onClick() {
        S.widgets.push({
          id: `w-${Date.now()}`,
          type,
          config: type === 'important' ? { count: 5 } : {},
        });
        save();
        rebuildPages();
      },
    })));
  });
  inner.appendChild(add);
  page.appendChild(inner);
  return page;
}

// ---------- category page ----------

function buildCategoryPage(cat) {
  const page = el('section', 'page');
  const inner = el('div', 'page-inner');

  const sortRow = el('div', 'sortrow');
  const sortBtn = el('button', 'sort-btn', `정렬: ${SORT_LABEL[getSort(cat.id)]} ▾`);
  sortBtn.addEventListener('click', () => {
    const cur = getSort(cat.id);
    openSheet('정렬 기준', Object.keys(SORT_LABEL).map((mode) => ({
      label: (mode === cur ? '✓ ' : '') + SORT_LABEL[mode],
      onClick() {
        S.sortBy[cat.id] = mode;
        save();
        rebuildPages();
      },
    })));
  });
  sortRow.appendChild(sortBtn);

  const items = sortItems(visibleItems(cat), getSort(cat.id));
  sortRow.appendChild(el('span', null, `${items.length}건`));
  inner.appendChild(sortRow);

  const translate = cat.lang && cat.lang !== 'ko';
  if (!items.length) {
    inner.appendChild(el('p', 'placeholder', '표시할 기사가 없습니다.'));
  } else {
    const ul = el('ul', 'news-list');
    for (const item of items) ul.appendChild(newsItemNode(item, { translate }));
    inner.appendChild(ul);
  }

  page.appendChild(inner);
  return page;
}

// ---------- view state (restored after opening an article) ----------

const VIEW_KEY = 'nf:view:v1';

function saveViewState() {
  const pager = document.getElementById('pager');
  const page = pager.children[currentIndex()];
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({
      index: currentIndex(),
      scroll: page ? page.scrollTop : 0,
    }));
  } catch {
    // storage unavailable; fall back to opening at the first page
  }
}

function restoreViewState() {
  let st = null;
  try {
    st = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
  } catch {
    st = null;
  }
  if (!st) return;
  const pager = document.getElementById('pager');
  const index = Math.min(st.index || 0, pager.children.length - 1);
  pager.scrollLeft = index * pager.clientWidth;
  const page = pager.children[index];
  if (page && st.scroll) page.scrollTop = st.scroll;
  syncPageIndicator();
}

// ---------- pager ----------

let pages = [];

function currentIndex() {
  const pager = document.getElementById('pager');
  return Math.round(pager.scrollLeft / pager.clientWidth);
}

function syncPageIndicator() {
  const i = currentIndex();
  const page = pages[i];
  if (!page) return;
  document.getElementById('page-title').textContent = page.title;
  document.querySelectorAll('.pagedots .dot').forEach((d, n) => {
    d.classList.toggle('on', n === i);
  });
  const active = document.querySelector('.pagedots .dot.on');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function rebuildPages() {
  const pager = document.getElementById('pager');
  const keep = currentIndex();
  pager.textContent = '';

  pages = [{ title: '대시보드', node: buildDashboard() }];
  for (const cat of enabledCategories()) {
    pages.push({ title: cat.name, node: buildCategoryPage(cat) });
  }
  for (const p of pages) pager.appendChild(p.node);

  const dots = document.getElementById('pagedots');
  dots.textContent = '';
  pages.forEach((p, i) => {
    const dot = el('button', 'dot' + (i === 0 ? ' on' : ''), p.title);
    dot.addEventListener('click', () => {
      pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
    });
    dots.appendChild(dot);
  });

  const target = Math.min(keep, pages.length - 1);
  pager.scrollLeft = target * pager.clientWidth;
  syncPageIndicator();
  translatePending(pager);
}

// ---------- settings panel ----------

function chipList(box, arr, emptyText) {
  box.textContent = '';
  if (!arr.length) {
    box.appendChild(el('span', 'w-empty', emptyText));
    return;
  }
  arr.forEach((v, i) => {
    const chip = el('span', 'x-chip');
    chip.appendChild(el('span', null, v));
    const x = el('button', 'x', '✕');
    x.setAttribute('aria-label', `${v} 삭제`);
    x.addEventListener('click', () => {
      arr.splice(i, 1);
      applySettingChange();
    });
    chip.appendChild(x);
    box.appendChild(chip);
  });
}

function addRow(placeholder, onAdd, listId) {
  const row = el('div', 'add-form');
  const input = el('input', 'in');
  input.placeholder = placeholder;
  if (listId) input.setAttribute('list', listId);
  const btn = el('button', 'primary', '추가');
  const commit = () => {
    const v = input.value.trim();
    if (!v) return;
    onAdd(v);
    input.value = '';
    applySettingChange();
  };
  btn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
  });
  row.appendChild(input);
  row.appendChild(btn);
  return row;
}

// Publisher families: one tap blocks a whole group, individual chips below
// still toggle each outlet. Ownership only, no editorial judgement.
const SOURCE_FAMILIES = [
  { name: '조선', members: ['조선일보', 'Chosunbiz', '조선비즈', '헬스조선', '스포츠조선', 'TV조선', '주간조선', '월간조선'] },
  { name: '중앙', members: ['중앙일보', '일간스포츠', 'JTBC', '중앙SUNDAY', '월간중앙'] },
  { name: '동아', members: ['동아일보', '스포츠동아', '채널A', '신동아', '동아사이언스'] },
  { name: '국민', members: ['국민일보', '더미션'] },
  { name: '경향', members: ['경향신문', '스포츠경향'] },
  { name: '한겨레', members: ['한겨레', '씨네21'] },
  { name: '매경', members: ['매일경제', 'MBN', '매경이코노미'] },
  { name: '한경', members: ['한국경제', '한경비즈니스', '한국경제TV'] },
];

function familyState(fam) {
  const n = fam.members.filter((m) => S.blockedSources.includes(m)).length;
  if (n === 0) return 'none';
  return n === fam.members.length ? 'all' : 'some';
}

function familyRow() {
  const box = el('div', 'src-grid');
  for (const fam of SOURCE_FAMILIES) {
    const state = familyState(fam);
    const cls = state === 'all' ? ' blocked' : state === 'some' ? ' partial' : '';
    const chip = el('button', 'fam-chip' + cls, `${fam.name} 계열`);
    chip.title = fam.members.join(', ');
    chip.addEventListener('click', () => {
      // re-read the state: a chip rendered as 'some' may have changed since
      if (familyState(fam) === 'all') {
        S.blockedSources = S.blockedSources.filter((s) => !fam.members.includes(s));
      } else {
        for (const m of fam.members) addUnique(S.blockedSources, m);
      }
      save();
      rebuildPages();
      openSettings();
    });
    box.appendChild(chip);
  }
  return box;
}

// Sources that actually show up in the feed, most frequent first, so the
// toggle grid reflects what is really there instead of a hardcoded guess.
function frequentSources(limit) {
  const count = new Map();
  for (const cat of newsData.categories) {
    for (const item of cat.items) {
      if (!item.source) continue;
      // skip aggregator/portal hostnames — they are not publishers
      if (/\./.test(item.source)) continue;
      count.set(item.source, (count.get(item.source) || 0) + 1);
    }
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const extra = [];
  // family members and anything already blocked stay listed even when this
  // batch has no article from them, so they remain individually unblockable
  for (const fam of SOURCE_FAMILIES) {
    for (const m of fam.members) if (!ranked.includes(m)) extra.push(m);
  }
  for (const s of S.blockedSources) {
    if (!ranked.includes(s) && !extra.includes(s)) extra.push(s);
  }
  return [...ranked.slice(0, limit), ...extra];
}

function sourceToggleGrid() {
  const box = el('div', 'src-grid');
  for (const src of frequentSources(40)) {
    const blocked = S.blockedSources.includes(src);
    const chip = el('button', 'src-chip' + (blocked ? ' blocked' : ''), src);
    chip.setAttribute('aria-pressed', String(blocked));
    chip.addEventListener('click', () => {
      // read current state, not the value captured at render time
      if (S.blockedSources.includes(src)) {
        S.blockedSources = S.blockedSources.filter((s) => s !== src);
      } else {
        S.blockedSources.push(src);
      }
      save();
      rebuildPages();
      openSettings();
    });
    box.appendChild(chip);
  }
  return box;
}

function knownSourcesDatalist() {
  const dl = el('datalist');
  dl.id = 'known-sources';
  const seen = new Set();
  for (const cat of newsData.categories) {
    for (const item of cat.items) {
      if (item.source && !seen.has(item.source)) {
        seen.add(item.source);
        const opt = el('option');
        opt.value = item.source;
        dl.appendChild(opt);
      }
    }
  }
  return dl;
}

// Any settings change has to reach the pages behind the panel too, otherwise
// the dashboard keeps showing blocked sources until the panel is dismissed.
function applySettingChange() {
  save();
  rebuildPages();
  openSettings();
}

function openSettings() {
  openPanel('설정', (body) => {
    body.appendChild(knownSourcesDatalist());

    // how articles open
    const omSec = el('div', 'set-section');
    omSec.appendChild(el('div', 'set-title', '기사 열기 방식'));
    for (const [key, def] of Object.entries(OPEN_MODES)) {
      const row = el('label', 'set-row set-choice');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'openmode';
      radio.checked = openMode() === key;
      radio.addEventListener('change', () => {
        S.openMode = key;
        save();
        rebuildPages();
        openSettings();
      });
      row.appendChild(radio);
      const tx = el('span', 'choice-tx');
      tx.appendChild(el('span', 'choice-label', def.label));
      tx.appendChild(el('span', 'choice-hint', def.hint));
      row.appendChild(tx);
      omSec.appendChild(row);
    }
    if (isStandalone() && openMode() === 'same') {
      omSec.appendChild(
        el('p', 'w-empty', '홈 화면 앱에서는 뒤로 가기 제스처가 없습니다. "앱 안에서 읽기"를 권합니다.')
      );
    }
    body.appendChild(omSec);

    // categories: on/off + order (also controls page order)
    const catSec = el('div', 'set-section');
    catSec.appendChild(el('div', 'set-title', '카테고리 (페이지 표시 · 순서)'));
    orderedCategories().forEach((cat, i, all) => {
      const row = el('div', 'set-row');
      const label = el('label', 'set-label');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !S.categoryDisabled.includes(cat.id);
      cb.addEventListener('change', () => {
        if (cb.checked) S.categoryDisabled = S.categoryDisabled.filter((id) => id !== cat.id);
        else addUnique(S.categoryDisabled, cat.id);
        applySettingChange();
      });
      label.appendChild(cb);
      label.appendChild(el('span', null, cat.name));
      row.appendChild(label);
      const mk = (t, fn, disabled) => {
        const b = el('button', 'w-btn', t);
        b.disabled = disabled;
        b.addEventListener('click', fn);
        row.appendChild(b);
      };
      const order = all.map((c) => c.id);
      mk('△', () => { moveItem(order, i, i - 1); S.categoryOrder = order; applySettingChange(); }, i === 0);
      mk('▽', () => { moveItem(order, i, i + 1); S.categoryOrder = order; applySettingChange(); }, i === all.length - 1);
      catSec.appendChild(row);
    });
    body.appendChild(catSec);

    const bsSec = el('div', 'set-section');
    bsSec.appendChild(el('div', 'set-title', '계열 묶어 차단 / 해제'));
    bsSec.appendChild(familyRow());
    bsSec.appendChild(el('div', 'set-title mt', '언론사별 (탭하면 취소선 = 차단)'));
    bsSec.appendChild(sourceToggleGrid());
    const blockedCount = S.blockedSources.length;
    bsSec.appendChild(
      el('p', 'w-empty', blockedCount ? `${blockedCount}곳 차단 중` : '차단한 언론사가 없습니다.')
    );
    bsSec.appendChild(addRow('목록에 없는 언론사 추가', (v) => addUnique(S.blockedSources, v), 'known-sources'));
    body.appendChild(bsSec);

    const bkSec = el('div', 'set-section');
    bkSec.appendChild(el('div', 'set-title', '차단한 키워드'));
    const bkBox = el('div', 'chipbox');
    chipList(bkBox, S.blockedKeywords, '없음');
    bkSec.appendChild(bkBox);
    bkSec.appendChild(addRow('키워드', (v) => addUnique(S.blockedKeywords, v)));
    body.appendChild(bkSec);

    const psSec = el('div', 'set-section');
    psSec.appendChild(el('div', 'set-title', "선호 언론사 ('언론사 우선' 정렬 순위)"));
    S.preferredSources.forEach((src, i) => {
      const row = el('div', 'set-row');
      row.appendChild(el('span', 'set-label', `${i + 1}. ${src}`));
      const mk = (t, fn) => {
        const b = el('button', 'w-btn', t);
        b.addEventListener('click', fn);
        row.appendChild(b);
      };
      mk('△', () => { moveItem(S.preferredSources, i, i - 1); applySettingChange(); });
      mk('▽', () => { moveItem(S.preferredSources, i, i + 1); applySettingChange(); });
      mk('✕', () => { S.preferredSources.splice(i, 1); applySettingChange(); });
      psSec.appendChild(row);
    });
    if (!S.preferredSources.length) psSec.appendChild(el('p', 'w-empty', '없음'));
    psSec.appendChild(addRow('언론사 이름', (v) => addUnique(S.preferredSources, v), 'known-sources'));
    body.appendChild(psSec);
  });
}

// ---------- link editor ----------

function openLinkEditor() {
  openPanel('바로가기 편집', (body) => {
    const listBox = el('div', 'edit-list');
    body.appendChild(listBox);

    const redraw = () => {
      listBox.textContent = '';
      S.links.forEach((link, i) => {
        const row = el('div', 'edit-row');
        const tx = el('div', 'tx');
        tx.appendChild(el('div', 'nm', link.name));
        tx.appendChild(el('div', 'url', link.url));
        row.appendChild(tx);
        const mk = (label, fn) => {
          const b = el('button', 'w-btn', label);
          b.addEventListener('click', fn);
          row.appendChild(b);
        };
        mk('△', () => { moveItem(S.links, i, i - 1); save(); redraw(); });
        mk('▽', () => { moveItem(S.links, i, i + 1); save(); redraw(); });
        mk('✎', () => {
          const name = prompt('이름', link.name);
          if (name === null) return;
          const url = prompt('URL (https://, tel:, kakaotalk:// 등)', link.url);
          if (url === null) return;
          if (name.trim() && url.trim()) {
            S.links[i] = { name: name.trim(), url: url.trim() };
            save();
            redraw();
          }
        });
        mk('✕', () => { S.links.splice(i, 1); save(); redraw(); });
        listBox.appendChild(row);
      });
      if (!S.links.length) listBox.appendChild(el('p', 'w-empty', '등록된 링크가 없습니다.'));
    };
    redraw();

    const form = el('div', 'add-form');
    const nameIn = el('input', 'in');
    nameIn.placeholder = '이름 (예: 카카오톡)';
    const urlIn = el('input', 'in');
    urlIn.placeholder = 'URL (https://, tel:, kakaotalk:// 등)';
    const addBtn = el('button', 'primary', '＋ 링크 추가');
    addBtn.addEventListener('click', () => {
      const name = nameIn.value.trim();
      const url = urlIn.value.trim();
      if (!name || !url) return;
      S.links.push({ name, url });
      save();
      nameIn.value = '';
      urlIn.value = '';
      redraw();
    });
    form.appendChild(nameIn);
    form.appendChild(urlIn);
    form.appendChild(addBtn);
    body.appendChild(form);
  });
}

// ---------- data loading ----------

function showUpdatedAt() {
  document.getElementById('updated-at').textContent =
    newsData.updatedAt ? relTime(newsData.updatedAt) : '';
}

async function loadNews() {
  const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let refreshing = false;

async function refreshNews() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  const label = document.getElementById('updated-at');
  label.textContent = '업데이트 중…';
  try {
    newsData = await loadNews();
    rebuildPages();
    showUpdatedAt();
  } catch {
    label.textContent = '업데이트 실패';
    setTimeout(showUpdatedAt, 2000);
  } finally {
    btn.classList.remove('spinning');
    refreshing = false;
  }
}

// ---------- boot ----------

async function main() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('refresh-btn').addEventListener('click', refreshNews);

  try {
    newsData = window.__NEWS_DATA__ || (await loadNews());
  } catch {
    newsData = { updatedAt: null, categories: [] };
  }

  save(); // persist defaults (including the initial block list) on first run
  showUpdatedAt();
  rebuildPages();
  restoreViewState();

  const pager = document.getElementById('pager');
  let raf = 0;
  pager.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(syncPageIndicator);
  });
  window.addEventListener('resize', () => {
    pager.scrollLeft = currentIndex() * pager.clientWidth;
  });

  // Safari restores this page from cache on back; scroll position can be lost
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) restoreViewState();
  });
}

main();
