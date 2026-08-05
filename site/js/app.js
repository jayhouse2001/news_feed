'use strict';

let newsData = null;
let activeCategory = null;

function relTime(iso) {
  if (!iso) return '';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function renderCategories() {
  const nav = document.getElementById('cats');
  nav.textContent = '';
  for (const cat of newsData.categories) {
    const btn = document.createElement('button');
    btn.className = 'cat' + (cat.id === activeCategory ? ' on' : '');
    btn.textContent = cat.name;
    btn.addEventListener('click', () => {
      activeCategory = cat.id;
      renderCategories();
      renderList();
    });
    nav.appendChild(btn);
  }
}

function renderList() {
  const list = document.getElementById('news-list');
  const empty = document.getElementById('news-empty');
  list.textContent = '';
  const cat = newsData.categories.find((c) => c.id === activeCategory);
  const items = cat ? cat.items : [];
  empty.hidden = items.length > 0;
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'news-item';

    const a = document.createElement('a');
    a.href = item.link;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = item.title;
    li.appendChild(a);

    const meta = document.createElement('div');
    meta.className = 'meta';
    if (item.coverage >= 3) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `${item.coverage}곳 보도`;
      meta.appendChild(badge);
    }
    const src = document.createElement('span');
    src.textContent = [item.source, relTime(item.pubDate)].filter(Boolean).join(' · ');
    meta.appendChild(src);
    li.appendChild(meta);

    list.appendChild(li);
  }
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tabbar .tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.toggle('on', t === tab));
      for (const view of document.querySelectorAll('main .view')) {
        view.hidden = view.id !== `view-${tab.dataset.view}`;
      }
      document.getElementById('appbar-title').textContent = tab.dataset.title;
    });
  });
}

async function main() {
  setupTabs();
  try {
    const res = await fetch('data/news.json', { cache: 'no-cache' });
    newsData = await res.json();
  } catch {
    document.getElementById('news-empty').hidden = false;
    return;
  }
  document.getElementById('updated-at').textContent =
    `업데이트 ${relTime(newsData.updatedAt)}`;
  activeCategory = newsData.categories[0]?.id ?? null;
  renderCategories();
  renderList();
}

main();
