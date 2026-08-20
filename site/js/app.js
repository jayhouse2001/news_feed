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
    trackers: [],
    saved: [],
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

let toastTimer = null;

// Brief confirmation for actions that finish on a screen that shows no trace
// of them — pinning an article to a tracker leaves the reader in the feed.
function toast(msg) {
  let box = document.getElementById('toast');
  if (!box) {
    box = el('div', 'toast');
    box.id = 'toast';
    document.body.appendChild(box);
  }
  box.textContent = msg;
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), 2200);
}

function overlayRoot() {
  return document.getElementById('overlay-root');
}

function closeOverlay() {
  const root = overlayRoot();
  root.hidden = true;
  root.textContent = '';
}

// A sheet layered on top of an open panel. openSheet() empties the overlay
// root, which would tear the panel down and leave nothing to return to, so a
// confirmation raised from inside a panel gets its own node above it.
function confirmSheet(title, confirmLabel, onConfirm) {
  const root = overlayRoot();
  const back = el('div', 'sheet-backdrop stacked');
  const sheet = el('div', 'sheet');
  if (title) sheet.appendChild(el('div', 's-title', title));

  const yes = el('button', 's-item danger', confirmLabel);
  yes.addEventListener('click', () => {
    back.remove();
    onConfirm();
  });
  sheet.appendChild(yes);

  const no = el('button', 's-item s-cancel', '취소');
  no.addEventListener('click', () => back.remove());
  sheet.appendChild(no);

  back.addEventListener('click', (e) => {
    if (e.target === back) back.remove();
  });
  back.appendChild(sheet);
  root.appendChild(back);
  root.hidden = false;
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
  // Toggling a setting reopens the panel to redraw it. Rebuilding from
  // scratch would jump back to the top, so carry the scroll position over
  // when the same panel is being redrawn.
  const prev = root.querySelector('.panel');
  const keepScroll = prev && prev.dataset.title === title
    ? prev.querySelector('.panel-body').scrollTop
    : 0;

  root.textContent = '';
  const panel = el('div', 'panel');
  panel.dataset.title = title;
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
  if (keepScroll) body.scrollTop = keepScroll;
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

  // Only a minority of articles carry a picture, so the thumbnail sits beside
  // the headline and the row keeps its height when there is none.
  if (item.image) {
    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.src = item.image;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';
    thumb.referrerPolicy = 'no-referrer';
    // a dead or hotlink-blocked image must not leave a broken icon
    thumb.addEventListener('error', () => thumb.remove());
    top.insertBefore(thumb, more);
  }
  li.appendChild(top);

  const meta = el('div', 'meta');
  if (item.coverage >= 5) {
    meta.appendChild(el('span', 'badge', `${item.coverage}곳 보도`));
  }
  if (opts && opts.categoryName) {
    meta.appendChild(el('span', 'badge cat-badge', opts.categoryName));
  }
  if (opts && opts.savedAt) {
    meta.appendChild(el('span', 'badge', `${relTime(opts.savedAt)} 저장`));
  } else if (isSaved(item.link)) {
    meta.appendChild(el('span', 'badge', '★'));
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
  const actions = [{
    label: isSaved(item.link) ? '★ 스크랩에서 빼기' : '☆ 스크랩에 저장',
    onClick() { toggleSaved(item); },
  }];
  if (aiReady()) {
    actions.push({
      label: '✦ 이 뉴스를 AI로 추적 (과거까지)',
      onClick() { openAiIssue(item); },
    });
  }
  actions.push({
    label: '◷ 이 뉴스를 이슈로 추적',
    onClick() { trackFromArticle(item); },
  });
  if (trackerList().length) {
    actions.push({
      label: '＋ 기존 이슈에 추가…',
      onClick() { addToTrackerSheet(item); },
    });
  }
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

async function reverseGeocodeCurrent(lat, lon) {
  const url = 'https://api.bigdatacloud.net/data/reverse-geocode-client' +
    `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=ko`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Reverse geocoding HTTP ${res.status}`);
  const data = await res.json();
  const parts = [data.city, data.locality]
    .filter((name, i, arr) => name && arr.indexOf(name) === i);
  return parts.join(' ') || data.principalSubdivision || '현재 위치';
}

// Resolve coordinates: device location first, fall back to the saved place.
function resolvePlace({ fresh = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(S.place || { name: '서울', lat: 37.5665, lon: 126.978 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = {
          name: '현재 위치',
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
        };
        try {
          p.name = await reverseGeocodeCurrent(p.lat, p.lon);
        } catch {
          // Coordinates are still usable when the place-name service is unavailable.
        }
        S.place = p;
        save();
        resolve(p);
      },
      () => resolve(S.place || { name: '서울', lat: 37.5665, lon: 126.978 }),
      { timeout: 8000, maximumAge: fresh ? 0 : 600000 }
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
  card.appendChild(body);

  const nameSlot = card.querySelector('.w-place');
  const locateBtn = card.querySelector('.w-locate');

  const load = ({ fresh = false } = {}) => {
    body.textContent = '';
    body.appendChild(el('p', 'w-empty', fresh ? '현재 위치 갱신 중…' : '위치 확인 중…'));
    if (locateBtn) {
      locateBtn.disabled = true;
      locateBtn.classList.add('spinning');
    }

    if (fresh) weatherCache = null;
    return resolvePlace({ fresh })
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
    })
    .finally(() => {
      if (locateBtn) {
        locateBtn.disabled = false;
        locateBtn.classList.remove('spinning');
      }
    });

  };

  if (locateBtn) locateBtn.addEventListener('click', () => load({ fresh: true }));
  load();
}

// ---------- dashboard widgets ----------

const WIDGET_TYPES = {
  weather: { name: '날씨 · 미세먼지' },
  important: { name: '중요 뉴스' },
  tracker: { name: '이슈 트래커' },
  links: { name: '바로가기' },
};

function widgetFrame(widget, index) {
  const card = el('div', 'widget');
  const head = el('div', 'w-head');
  head.appendChild(el('span', null, WIDGET_TYPES[widget.type]?.name || widget.type));

  const btns = el('span', 'w-btns');
  if (widget.type === 'weather') {
    const locate = el('button', 'w-locate');
    locate.type = 'button';
    locate.setAttribute('aria-label', '현재 위치 새로고침');
    locate.title = '현재 위치 새로고침';
    locate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" class="fill"/></svg>';
    btns.appendChild(locate);
    btns.appendChild(el('span', 'w-place', '현재 위치'));
  }
  if (widget.type === 'important') {
    const cfg = el('button', 'w-btn', '설정');
    cfg.addEventListener('click', () => configureImportant(widget));
    btns.appendChild(cfg);
  }
  if (widget.type === 'tracker') {
    const add = el('button', 'w-btn', '＋ 이슈');
    add.addEventListener('click', () => openTrackerEditor(null));
    btns.appendChild(add);
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
  // Walk the whole ranked pool, not a fixed window: "더 보기" has to be able
  // to reach past the first hundred once the near-duplicates are dropped.
  const picked = [];
  for (const cand of pool) {
    const tk = titleTokens(cand.item.title);
    if (picked.some((p) => similar(p.tk, tk) >= 0.6)) continue;
    picked.push({ ...cand, tk });
    if (picked.length >= count) break;
  }
  return picked;
}

function renderImportantWidget(card, widget) {
  const step = widget.config?.count || 5;
  const ul = el('ul', 'news-list flat');
  card.appendChild(ul);

  // The configured count is the starting size, not a ceiling: "더 보기"
  // keeps walking down the ranked list until it runs out.
  const more = el('button', 'add-dashed', '');
  let shown = 0;

  const draw = () => {
    const rows = importantItems(shown + step);
    for (const { item, catName, translate } of rows.slice(shown)) {
      ul.appendChild(newsItemNode(item, { categoryName: catName, translate }));
    }
    const grew = rows.length > shown;
    shown = rows.length;
    if (!shown) {
      card.appendChild(el('p', 'w-empty', '표시할 뉴스가 없습니다.'));
      more.hidden = true;
      return;
    }
    // no growth means the ranked pool is exhausted
    more.hidden = !grew;
    more.textContent = `＋ ${step}건 더 보기`;
    translatePending(ul);
  };

  draw();
  more.addEventListener('click', draw);
  card.appendChild(more);
}

function configureImportant(widget) {
  openSheet('처음 보여줄 기사 수 (더 보기로 계속)', [3, 5, 10, 20].map((n) => ({
    label: (widget.config?.count === n ? '✓ ' : '') + `${n}건`,
    onClick() {
      widget.config = { ...widget.config, count: n };
      save();
      rebuildPages();
    },
  })));
}

function renderTrackerWidget(card) {
  const active = trackerList().filter((t) => t.status === 'active');
  if (!active.length) {
    card.appendChild(el('p', 'w-empty', "추적 중인 이슈가 없습니다. '트래커' 탭에서 추가하세요."));
    return;
  }
  const ul = el('ul', 'news-list flat');
  for (const tracker of active) {
    const li = el('li', 'news-item');
    const top = el('div', 'item-top');
    const name = el('button', 'tk-name', tracker.name);
    name.addEventListener('click', () => openTrackerTimeline(tracker));
    top.appendChild(name);
    li.appendChild(top);

    const meta = el('div', 'meta');
    const fresh = tracker.counts ? tracker.counts.unseen : newEventCount(tracker);
    if (fresh) meta.appendChild(el('span', 'badge', `새 ${fresh}건`));
    const latest = (tracker.events || [])[0];
    meta.appendChild(el('span', null, latest
      ? `${latest.date} · ${latest.title}`.slice(0, 60)
      : '모인 기사 없음'));
    li.appendChild(meta);
    ul.appendChild(li);
  }
  card.appendChild(ul);
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
    else if (widget.type === 'tracker') renderTrackerWidget(card);
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

// how many articles a category shows before "더 보기" is needed
const PAGE_STEP = 15;

function buildCategoryPage(cat) {
  const page = el('section', 'page');
  page.dataset.pullRefresh = 'true';
  const pull = el('div', 'pull-refresh', '아래로 당겨 새로고침');
  pull.setAttribute('aria-hidden', 'true');
  page.appendChild(pull);
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
    // Render a first screenful and grow on demand: drawing all 50 cards up
    // front costs layout time on every tab switch for rows nobody scrolls to.
    const ul = el('ul', 'news-list');
    let shown = 0;
    const more = el('button', 'add-dashed', '');

    const draw = () => {
      const next = items.slice(shown, shown + PAGE_STEP);
      for (const item of next) ul.appendChild(newsItemNode(item, { translate }));
      shown += next.length;
      const left = items.length - shown;
      more.hidden = left <= 0;
      more.textContent = `＋ ${Math.min(left, PAGE_STEP)}건 더 보기 (남은 ${left}건)`;
      // newly added foreign titles still need translating
      translatePending(ul);
    };
    draw();

    more.addEventListener('click', draw);
    inner.appendChild(ul);
    inner.appendChild(more);
  }

  page.appendChild(inner);
  return page;
}

// ---------- issue tracker ----------

// A tracker is a keyword rule plus the timeline it has collected. Matching is
// plain substring on the title, so no service or model is involved: every
// article the feed already carries is tested against the rule on each load.

const TRACKER_STATUS = { active: '진행중', closed: '종료' };

function dayOf(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function dowOf(date) {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? '' : `${DAY_NAMES[d.getDay()]}요일`;
}

function sortEvents(tracker) {
  tracker.events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Particles and generic news words carry no topic, so a headline's keywords
// are what is left after they are stripped. Korean is not tokenized here —
// the trailing particle is trimmed instead, which is enough for title
// substring matching since "이란은" still contains "이란".
const STOP_WORDS = new Set([
  '뉴스', '속보', '단독', '종합', '오늘', '내일', '어제', '올해', '작년', '지난',
  '관련', '대한', '위해', '통해', '따라', '대해', '이번', '최근', '현재', '상황',
  '기자', '보도', '전망', '분석', '가능', '예정', '계획', '발표', '밝혀', '말해',
  '사진', '영상', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'says',
  'said', 'will', 'new', 'news', 'over', 'into', 'after', 'amid',
]);

const PARTICLES = ['에서는', '으로', '에서', '에게', '까지', '부터', '이라', '라고',
  '과의', '와의', '에도', '에는',
  '의', '은', '는', '이', '가', '을', '를', '에', '서', '도', '만', '과', '와', '로'];

// Headlines end in a conjugated verb ("발표했다", "밝혔다"), which says what
// happened rather than what the story is about, so it makes a poor keyword.
const VERB_TAIL = /(했다|한다|된다|됐다|였다|이다|합니다|밝혔다|나섰다|보인다|중이다|해야|하나)$/;

function trimParticle(w) {
  if (!/[가-힣]$/.test(w)) return w;
  for (const part of PARTICLES) {
    if (w.length > part.length + 1 && w.endsWith(part)) return w.slice(0, -part.length);
  }
  return w;
}

// Words that describe an action or a degree rather than a subject. They pass
// every shape test — not verbs by ending, not stop words, often rare — yet a
// tracker keyed on 완전 or 부인 collects nothing but noise. Collected from what
// a rarity ranking wrongly preferred over 트럼프 and 이란.
const WEAK_WORDS = new Set([
  '완전', '부인', '장악', '주장', '확대', '축소', '증가', '감소', '강화', '추진',
  '검토', '논의', '결정', '시작', '종료', '공개', '제기', '지적', '요구', '촉구',
  '비판', '반발', '우려', '기대', '전환', '개최', '참석', '방문', '언급', '거부',
  '수용', '전례', '이제', '다시', '모두', '일부', '전체', '최대', '최소', '본격',
  '대규모', '소규모', '사실', '문제', '이유', '방안', '수준', '규모', '내용',
  '결과', '효과', '영향', '필요', '중요', '주요', '새로', '향해', '위한', '없는',
]);

function titleWords(title) {
  return (title || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => !VERB_TAIL.test(w))
    .map(trimParticle)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w.toLowerCase()) && !/^\d+$/.test(w));
}

// How many loaded articles mention each word. A word in a quarter of the feed
// cannot identify a story; one in three or four articles can.
let dfCache = null;

function documentFrequency() {
  if (dfCache) return dfCache;
  const df = new Map();
  let total = 0;
  for (const cat of newsData.categories) {
    for (const it of cat.items) {
      total++;
      for (const w of new Set(titleWords(it.title))) df.set(w, (df.get(w) || 0) + 1);
    }
  }
  dfCache = { df, total: total || 1 };
  return dfCache;
}

// Ranks a headline's words by how well each would identify this story.
// Frequency alone is not enough — measured, it prefers 완전 over 트럼프, because
// rare-and-meaningless beats common-and-central. So shape and position count
// too, and the words that are only ever noise are excluded outright.
function rankKeywords(title) {
  const { df, total } = documentFrequency();
  const seen = new Set();
  const out = [];
  titleWords(title).forEach((w, i) => {
    const key = w.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const n = df.get(w) || 0;
    let score = 0;
    if (WEAK_WORDS.has(w)) score -= 100;
    // Counted, not proportioned. A share of the corpus reads as tiny for words
    // that are in fact everywhere: 서울 appears in 26 of 2016 articles — 1.3%,
    // which any percentage cut waves through, while plainly being a place name
    // too broad to track. Absolute counts are what separate 호르무즈 (3) from
    // 서울 (26) at any feed size.
    if (n >= 2 && n <= 8) score += 3;
    else if (n <= 1) score += 1;
    else if (n <= 15) score += 1;
    else score -= 3;
    // Latin letters or digits inside a Korean headline nearly always mark a
    // name: LAFC, iPhone, G7.
    if (/^[A-Za-z][A-Za-z0-9.\-]*$/.test(w)) score += 2;
    if (w.length >= 3) score += 1;
    if (i <= 1) score += 1;   // headlines lead with their subject
    out.push({ word: w, score, n, at: i });
  });
  out.sort((a, b) => b.score - a.score || a.at - b.at);
  return out;
}

// The words switched on by default. Deliberately few: two good keywords
// collect a tighter timeline than four mediocre ones, and the rest of the
// headline stays one tap away in the editor.
function suggestKeywords(title, limit = 2) {
  return rankKeywords(title).filter((c) => c.score > 0).slice(0, limit)
    .sort((a, b) => a.at - b.at).map((c) => c.word);
}

// Cross-source dedup. The same story reaches a timeline three ways — the
// half-hourly feed, a Google News sweep, a hand pin — and each carries its own
// url, so url equality alone lets the wire copy and the daily's rewrite both
// through. Same day plus near-identical title is the test that catches those.
const DEDUP_SIM = 0.6;

// Pre-bucketing existing titles by day keeps a long sweep from going quadratic
// over a timeline holding hundreds of entries.
function dedupIndex(tracker) {
  const idx = new Map();
  for (const e of tracker.events) {
    if (!idx.has(e.date)) idx.set(e.date, []);
    idx.get(e.date).push(titleTokens(e.title));
  }
  return idx;
}

function isDuplicate(index, date, title) {
  const tk = titleTokens(title);
  return (index.get(date) || []).some((t) => similar(t, tk) >= DEDUP_SIM);
}

function indexAdd(index, date, title) {
  if (!index.has(date)) index.set(date, []);
  index.get(date).push(titleTokens(title));
}

// Takes an article or a bare title. The server has a function of the same name
// that only ever gets a string, and calling this one with a string threw where
// the difference was invisible — accepting both removes the trap rather than
// documenting it.
function trackerMatches(tracker, item) {
  const title = String(typeof item === 'string' ? item : (item && item.title) || '')
    .toLowerCase();
  const all = (tracker.all || []).map((w) => w.toLowerCase());
  const any = (tracker.any || []).map((w) => w.toLowerCase());
  if (all.length && !all.every((w) => title.includes(w))) return false;
  if (any.length && !any.some((w) => title.includes(w))) return false;
  return all.length > 0 || any.length > 0;
}

// Fold today's feed into the tracker timelines. Titles are kept, bodies never
// are, and a link is only ever recorded once.
function collectTrackers() {
  let added = 0;
  for (const tracker of S.trackers) {
    if (tracker.status !== 'active') continue;
    const seen = new Set(tracker.events.map((e) => e.url));
    for (const url of tracker.dropped || []) seen.add(url);
    const index = dedupIndex(tracker);
    // Days already on the timeline are settled: refreshing adds new days, it
    // does not reopen old ones. Reading an issue is following a sequence, and
    // a day changing under the reader breaks that.
    const settled = new Set(index.keys());
    const perDay = tracker.perDay || DEFAULT_PER_DAY;
    const dayCount = new Map();
    for (const ev of tracker.events) dayCount.set(ev.date, (dayCount.get(ev.date) || 0) + 1);

    for (const cat of newsData.categories) {
      for (const item of cat.items) {
        if (seen.has(item.link) || isBlocked(item) || !trackerMatches(tracker, item)) continue;
        if (isBlockedSource(item.source)) continue;
        const date = dayOf(item.pubDate);
        if (settled.has(date)) continue;
        if ((dayCount.get(date) || 0) >= perDay) continue;
        // one story reaches several categories and the wires rewrite each
        // other, so a near-identical title already on that day is not news
        if (isDuplicate(index, date, item.title)) continue;
        dayCount.set(date, (dayCount.get(date) || 0) + 1);
        seen.add(item.link);
        indexAdd(index, date, item.title);
        tracker.events.push({
          date,
          title: item.title,
          source: item.source || '',
          url: item.link,
          coverage: item.coverage || 0,
          addedAt: new Date().toISOString(),
        });
        added++;
      }
    }
    sortEvents(tracker);
  }
  if (added) save();
  return added;
}

// desc = newest day first (what is happening now), asc = oldest first (how it
// started). Kept per issue: a running story is read from the top, a finished
// one from the beginning.
function eventsByDay(tracker, order) {
  const dir = order || tracker.order || 'desc';
  const days = new Map();
  for (const ev of tracker.events) {
    if (!days.has(ev.date)) days.set(ev.date, []);
    days.get(ev.date).push(ev);
  }
  // most reported first within a day
  const out = [...days.entries()].map(([date, list]) => ({
    date,
    list: list.slice().sort((a, b) => (b.coverage || 0) - (a.coverage || 0)),
  }));
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (dir === 'asc') out.reverse();
  return out;
}

// "new" means collected since the issue was last opened, not published today:
// the feed can lag a day and a tracker still has genuinely unseen articles.
function newEventCount(tracker) {
  const seenAt = tracker.seenAt || '';
  // notes are written by hand, so they are never unread news
  return tracker.events.filter((e) => !e.note && (e.addedAt || '') > seenAt).length;
}

function isRemote(tracker) {
  return serverBacked() && remoteTrackers.some((t) => t.id === tracker.id);
}

function markTrackerSeen(tracker) {
  tracker.seenAt = new Date().toISOString();
  if (isRemote(tracker)) {
    // fire and forget: a lost "seen" only costs an unread badge
    api(`/trackers/${tracker.id}`, { method: 'PATCH', body: JSON.stringify({ seen: true }) })
      .catch(() => {});
    if (tracker.counts) tracker.counts.unseen = 0;
    return;
  }
  save();
}

// ---------- GDELT backfill ----------

// GDELT indexes Korean articles (language:Korean, sourcecountry:South Korea)
// but its keyword matching does not tokenize Korean, so the query terms have
// to be English while the results come back in Korean. Verified 2026-08-06.
// CORS is open (Access-Control-Allow-Origin: *) so the browser calls it
// directly; the server-side collector cannot, since trackers live in each
// device's localStorage. Rate limit is strict, hence one sweep per request.

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_MAX = 250;
const GNEWS_MAX = 100;

// GDELT returns whatever Korean outlet it has indexed, and the volume is
// dominated by business dailies filing many near-identical wire rewrites.
// Measured on a peak news week: 250 raw articles from 27 domains, 139 on the
// busiest day. Keeping the majors and capping each day brings that to 8.
const MAJOR_DOMAINS = [
  // wire services / broadcast
  'yna.co.kr', 'yonhapnews.co.kr', 'ytn.co.kr', 'news.kbs.co.kr', 'imnews.imbc.com',
  'news.sbs.co.kr', 'news1.kr', 'newsis.com', 'nocutnews.co.kr',
  // general dailies
  'hani.co.kr', 'khan.co.kr', 'hankookilbo.com', 'seoul.co.kr', 'segye.com',
  'munhwa.com', 'kmib.co.kr', 'pressian.com', 'ohmynews.com',
  // business dailies
  'mk.co.kr', 'hankyung.com', 'edaily.co.kr', 'sedaily.com', 'asiae.co.kr',
];

// Two, not eight. A tracker is read to see how an issue moved, not to count
// coverage — and a busy day yields 26 articles, which buries the shape of the
// story under repetition. The ones past the cap are kept and folded away rather
// than dropped, so a day can still be opened up.
const DEFAULT_PER_DAY = 2;

// Waits between retries of a throttled window. A blocked IP stays blocked for
// a while, so the gaps grow; 0 ends the attempts for that window.
const RATE_BACKOFF = [6000, 20000, 45000, 0];

// Google News reports a publisher name ("연합뉴스") where GDELT reports a
// hostname ("yna.co.kr"), so the whitelist has to recognise both forms.
const MAJOR_NAMES = [
  '연합뉴스', '연합뉴스TV', 'YTN', 'KBS', 'KBS 뉴스', 'MBC', 'MBC 뉴스', 'SBS', 'SBS 뉴스',
  '뉴스1', '뉴시스', 'CBS 노컷뉴스', '노컷뉴스', 'BBC News 코리아',
  '한겨레', '경향신문', '한국일보', '서울신문', '세계일보', '문화일보',
  '국민일보', '프레시안', '오마이뉴스',
  '매일경제', '한국경제', '이데일리', '서울경제', '아시아경제',
];

// Sources that are never a news outlet, whatever the keyword matched. Found in
// live results: a site filing game and gambling copy that happened to carry the
// search terms in its body, and a machine-translation farm posting the same
// sentence twice. Applied even with "all sources" on — that switch is for
// widening past the major-outlet list, not for turning off the floor.
const BLOCKED_SOURCES = [
  'gwara', 'vietnam.vn', 'vietnam.', 'baohaiduong',
];

function isBlockedSource(source) {
  const s = (source || '').trim().toLowerCase();
  if (!s) return false;
  return BLOCKED_SOURCES.some((b) => s.includes(b));
}

function isMajorDomain(source) {
  if (!source) return false;
  const s = source.trim();
  if (MAJOR_NAMES.some((n) => s === n || s.startsWith(n))) return true;
  const d = s.toLowerCase().replace(/^(www|m|news|biz)\./, '');
  return MAJOR_DOMAINS.some((x) => {
    const base = x.replace(/^(www|m|news|biz)\./, '');
    return d === base || d.endsWith(`.${base}`) || s.toLowerCase() === x;
  });
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return dayOf(d.toISOString());
}

// ---------- Google News search RSS (primary backfill source) ----------

// Google News accepts the Korean keywords directly and honours after:/before:,
// and it surfaces the wires (연합·YTN) that GDELT largely misses. It sends no
// CORS header though, so the browser cannot read it without a relay. The free
// relays fail intermittently — measured both allorigins endpoints flipping
// between working and refused minutes apart — so several are tried in turn.
// Verified 2026-08-06: both allorigins endpoints returned all 100 items but
// took 9.5s and 22s; codetabs answered 521 and corsproxy.io 403 at the same
// moment, and either can be the healthy one minutes later.
const CORS_RELAYS = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

function gnewsUrl(query, from, to) {
  const q = `${query} after:${from} before:${to}`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}`
    + '&hl=ko&gl=KR&ceid=KR:ko';
}

// allorigins /get wraps the payload in JSON; /raw and the others return it bare
function unwrapRelay(text) {
  const t = text.trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      if (typeof j.contents === 'string') return j.contents;
    } catch {
      return t;
    }
  }
  return t;
}

const RELAY_TIMEOUT_MS = 25000;

// The relays are unreliable and slow in different ways — measured 9.5s and
// 22s for two that worked while a third returned 521. Racing them means one
// slow link cannot stall the sweep, and a dead one costs nothing.
async function fetchViaRelay(url) {
  const attempts = CORS_RELAYS.map(async (mk) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RELAY_TIMEOUT_MS);
    try {
      const res = await fetch(mk(url), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = unwrapRelay(await res.text());
      if (!body.includes('<item>')) throw new Error('no items');
      return body;
    } finally {
      clearTimeout(timer);
    }
  });
  // Promise.any resolves on the first success and only rejects if all fail
  try {
    return await Promise.any(attempts);
  } catch (agg) {
    const first = agg && agg.errors && agg.errors[0];
    throw new Error(first ? first.message : 'relay unavailable');
  }
}

function parseGnewsRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const pick = (tag) => {
      const t = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      if (!t) return '';
      const cdata = t[1].trim().match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
      return decodeXmlEntities((cdata ? cdata[1] : t[1]).trim());
    };
    let title = pick('title');
    const link = pick('link');
    const pubDate = pick('pubDate');
    const srcM = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const source = srcM ? decodeXmlEntities(srcM[1].trim()) : '';
    // Google appends " - <source>" to every headline
    if (source && title.endsWith(` - ${source}`)) {
      title = title.slice(0, -(source.length + 3)).trim();
    }
    if (!title || !link) continue;
    out.push({ title, link, source, pubDate });
  }
  return out;
}

function decodeXmlEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// Returns rows shaped like the GDELT branch so the caller treats both alike.
async function gnewsFetch(tracker, from, to) {
  const query = tracker.kr || (tracker.any.length ? tracker.any.join(' OR ')
    : tracker.all.join(' '));
  if (!query.trim()) throw new Error('검색어가 없습니다');
  const xml = await fetchViaRelay(gnewsUrl(query, from, to));
  return parseGnewsRss(xml).map((it) => ({
    url: it.link,
    title: it.title,
    seendate: null,
    isoDate: it.pubDate ? new Date(it.pubDate).toISOString() : null,
    domain: it.source,
  }));
}

function gdeltStamp(date, endOfDay) {
  return date.replace(/-/g, '') + (endOfDay ? '235959' : '000000');
}

// GDELT returns seendate as 20260805T143000Z
function parseSeenDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
}

async function gdeltFetch(tracker, from, to) {
  const query = `(${tracker.en}) sourcecountry:southkorea sourcelang:korean`;
  const url = `${GDELT_URL}?query=${encodeURIComponent(query)}`
    + `&mode=artlist&maxrecords=${GDELT_MAX}&format=json&sort=datedesc`
    + `&startdatetime=${gdeltStamp(from, false)}&enddatetime=${gdeltStamp(to, true)}`;
  let res;
  try {
    res = await fetch(url);
  } catch {
    // A throttled GDELT reply carries no Access-Control-Allow-Origin, so the
    // browser blocks it and fetch rejects before any status is visible.
    // Treat every network-level failure as rate limiting and back off.
    throw new Error('rate');
  }
  if (res.status === 429) throw new Error('rate');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // errors come back as plain text, not JSON
  if (!text.trim().startsWith('{')) {
    const msg = text.trim();
    if (/limit requests/i.test(msg)) throw new Error('rate');
    throw new Error(msg.slice(0, 90));
  }
  return JSON.parse(text).articles || [];
}

// A GDELT hit matches on full text, so unrelated stories slip in. Keep only
// those whose title also satisfies the tracker's Korean rule when it has one.
function backfillKeeps(tracker, title) {
  if (!tracker.all.length && !tracker.any.length) return true;
  return trackerMatches(tracker, { title });
}

async function runBackfill(tracker, onProgress, opts) {
  const force = !!(opts && opts.force);
  const seen = new Set(tracker.events.map((e) => e.url));
  for (const u of tracker.dropped || []) seen.add(u);
  for (const u of tracker.skippedUrls || []) seen.add(u);

  const from = tracker.from || monthsAgo(6);
  const to = dayOf(null);

  // Only sweep what has not been covered yet. Moving the start date earlier
  // adds the newly exposed span in front; the rest is already in the
  // timeline, so re-requesting it would only burn rate limit.
  const spans = [];
  const done = force ? null : tracker.backfilledFrom;
  if (done && done > from) {
    spans.push([from, done]);            // newly exposed older span
    spans.push([tracker.backfilledTo || done, to]); // anything since last run
  } else if (done && !force) {
    spans.push([tracker.backfilledTo || done, to]);
  } else {
    spans.push([from, to]);
  }
  // windows a throttled run never answered; retry them before anything else
  if (!force && tracker.pendingSpans) {
    spans.unshift(...tracker.pendingSpans.filter(([a, b]) => a >= from && b <= to));
  }

  // One response caps at GDELT_MAX rows, so a busy window silently loses its
  // older half. Start at a month and split any window that comes back full.
  // Measured: a two-week window on a peak news event already hits the cap.
  const queue = [];
  for (const [spanFrom, spanTo] of spans) {
    if (!spanFrom || !spanTo || spanFrom >= spanTo) continue;
    let cur = spanFrom;
    while (cur < spanTo) {
      const d = new Date(`${cur}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      const next = d.toISOString().slice(0, 10);
      queue.push([cur, next > spanTo ? spanTo : next]);
      cur = next;
    }
  }
  // Newest month first. A two-year span is two dozen windows before any of them
  // splits, and a busy one splits several times over — so an oldest-first queue
  // spends itself on the quiet beginning of an issue and never reaches the part
  // the reader cares about. Observed on a war tracked from 2024: the timeline
  // stopped dead at the month fighting began.
  queue.reverse();
  if (!queue.length) {
    return { added: 0, skipped: 0, requests: 0, truncated: 0, filtered: 0, capped: 0, upToDate: true };
  }

  // split down to a single day; a day with more than GDELT_MAX articles is
  // irreducible and gets reported as truncated
  const MIN_SPLIT_DAYS = 1;
  const dayGap = (a, b) =>
    Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
  const midpoint = (a, b) => {
    const t = new Date(`${a}T00:00:00Z`).getTime()
      + (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 2;
    return new Date(t).toISOString().slice(0, 10);
  };

  const perDay = tracker.perDay || DEFAULT_PER_DAY;
  const allSources = !!tracker.allSources;
  const candidates = [];
  // What actually made it onto the timeline, so a signed-in run can upload it
  const collected = [];

  let added = 0;
  let skipped = 0;
  let requests = 0;
  let truncated = 0;
  let filtered = 0;
  let capped = 0;
  let consecutiveRateFails = 0;
  let rateBlocked = false;
  let usedGnews = false;
  let usedGdelt = false;
  let gnewsError = null;
  const unfinished = [];

  while (queue.length) {
    const [ws, we] = queue.shift();
    requests++;
    onProgress(`${ws} ~ ${we} · ${requests}회 요청 · ${added}건`);

    // Google News first: it matches the Korean keywords and carries the wires.
    // Fall back to GDELT when the free relays are down.
    let arts = null;
    if (!tracker.sourceApi || tracker.sourceApi === 'gnews') {
      try {
        arts = await gnewsFetch(tracker, ws, we);
        usedGnews = true;
      } catch (err) {
        gnewsError = err.message;
      }
    }

    // GDELT throttles hard once it has seen a burst, so wait longer each try
    if (arts === null && tracker.en) {
      for (let attempt = 0; attempt < RATE_BACKOFF.length && arts === null; attempt++) {
        try {
          arts = await gdeltFetch(tracker, ws, we);
          usedGdelt = true;
        } catch (err) {
          if (err.message !== 'rate') throw err;
          const wait = RATE_BACKOFF[attempt];
          if (wait === 0) break;
          onProgress(`요청 제한 — ${Math.round(wait / 1000)}초 대기 후 재시도 (${ws})`);
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }
    if (arts === null) {
      skipped++;
      unfinished.push([ws, we]);
      consecutiveRateFails++;
      // the whole IP is blocked; further windows would only fail the same way
      if (consecutiveRateFails >= 3) {
        rateBlocked = true;
        unfinished.push(...queue);
        break;
      }
      continue;
    }
    consecutiveRateFails = 0;

    // A full response means older articles in this span were cut off. Google
    // News stops at 100 rows per query, GDELT at 250.
    const cap = arts.length && arts[0].isoDate !== undefined ? GNEWS_MAX : GDELT_MAX;
    if (arts.length >= cap && dayGap(ws, we) > MIN_SPLIT_DAYS) {
      const mid = midpoint(ws, we);
      queue.unshift([ws, mid], [mid, we]);
    } else if (arts.length >= cap) {
      truncated++;
    }

    for (const a of arts) {
      if (!a.url || seen.has(a.url)) continue;
      const title = (a.title || '').trim();
      if (!title || !backfillKeeps(tracker, title)) continue;
      if (isBlockedSource(a.domain)) { filtered++; continue; }
      if (!allSources && !isMajorDomain(a.domain)) { filtered++; continue; }
      seen.add(a.url);
      candidates.push({
        date: dayOf(a.isoDate || parseSeenDate(a.seendate)),
        title,
        source: a.domain || '',
        url: a.url,
      });
    }
    // GDELT publishes a 1-request-per-5s limit; the relays need no such pause
    if (queue.length) {
      await new Promise((r) => setTimeout(r, usedGdelt ? 5500 : 400));
    }
  }

  // Keep only the top few per day. Sources earlier in MAJOR_DOMAINS (wires,
  // broadcast) win the slots, and near-identical titles collapse together.
  const byDay = new Map();
  for (const c of candidates) {
    if (!byDay.has(c.date)) byDay.set(c.date, []);
    byDay.get(c.date).push(c);
  }
  const rank = (dom) => {
    const d = (dom || '').toLowerCase();
    const i = MAJOR_DOMAINS.findIndex((x) => d === x || d.endsWith(`.${x}`) || x.endsWith(`.${d}`));
    return i < 0 ? MAJOR_DOMAINS.length : i;
  };
  // URLs rejected by the cap are remembered too, otherwise the next run
  // re-fetches them and the timeline keeps growing past the limit
  if (!tracker.skippedUrls) tracker.skippedUrls = [];
  const stamp = new Date().toISOString();
  // Seeded with the entries already on the timeline: without this a sweep
  // re-adds the same story the live feed collected under a different url,
  // and the day fills up with rewrites of one headline.
  const index = dedupIndex(tracker);
  for (const [day, list] of byDay) {
    list.sort((a, b) => rank(a.source) - rank(b.source));
    const already = (index.get(day) || []).length;
    const kept = [];
    for (const c of list) {
      const tk = titleTokens(c.title);
      if (isDuplicate(index, day, c.title)
          || kept.some((k) => similar(k.tk, tk) >= DEDUP_SIM)
          || kept.length + already >= perDay) {
        capped++;
        tracker.skippedUrls.push(c.url);
        continue;
      }
      kept.push({ ...c, tk });
      indexAdd(index, day, c.title);
      collected.push(c);
      tracker.events.push({
        date: c.date,
        title: c.title,
        source: c.source,
        url: c.url,
        coverage: 0,
        past: true,
        addedAt: stamp,
      });
      added++;
    }
  }

  tracker.backfilledAt = new Date().toISOString();
  // The range still advances so finished windows are not re-requested; the
  // windows that never answered are kept separately and retried next time.
  tracker.backfilledFrom = tracker.backfilledFrom && !force
    ? (from < tracker.backfilledFrom ? from : tracker.backfilledFrom)
    : from;
  tracker.backfilledTo = to;
  tracker.pendingSpans = unfinished.length ? unfinished : undefined;
  sortEvents(tracker);
  markTrackerSeen(tracker);
  save();
  return {
    added, skipped, requests, truncated, filtered, capped, rateBlocked,
    usedGnews, usedGdelt, gnewsError, collected,
  };
}

function backfillQuery(tracker) {
  return (tracker.kr
    || (tracker.any.length ? tracker.any.join(' OR ') : tracker.all.join(' '))
    || '').trim();
}

// One action instead of three. "Update" means: take today's feed, then sweep
// the whole span from the issue's start date to now, and merge both into the
// single timeline. The user picked the issue by reading an article, so they
// should not have to know that recent news and old news arrive by different
// routes.
async function runUpdate(tracker, onProgress) {
  // History is searched here even for a server-backed issue: Google answers 503
  // to Cloudflare, and this device can reach it. What is found is uploaded, so
  // the timeline still ends up on the account and on every other device.
  if (isRemote(tracker)) {
    const r = await runBackfill(tracker, onProgress, { force: false });
    onProgress('서버에 올리는 중…');
    await uploadEvents(tracker, r.collected || []);
    const full = await pullTimeline(tracker);
    Object.assign(tracker, full);
    return { sweep: r, fromFeed: 0, feedOk: true, sweepError: null };
  }
  onProgress('최신 뉴스 확인 중…');
  const before = tracker.events.length;
  let feedOk = true;
  try {
    feedOk = await refreshNews();
  } catch {
    feedOk = false;
  }
  const fromFeed = tracker.events.length - before;

  let sweep = null;
  let sweepError = null;
  if (backfillQuery(tracker) || tracker.en) {
    try {
      sweep = await runBackfill(tracker, onProgress, { force: false });
    } catch (err) {
      sweepError = err.message;
    }
  }
  return { feedOk, fromFeed, sweep, sweepError };
}

function updateSummary(r) {
  if (r.server) {
    const w = r.sweep || {};
    if (w.upToDate) {
      return '이미 다 모았습니다. 더 과거를 보려면 시작일을 앞당기세요.';
    }
    const out = [w.added ? `기사 ${w.added}건을 추가했습니다.` : '새로 추가된 기사가 없습니다.'];
    if (w.capped) out.push(`중복·하루 상한으로 ${w.capped}건 제외.`);
    if (w.complete === false) out.push('남은 구간은 다음 자동 수집 때 이어서 채웁니다.');
    if (w.failed) out.push(`${w.failed}개 구간을 받지 못했습니다.`);
    return out.join(' ');
  }
  const parts = [];
  const swept = r.sweep && !r.sweep.upToDate ? r.sweep.added : 0;
  const total = r.fromFeed + swept;
  parts.push(total ? `기사 ${total}건을 타임라인에 추가했습니다.` : '새로 추가된 기사가 없습니다.');
  if (r.fromFeed && swept) parts.push(`(최신 ${r.fromFeed}건 · 과거 ${swept}건)`);
  if (r.sweep && r.sweep.upToDate) {
    parts.push('설정한 시작일까지는 이미 다 모았습니다. 더 과거를 보려면 시작일을 앞당기세요.');
  }
  if (r.sweep && r.sweep.capped) parts.push(`중복·하루 상한으로 ${r.sweep.capped}건 제외.`);
  if (r.sweep && r.sweep.rateBlocked) {
    parts.push('요청 제한으로 일부 구간을 못 받았습니다. 잠시 후 다시 누르면 이어서 채웁니다.');
  } else if (r.sweep && r.sweep.skipped) {
    parts.push(`${r.sweep.skipped}개 구간은 나중에 이어서 채웁니다.`);
  }
  if (r.sweepError) parts.push(`과거 수집 실패: ${r.sweepError}`);
  if (!r.feedOk) parts.push('최신 뉴스 갱신에 실패했습니다.');
  return parts.join(' ');
}

// Shown while an update runs so the sweep's progress is visible; on finish it
// hands straight back to the timeline with the result as a notice.
function openTrackerUpdate(tracker, auto = false) {
  openPanel('업데이트', (body) => {
    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', tracker.name));
    sec.appendChild(el('p', 'choice-hint',
      `${tracker.from || monthsAgo(6)} 부터 오늘까지의 관련 기사를 모아 날짜순으로 이어붙입니다. `
      + `검색어: ${backfillQuery(tracker) || '(없음)'}`));
    body.appendChild(sec);

    const status = el('p', 'placeholder', '');
    const run = el('button', 'primary', '지금 업데이트');
    run.style.width = '100%';

    const go = async () => {
      run.disabled = true;
      run.textContent = '업데이트 중…';
      try {
        const r = await runUpdate(tracker, (msg) => { status.textContent = msg; });
        rebuildPages();
        openTrackerTimeline(tracker, updateSummary(r));
      } catch (err) {
        status.textContent = `실패: ${err.message}`;
        run.disabled = false;
        run.textContent = '다시 시도';
      }
    };
    run.addEventListener('click', go);
    body.appendChild(run);
    body.appendChild(status);

    const opts = el('button', 'add-dashed', '⚙ 수집 범위·매체 설정');
    opts.addEventListener('click', () => openBackfill(tracker));
    body.appendChild(opts);

    if (auto) go();
  });
}

function openBackfill(tracker) {
  if (!backfillQuery(tracker) && !tracker.en) {
    openSheet('과거 소급', [{
      label: '검색어를 먼저 입력하세요',
      onClick() { openTrackerEditor(tracker); },
    }]);
    return;
  }
  openPanel('과거 소급', (body) => {
    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', tracker.name));
    sec.appendChild(el('p', 'choice-hint',
      `Google 뉴스에서 과거 기사를 가져옵니다. 검색어: ${backfillQuery(tracker) || '(없음)'}`
      + (tracker.en ? ` · 예비: GDELT (${tracker.en})` : '')
      + ' · 한 달씩 나눠 요청합니다.'));

    // The start date belongs here, not only in the issue editor: deciding how
    // far back to go is part of running the sweep.
    sec.appendChild(el('div', 'set-title mt', '어디까지 거슬러 갈까요'));
    const fromIn = el('input', 'in');
    fromIn.type = 'date';
    fromIn.value = tracker.from || monthsAgo(6);
    fromIn.addEventListener('change', () => {
      if (!fromIn.value) return;
      tracker.from = fromIn.value;
      save();
      openBackfill(tracker);
    });
    sec.appendChild(fromIn);

    const quick = el('div', 'segrow');
    for (const [label, months] of [['6개월', 6], ['1년', 12], ['2년', 24], ['3년', 36]]) {
      const d = monthsAgo(months);
      const b = el('button', 'seg' + (fromIn.value === d ? ' on' : ''), label);
      b.addEventListener('click', () => {
        tracker.from = d;
        save();
        openBackfill(tracker);
      });
      quick.appendChild(b);
    }
    sec.appendChild(quick);
    body.appendChild(sec);

    const opt = el('div', 'set-section');
    opt.appendChild(el('div', 'set-title', '하루에 남길 기사 수'));
    const segRow = el('div', 'segrow');
    for (const n of [1, 2, 3, 5]) {
      const cur = tracker.perDay || DEFAULT_PER_DAY;
      const b = el('button', 'seg' + (cur === n ? ' on' : ''), `${n}건`);
      b.addEventListener('click', () => {
        tracker.perDay = n;
        // previously capped articles must be reconsidered under the new limit
        tracker.skippedUrls = [];
        save();
        openBackfill(tracker);
      });
      segRow.appendChild(b);
    }
    opt.appendChild(segRow);
    opt.appendChild(el('p', 'choice-hint',
      '같은 날 기사가 많으면 주요 매체 순으로 이만큼만 남깁니다. 비슷한 제목은 한 건으로 묶습니다.'));

    const srcRow = el('label', 'set-row set-choice');
    const chk = el('input');
    chk.type = 'checkbox';
    chk.checked = !!tracker.allSources;
    chk.addEventListener('change', () => {
      tracker.allSources = chk.checked;
      tracker.skippedUrls = [];
      save();
    });
    srcRow.appendChild(chk);
    const stx = el('div', 'choice-tx');
    stx.appendChild(el('span', 'choice-label', '모든 매체 포함'));
    stx.appendChild(el('span', 'choice-hint',
      `기본은 주요 매체 ${MAJOR_DOMAINS.length}곳(통신사·지상파·주요 일간지·경제지)만 가져옵니다.`));
    srcRow.appendChild(stx);
    opt.appendChild(srcRow);
    body.appendChild(opt);

    const status = el('p', 'placeholder', '');

    const start = async (force) => {
      status.textContent = '준비 중…';
      try {
        const r = await runBackfill(tracker, (msg) => {
          status.textContent = `수집 중… ${msg}`;
        }, { force });
        if (r.upToDate) {
          status.textContent = '이미 소급된 구간입니다. 더 과거를 보려면 시작일을 앞당기세요.';
          return;
        }
        const via = [r.usedGnews && 'Google 뉴스', r.usedGdelt && 'GDELT']
          .filter(Boolean).join(' + ');
        const notes = [`${r.added}건 추가 (${via || '없음'}, 요청 ${r.requests}회).`];
        if (r.usedGdelt && r.gnewsError) {
          notes.push('Google 뉴스 중계가 응답하지 않아 GDELT 로 대체했습니다.');
        }
        if (r.filtered) notes.push(`주요 매체가 아닌 ${r.filtered}건 제외.`);
        if (r.capped) notes.push(`하루 상한·중복으로 ${r.capped}건 제외.`);
        if (r.rateBlocked) {
          notes.push('GDELT 가 요청을 계속 거부해 중단했습니다 (초당 요청 제한). '
            + '몇 분 뒤 다시 누르면 남은 구간부터 이어서 채웁니다.');
        } else if (r.skipped) {
          notes.push(`${r.skipped}개 구간은 요청 제한으로 건너뜀 — 잠시 후 다시 실행하면 이어서 채웁니다.`);
        }
        if (r.truncated) notes.push(`${r.truncated}개 구간은 기사가 너무 많아 일부만 가져왔습니다.`);
        status.textContent = notes.join(' ');
        rebuildPages();
      } catch (err) {
        status.textContent = `실패: ${err.message}`;
      }
    };

    const run = el('button', 'primary', tracker.backfilledFrom ? '이어서 가져오기' : '가져오기 시작');
    run.style.width = '100%';
    run.addEventListener('click', async () => {
      run.disabled = true;
      await start(false);
      run.disabled = false;
    });
    body.appendChild(run);

    if (tracker.backfilledFrom) {
      const redo = el('button', 'add-dashed', '↻ 처음부터 다시 가져오기');
      redo.addEventListener('click', async () => {
        if (!confirm('이미 가져온 구간까지 전부 다시 요청합니다. 시간이 오래 걸립니다.')) return;
        redo.disabled = true;
        tracker.skippedUrls = [];
        await start(true);
        redo.disabled = false;
      });
      body.appendChild(redo);
    }

    body.appendChild(status);

    if (tracker.backfilledAt) {
      body.appendChild(el('p', 'choice-hint',
        `이미 가져온 구간: ${tracker.backfilledFrom} ~ ${tracker.backfilledTo || '?'}`
        + ` (${relTime(tracker.backfilledAt)}). 시작일을 앞당기면 그 앞부분만 추가로 가져옵니다.`));
    }
  });
}

function openTrackerEditor(tracker) {
  const editing = !!tracker;
  const draft = tracker
    ? { ...tracker, all: [...tracker.all], any: [...tracker.any], events: [...tracker.events] }
    : { id: `t-${Date.now()}`, name: '', all: [], any: [], status: 'active', events: [] };

  openPanel(editing ? '이슈 편집' : '이슈 추가', (body) => {
    const nameSec = el('div', 'set-section');
    nameSec.appendChild(el('div', 'set-title', '이슈 이름'));
    const nameIn = el('input', 'in');
    nameIn.placeholder = '예: 미국-이란 전쟁';
    nameIn.value = draft.name;
    nameSec.appendChild(nameIn);
    body.appendChild(nameSec);

    const mkKeywords = (title, hint, key) => {
      const sec = el('div', 'set-section');
      sec.appendChild(el('div', 'set-title', title));
      const box = el('div', 'chipbox');
      const redraw = () => {
        box.textContent = '';
        if (!draft[key].length) {
          box.appendChild(el('span', 'w-empty', '없음'));
          return;
        }
        draft[key].forEach((w, i) => {
          const chip = el('span', 'x-chip');
          chip.appendChild(el('span', null, w));
          const x = el('button', 'x', '✕');
          x.setAttribute('aria-label', `${w} 삭제`);
          x.addEventListener('click', () => { draft[key].splice(i, 1); redraw(); });
          chip.appendChild(x);
          box.appendChild(chip);
        });
      };
      redraw();
      sec.appendChild(box);
      sec.appendChild(el('p', 'choice-hint', hint));
      const form = el('div', 'add-form');
      const input = el('input', 'in');
      input.placeholder = '키워드';
      const add = el('button', 'primary', '추가');
      const commit = () => {
        const v = input.value.trim();
        if (!v) return;
        addUnique(draft[key], v);
        input.value = '';
        redraw();
      };
      add.addEventListener('click', commit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
      form.appendChild(input);
      form.appendChild(add);
      sec.appendChild(form);
      body.appendChild(sec);
    };

    mkKeywords('필수 키워드 (AND)', '제목에 이 단어가 모두 있어야 수집됩니다.', 'all');
    mkKeywords('선택 키워드 (OR)',
      '이 중 하나라도 제목에 있으면 수집됩니다. '
      + '둘 다 비워두면 자동 수집 없이 직접 추가·AI 로만 채웁니다.', 'any');

    const gsec = el('div', 'set-section');
    gsec.appendChild(el('div', 'set-title', '과거 소급 검색어 (한국어)'));
    const krIn = el('input', 'in');
    krIn.placeholder = '예: 이란 이스라엘 (비우면 위 키워드 사용)';
    krIn.value = draft.kr || '';
    gsec.appendChild(krIn);
    gsec.appendChild(el('p', 'choice-hint',
      'Google 뉴스에서 과거 기사를 찾을 때 쓰는 검색어입니다. 비우면 위의 선택 키워드를 씁니다.'));

    // GDELT is the fallback when the CORS relays are unreachable; it cannot
    // match Korean, so it needs its own English terms.
    gsec.appendChild(el('div', 'set-title mt', '예비 검색어 (영어)'));
    const enIn = el('input', 'in');
    enIn.placeholder = '예: iran OR iranian';
    enIn.value = draft.en || '';
    gsec.appendChild(enIn);
    gsec.appendChild(el('p', 'choice-hint',
      'Google 뉴스를 못 쓸 때 GDELT 로 대신 가져옵니다. GDELT 는 한국어 검색이 안 되어 영어가 필요합니다. 비워도 됩니다.'));

    gsec.appendChild(el('div', 'set-title mt', '소급 시작일'));
    const fromIn = el('input', 'in');
    fromIn.type = 'date';
    fromIn.value = draft.from || monthsAgo(6);
    gsec.appendChild(fromIn);
    gsec.appendChild(el('p', 'choice-hint',
      '기본 6개월 전. 이슈가 더 오래됐으면 앞당기세요.'));
    body.appendChild(gsec);

    const statSec = el('div', 'set-section');
    statSec.appendChild(el('div', 'set-title', '상태'));
    for (const [key, label] of Object.entries(TRACKER_STATUS)) {
      const row = el('label', 'set-row set-choice');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'tk-status';
      radio.checked = draft.status === key;
      radio.addEventListener('change', () => { draft.status = key; });
      row.appendChild(radio);
      const tx = el('div', 'choice-tx');
      tx.appendChild(el('span', 'choice-label', label));
      tx.appendChild(el('span', 'choice-hint',
        key === 'active' ? '새 기사를 계속 모읍니다.' : '수집을 멈추고 타임라인만 보관합니다.'));
      row.appendChild(tx);
      statSec.appendChild(row);
    }
    body.appendChild(statSec);

    const saveBtn = el('button', 'primary', editing ? '저장' : '＋ 이슈 추가');
    saveBtn.style.width = '100%';
    saveBtn.addEventListener('click', () => {
      const name = nameIn.value.trim();
      if (!name) {
        nameIn.focus();
        return;
      }
      // Keywords are optional: an issue can be filled entirely by hand or
      // from an AI-written timeline, in which case nothing is auto-collected.
      draft.name = name;
      draft.kr = krIn.value.trim();
      draft.en = enIn.value.trim();
      draft.from = fromIn.value || monthsAgo(6);

      // Signed in, every issue is a server issue — including new ones, so a
      // user who has an account never accumulates a second local set.
      if (serverBacked()) {
        const payload = {
          name: draft.name, all: draft.all, any: draft.any, kr: draft.kr,
          en: draft.en, from: draft.from, status: draft.status,
          perDay: draft.perDay, allSources: draft.allSources, order: draft.order,
        };
        saveBtn.disabled = true;
        const done = () => pullTrackers().then(() => {
          closeOverlay();
          rebuildPages();
        }).catch(() => { saveBtn.disabled = false; });
        if (editing && isRemote(tracker)) {
          api(`/trackers/${tracker.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
            .then(done).catch((err) => { saveBtn.disabled = false; toast(err.message); });
        } else {
          api('/trackers', { method: 'POST', body: JSON.stringify(payload) })
            .then(done).catch((err) => { saveBtn.disabled = false; toast(err.message); });
        }
        return;
      }

      if (editing) {
        const i = S.trackers.findIndex((t) => t.id === tracker.id);
        if (i >= 0) S.trackers[i] = draft;
      } else {
        S.trackers.push(draft);
      }
      save();
      collectTrackers();
      // the first sweep is the issue's backlog, not unread news
      if (!editing) markTrackerSeen(draft);
      closeOverlay();
      rebuildPages();
    });
    body.appendChild(saveBtn);
  });
}

// Days the reader expanded, and which issue they belong to. Kept outside the
// panel because the timeline is redrawn from scratch on every sort flip, delete
// and refresh, and collapsing what someone just opened would be its own bug —
// but tied to a tracker id, so opening a different issue does not inherit it.
let expandedDays = new Set();
let expandedFor = null;

// How many articles a day shows before it folds. The collection keeps
// everything; this is only what the eye sees first, so the number can change
// without re-collecting anything.
const DAY_PREVIEW = 2;

function openTrackerTimeline(tracker, refreshNotice = '') {
  // Server trackers arrive from the list without their events; fetch them on
  // first open, then re-enter with the full object.
  if (tracker._partial) {
    openPanel(tracker.name, (body) => {
      body.appendChild(el('p', 'placeholder', '불러오는 중…'));
    });
    pullTimeline(tracker)
      .then((full) => openTrackerTimeline(full, refreshNotice))
      .catch((err) => openPanel(tracker.name, (body) => {
        body.appendChild(el('p', 'placeholder', `불러오지 못했습니다: ${err.message}`));
      }));
    return;
  }
  if (expandedFor !== tracker.id) {
    expandedDays = new Set();
    expandedFor = tracker.id;
  }
  markTrackerSeen(tracker);
  openPanel(tracker.name, (body) => {
    const order = tracker.order || 'desc';
    const bar = el('div', 'sortrow');
    bar.appendChild(el('span', null,
      `${TRACKER_STATUS[tracker.status]} · ${tracker.events.length}건`));

    // Sorting is the one control that has to stay visible: the same timeline
    // reads as "what is happening now" from the top and "how this started"
    // from the bottom, and which one is wanted changes per issue.
    const sortBtn = el('button', 'sort-btn',
      order === 'desc' ? '↓ 최신순' : '↑ 오래된순');
    sortBtn.addEventListener('click', () => {
      tracker.order = order === 'desc' ? 'asc' : 'desc';
      if (isRemote(tracker)) {
        api(`/trackers/${tracker.id}`, {
          method: 'PATCH', body: JSON.stringify({ order: tracker.order }),
        }).catch(() => {});
      } else {
        save();
      }
      openTrackerTimeline(tracker, refreshNotice);
    });
    bar.appendChild(sortBtn);

    if (tracker.status === 'active') {
      const upd = el('button', 'sort-btn primary-btn', '↻ 업데이트');
      upd.addEventListener('click', () => openTrackerUpdate(tracker, true));
      bar.appendChild(upd);
    }
    const more = el('button', 'sort-btn', '⋯');
    more.setAttribute('aria-label', '이슈 옵션');
    more.addEventListener('click', () => {
      openSheet(tracker.name, [
        { label: '✦ 관련 없는 기사 정리 (AI)', onClick() { openAiFilter(tracker); } },
        { label: '✦ 흐름 요약 (AI)', onClick() { openAiSummary(tracker); } },
        { label: '＋ 뉴스에서 골라 추가', onClick() { openPickArticles(tracker); } },
        { label: '✎ 직접 입력해 추가', onClick() { openNoteEditor(tracker, null); } },
        { label: '⚙ 수집 범위·매체 설정', onClick() { openBackfill(tracker); } },
        { label: '✎ 이슈 편집', onClick() { openTrackerEditor(tracker); } },
        { label: '✦ AI로 채우기', onClick() { openAiImport(tracker); } },
      ]);
    });
    bar.appendChild(more);
    body.appendChild(bar);

    if (refreshNotice) body.appendChild(el('p', 'set-desc', refreshNotice));

    const days = eventsByDay(tracker, order);
    if (!days.length) {
      body.appendChild(el('p', 'placeholder',
        '아직 모인 기사가 없습니다. 업데이트를 누르면 시작일부터 오늘까지의 기사를 모읍니다.'));
      const first = el('button', 'primary', '↻ 지금 업데이트');
      first.style.width = '100%';
      first.addEventListener('click', () => openTrackerUpdate(tracker, true));
      body.appendChild(first);
      const pick = el('button', 'add-dashed', '＋ 뉴스에서 직접 골라 넣기');
      pick.addEventListener('click', () => openPickArticles(tracker));
      body.appendChild(pick);
      return;
    }

    // A span reads as a period, not a pile: the two ends of the timeline and
    // how long the issue has been running.
    const span = el('p', 'set-desc',
      `${days[order === 'desc' ? days.length - 1 : 0].date}`
      + ` ~ ${days[order === 'desc' ? 0 : days.length - 1].date}`
      + ` · ${days.length}일`);
    body.appendChild(span);

    const tl = el('div', 'tl');
    days.forEach((day, i) => {
      const row = el('div', 'tl-day');
      const rail = el('div', 'tl-rail');
      const peak = Math.max(...day.list.map((e) => e.coverage || 0), 0);
      rail.appendChild(el('div', 'tl-dot' + (peak >= 5 ? ' big' : '')));
      if (i < days.length - 1) rail.appendChild(el('div', 'tl-line'));
      row.appendChild(rail);

      const bodyCol = el('div', 'tl-body');
      const card = el('div', 'tl-card');

      const head = el('div', 'tl-head');
      head.appendChild(el('span', 'tl-date', day.date));
      head.appendChild(el('span', 'tl-dow', dowOf(day.date)));
      head.appendChild(el('span', 'tl-count', `${day.list.length}건`));
      card.appendChild(head);

      // A day shows its most-reported few and folds the rest. What the issue is
      // for is the shape of the story over time, and twenty articles from one
      // busy day hide that shape rather than adding to it.
      const open = expandedDays.has(day.date);
      const shown = open ? day.list : day.list.slice(0, DAY_PREVIEW);
      const hidden = day.list.length - shown.length;

      const ul = el('ul', 'tl-links');
      for (const ev of shown) {
        const li = el('li');
        if (ev.note) {
          const box = el('div', 'tl-note');
          const tx = el('div', 'nt', ev.title);
          tx.addEventListener('click', () => openNoteEditor(tracker, ev));
          box.appendChild(tx);
          box.appendChild(el('span', 'nb', ev.ai ? 'AI 추가' : '직접 기록'));
          li.appendChild(box);
        } else {
          const a = el('a', null, ev.title);
          a.href = ev.url;
          a.rel = 'noreferrer';
          if (openMode() === 'newtab') {
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
          } else if (openMode() === 'reader') {
            a.addEventListener('click', (e) => {
              e.preventDefault();
              openReader({ title: ev.title, link: ev.url, source: ev.source });
            });
          } else {
            a.addEventListener('click', () => saveViewState());
          }
          a.appendChild(el('span', 'tl-src',
            [ev.source, ev.ai ? 'AI 추가' : '',
             ev.coverage >= 5 ? `${ev.coverage}곳 보도` : ''].filter(Boolean).join(' · ')));
          li.appendChild(a);

          // a linked entry opens the article, so editing needs its own control
          const pen = el('button', 'tl-x', '✎');
          pen.setAttribute('aria-label', '이 항목 편집');
          pen.addEventListener('click', () => openNoteEditor(tracker, ev));
          li.appendChild(pen);
        }

        const x = el('button', 'tl-x', '✕');
        x.setAttribute('aria-label', '타임라인에서 삭제');
        x.addEventListener('click', () => {
          // ✕ sits right next to the article link, so a mistap must not
          // silently drop an entry — a removed article never comes back
          // on its own either, since its url goes on the dropped list.
          const label = ev.title.length > 34 ? `${ev.title.slice(0, 34)}…` : ev.title;
          confirmSheet(`${ev.date} · ${label}`, '✕ 타임라인에서 삭제', () => {
            removeEvent(tracker, ev);
            openTrackerTimeline(tracker);
          });
        });
        li.appendChild(x);
        ul.appendChild(li);
      }
      card.appendChild(ul);

      if (hidden > 0 || open) {
        const more = el('button', 'tl-more', open
          ? '⌃ 접기'
          : `⌄ 이 날 기사 ${hidden}건 더 보기`);
        more.addEventListener('click', () => {
          if (open) expandedDays.delete(day.date);
          else expandedDays.add(day.date);
          openTrackerTimeline(tracker, refreshNotice);
        });
        card.appendChild(more);
      }

      bodyCol.appendChild(card);
      row.appendChild(bodyCol);
      tl.appendChild(row);
    });
    body.appendChild(tl);
  });
}

// The other direction of manual adding. Pinning from the feed means finding
// the article first; here the issue is already open and the whole feed is
// searchable from inside it, which is what "add this news by hand" usually
// means once the keyword rule has missed something.
function openPickArticles(tracker) {
  openPanel('뉴스에서 고르기', (body) => {
    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', tracker.name));
    sec.appendChild(el('p', 'choice-hint',
      '수집된 뉴스에서 직접 골라 타임라인에 넣습니다. 키워드가 놓친 기사를 넣을 때 씁니다.'));
    body.appendChild(sec);

    const search = el('input', 'in');
    search.type = 'search';
    search.placeholder = '제목 검색';
    body.appendChild(search);

    // seeded with the issue's own keywords: the article that is missing is
    // usually near the ones that matched, not at the top of the whole feed
    search.value = (tracker.any[0] || tracker.all[0] || '');

    const count = el('p', 'choice-hint pick-count', '');
    body.appendChild(count);
    const list = el('div', 'pick-list');
    body.appendChild(list);

    const LIMIT = 40;

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const on = new Set(tracker.events.map((e) => e.url));
      // every collected category, not just the ones the news tab shows: an
      // article is missing from the timeline precisely because it fell
      // outside the usual filters, and a hidden category is one of those.
      const rows = [];
      for (const cat of newsData.categories) {
        for (const it of cat.items) {
          if (isBlocked(it)) continue;
          if (q && !it.title.toLowerCase().includes(q)) continue;
          rows.push({ it, cat: cat.name });
        }
      }
      // newest first, and one story that reaches several categories is listed once
      rows.sort((a, b) => (b.it.pubDate || '').localeCompare(a.it.pubDate || ''));
      const seenUrl = new Set();
      const uniq = rows.filter((r) => !seenUrl.has(r.it.link) && seenUrl.add(r.it.link));

      list.textContent = '';
      count.textContent = uniq.length
        ? `${uniq.length}건 중 ${Math.min(uniq.length, LIMIT)}건 표시`
        : '검색 결과가 없습니다.';

      for (const { it, cat } of uniq.slice(0, LIMIT)) {
        const row = el('div', 'pick-row');
        const tx = el('div', 'pick-tx');
        tx.appendChild(el('div', 'pick-title', it.title));
        tx.appendChild(el('div', 'pick-meta',
          [dayOf(it.pubDate), it.source, cat].filter(Boolean).join(' · ')));
        row.appendChild(tx);

        const added = on.has(it.link);
        const btn = el('button', added ? 'pick-btn on' : 'pick-btn', added ? '✓' : '＋');
        btn.setAttribute('aria-label', added ? '이미 추가됨' : '타임라인에 추가');
        btn.addEventListener('click', () => {
          if (on.has(it.link)) {
            const ev = tracker.events.find((e) => e.url === it.link);
            if (ev) removeEvent(tracker, ev);
            on.delete(it.link);
            btn.className = 'pick-btn';
            btn.textContent = '＋';
          } else {
            pinToTracker(tracker, it);
            on.add(it.link);
            btn.className = 'pick-btn on';
            btn.textContent = '✓';
          }
        });
        row.appendChild(btn);
        list.appendChild(row);
      }
    };

    let t = null;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(draw, 180);
    });
    draw();

    const done = el('button', 'primary', '완료');
    done.style.width = '100%';
    done.addEventListener('click', () => {
      rebuildPages();
      openTrackerTimeline(tracker);
    });
    body.appendChild(done);
  });
}

// Hand-written timeline entry: an event that has no article behind it, or one
// the keyword rule cannot express. Doubles as the editor for existing notes.
// ---------- import a timeline written by an AI ----------

// The prompt asks for `날짜 | 제목 | 언론사 | 링크`, but assistants drift into
// markdown tables, bullet lists and localized dates, so the parser accepts all
// of those rather than rejecting a paste over formatting.

// Written against a real failed session: without an explicit search order the
// assistant answers from memory and says the period is beyond its knowledge;
// restricted to Korean outlets it returns empty link columns because yna/ytn
// article URLs rarely surface in search results; and "leave it blank if
// unsure" becomes an excuse to blank every link. Hence: search first, allow
// foreign wires, and require a verified URL on every line.
function aiPrompt(tracker) {
  const from = tracker.from || monthsAgo(6);
  const perDay = tracker.perDay || 3;
  const kw = backfillQuery(tracker);
  return [
    `"${tracker.name}" 이슈의 진행 상황을 시간순 타임라인으로 정리해줘.`,
    '',
    '■ 먼저 웹 검색을 해라',
    '- 기억에 의존하지 말고 반드시 웹 검색으로 실제 기사를 찾을 것.',
    '- 사건마다 개별로 검색해서 그 기사의 실제 URL 을 확보할 것.',
    '- "학습 데이터 범위를 벗어난다" 같은 말 대신, 검색해서 확인할 것.',
    '',
    '■ 조건',
    `- 기간: ${from} 부터 오늘까지`,
    kw ? `- 관련 키워드: ${kw}` : '',
    `- 하루 최대 ${perDay}건, 흐름을 바꾼 주요 사건 위주로`,
    '- 이슈의 배경이 되는 초반 사건부터 포함할 것',
    '',
    '■ 링크 (가장 중요)',
    '- 모든 줄에 실제 URL 이 있어야 한다. 링크 없는 줄은 넣지 마라.',
    '- 검색 결과에 나온 URL 만 쓰고, 주소를 추측하거나 지어내지 마라.',
    '- 한국 언론(연합뉴스·YTN·KBS 등)은 기사 URL 이 검색에 잘 안 잡힌다.',
    '  한국 기사 링크를 못 찾으면 그 사건을 버리지 말고,',
    '  Reuters·AP·BBC·Al Jazeera·Axios·Euronews·CNN 등 해외 매체에서',
    '  같은 사건을 다룬 기사를 찾아 그 링크를 써라.',
    '- 링크를 도저히 못 찾은 사건은 아예 제외해라 (빈 칸으로 남기지 마라).',
    '',
    '■ 출력 형식 (반드시 지킬 것)',
    '아래 네 칸을 " | " 로 구분한 줄만 나열해라.',
    '',
    '날짜 | 제목 | 언론사 | 링크',
    '',
    '예시:',
    '2025-06-13 | 이스라엘, 이란 핵시설 선제공습 | Al Jazeera | https://www.aljazeera.com/news/2025/6/13/...',
    '2025-06-22 | 미국, 포르도 핵시설 직접 공습 | Reuters | https://www.reuters.com/world/...',
    '',
    '- 날짜는 YYYY-MM-DD, 오래된 것부터 순서대로.',
    '- 인사말·머리말·맺음말·번호·표·굵은글씨를 붙이지 마라.',
    '- 그대로 복사해서 붙여넣을 수 있게, 목록 외에는 아무것도 쓰지 마라.',
  ].filter((l) => l !== '').join('\n');
}

function normalizeDate(raw) {
  const s = (raw || '').trim().replace(/\s+/g, '');
  let m = /^(\d{4})[-./년]+(\d{1,2})[-./월]+(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  // 6/13/2025 or 13.6.2025
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

function parseAiTimeline(text) {
  const rows = [];
  const seen = new Set();
  for (let line of (text || '').split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    // drop markdown table rules and heading underlines
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-')) continue;
    // Strip bullets, list numbering and table pipes. The numbering pattern
    // must not swallow the year of "2025.06.13", so it needs a space after
    // the separator and at most two digits.
    line = line.replace(/^[-*•·]\s*/, '').replace(/^\d{1,2}[.)]\s+/, '');
    line = line.replace(/^\|/, '').replace(/\|$/, '');

    let cells = line.includes('|')
      ? line.split('|').map((c) => c.trim())
      : null;
    if (!cells) {
      // "2025-06-13: 제목" / "2025.06.13 제목" / "2025년 6월 13일 - 제목";
      // match the date shape itself so a comma in the title cannot split it
      const m = /^(\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?)\s*[:：\-–—]?\s*(.+)$/
        .exec(line);
      if (!m) continue;
      cells = [m[1], m[2]];
    }
    const date = normalizeDate(cells[0]);
    if (!date) continue;

    let title = (cells[1] || '').trim();
    let source = (cells[2] || '').trim();
    let url = (cells[3] || '').trim();

    // a url can land in any later cell
    for (let i = 2; i < cells.length; i++) {
      const c = (cells[i] || '').trim();
      if (/^https?:\/\//i.test(c)) { url = c; if (i === 2) source = ''; }
    }
    // pull a trailing "(연합뉴스)" out of the title when no source column
    if (!source) {
      const m = /^(.*)[（(]\s*([^()（）]{2,20})\s*[)）]\s*$/.exec(title);
      if (m) { title = m[1].trim(); source = m[2].trim(); }
    }
    if (!/^https?:\/\//i.test(url)) url = '';
    title = title.replace(/^\*+|\*+$/g, '').trim();
    if (!title || title.length < 2) continue;
    // skip a header row like "날짜 | 제목 | 언론사"
    if (/^(제목|title)$/i.test(title)) continue;

    const key = `${date}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ date, title, source, url });
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return rows;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // clipboard API needs a secure context; fall back to a hidden textarea
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const okc = document.execCommand('copy');
      document.body.removeChild(ta);
      return okc;
    } catch {
      return false;
    }
  }
}

// Reading the clipboard needs permission and a secure context; Safari also
// refuses outside a user gesture. Returns null so the caller can fall back to
// telling the user to paste by hand.
async function readClipboard() {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) return null;
    const text = await navigator.clipboard.readText();
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null;
  }
}

// ---------- share this app ----------

// The address to hand out is the deployed page, not whatever query or hash
// the current session happens to carry.
function appShareUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

async function shareApp() {
  const url = appShareUrl();
  const data = { title: '뉴스 피드', text: '뉴스 피드 — 카테고리·이슈 트래커', url };
  // navigator.share needs a user gesture and a secure context; a cancelled
  // sheet also rejects, which must not look like a failure.
  if (navigator.share) {
    try {
      await navigator.share(data);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  const copied = await copyText(url);
  openSheet(copied ? '주소를 복사했습니다' : '주소', [
    { label: url, onClick() { copyText(url); } },
  ]);
}

function openAiImport(tracker) {
  openPanel('AI로 타임라인 채우기', (body) => {
    const step1 = el('div', 'set-section');
    step1.appendChild(el('div', 'set-title', '① 요청문 복사 → AI 에 붙여넣기'));
    step1.appendChild(el('p', 'choice-hint',
      '웹 검색이 되는 AI 에 넣으세요. 링크가 비어 나오면 '
      + '"링크 없는 항목은 해외 매체에서 찾아서 다시" 라고 한 번 더 요구하면 됩니다.'));
    const promptBox = document.createElement('textarea');
    promptBox.className = 'in';
    promptBox.rows = 7;
    promptBox.readOnly = true;
    promptBox.value = aiPrompt(tracker);
    step1.appendChild(promptBox);

    const row = el('div', 'add-form');
    const copyBtn = el('button', 'primary', '요청문 복사');
    copyBtn.addEventListener('click', async () => {
      const done = await copyText(promptBox.value);
      copyBtn.textContent = done ? '복사됨 ✓' : '복사 실패 — 직접 선택하세요';
      if (!done) promptBox.select();
      setTimeout(() => { copyBtn.textContent = '요청문 복사'; }, 2000);
    });
    row.appendChild(copyBtn);
    for (const [label, url] of [['ChatGPT', 'https://chat.openai.com/'],
                                ['Gemini', 'https://gemini.google.com/']]) {
      const a = el('a', 'w-btn', label + ' 열기');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.padding = '7px 12px';
      row.appendChild(a);
    }
    step1.appendChild(row);
    body.appendChild(step1);

    const step2 = el('div', 'set-section');
    step2.appendChild(el('div', 'set-title', '② AI 답변을 여기에 붙여넣기'));
    const inBox = document.createElement('textarea');
    inBox.className = 'in';
    inBox.rows = 8;
    inBox.placeholder = '2025-06-13 | 이스라엘, 이란 핵시설 선제공습 | 연합뉴스 | https://...';
    step2.appendChild(inBox);

    const inRow = el('div', 'add-form');
    const pasteBtn = el('button', 'primary', '붙여넣기');
    pasteBtn.addEventListener('click', async () => {
      const text = await readClipboard();
      if (text == null) {
        pasteBtn.textContent = '길게 눌러 붙여넣기';
        inBox.focus();
        setTimeout(() => { pasteBtn.textContent = '붙여넣기'; }, 2500);
        return;
      }
      inBox.value = text;
      redraw();
    });
    inRow.appendChild(pasteBtn);
    const clearBtn = el('button', 'w-btn', '지우기');
    clearBtn.style.padding = '7px 12px';
    clearBtn.addEventListener('click', () => { inBox.value = ''; redraw(); });
    inRow.appendChild(clearBtn);
    step2.appendChild(inRow);

    const info = el('p', 'choice-hint', '표·목록·JSON 등 웬만한 형식은 그대로 알아봅니다.');
    step2.appendChild(info);
    body.appendChild(step2);

    const preview = el('div', 'set-section');
    preview.hidden = true;
    body.appendChild(preview);

    let rows = [];
    const redraw = () => {
      rows = parseAiTimeline(inBox.value);
      preview.textContent = '';
      if (!rows.length) {
        preview.hidden = true;
        info.textContent = inBox.value.trim()
          ? '인식된 항목이 없습니다. 날짜로 시작하는 줄이 필요합니다.'
          : '표·목록·JSON 등 웬만한 형식은 그대로 알아봅니다.';
        // the button must not keep a stale count from the previous paste
        addBtn.disabled = true;
        addBtn.textContent = '＋ 타임라인에 추가';
        return;
      }
      preview.hidden = false;
      const known = new Set(tracker.events.map((e) => `${e.date}|${e.title}`));
      const fresh = rows.filter((r) => !known.has(`${r.date}|${r.title}`));
      info.textContent = `${rows.length}건 인식됨`;
      preview.appendChild(el('div', 'set-title',
        `미리보기 — ${fresh.length}건 추가 예정`
        + (rows.length - fresh.length ? ` (중복 ${rows.length - fresh.length}건 제외)` : '')));
      const ul = el('ul', 'tl-links');
      for (const r of rows.slice(0, 12)) {
        const li = el('li');
        const box = el('div', 'tl-note');
        box.appendChild(el('div', 'nt', `${r.date}  ${r.title}`));
        box.appendChild(el('span', 'tl-src',
          [r.source || '언론사 없음', r.url ? '링크 있음' : '링크 없음'].join(' · ')));
        li.appendChild(box);
        ul.appendChild(li);
      }
      preview.appendChild(ul);
      if (rows.length > 12) {
        preview.appendChild(el('p', 'choice-hint', `외 ${rows.length - 12}건`));
      }
      addBtn.disabled = !fresh.length;
      addBtn.textContent = fresh.length ? `＋ ${fresh.length}건 타임라인에 추가` : '추가할 새 항목 없음';
    };

    const addBtn = el('button', 'primary', '＋ 타임라인에 추가');
    addBtn.style.width = '100%';
    addBtn.disabled = true;
    addBtn.addEventListener('click', () => {
      const known = new Set(tracker.events.map((e) => `${e.date}|${e.title}`));
      const stamp = new Date().toISOString();
      let n = 0;
      for (const r of rows) {
        const key = `${r.date}|${r.title}`;
        if (known.has(key)) continue;
        known.add(key);
        tracker.events.push({
          date: r.date,
          title: r.title,
          source: r.source,
          // no link means it behaves as a hand-written entry
          url: r.url || `note:ai-${stamp}-${n}`,
          coverage: 0,
          note: !r.url,
          ai: true,
          addedAt: stamp,
        });
        n++;
      }
      sortEvents(tracker);
      save();
      openTrackerTimeline(tracker);
    });

    inBox.addEventListener('input', redraw);
    inBox.addEventListener('paste', () => setTimeout(redraw, 0));
    body.appendChild(addBtn);
  });
}

function openNoteEditor(tracker, note) {
  openPanel(note ? '항목 편집' : '직접 추가', (body) => {
    const sec = el('div', 'set-section');

    sec.appendChild(el('div', 'set-title', '날짜'));
    const dateIn = el('input', 'in');
    dateIn.type = 'date';
    dateIn.value = note ? note.date : dayOf(null);
    sec.appendChild(dateIn);

    sec.appendChild(el('div', 'set-title mt', '내용'));
    const txIn = document.createElement('textarea');
    txIn.className = 'in';
    txIn.rows = 3;
    txIn.placeholder = '예: 이스라엘, 이란 핵시설 선제공습';
    txIn.value = note ? note.title : '';
    sec.appendChild(txIn);

    sec.appendChild(el('div', 'set-title mt', '언론사 (선택)'));
    const srcIn = el('input', 'in');
    srcIn.placeholder = '예: 연합뉴스';
    srcIn.value = note ? note.source || '' : '';
    sec.appendChild(srcIn);

    sec.appendChild(el('div', 'set-title mt', '링크 (선택)'));
    const urlIn = el('input', 'in');
    urlIn.placeholder = 'https:// (없어도 됩니다)';
    urlIn.value = note && note.url && !note.url.startsWith('note:') ? note.url : '';
    sec.appendChild(urlIn);

    body.appendChild(sec);

    const saveBtn = el('button', 'primary', note ? '저장' : '＋ 추가');
    saveBtn.style.width = '100%';
    saveBtn.addEventListener('click', () => {
      const text = txIn.value.trim();
      if (!text) {
        txIn.focus();
        return;
      }
      const url = urlIn.value.trim();
      if (note) {
        note.date = dateIn.value || note.date;
        note.title = text;
        note.source = srcIn.value.trim();
        // clearing the link turns the entry back into a plain record
        note.url = url || (note.url.startsWith('note:') ? note.url : `note:${Date.now()}`);
        note.note = !url;
      } else {
        tracker.events.push({
          date: dateIn.value || dayOf(null),
          title: text,
          source: srcIn.value.trim(),
          url: url || `note:${Date.now()}`,
          coverage: 0,
          note: !url,
          addedAt: new Date().toISOString(),
        });
      }
      sortEvents(tracker);
      if (isRemote(tracker)) {
        api(`/trackers/${tracker.id}/events`, {
          method: 'POST',
          body: JSON.stringify({
            title: text, url: url || null, source: srcIn.value.trim(),
            date: dateIn.value || dayOf(null),
          }),
        }).then(() => pullTimeline(tracker))
          .then((full) => openTrackerTimeline(full))
          .catch((e) => toast(e.message));
        return;
      }
      save();
      openTrackerTimeline(tracker);
    });
    body.appendChild(saveBtn);

    if (note) {
      const del = el('button', 'add-dashed', '✕ 이 항목 삭제');
      del.addEventListener('click', () => {
        confirmSheet('이 항목을 삭제할까요?', '✕ 삭제', () => {
          removeEvent(tracker, note);
          openTrackerTimeline(tracker);
        });
      });
      body.appendChild(del);
    }
  });
}

function removeEvent(tracker, ev) {
  tracker.events = tracker.events.filter((e) => e.url !== ev.url);
  if (isRemote(tracker)) {
    api(`/trackers/${tracker.id}/events`, {
      method: 'DELETE', body: JSON.stringify({ url: ev.url }),
    }).catch(() => {});
    if (tracker.counts) tracker.counts.events = Math.max(0, tracker.counts.events - 1);
    return;
  }
  // a removed article must not come back on the next sweep
  if (!ev.note) {
    if (!tracker.dropped) tracker.dropped = [];
    addUnique(tracker.dropped, ev.url);
  }
  save();
}

let trackerFilter = 'active';

function buildTrackerPage() {
  const page = el('section', 'page');
  const inner = el('div', 'page-inner');

  // A signed-in account renders the server's issues; otherwise this device's.
  const all = trackerList();

  const acct = el('div', 'sortrow');
  if (account.signedIn) {
    acct.appendChild(el('span', null, `${account.email} · 서버 저장`));
    if (S.trackers.length) {
      const mv = el('button', 'sort-btn', `이 기기 이슈 ${S.trackers.length}개 옮기기`);
      mv.addEventListener('click', () => openMigrate());
      acct.appendChild(mv);
    }
    const acc = el('button', 'sort-btn', '계정');
    acc.addEventListener('click', () => openLogin());
    acct.appendChild(acc);
  } else {
    acct.appendChild(el('span', null, '이 기기에만 저장됨'));
    const login = el('button', 'sort-btn primary-btn', '로그인하고 기기 간 동기화');
    login.addEventListener('click', () => openLogin());
    acct.appendChild(login);
  }
  inner.appendChild(acct);

  const seg = el('div', 'segrow');
  for (const [key, label] of Object.entries(TRACKER_STATUS)) {
    const n = all.filter((t) => t.status === key).length;
    const b = el('button', 'seg' + (trackerFilter === key ? ' on' : ''), `${label} ${n}`);
    b.addEventListener('click', () => { trackerFilter = key; rebuildPages(); });
    seg.appendChild(b);
  }
  inner.appendChild(seg);

  const list = all.filter((t) => t.status === trackerFilter);
  if (!list.length) {
    inner.appendChild(el('p', 'placeholder', trackerFilter === 'active'
      ? '추적 중인 이슈가 없습니다. 아래에서 추가하세요.'
      : '종료한 이슈가 없습니다.'));
  }

  for (const tracker of list) {
    const card = el('div', 'tk-card');
    const top = el('div', 'tk-top');
    const name = el('button', 'tk-name', tracker.name);
    name.addEventListener('click', () => openTrackerTimeline(tracker));
    top.appendChild(name);

    const more = el('button', 'more', '⋯');
    more.setAttribute('aria-label', '이슈 옵션');
    more.addEventListener('click', () => {
      const other = tracker.status === 'active' ? 'closed' : 'active';
      openSheet(tracker.name, [
        { label: '↻ 업데이트', onClick() { openTrackerUpdate(tracker, true); } },
        { label: '＋ 뉴스에서 골라 추가', onClick() { openPickArticles(tracker); } },
        { label: '✎ 편집', onClick() { openTrackerEditor(tracker); } },
        { label: '⚙ 수집 범위·매체 설정', onClick() { openBackfill(tracker); } },
        {
          label: other === 'closed' ? '■ 종료로 이동' : '▶ 다시 진행중으로',
          async onClick() {
            tracker.status = other;
            if (isRemote(tracker)) {
              try {
                await api(`/trackers/${tracker.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({
                    name: tracker.name, all: tracker.all, any: tracker.any,
                    kr: tracker.kr, en: tracker.en, from: tracker.from,
                    status: other, perDay: tracker.perDay,
                    allSources: tracker.allSources, order: tracker.order,
                  }),
                });
                await pullTrackers();
              } catch (err) { toast(err.message); return; }
            } else {
              save();
            }
            trackerFilter = other;
            rebuildPages();
          },
        },
        {
          label: '✕ 이슈 삭제',
          onClick() {
            confirmSheet(`'${tracker.name}' 이슈와 타임라인을 삭제합니다`, '✕ 삭제', async () => {
              if (isRemote(tracker)) {
                try {
                  await api(`/trackers/${tracker.id}`, { method: 'DELETE' });
                  await pullTrackers();
                } catch (err) {
                  toast(err.message);
                  return;
                }
              } else {
                S.trackers = S.trackers.filter((t) => t.id !== tracker.id);
                save();
              }
              rebuildPages();
            });
          },
        },
      ]);
    });
    top.appendChild(more);
    card.appendChild(top);

    const meta = el('div', 'tk-meta');
    // A server tracker arrives with counts and no events; a local one has the
    // events themselves. Both have to render the same summary line.
    const c = tracker.counts;
    const fresh = c ? c.unseen : newEventCount(tracker);
    if (fresh) meta.appendChild(el('span', 'badge', `새 ${fresh}건`));
    if (c) {
      meta.appendChild(el('span', null, c.events
        ? `${c.events}건 · ${c.firstDate} ~ ${c.lastDate}`
        : '모인 기사 없음'));
    } else {
      const days = eventsByDay(tracker);
      meta.appendChild(el('span', null, days.length
        ? `${tracker.events.length}건 · ${days[days.length - 1].date} ~ ${days[0].date}`
        : '모인 기사 없음'));
    }
    card.appendChild(meta);

    const kw = el('div', 'tk-kw');
    for (const w of tracker.all) kw.appendChild(el('span', 'kw', `+${w}`));
    for (const w of tracker.any) kw.appendChild(el('span', 'kw', w));
    if (!tracker.all.length && !tracker.any.length) {
      kw.appendChild(el('span', 'kw', '자동 수집 없음 · 직접 관리'));
    }
    card.appendChild(kw);

    inner.appendChild(card);
  }

  // With a key, the sentence-first path is the one that works; the keyword
  // editor stays for anyone without one, and for tightening a rule by hand.
  if (aiReady()) {
    const aiAdd = el('button', 'add-dashed', '✦ AI로 이슈 추가 (이름만 적으면 됨)');
    aiAdd.addEventListener('click', () => openAiIssue(null));
    inner.appendChild(aiAdd);
  }

  const add = el('button', 'add-dashed',
    aiReady() ? '＋ 직접 키워드로 추가' : '＋ 이슈 추가');
  add.addEventListener('click', () => openTrackerEditor(null));
  inner.appendChild(add);

  page.appendChild(inner);
  return page;
}

// Creating an issue from a sentence. With a key, the keyword rule stops being
// something the reader has to compose: they say what the issue is and when it
// started — or leave the date blank and let the search find the beginning —
// and the model returns dated articles that land in the ordinary timeline.
//
// The rule is still written, from the model's own keyword suggestion, so the
// half-hourly collection keeps the issue current afterwards without further
// AI calls.
function openAiIssue(seedItem) {
  openPanel('AI로 이슈 추적', (body) => {
    if (!aiReady()) {
      body.appendChild(el('p', 'choice-hint',
        'AI 키를 등록하면 이슈 이름만 적어도 과거 기사를 찾아 타임라인을 만들어 줍니다.'));
      const go = el('button', 'primary', 'AI 설정하기');
      go.style.width = '100%';
      go.addEventListener('click', () => openAiSettings());
      body.appendChild(go);
      return;
    }

    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', '무슨 이슈인가요'));
    const nameIn = el('input', 'in');
    nameIn.placeholder = '예: 미국-이란 전쟁';
    if (seedItem) nameIn.value = seedItem.title.slice(0, 60);
    sec.appendChild(nameIn);
    sec.appendChild(el('p', 'choice-hint',
      '한 줄로 적으면 됩니다. 키워드를 고를 필요 없습니다.'));
    body.appendChild(sec);

    const dsec = el('div', 'set-section');
    dsec.appendChild(el('div', 'set-title', '언제부터'));
    const fromIn = el('input', 'in');
    fromIn.type = 'date';
    // An article's own date is the natural anchor when the issue starts from
    // one; otherwise blank, which asks the model to find the beginning.
    if (seedItem) fromIn.value = dayOf(seedItem.pubDate);
    dsec.appendChild(fromIn);

    const quick = el('div', 'segrow');
    const marks = [['6개월', 6], ['1년', 12], ['2년', 24]];
    const paint = () => {
      [...quick.children].forEach((b, i) => {
        if (i < marks.length) b.classList.toggle('on', fromIn.value === monthsAgo(marks[i][1]));
        else b.classList.toggle('on', !fromIn.value);
      });
    };
    for (const [label, months] of marks) {
      const b = el('button', 'seg', label);
      b.addEventListener('click', () => { fromIn.value = monthsAgo(months); paint(); });
      quick.appendChild(b);
    }
    const auto = el('button', 'seg', '알아서 찾기');
    auto.addEventListener('click', () => { fromIn.value = ''; paint(); });
    quick.appendChild(auto);
    fromIn.addEventListener('change', paint);
    paint();
    dsec.appendChild(quick);
    dsec.appendChild(el('p', 'choice-hint',
      "비워두면 AI 가 이 사건이 언제 시작됐는지 판단해서 그 시점부터 정리합니다."));
    body.appendChild(dsec);

    const status = el('p', 'placeholder', '');
    const preview = el('div', 'pick-list');

    const go = el('button', 'primary', '✦ AI로 타임라인 만들기');
    go.style.width = '100%';
    go.addEventListener('click', async () => {
      const name = nameIn.value.trim();
      if (!name) { nameIn.focus(); return; }
      go.disabled = true;
      preview.textContent = '';
      status.textContent = 'AI 가 웹에서 기사를 찾는 중… (1~2분 걸릴 수 있습니다)';

      try {
        const r = await aiCall('timeline', {
          issue: name,
          from: fromIn.value || undefined,
          perDay: DEFAULT_PER_DAY,
        });
        if (!r.events.length) {
          status.textContent = '기사를 찾지 못했습니다. 이슈 이름을 더 구체적으로 적어 보세요.';
          go.disabled = false;
          return;
        }

        // The rule comes from the model too, so the issue keeps collecting on
        // its own after this one call.
        status.textContent = '키워드를 정하는 중…';
        let kw = { must: [], any: [] };
        try {
          kw = await aiCall('keywords', { issue: name, sample: r.events[0].title });
        } catch {
          // A missing rule only costs automatic updates, not the timeline.
        }

        const days = new Set(r.events.map((e) => e.date));
        status.textContent = `기사 ${r.events.length}건 · ${days.size}일`
          + (r.dropped ? ` (링크를 확인 못 한 ${r.dropped}건 제외)` : '')
          + `. 아래를 확인하고 만드세요.`;

        for (const e of r.events.slice(0, 8)) {
          const row = el('div', 'pick-row');
          const tx = el('div', 'pick-tx');
          tx.appendChild(el('div', 'pick-title', e.title));
          tx.appendChild(el('div', 'pick-meta', [e.date, e.source].filter(Boolean).join(' · ')));
          row.appendChild(tx);
          preview.appendChild(row);
        }
        if (r.events.length > 8) {
          preview.appendChild(el('p', 'choice-hint', `… 외 ${r.events.length - 8}건`));
        }

        go.textContent = `＋ 이슈 만들기 (${r.events.length}건)`;
        go.disabled = false;
        go.onclick = async () => {
          go.disabled = true;
          const ts = new Date().toISOString();
          const draft = {
            id: `t-${Date.now()}`,
            name,
            all: kw.must || [],
            any: (kw.any && kw.any.length) ? kw.any : [name.split(/\s+/)[0]],
            kr: [...(kw.must || []), ...(kw.any || [])].slice(0, 3).join(' '),
            en: '',
            from: r.start || fromIn.value || monthsAgo(24),
            status: 'active',
            perDay: DEFAULT_PER_DAY,
            allSources: false,
            order: 'desc',
            events: r.events.map((e) => ({
              date: e.date, title: e.title, source: e.source,
              url: e.url, coverage: 0, ai: true, addedAt: ts,
            })),
          };

          if (serverBacked()) {
            try {
              const created = await createRemoteTracker(draft, null);
              await uploadEvents(created, draft.events);
              const full = await pullTimeline(created);
              rebuildPages();
              openTrackerTimeline(full, `AI 가 기사 ${draft.events.length}건을 찾았습니다.`);
            } catch (err) {
              status.textContent = `저장 실패: ${err.message}`;
              go.disabled = false;
            }
            return;
          }

          S.trackers.push(draft);
          save();
          markTrackerSeen(draft);
          rebuildPages();
          openTrackerTimeline(draft, `AI 가 기사 ${draft.events.length}건을 찾았습니다.`);
        };
      } catch (e) {
        status.textContent = `실패: ${e.message}`;
        go.disabled = false;
      }
    });

    body.appendChild(go);
    body.appendChild(status);
    body.appendChild(preview);
  });
}

// Start an issue from the article being read: the headline supplies the name,
// the keywords and the anchor date, so tracking a story is one tap and the
// user never composes a query. The extracted words are shown for editing
// before anything is saved, since a headline's nouns are a guess.
function trackFromArticle(item) {
  const words = suggestKeywords(item.title);
  const draft = {
    id: `t-${Date.now()}`,
    name: item.title.length > 30 ? `${item.title.slice(0, 30)}…` : item.title,
    all: [],
    any: words,
    kr: words.slice(0, 3).join(' '),
    status: 'active',
    events: [],
    // the article that started the issue is the anchor; the sweep reaches
    // back from there rather than from today
    from: dayOf(item.pubDate),
    seedUrl: item.link,
    seedDate: dayOf(item.pubDate),
  };

  openPanel('이슈로 추적', (body) => {
    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', '이 기사'));
    sec.appendChild(el('p', 'choice-hint', `${item.title}${item.source ? ` · ${item.source}` : ''}`));
    body.appendChild(sec);

    const nsec = el('div', 'set-section');
    nsec.appendChild(el('div', 'set-title', '이슈 이름'));
    const nameIn = el('input', 'in');
    nameIn.value = draft.name;
    nsec.appendChild(nameIn);
    body.appendChild(nsec);

    // Every word of the headline is offered, not just the chosen two: which
    // word names the story is a judgement a reader makes instantly and the
    // scoring only guesses at. Tapping costs less than typing, so the ranking
    // decides what starts switched on, never what is available.
    const ksec = el('div', 'set-section');
    ksec.appendChild(el('div', 'set-title', '추적 키워드'));
    const chosen = new Set(draft.any);
    const candidates = rankKeywords(item.title);
    const box = el('div', 'chipbox');
    const count = el('p', 'choice-hint', '');

    const syncDraft = () => {
      draft.any = [...chosen];
      draft.kr = draft.any.slice(0, 3).join(' ');
    };

    const redraw = () => {
      box.textContent = '';
      // headline order reads naturally; the ranking only picked the defaults
      for (const c of candidates.slice().sort((a, b) => a.at - b.at)) {
        const on = chosen.has(c.word);
        const chip = el('button', 'kw-chip' + (on ? ' on' : ''), c.word);
        // A word matching a large slice of the feed will drown the timeline in
        // articles that merely mention it, which is not visible from the word.
        if (c.n >= 10) {
          chip.appendChild(el('span', 'kw-n', `${c.n}`));
          chip.classList.add('broad');
          chip.title = `피드 ${c.n}건에 등장 — 무관한 기사가 섞일 수 있습니다`;
        }
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        chip.addEventListener('click', () => {
          if (chosen.has(c.word)) chosen.delete(c.word);
          else chosen.add(c.word);
          syncDraft();
          redraw();
        });
        box.appendChild(chip);
      }
      // hand-typed words are not in the headline, so they get their own chips
      for (const w of chosen) {
        if (candidates.some((c) => c.word === w)) continue;
        const chip = el('button', 'kw-chip on', w);
        chip.setAttribute('aria-pressed', 'true');
        chip.addEventListener('click', () => { chosen.delete(w); syncDraft(); redraw(); });
        box.appendChild(chip);
      }
      // What this rule would collect from the feed as it stands. Telling someone
      // a word is "too common" does not land; showing them that 미국 drags in
      // twelve unrelated articles does.
      if (!chosen.size) {
        count.textContent = '최소 하나는 선택해야 합니다.';
      } else {
        const rule = { all: [], any: [...chosen] };
        const hits = newsData.categories
          .flatMap((c) => c.items)
          .filter((it) => !isBlocked(it) && trackerMatches(rule, it));
        count.textContent = `${chosen.size}개 선택 · 지금 피드에서 ${hits.length}건 걸립니다.`;
        preview.textContent = '';
        for (const it of hits.slice(0, 3)) {
          preview.appendChild(el('div', 'kw-hit', it.title));
        }
        if (hits.length > 3) {
          preview.appendChild(el('div', 'kw-hit muted', `… 외 ${hits.length - 3}건`));
        }
      }
    };

    const preview = el('div', 'kw-preview');
    ksec.appendChild(box);
    ksec.appendChild(count);
    ksec.appendChild(preview);
    ksec.appendChild(el('p', 'choice-hint',
      '제목의 단어를 눌러 켜고 끕니다. 진한 것이 켜진 상태입니다. '
      + '숫자가 붙은 단어는 피드에 그만큼 흔해서, 켜면 무관한 기사가 딸려옵니다.'));

    const form = el('div', 'add-form');
    const kin = el('input', 'in');
    kin.placeholder = '제목에 없는 키워드 추가';
    const kadd = el('button', 'primary', '추가');
    const commit = () => {
      const v = kin.value.trim();
      if (!v) return;
      chosen.add(v);
      kin.value = '';
      syncDraft();
      redraw();
    };
    kadd.addEventListener('click', commit);
    kin.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
    form.appendChild(kin);
    form.appendChild(kadd);
    ksec.appendChild(form);
    redraw();
    body.appendChild(ksec);

    const fsec = el('div', 'set-section');
    fsec.appendChild(el('div', 'set-title', '어디까지 거슬러 갈까요'));
    const fromIn = el('input', 'in');
    fromIn.type = 'date';
    fromIn.value = monthsAgo(6);
    fsec.appendChild(fromIn);
    const quick = el('div', 'segrow');
    const marks = [['3개월', 3], ['6개월', 6], ['1년', 12], ['2년', 24]];
    const paint = () => {
      [...quick.children].forEach((b, i) => {
        b.classList.toggle('on', fromIn.value === monthsAgo(marks[i][1]));
      });
    };
    for (const [label, months] of marks) {
      const b = el('button', 'seg', label);
      b.addEventListener('click', () => { fromIn.value = monthsAgo(months); paint(); });
      quick.appendChild(b);
    }
    fromIn.addEventListener('change', paint);
    paint();
    fsec.appendChild(quick);
    fsec.appendChild(el('p', 'choice-hint',
      '업데이트를 누르면 이 날짜부터 오늘까지의 관련 기사를 모아 날짜순으로 이어붙입니다.'));
    body.appendChild(fsec);

    const go = el('button', 'primary', '추적 시작하고 업데이트');
    go.style.width = '100%';
    go.addEventListener('click', () => {
      const name = nameIn.value.trim();
      if (!name) { nameIn.focus(); return; }
      if (!draft.any.length) { kin.focus(); return; }
      draft.name = name;
      draft.from = fromIn.value || monthsAgo(6);
      draft.kr = draft.any.slice(0, 3).join(' ');
      // the seed article belongs on the timeline even if the keyword rule
      // would not have matched its own headline
      draft.events.push({
        date: dayOf(item.pubDate),
        title: item.title,
        source: item.source || '',
        url: item.link,
        coverage: item.coverage || 0,
        addedAt: new Date().toISOString(),
      });
      if (serverBacked()) {
        go.disabled = true;
        createRemoteTracker(draft, item)
          .then((t) => { rebuildPages(); openTrackerUpdate(t, true); })
          .catch((e) => { go.disabled = false; toast(e.message); });
        return;
      }
      S.trackers.push(draft);
      save();
      collectTrackers();
      markTrackerSeen(draft);
      rebuildPages();
      openTrackerUpdate(draft, true);
    });
    body.appendChild(go);

    const later = el('button', 'add-dashed', '나중에 — 추가만 하고 닫기');
    later.addEventListener('click', () => {
      const name = nameIn.value.trim();
      if (!name || !draft.any.length) return;
      draft.name = name;
      draft.from = fromIn.value || monthsAgo(6);
      draft.kr = draft.any.slice(0, 3).join(' ');
      draft.events.push({
        date: dayOf(item.pubDate),
        title: item.title,
        source: item.source || '',
        url: item.link,
        coverage: item.coverage || 0,
        addedAt: new Date().toISOString(),
      });
      if (serverBacked()) {
        createRemoteTracker(draft, item)
          .then(() => { closeOverlay(); rebuildPages(); })
          .catch((e) => toast(e.message));
        return;
      }
      S.trackers.push(draft);
      save();
      collectTrackers();
      markTrackerSeen(draft);
      closeOverlay();
      rebuildPages();
    });
    body.appendChild(later);
  });
}

// The seed article travels with the create call so the server writes both in
// one round trip and the timeline is never briefly empty.
async function createRemoteTracker(draft, item) {
  const r = await api('/trackers', {
    method: 'POST',
    body: JSON.stringify({
      name: draft.name, all: draft.all, any: draft.any, kr: draft.kr,
      en: draft.en, from: draft.from, status: draft.status,
      perDay: draft.perDay, allSources: draft.allSources, order: draft.order,
      seed: item ? {
        title: item.title, url: item.link, source: item.source || '',
        date: dayOf(item.pubDate), coverage: item.coverage || 0,
      } : undefined,
    }),
  });
  await pullTrackers();
  return { ...r.tracker, _partial: false };
}

// Sends locally-found articles to the account. One at a time rather than in a
// batch: a partial failure then costs one article instead of the whole sweep,
// and the server applies its own dedup to each.
async function uploadEvents(tracker, events) {
  let sent = 0;
  for (const ev of events) {
    try {
      await api(`/trackers/${tracker.id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          title: ev.title, url: ev.url, source: ev.source,
          date: ev.date, coverage: ev.coverage || 0,
        }),
      });
      sent++;
    } catch {
      // one article is not worth failing the sweep over
    }
  }
  return sent;
}

// Manual pin: keyword rules miss articles whose title words differ, so an
// article can be dropped into a timeline by hand.
// A hand-pinned article is kept even when it duplicates one already on that
// day: the user chose this specific piece, so the automatic dedup rule does
// not get to overrule them. Only the identical url is refused.
function pinToTracker(tracker, item) {
  if ((tracker.events || []).some((e) => e.url === item.link)) return false;
  if (isRemote(tracker)) {
    api(`/trackers/${tracker.id}/events`, {
      method: 'POST',
      body: JSON.stringify({
        title: item.title, url: item.link, source: item.source || '',
        date: dayOf(item.pubDate), coverage: item.coverage || 0,
      }),
    }).catch(() => {});
    tracker.events.push({
      date: dayOf(item.pubDate), title: item.title, source: item.source || '',
      url: item.link, coverage: item.coverage || 0, manual: true,
      addedAt: new Date().toISOString(),
    });
    if (tracker.counts) tracker.counts.events++;
    sortEvents(tracker);
    return true;
  }
  tracker.events.push({
    date: dayOf(item.pubDate),
    title: item.title,
    source: item.source || '',
    url: item.link,
    coverage: item.coverage || 0,
    manual: true,
    addedAt: new Date().toISOString(),
  });
  // pinning by hand overrides an earlier removal, and must survive the next
  // sweep — otherwise the dropped list would strip it again
  if (tracker.dropped) tracker.dropped = tracker.dropped.filter((u) => u !== item.link);
  if (tracker.skippedUrls) tracker.skippedUrls = tracker.skippedUrls.filter((u) => u !== item.link);
  sortEvents(tracker);
  save();
  return true;
}

function addToTrackerSheet(item) {
  const actions = trackerList().map((tracker) => {
    const has = tracker.events.some((e) => e.url === item.link);
    return {
      label: `${has ? '✓ ' : ''}${tracker.name}`
        + ` (${TRACKER_STATUS[tracker.status]}${has ? ' · 이미 있음' : ''})`,
      onClick() {
        if (has) {
          openTrackerTimeline(tracker);
          return;
        }
        pinToTracker(tracker, item);
        rebuildPages();
        toast(`'${tracker.name}' 에 추가했습니다.`);
      },
    };
  });
  actions.push({
    label: '＋ 새 이슈로 추적',
    onClick() { trackFromArticle(item); },
  });
  openSheet('이슈에 추가', actions);
}

// ---------- scrap (saved articles) ----------

function isSaved(link) {
  return S.saved.some((s) => s.url === link);
}

function toggleSaved(item) {
  if (isSaved(item.link)) {
    S.saved = S.saved.filter((s) => s.url !== item.link);
  } else {
    S.saved.unshift({
      title: item.title,
      source: item.source || '',
      url: item.link,
      pubDate: item.pubDate || null,
      savedAt: new Date().toISOString(),
    });
  }
  save();
  rebuildPages();
}

function buildScrapPage() {
  const page = el('section', 'page');
  const inner = el('div', 'page-inner');

  const bar = el('div', 'sortrow');
  bar.appendChild(el('span', null, `${S.saved.length}건`));
  if (S.saved.length) {
    const clear = el('button', 'sort-btn', '전체 비우기');
    clear.addEventListener('click', () => {
      if (!confirm('저장한 기사를 모두 지울까요?')) return;
      S.saved = [];
      save();
      rebuildPages();
    });
    bar.appendChild(clear);
  }
  inner.appendChild(bar);

  if (!S.saved.length) {
    inner.appendChild(el('p', 'placeholder',
      '저장한 기사가 없습니다. 기사의 ⋯ 에서 "저장"을 누르세요.'));
    page.appendChild(inner);
    return page;
  }

  const ul = el('ul', 'news-list');
  for (const saved of S.saved) {
    const item = {
      title: saved.title,
      link: saved.url,
      source: saved.source,
      pubDate: saved.pubDate,
      coverage: 0,
    };
    ul.appendChild(newsItemNode(item, { savedAt: saved.savedAt }));
  }
  inner.appendChild(ul);

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
      tab: activeTab,
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
  // the tab has to be restored first: it decides which pages exist
  if (st.tab && st.tab !== activeTab && TABS.some((t) => t.id === st.tab)) {
    activeTab = st.tab;
    rebuildPages();
  }
  const pager = document.getElementById('pager');
  const index = Math.min(st.index || 0, pager.children.length - 1);
  tabIndex[activeTab] = index;
  pager.scrollLeft = index * pager.clientWidth;
  const page = pager.children[index];
  if (page && st.scroll) page.scrollTop = st.scroll;
  syncPageIndicator();
}

// ---------- tabs + pager ----------

// Bottom bar switches sections; the horizontal pager and the category strip
// only ever apply to the news section, so a swipe never leaves it.

const TABS = [
  { id: 'dash', label: '대시보드', icon: 'M3 11 12 4l9 7v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z' },
  { id: 'news', label: '뉴스', icon: 'M4 5h16v14H4Zm2 3h7v5H6Zm9 0h3M15 11h3M6 16h12' },
  { id: 'tracker', label: '트래커', icon: 'M12 4a8 8 0 1 1-8 8M12 7v5l3.5 2.5M4 4v4h4' },
  { id: 'scrap', label: '스크랩', icon: 'M7 4h10v16l-5-4-5 4Z' },
];

let activeTab = 'dash';
let pages = [];

function currentIndex() {
  const pager = document.getElementById('pager');
  if (!pager.clientWidth) return 0;
  return Math.round(pager.scrollLeft / pager.clientWidth);
}

function syncPageIndicator() {
  const i = currentIndex();
  const page = pages[i];
  if (!page) return;
  document.getElementById('page-title').textContent = page.title;
  // sharing the app belongs to its front page, not to a category listing
  document.getElementById('share-btn').hidden = activeTab !== 'dash';
  document.querySelectorAll('.pagedots .dot').forEach((d, n) => {
    d.classList.toggle('on', n === i);
  });
  const active = document.querySelector('.pagedots .dot.on');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function buildTabBar() {
  const bar = document.getElementById('tabbar');
  bar.textContent = '';
  for (const tab of TABS) {
    const b = el('button', 'tab' + (tab.id === activeTab ? ' on' : ''));
    b.setAttribute('aria-label', tab.label);
    b.setAttribute('aria-current', tab.id === activeTab ? 'page' : 'false');

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', tab.icon);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.9');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    b.appendChild(svg);

    if (tab.id === 'tracker') {
      // A server tracker reports its unread count with the list; a local one
      // has to be counted from its own events.
      const fresh = trackerList()
        .filter((t) => t.status === 'active')
        .reduce((n, t) => n + (t.counts ? t.counts.unseen : newEventCount(t)), 0);
      if (fresh) b.appendChild(el('span', 'tb-badge', fresh > 99 ? '99+' : String(fresh)));
    }
    b.appendChild(el('span', 'tb-label', tab.label));
    b.addEventListener('click', () => switchTab(tab.id));
    bar.appendChild(b);
  }
}

function switchTab(id) {
  if (activeTab === id) {
    // tapping the current tab scrolls its page back to the top
    const page = document.getElementById('pager').children[currentIndex()];
    if (page) page.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  activeTab = id;
  rebuildPages();
}

function tabPages() {
  if (activeTab === 'news') {
    return enabledCategories().map((cat) => ({
      title: cat.name,
      node: buildCategoryPage(cat),
    }));
  }
  if (activeTab === 'tracker') return [{ title: '트래커', node: buildTrackerPage() }];
  if (activeTab === 'scrap') return [{ title: '스크랩', node: buildScrapPage() }];
  return [{ title: '대시보드', node: buildDashboard() }];
}

// keeps each tab on the category it was left on
const tabIndex = { dash: 0, news: 0, tracker: 0, scrap: 0 };

function rebuildPages() {
  const pager = document.getElementById('pager');
  if (pages.length) tabIndex[pages[0].tab] = currentIndex();
  pager.textContent = '';

  pages = tabPages();
  if (!pages.length) pages = [{ title: '뉴스', node: emptyNewsPage() }];
  for (const p of pages) {
    p.tab = activeTab;
    pager.appendChild(p.node);
  }

  const dots = document.getElementById('pagedots');
  dots.textContent = '';
  dots.hidden = pages.length < 2;
  pages.forEach((p, i) => {
    const dot = el('button', 'dot', p.title);
    dot.addEventListener('click', () => {
      pager.scrollTo({ left: i * pager.clientWidth, behavior: 'smooth' });
    });
    dots.appendChild(dot);
  });

  const target = Math.min(tabIndex[activeTab] || 0, pages.length - 1);
  pager.scrollLeft = target * pager.clientWidth;
  buildTabBar();
  syncPageIndicator();
  translatePending(pager);
}

function emptyNewsPage() {
  const page = el('section', 'page');
  const inner = el('div', 'page-inner');
  inner.appendChild(el('p', 'placeholder', '표시할 카테고리가 없습니다. 설정에서 켜세요.'));
  page.appendChild(inner);
  return page;
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

// ---------- account (optional server sync) ----------

// The app works with no account at all: trackers live in localStorage exactly
// as before. Signing in switches the tracker tab to the server copy, which is
// what makes an issue followed on the phone visible on the desktop and lets
// collection keep running while the app is closed. Nothing else — blocked
// outlets, widgets, weather location — is uploaded; those are genuinely
// per-device preferences and syncing them would be a nuisance, not a feature.

const account = { signedIn: false, email: null, checked: false };

// Remote trackers are held here rather than in S, so signing out cannot leave
// the server's copy written into this device's storage.
let remoteTrackers = null;

function serverBacked() {
  return account.signedIn && remoteTrackers !== null;
}

// The one place that decides which list the UI renders.
function trackerList() {
  return serverBacked() ? remoteTrackers : S.trackers;
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // an HTML error page from the edge, not our API
    throw new Error(`서버 응답을 읽을 수 없습니다 (${res.status})`);
  }
  if (!res.ok) throw new Error((data && data.error) || `서버 오류 (${res.status})`);
  return data;
}

async function refreshAccount() {
  try {
    const r = await api('/auth/me');
    account.signedIn = !!r.signedIn;
    account.email = r.email || null;
  } catch {
    // No API deployed, or offline. Staying signed out keeps the app usable.
    account.signedIn = false;
    account.email = null;
  }
  account.checked = true;
  return account.signedIn;
}

async function pullTrackers() {
  if (!account.signedIn) {
    remoteTrackers = null;
    return null;
  }
  const r = await api('/trackers');
  // The list view carries counts but no events; a timeline is fetched when
  // it is opened, so a hundred issues do not mean a hundred timelines.
  remoteTrackers = r.trackers.map((t) => ({ ...t, events: t.events || [], _partial: true }));
  return remoteTrackers;
}

async function pullTimeline(tracker) {
  const r = await api(`/trackers/${tracker.id}`);
  const full = { ...r.tracker, _partial: false };
  if (remoteTrackers) {
    const i = remoteTrackers.findIndex((t) => t.id === tracker.id);
    if (i >= 0) remoteTrackers[i] = { ...remoteTrackers[i], ...full };
  }
  return full;
}

function openLogin() {
  openPanel('로그인', (body) => {
    if (account.signedIn) {
      const sec = el('div', 'set-section');
      sec.appendChild(el('div', 'set-title', '로그인됨'));
      sec.appendChild(el('p', 'choice-hint', account.email));
      sec.appendChild(el('p', 'choice-hint',
        '이슈는 서버에 저장되어 다른 기기에서도 같이 보이고, 앱을 닫아둬도 30분마다 새 기사가 쌓입니다.'));
      body.appendChild(sec);

      const out = el('button', 'add-dashed', '로그아웃');
      out.addEventListener('click', () => {
        confirmSheet('로그아웃할까요?', '로그아웃', async () => {
          try {
            await api('/auth/logout', { method: 'POST', body: '{}' });
          } catch { /* the cookie is cleared server-side either way */ }
          account.signedIn = false;
          account.email = null;
          remoteTrackers = null;
          closeOverlay();
          rebuildPages();
          toast('로그아웃했습니다.');
        });
      });
      body.appendChild(out);
      return;
    }

    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', '메일 주소로 로그인'));
    sec.appendChild(el('p', 'choice-hint',
      '비밀번호는 없습니다. 메일로 받은 링크를 누르면 로그인됩니다. '
      + '로그인하면 이슈가 서버에 저장되어 폰과 PC에서 같이 보입니다.'));

    const input = el('input', 'in');
    input.type = 'email';
    input.inputMode = 'email';
    input.autocomplete = 'email';
    input.placeholder = 'you@example.com';
    sec.appendChild(input);

    const status = el('p', 'placeholder', '');
    const send = el('button', 'primary', '로그인 링크 받기');
    send.style.width = '100%';
    const submit = async () => {
      const email = input.value.trim();
      if (!email) { input.focus(); return; }
      send.disabled = true;
      send.textContent = '보내는 중…';
      try {
        const r = await api('/auth/request', {
          method: 'POST',
          body: JSON.stringify({ email }),
        });
        status.textContent = `${email} 로 링크를 보냈습니다. 메일함을 확인하세요. `
          + '15분 뒤에 만료됩니다.';
        // Only present when the server has no mail key configured; opening it
        // here is what makes local development usable.
        if (r.dev) {
          const a = el('a', null, '메일 설정 전입니다 — 이 링크로 바로 로그인');
          a.href = r.dev;
          status.appendChild(document.createElement('br'));
          status.appendChild(a);
        }
        send.textContent = '다시 보내기';
      } catch (err) {
        status.textContent = `✕ ${err.message}`;
        send.textContent = '로그인 링크 받기';
      }
      send.disabled = false;
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    sec.appendChild(send);
    sec.appendChild(status);
    body.appendChild(sec);

    if (S.trackers.length) {
      const mig = el('div', 'set-section');
      mig.appendChild(el('div', 'set-title', '이 기기의 이슈'));
      mig.appendChild(el('p', 'choice-hint',
        `이 기기에 이슈 ${S.trackers.length}개가 있습니다. 로그인한 뒤 서버로 옮길 수 있습니다. `
        + '옮기기 전에 백업을 받아두세요.'));
      const b = el('button', 'add-dashed', '⭳ 먼저 백업하기');
      b.addEventListener('click', () => openBackupPanel());
      mig.appendChild(b);
      body.appendChild(mig);
    }
  });
}

// Copies this device's issues to the account. The local copy is left alone —
// if anything goes wrong the user still has it, and the backup file besides.
async function migrateLocalTrackers(onProgress) {
  const out = { moved: 0, events: 0, failed: [] };
  for (const t of S.trackers) {
    onProgress(`${t.name}…`);
    try {
      const r = await api('/trackers', {
        method: 'POST',
        body: JSON.stringify({
          name: t.name, all: t.all, any: t.any, kr: t.kr, en: t.en,
          from: t.from, status: t.status, perDay: t.perDay,
          allSources: t.allSources, order: t.order,
        }),
      });
      const id = r.tracker.id;
      // Events go up one by one rather than in a batch: a partial failure
      // then costs one article, not the whole timeline.
      for (const ev of t.events || []) {
        try {
          await api(`/trackers/${id}/events`, {
            method: 'POST',
            body: JSON.stringify({
              title: ev.title, url: ev.note ? null : ev.url,
              source: ev.source, date: ev.date, coverage: ev.coverage,
            }),
          });
          out.events++;
        } catch { /* one article is not worth failing the issue over */ }
      }
      out.moved++;
    } catch (err) {
      out.failed.push(`${t.name}: ${err.message}`);
    }
  }
  return out;
}

function openMigrate() {
  openPanel('서버로 옮기기', (body) => {
    const sec = el('div', 'set-section');
    const evCount = S.trackers.reduce((n, t) => n + ((t.events || []).length), 0);
    sec.appendChild(el('div', 'set-title', `이슈 ${S.trackers.length}개 · 기사 ${evCount}건`));
    sec.appendChild(el('p', 'choice-hint',
      '이 기기의 이슈를 계정으로 복사합니다. 기기의 원본은 지우지 않으니, '
      + '잘못되어도 그대로 남아 있습니다.'));
    body.appendChild(sec);

    const status = el('p', 'placeholder', '');
    const go = el('button', 'primary', '옮기기 시작');
    go.style.width = '100%';
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = '옮기는 중…';
      const r = await migrateLocalTrackers((m) => { status.textContent = m; });
      await pullTrackers();
      rebuildPages();
      const parts = [`이슈 ${r.moved}개 · 기사 ${r.events}건을 옮겼습니다.`];
      if (r.failed.length) parts.push(`실패: ${r.failed.join(' / ')}`);
      status.textContent = parts.join(' ');
      go.textContent = '완료';
    });
    body.appendChild(go);
    body.appendChild(status);

    const bak = el('button', 'add-dashed', '⭳ 먼저 백업하기');
    bak.addEventListener('click', () => openBackupPanel());
    body.appendChild(bak);
  });
}

// ---------- AI (optional, the user's own key) ----------

// The tracker's keyword rule cannot tell "about this issue" from "contains this
// word" — a rule matching 미국 collected the national debt and an altcoin
// roundup into a war timeline. A model can, so an optional key unlocks three
// things the rule cannot do: filter what was collected, propose a better rule,
// and read the timeline back as a sequence of events.
//
// The key is the user's own and lives in this device's localStorage. It goes to
// /api/ai only because a browser cannot call these providers directly, and that
// endpoint uses it once and forgets it. Everything here is optional: with no
// key, the app behaves exactly as before.

const AI_KEY = 'nf:ai:v1';

function loadAi() {
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (!raw) return { provider: 'claude', key: '', model: '' };
    return { provider: 'claude', key: '', model: '', ...JSON.parse(raw) };
  } catch {
    return { provider: 'claude', key: '', model: '' };
  }
}

let aiCfg = loadAi();
let aiProviders = null;   // filled from /api/ai on first use

function aiReady() {
  return !!(aiCfg.key && aiCfg.provider);
}

function saveAi() {
  localStorage.setItem(AI_KEY, JSON.stringify(aiCfg));
}

async function aiProviderList() {
  if (aiProviders) return aiProviders;
  const r = await api('/ai');
  aiProviders = r.providers;
  return aiProviders;
}

async function aiCall(task, payload) {
  if (!aiReady()) throw new Error('AI 키가 설정되지 않았습니다.');
  const r = await api('/ai', {
    method: 'POST',
    body: JSON.stringify({
      provider: aiCfg.provider,
      key: aiCfg.key,
      model: aiCfg.model || undefined,
      task,
      ...payload,
    }),
  });
  return r.result;
}

function openAiSettings() {
  openPanel('AI 설정', (body) => {
    const intro = el('div', 'set-section');
    intro.appendChild(el('div', 'set-title', '내 API 키로 AI 기능 켜기'));
    intro.appendChild(el('p', 'choice-hint',
      '키는 이 기기에만 저장됩니다. AI 호출 때만 서버를 거쳐 가고, 서버는 저장하지 않습니다. '
      + '설정하지 않아도 앱은 지금처럼 동작합니다.'));
    body.appendChild(intro);

    const status = el('p', 'placeholder', '불러오는 중…');
    body.appendChild(status);

    aiProviderList().then((provs) => {
      status.remove();

      const psec = el('div', 'set-section');
      psec.appendChild(el('div', 'set-title', '제공자'));
      const row = el('div', 'segrow');
      for (const [id, p] of Object.entries(provs)) {
        const b = el('button', 'seg' + (aiCfg.provider === id ? ' on' : ''), p.label);
        b.addEventListener('click', () => {
          aiCfg.provider = id;
          aiCfg.model = '';
          saveAi();
          openAiSettings();
        });
        row.appendChild(b);
      }
      psec.appendChild(row);
      body.appendChild(psec);

      const cur = provs[aiCfg.provider] || provs.claude;

      const ksec = el('div', 'set-section');
      ksec.appendChild(el('div', 'set-title', `${cur.label} API 키`));
      const kin = el('input', 'in');
      kin.type = 'password';
      kin.autocomplete = 'off';
      kin.placeholder = cur.keyHint;
      kin.value = aiCfg.key;
      kin.addEventListener('change', () => {
        aiCfg.key = kin.value.trim();
        saveAi();
      });
      ksec.appendChild(kin);
      // Two links, because the key page silently assumes you are signed in as
      // the right account — and these sites pick up whichever account the
      // browser was already holding, which is not always the one you meant.
      const mkLink = (text, href) => {
        const a = el('a', 'choice-hint', text);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'block';
        a.style.marginTop = '6px';
        return a;
      };
      ksec.appendChild(mkLink(`${cur.label} 키 발급받기 →`, cur.docs));
      if (cur.login) {
        ksec.appendChild(mkLink(`${cur.label} 로그인 / 계정 바꾸기 →`, cur.login));
      }
      body.appendChild(ksec);

      const msec = el('div', 'set-section');
      msec.appendChild(el('div', 'set-title', '모델'));
      const mrow = el('div', 'segrow');
      for (const m of cur.models) {
        const on = (aiCfg.model || cur.defaultModel) === m;
        const b = el('button', 'seg' + (on ? ' on' : ''), m);
        b.addEventListener('click', () => { aiCfg.model = m; saveAi(); openAiSettings(); });
        mrow.appendChild(b);
      }
      msec.appendChild(mrow);
      msec.appendChild(el('p', 'choice-hint',
        '작은 모델이 싸고 빠릅니다. 기사 100건 거르는 데 몇 원 수준입니다.'));
      body.appendChild(msec);

      const test = el('button', 'primary', '연결 확인');
      test.style.width = '100%';
      const tstat = el('p', 'placeholder', '');
      test.addEventListener('click', async () => {
        aiCfg.key = kin.value.trim();
        saveAi();
        if (!aiCfg.key) { tstat.textContent = '키를 입력하세요.'; return; }
        test.disabled = true;
        tstat.textContent = '확인 중…';
        try {
          // The cheapest task that still proves the key works end to end.
          const r = await aiCall('keywords', { issue: '테스트' });
          tstat.textContent = `✓ ${cur.label} 연결됨 (예: ${(r.any || []).slice(0, 3).join(', ')})`;
        } catch (e) {
          tstat.textContent = `✕ ${e.message}`;
        }
        test.disabled = false;
      });
      body.appendChild(test);
      body.appendChild(tstat);

      if (aiCfg.key) {
        const clear = el('button', 'add-dashed', '✕ 키 삭제');
        clear.addEventListener('click', () => {
          confirmSheet('저장된 API 키를 지울까요?', '✕ 삭제', () => {
            aiCfg.key = '';
            saveAi();
            openAiSettings();
          });
        });
        body.appendChild(clear);
      }

      const what = el('div', 'set-section');
      what.appendChild(el('div', 'set-title', '무엇에 쓰이나'));
      for (const [t, d] of [
        ['◌ 관련 없는 기사 걸러내기', '키워드만 겹치고 주제가 다른 기사를 타임라인에서 제거합니다.'],
        ['◌ 흐름 요약', '타임라인을 읽고 사건이 어떻게 전개됐는지 정리합니다.'],
        ['◌ 키워드 제안', '이슈 이름만 주면 적절한 추적 키워드를 만들어 줍니다.'],
      ]) {
        const r = el('div', 'set-row');
        const tx = el('div', 'choice-tx');
        tx.appendChild(el('span', 'choice-label', t));
        tx.appendChild(el('span', 'choice-hint', d));
        r.appendChild(tx);
        what.appendChild(r);
      }
      body.appendChild(what);
    }).catch((e) => {
      status.textContent = `AI 기능을 쓸 수 없습니다: ${e.message}`;
    });
  });
}

// Runs the collected timeline past the model and drops what does not belong.
// Removals go through removeEvent so they are remembered — the next sweep will
// not bring the same articles back.
function openAiFilter(tracker) {
  openPanel('관련 없는 기사 정리', (body) => {
    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', tracker.name));

    const linked = (tracker.events || []).filter((e) => !e.note);
    sec.appendChild(el('p', 'choice-hint',
      `타임라인의 기사 ${linked.length}건을 AI 가 읽고, 이 이슈와 무관한 것을 골라냅니다. `
      + '무엇을 지울지 먼저 보여주고, 확인을 눌러야 실제로 지웁니다.'));
    body.appendChild(sec);

    if (!aiReady()) {
      const go = el('button', 'primary', 'AI 설정하기');
      go.style.width = '100%';
      go.addEventListener('click', () => openAiSettings());
      body.appendChild(go);
      return;
    }
    if (!linked.length) {
      body.appendChild(el('p', 'placeholder', '기사가 없습니다.'));
      return;
    }

    const status = el('p', 'placeholder', '');
    const list = el('div', 'pick-list');
    const run = el('button', 'primary', '검사 시작');
    run.style.width = '100%';

    run.addEventListener('click', async () => {
      run.disabled = true;
      status.textContent = 'AI 가 읽는 중…';
      list.textContent = '';
      try {
        // One call per 100 so a long timeline neither hits the endpoint cap nor
        // asks the model to hold more than it reads well.
        const drop = [];
        for (let i = 0; i < linked.length; i += 100) {
          const batch = linked.slice(i, i + 100);
          status.textContent = `AI 가 읽는 중… ${i + batch.length}/${linked.length}`;
          const r = await aiCall('filter', {
            issue: tracker.name,
            keywords: [...(tracker.all || []), ...(tracker.any || [])],
            articles: batch.map((e) => ({ title: e.title })),
          });
          const keep = new Set(r.keep || []);
          batch.forEach((e, k) => { if (!keep.has(k)) drop.push(e); });
        }

        if (!drop.length) {
          status.textContent = '무관한 기사가 없습니다. 그대로 두면 됩니다.';
          run.textContent = '다시 검사';
          run.disabled = false;
          return;
        }

        status.textContent = `${drop.length}건이 이 이슈와 무관해 보입니다.`;
        for (const e of drop) {
          const row = el('div', 'pick-row');
          const tx = el('div', 'pick-tx');
          tx.appendChild(el('div', 'pick-title', e.title));
          tx.appendChild(el('div', 'pick-meta', [e.date, e.source].filter(Boolean).join(' · ')));
          row.appendChild(tx);
          list.appendChild(row);
        }

        run.textContent = `✕ ${drop.length}건 삭제`;
        run.disabled = false;
        run.onclick = () => {
          confirmSheet(`${drop.length}건을 타임라인에서 지웁니다`, '✕ 삭제', () => {
            for (const e of drop) removeEvent(tracker, e);
            rebuildPages();
            openTrackerTimeline(tracker, `AI 가 ${drop.length}건을 정리했습니다.`);
          });
        };
      } catch (e) {
        status.textContent = `실패: ${e.message}`;
        run.disabled = false;
      }
    });

    body.appendChild(run);
    body.appendChild(status);
    body.appendChild(list);
  });
}

// Reads the timeline back as a sequence rather than a list — the thing the
// tracker was for. Not stored: it is cheap to regenerate and would go stale.
function openAiSummary(tracker) {
  openPanel('흐름 요약', (body) => {
    if (!aiReady()) {
      body.appendChild(el('p', 'choice-hint', 'AI 키가 필요합니다.'));
      const go = el('button', 'primary', 'AI 설정하기');
      go.style.width = '100%';
      go.addEventListener('click', () => openAiSettings());
      body.appendChild(go);
      return;
    }

    const events = (tracker.events || []).filter((e) => !e.note)
      .slice().sort((a, b) => (a.date < b.date ? -1 : 1));
    if (!events.length) {
      body.appendChild(el('p', 'placeholder', '요약할 기사가 없습니다.'));
      return;
    }

    const status = el('p', 'placeholder', 'AI 가 읽는 중…');
    body.appendChild(status);
    const out = el('div');
    body.appendChild(out);

    aiCall('summary', {
      issue: tracker.name,
      events: events.slice(-200).map((e) => ({ date: e.date, title: e.title })),
    }).then((r) => {
      status.remove();
      if (r.headline) {
        const h = el('div', 'set-section');
        h.appendChild(el('div', 'set-title', r.headline));
        out.appendChild(h);
      }
      if (r.phases && r.phases.length) {
        const tl = el('div', 'tl');
        r.phases.forEach((ph, i) => {
          const row = el('div', 'tl-day');
          const rail = el('div', 'tl-rail');
          rail.appendChild(el('div', 'tl-dot'));
          if (i < r.phases.length - 1) rail.appendChild(el('div', 'tl-line'));
          row.appendChild(rail);
          const col = el('div', 'tl-body');
          const card = el('div', 'tl-card');
          const head = el('div', 'tl-head');
          head.appendChild(el('span', 'tl-date', ph.date));
          card.appendChild(head);
          card.appendChild(el('div', 'pick-title', ph.what));
          col.appendChild(card);
          row.appendChild(col);
          tl.appendChild(row);
        });
        out.appendChild(tl);
      }
      if (r.now) {
        const n = el('div', 'set-section');
        n.appendChild(el('div', 'set-title', '현재'));
        n.appendChild(el('p', 'choice-hint', r.now));
        out.appendChild(n);
      }
      out.appendChild(el('p', 'choice-hint',
        `기사 ${events.length}건을 읽고 정리했습니다. 저장하지 않으니 다시 열면 새로 만듭니다.`));
    }).catch((e) => {
      status.textContent = `실패: ${e.message}`;
    });
  });
}

// ---------- backup ----------

// Everything lives in this device's localStorage, so clearing site data — or
// iOS evicting storage from an app left unused — takes the trackers with it.
// A file the user holds is the only recovery path that does not depend on the
// browser, and it has to exist before anything migrates data anywhere.
const BACKUP_VERSION = 1;

function backupBlob() {
  return JSON.stringify({
    app: 'news-feed',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: S,
  }, null, 2);
}

function backupFilename() {
  return `news-feed-backup-${dayOf(null)}.json`;
}

function downloadBackup() {
  const blob = new Blob([backupBlob()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoking immediately can cancel the download on some browsers
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Restoring replaces the whole settings object, so anything the running app
// still holds a reference to has to be re-read. Reloading is simpler and
// safer than reconciling every module-level cache by hand.
function applyBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('파일을 읽을 수 없습니다. JSON 형식이 아닙니다.');
  }
  if (!data || data.app !== 'news-feed' || !data.settings) {
    throw new Error('이 앱의 백업 파일이 아닙니다.');
  }
  if (data.version > BACKUP_VERSION) {
    throw new Error('더 새로운 버전의 백업입니다. 앱을 새로고침한 뒤 다시 시도하세요.');
  }
  const s = data.settings;
  if (!Array.isArray(s.trackers)) throw new Error('백업에 트래커 정보가 없습니다.');
  return {
    settings: s,
    trackers: s.trackers.length,
    events: s.trackers.reduce((n, t) => n + ((t.events || []).length), 0),
    saved: (s.saved || []).length,
    exportedAt: data.exportedAt || null,
  };
}

function openBackupPanel() {
  openPanel('백업 · 복원', (body) => {
    const sec = el('div', 'set-section');
    sec.appendChild(el('div', 'set-title', '내보내기'));
    const evCount = S.trackers.reduce((n, t) => n + ((t.events || []).length), 0);
    sec.appendChild(el('p', 'choice-hint',
      `이슈 ${S.trackers.length}개 · 기사 ${evCount}건 · 스크랩 ${S.saved.length}건과 `
      + '모든 설정을 파일 하나로 저장합니다.'));
    const dl = el('button', 'primary', '⭳ 백업 파일 저장');
    dl.style.width = '100%';
    dl.addEventListener('click', () => {
      downloadBackup();
      toast('백업 파일을 저장했습니다.');
    });
    sec.appendChild(dl);

    // iOS in standalone mode often ignores a download; copying gives the user
    // something they can paste into a note or a mail to themselves
    const cp = el('button', 'add-dashed', '⧉ 클립보드로 복사');
    cp.addEventListener('click', async () => {
      const ok = await copyText(backupBlob());
      toast(ok ? '백업 내용을 복사했습니다.' : '복사에 실패했습니다.');
    });
    sec.appendChild(cp);
    body.appendChild(sec);

    const rs = el('div', 'set-section');
    rs.appendChild(el('div', 'set-title', '복원'));
    rs.appendChild(el('p', 'choice-hint',
      '백업 파일을 고르면 현재 이슈·스크랩·설정을 모두 덮어씁니다. 되돌릴 수 없습니다.'));

    const file = el('input', 'in');
    file.type = 'file';
    file.accept = 'application/json,.json';
    rs.appendChild(file);

    const status = el('p', 'placeholder', '');
    rs.appendChild(status);

    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      let info;
      try {
        info = applyBackup(await f.text());
      } catch (err) {
        status.textContent = `✕ ${err.message}`;
        file.value = '';
        return;
      }
      const when = info.exportedAt ? ` (${dayOf(info.exportedAt)} 백업)` : '';
      confirmSheet(
        `이슈 ${info.trackers}개 · 기사 ${info.events}건으로 덮어씁니다${when}`,
        '⭱ 복원하기',
        () => {
          localStorage.setItem(LS_KEY, JSON.stringify(info.settings));
          location.reload();
        }
      );
      file.value = '';
    });
    body.appendChild(rs);
  });
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

    const acc = el('div', 'set-section');
    acc.appendChild(el('div', 'set-title', '계정'));
    acc.appendChild(el('p', 'choice-hint', account.signedIn
      ? `${account.email} 로 로그인되어 있습니다. 이슈는 서버에 저장됩니다.`
      : '로그인하면 이슈가 서버에 저장되어 폰과 PC에서 같이 보이고, '
        + '앱을 닫아둬도 새 기사가 쌓입니다. 로그인하지 않아도 앱은 그대로 씁니다.'));
    const abtn = el('button', 'add-dashed', account.signedIn ? '계정 관리' : '메일로 로그인');
    abtn.addEventListener('click', () => openLogin());
    acc.appendChild(abtn);
    body.appendChild(acc);

    const ai = el('div', 'set-section');
    ai.appendChild(el('div', 'set-title', 'AI (선택)'));
    ai.appendChild(el('p', 'choice-hint', aiReady()
      ? `${aiCfg.provider} 키가 설정되어 있습니다. 트래커에서 기사 정리·흐름 요약을 쓸 수 있습니다.`
      : '내 API 키를 넣으면 관련 없는 기사를 걸러내고 흐름을 요약할 수 있습니다. '
        + 'Claude·ChatGPT·Gemini·Grok 중 하나. 넣지 않아도 앱은 그대로 동작합니다.'));
    const aibtn = el('button', 'add-dashed', aiReady() ? 'AI 설정 관리' : '✦ AI 키 등록');
    aibtn.addEventListener('click', () => openAiSettings());
    ai.appendChild(aibtn);
    body.appendChild(ai);

    const bak = el('div', 'set-section');
    bak.appendChild(el('div', 'set-title', '백업 · 복원'));
    bak.appendChild(el('p', 'choice-hint',
      '설정과 트래커는 이 기기에만 저장됩니다. 브라우저 데이터를 지우면 사라지니 가끔 백업해 두세요.'));
    const bbtn = el('button', 'add-dashed', '⭳ 백업 · 복원 열기');
    bbtn.addEventListener('click', () => openBackupPanel());
    bak.appendChild(bbtn);
    body.appendChild(bak);
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

// The API serves whatever the last cron run collected; the file in the deploy
// is what answers before the first run, and if the API is not there at all the
// app falls back to it directly so an install without a Worker still works.
async function loadNews() {
  try {
    const res = await fetch(`api/news?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) return await res.json();
  } catch {
    // fall through to the file
  }
  const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

let refreshing = false;

async function refreshNews() {
  if (refreshing) return false;
  refreshing = true;
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  const label = document.getElementById('updated-at');
  label.textContent = '업데이트 중…';
  try {
    newsData = await loadNews();
    collectTrackers();
    rebuildPages();
    showUpdatedAt();
    return true;
  } catch {
    label.textContent = '업데이트 실패';
    setTimeout(showUpdatedAt, 2000);
    return false;
  } finally {
    btn.classList.remove('spinning');
    refreshing = false;
  }
}

// ---------- edge swipe between tabs ----------

// Inside the news tab a horizontal swipe moves between categories, and the
// pager consumes it. Only at the very first or last page does a swipe have
// nowhere to go, and that is where it hands over to the neighbouring tab.
function setupEdgeSwipe() {
  const pager = document.getElementById('pager');
  const THRESHOLD = 60;
  let g = null;

  pager.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const atStart = pager.scrollLeft <= 1;
    const atEnd = pager.scrollLeft >= pager.scrollWidth - pager.clientWidth - 1;
    if (!atStart && !atEnd) return;
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, atStart, atEnd, axis: null };
  }, { passive: true });

  pager.addEventListener('touchmove', (e) => {
    if (!g || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - g.x;
    const dy = t.clientY - g.y;
    if (g.axis === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      // let pull-to-refresh own anything vertical
      g.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (g.axis !== 'x') return;
    g.dx = dx;
  }, { passive: true });

  const settle = () => {
    if (!g) return;
    const { dx, axis, atStart, atEnd } = g;
    g = null;
    if (axis !== 'x' || !dx || Math.abs(dx) < THRESHOLD) return;

    const order = TABS.map((t) => t.id);
    const i = order.indexOf(activeTab);
    // swiping left (dx < 0) at the last page moves to the next tab
    if (dx < 0 && atEnd && i < order.length - 1) {
      tabIndex[order[i + 1]] = 0;
      switchTab(order[i + 1]);
    } else if (dx > 0 && atStart && i > 0) {
      const prev = order[i - 1];
      // arriving backwards should land on that tab's last page
      tabIndex[prev] = prev === 'news' ? Math.max(0, enabledCategories().length - 1) : 0;
      switchTab(prev);
    }
  };

  pager.addEventListener('touchend', settle);
  pager.addEventListener('touchcancel', () => { g = null; });
}

// ---------- pull to refresh ----------

function setupPullToRefresh() {
  const pager = document.getElementById('pager');
  const threshold = 72;
  let gesture = null;

  pager.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || refreshing) return;
    const page = e.target.closest('.page[data-pull-refresh="true"]');
    if (!page || page.scrollTop > 0) return;
    const touch = e.touches[0];
    gesture = { page, x: touch.clientX, y: touch.clientY, vertical: null };
  }, { passive: true });

  pager.addEventListener('touchmove', (e) => {
    if (!gesture || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;

    if (gesture.vertical === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      gesture.vertical = dy > 0 && Math.abs(dy) > Math.abs(dx);
    }
    if (!gesture.vertical || dy <= 0 || gesture.page.scrollTop > 0) return;

    e.preventDefault();
    const distance = Math.min(100, dy * 0.5);
    const pull = gesture.page.querySelector('.pull-refresh');
    gesture.page.classList.add('pull-refresh-active');
    pull.classList.add('pulling');
    pull.style.transform = `translateY(${Math.min(0, distance - 48)}px)`;
    gesture.page.querySelector('.page-inner').style.transform = `translateY(${distance}px)`;
    pull.classList.toggle('ready', distance >= threshold);
    pull.textContent = distance >= threshold ? '놓아서 새로고침' : '아래로 당겨 새로고침';
  }, { passive: false });

  const finish = async () => {
    if (!gesture) return;
    const { page, vertical } = gesture;
    gesture = null;
    const pull = page.querySelector('.pull-refresh');
    if (!pull || !vertical) return;
    const inner = page.querySelector('.page-inner');

    const shouldRefresh = pull.classList.contains('ready');
    page.classList.remove('pull-refresh-active');
    pull.classList.remove('pulling');
    if (!shouldRefresh) {
      pull.style.transform = '';
      inner.style.transform = '';
      pull.classList.remove('ready');
      return;
    }

    pull.style.transform = 'translateY(0)';
    inner.style.transform = 'translateY(48px)';
    pull.textContent = '업데이트 중…';
    pull.classList.add('loading');
    await refreshNews();
    pull.style.transform = '';
    inner.style.transform = '';
    pull.classList.remove('ready', 'loading');
  };

  pager.addEventListener('touchend', finish);
  pager.addEventListener('touchcancel', () => {
    if (!gesture) return;
    const pull = gesture.page.querySelector('.pull-refresh');
    const inner = gesture.page.querySelector('.page-inner');
    gesture.page.classList.remove('pull-refresh-active');
    gesture = null;
    if (!pull) return;
    pull.style.transform = '';
    if (inner) inner.style.transform = '';
    pull.classList.remove('ready', 'pulling');
  });
}

// ---------- boot ----------

// The magic link comes back as /?login=ok. Reporting it and clearing the query
// keeps a refresh from re-announcing a login that already happened.
function showLoginResult() {
  const q = new URLSearchParams(location.search);
  const r = q.get('login');
  if (!r) return;
  history.replaceState(null, '', location.pathname);
  if (r === 'ok') toast('로그인했습니다.');
  else if (r === 'expired') toast('링크가 만료됐습니다. 다시 로그인해 주세요.');
  else toast('로그인 링크가 유효하지 않습니다.');
}

async function main() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('share-btn').addEventListener('click', shareApp);
  document.getElementById('refresh-btn').addEventListener('click', refreshNews);

  try {
    newsData = window.__NEWS_DATA__ || (await loadNews());
  } catch {
    newsData = { updatedAt: null, categories: [] };
  }

  save(); // persist defaults (including the initial block list) on first run
  collectTrackers();
  showUpdatedAt();
  rebuildPages();

  // The account check runs after the first paint: the feed must not wait on a
  // request that fails whenever the API is not deployed.
  refreshAccount().then(async (signedIn) => {
    if (signedIn) {
      try {
        await pullTrackers();
      } catch { /* keep showing the local list */ }
    }
    rebuildPages();
    showLoginResult();
  });
  restoreViewState();
  setupPullToRefresh();
  setupEdgeSwipe();

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
