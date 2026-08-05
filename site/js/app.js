'use strict';

// ---------- settings (localStorage, per device) ----------

const LS_KEY = 'nf:settings:v1';

function defaultSettings() {
  return {
    blockedSources: [],
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
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultSettings();
    return Object.assign(defaultSettings(), JSON.parse(raw));
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
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  if (isStandalone()) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = `x-safari-${item.link}`;
    });
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
    for (const item of visibleItems(cat)) pool.push({ item, catName: cat.name });
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
  for (const { item, catName } of importantItems(count)) {
    ul.appendChild(newsItemNode(item, { categoryName: catName }));
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

  if (!items.length) {
    inner.appendChild(el('p', 'placeholder', '표시할 기사가 없습니다.'));
  } else {
    const ul = el('ul', 'news-list');
    for (const item of items) ul.appendChild(newsItemNode(item));
    inner.appendChild(ul);
  }

  page.appendChild(inner);
  return page;
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
      save();
      openSettings();
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
    save();
    openSettings();
  };
  btn.addEventListener('click', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
  });
  row.appendChild(input);
  row.appendChild(btn);
  return row;
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

function openSettings() {
  openPanel('설정', (body) => {
    body.appendChild(knownSourcesDatalist());

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
        save();
        openSettings();
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
      mk('△', () => { moveItem(order, i, i - 1); S.categoryOrder = order; save(); openSettings(); }, i === 0);
      mk('▽', () => { moveItem(order, i, i + 1); S.categoryOrder = order; save(); openSettings(); }, i === all.length - 1);
      catSec.appendChild(row);
    });
    body.appendChild(catSec);

    const bsSec = el('div', 'set-section');
    bsSec.appendChild(el('div', 'set-title', '차단한 언론사'));
    const bsBox = el('div', 'chipbox');
    chipList(bsBox, S.blockedSources, '없음 — 기사의 ⋯ 버튼 또는 아래에서 추가');
    bsSec.appendChild(bsBox);
    bsSec.appendChild(addRow('언론사 이름', (v) => addUnique(S.blockedSources, v), 'known-sources'));
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
      mk('△', () => { moveItem(S.preferredSources, i, i - 1); save(); openSettings(); });
      mk('▽', () => { moveItem(S.preferredSources, i, i + 1); save(); openSettings(); });
      mk('✕', () => { S.preferredSources.splice(i, 1); save(); openSettings(); });
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

  showUpdatedAt();
  rebuildPages();

  const pager = document.getElementById('pager');
  let raf = 0;
  pager.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(syncPageIndicator);
  });
  window.addEventListener('resize', () => {
    pager.scrollLeft = currentIndex() * pager.clientWidth;
  });
}

main();
