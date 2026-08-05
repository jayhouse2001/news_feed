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
      { id: 'w-important', type: 'important', config: { count: 5 } },
      { id: 'w-links', type: 'links', config: {} },
    ],
    links: [],
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
let activeCategory = null;

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

// ---------- action sheet / overlay ----------

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
    rerender();
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

function newsItemNode(item, opts) {
  const li = el('li', 'news-item');
  const top = el('div', 'item-top');

  const a = el('a', 'item-link', item.title);
  a.href = item.link;
  a.target = '_blank';
  a.rel = 'noopener';
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
        rerender();
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
        rerender();
      }
    },
  });
  openSheet('이 기사에 대해', actions);
}

// ---------- news view ----------

function renderCategories() {
  const nav = document.getElementById('cats');
  nav.textContent = '';
  const cats = enabledCategories();
  if (cats.length && !cats.some((c) => c.id === activeCategory)) {
    activeCategory = cats[0].id;
  }
  for (const cat of cats) {
    const btn = el('button', 'cat' + (cat.id === activeCategory ? ' on' : ''), cat.name);
    btn.addEventListener('click', () => {
      activeCategory = cat.id;
      renderNews();
    });
    nav.appendChild(btn);
  }
}

function renderList() {
  const list = document.getElementById('news-list');
  const empty = document.getElementById('news-empty');
  list.textContent = '';
  const cat = newsData.categories.find((c) => c.id === activeCategory);
  const items = cat ? sortItems(visibleItems(cat), getSort(activeCategory)) : [];
  empty.hidden = items.length > 0;
  document.getElementById('cat-count').textContent = `${items.length}건`;
  document.getElementById('sort-btn').textContent =
    `정렬: ${SORT_LABEL[getSort(activeCategory)]} ▾`;
  for (const item of items) list.appendChild(newsItemNode(item));
}

function renderNews() {
  renderCategories();
  renderList();
}

function setupSortButton() {
  document.getElementById('sort-btn').addEventListener('click', () => {
    const cur = getSort(activeCategory);
    openSheet(
      '정렬 기준',
      Object.keys(SORT_LABEL).map((mode) => ({
        label: (mode === cur ? '✓ ' : '') + SORT_LABEL[mode],
        onClick() {
          S.sortBy[activeCategory] = mode;
          save();
          renderNews();
        },
      }))
    );
  });
}

// ---------- dashboard widgets ----------

const WIDGET_TYPES = {
  important: { name: '중요 뉴스' },
  links: { name: '바로가기' },
};

function widgetFrame(widget, index) {
  const card = el('div', 'widget');
  const head = el('div', 'w-head');
  head.appendChild(el('span', null, WIDGET_TYPES[widget.type]?.name || widget.type));

  const btns = el('span', 'w-btns');
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
      { label: '△ 위로', onClick() { moveItem(S.widgets, index, index - 1); save(); renderDashboard(); } },
      { label: '▽ 아래로', onClick() { moveItem(S.widgets, index, index + 1); save(); renderDashboard(); } },
      { label: '✕ 위젯 삭제', onClick() { S.widgets.splice(index, 1); save(); renderDashboard(); } },
    ]);
  });
  btns.appendChild(menu);
  head.appendChild(btns);
  card.appendChild(head);
  return card;
}

// near-duplicate removal across categories for the important widget
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
      pool.push({ item, catName: cat.name });
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
      renderDashboard();
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
    const ic = el('span', 'ic', [...link.name][0] || '?');
    a.appendChild(ic);
    a.appendChild(el('span', 'lb', link.name));
    grid.appendChild(a);
  }
  card.appendChild(grid);
}

function renderDashboard() {
  const box = document.getElementById('widgets');
  box.textContent = '';
  S.widgets.forEach((widget, i) => {
    const card = widgetFrame(widget, i);
    if (widget.type === 'important') renderImportantWidget(card, widget);
    else if (widget.type === 'links') renderLinksWidget(card);
    box.appendChild(card);
  });
}

function setupAddWidget() {
  document.getElementById('add-widget').addEventListener('click', () => {
    openSheet(
      '위젯 추가',
      Object.entries(WIDGET_TYPES).map(([type, def]) => ({
        label: def.name,
        onClick() {
          S.widgets.push({ id: `w-${Date.now()}`, type, config: type === 'important' ? { count: 5 } : {} });
          save();
          renderDashboard();
        },
      }))
    );
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

// ---------- settings view ----------

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
      rerender();
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
    rerender();
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

function renderSettings() {
  const body = document.getElementById('settings-body');
  body.textContent = '';
  body.appendChild(knownSourcesDatalist());

  // categories: on/off + order
  const catSec = el('div', 'set-section');
  catSec.appendChild(el('div', 'set-title', '카테고리 (표시 여부 · 순서)'));
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
      rerender();
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
    mk('△', () => { moveItem(order, i, i - 1); S.categoryOrder = order; save(); rerender(); }, i === 0);
    mk('▽', () => { moveItem(order, i, i + 1); S.categoryOrder = order; save(); rerender(); }, i === all.length - 1);
    catSec.appendChild(row);
  });
  body.appendChild(catSec);

  // blocked sources
  const bsSec = el('div', 'set-section');
  bsSec.appendChild(el('div', 'set-title', '차단한 언론사'));
  const bsBox = el('div', 'chipbox');
  chipList(bsBox, S.blockedSources, '없음 — 기사의 ⋯ 버튼 또는 아래에서 추가');
  bsSec.appendChild(bsBox);
  bsSec.appendChild(addRow('언론사 이름', (v) => addUnique(S.blockedSources, v), 'known-sources'));
  body.appendChild(bsSec);

  // blocked keywords
  const bkSec = el('div', 'set-section');
  bkSec.appendChild(el('div', 'set-title', '차단한 키워드'));
  const bkBox = el('div', 'chipbox');
  chipList(bkBox, S.blockedKeywords, '없음');
  bkSec.appendChild(bkBox);
  bkSec.appendChild(addRow('키워드', (v) => addUnique(S.blockedKeywords, v)));
  body.appendChild(bkSec);

  // preferred sources (for '언론사 우선' sort)
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
    mk('△', () => { moveItem(S.preferredSources, i, i - 1); save(); rerender(); });
    mk('▽', () => { moveItem(S.preferredSources, i, i + 1); save(); rerender(); });
    mk('✕', () => { S.preferredSources.splice(i, 1); save(); rerender(); });
    psSec.appendChild(row);
  });
  if (!S.preferredSources.length) psSec.appendChild(el('p', 'w-empty', '없음'));
  psSec.appendChild(addRow('언론사 이름', (v) => addUnique(S.preferredSources, v), 'known-sources'));
  body.appendChild(psSec);
}

// ---------- tabs ----------

function switchTab(view) {
  document.querySelectorAll('.tabbar .tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.view === view);
    if (t.dataset.view === view) {
      document.getElementById('appbar-title').textContent = t.dataset.title;
    }
  });
  for (const v of document.querySelectorAll('main .view')) {
    v.hidden = v.id !== `view-${view}`;
  }
  if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
}

function setupTabs() {
  document.querySelectorAll('.tabbar .tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.view));
  });
}

// ---------- boot ----------

function rerender() {
  renderDashboard();
  renderNews();
  renderSettings();
}

async function main() {
  setupTabs();
  setupSortButton();
  setupAddWidget();

  try {
    if (window.__NEWS_DATA__) {
      newsData = window.__NEWS_DATA__;
    } else {
      const res = await fetch('data/news.json', { cache: 'no-cache' });
      newsData = await res.json();
    }
  } catch {
    document.getElementById('news-empty').hidden = false;
  }

  if (newsData.updatedAt) {
    document.getElementById('updated-at').textContent = `업데이트 ${relTime(newsData.updatedAt)}`;
  }
  activeCategory = enabledCategories()[0]?.id ?? null;
  rerender();

  const initial =
    new URLSearchParams(location.search).get('tab') || location.hash.replace('#', '');
  switchTab(['dashboard', 'news', 'settings'].includes(initial) ? initial : 'dashboard');
}

main();
