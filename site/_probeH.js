// Temporary: why would the important-news widget show only two items?
(function () {
  const R = [];
  const sleep = (m) => new Promise((r) => setTimeout(r, m));
  const line = (s) => R.push(s);

  const dump = () => {
    const p = document.createElement('pre');
    p.id = 'probe-out';
    p.textContent = 'BEGIN\n' + R.join('\n') + '\nEND';
    p.style.cssText = 'position:fixed;inset:0;background:#fff;color:#000;z-index:99999;'
      + 'font:11px monospace;padding:8px;overflow:auto;margin:0';
    document.body.appendChild(p);
    document.title = 'PROBE_DONE';
  };

  window.addEventListener('load', async () => {
    try {
      await sleep(900);

      line(`feed categories      : ${newsData.categories.length}`);
      line(`enabled categories   : ${enabledCategories().length}`);
      line(`categoryDisabled     : ${JSON.stringify(S.categoryDisabled)}`);
      line(`blockedSources count : ${S.blockedSources.length}`);
      line(`blockedKeywords      : ${JSON.stringify(S.blockedKeywords)}`);
      line('');

      let visible = 0;
      for (const c of enabledCategories()) visible += visibleItems(c).length;
      line(`visible after blocking : ${visible}`);

      const w = S.widgets.find((x) => x.type === 'important');
      line(`widget config          : ${JSON.stringify(w && w.config)}`);
      line(`requested count        : ${(w && w.config && w.config.count) || 5}`);
      line('');

      for (const n of [3, 5, 10]) {
        line(`importantItems(${String(n).padStart(2)}) -> ${importantItems(n).length}`);
      }
      line('');

      // how many survive dedup out of the 120-candidate window
      const pool = [];
      for (const cat of enabledCategories()) {
        for (const item of visibleItems(cat)) pool.push(item);
      }
      pool.sort((a, b) => b.score - a.score);
      line(`pool size              : ${pool.length}`);
      line(`candidate window       : ${Math.min(120, pool.length)}`);

      const picked = [];
      let dropped = 0;
      for (const cand of pool.slice(0, 120)) {
        const tk = titleTokens(cand.title);
        if (picked.some((p) => similar(p.tk, tk) >= 0.6)) { dropped++; continue; }
        picked.push({ tk });
      }
      line(`unique after dedup     : ${picked.length} (dropped ${dropped})`);
      line('');

      // what the widget actually renders
      const card = [...document.querySelectorAll('.widget')]
        .find((c) => /중요 뉴스/.test(c.querySelector('.w-head')?.textContent || ''));
      line(`widget card present    : ${!!card}`);
      if (card) {
        line(`rendered rows          : ${card.querySelectorAll('.news-item').length}`);
        line(`empty message shown    : ${!!card.querySelector('.w-empty')}`);
      }
      line('');
      line('top 6 by score:');
      pool.slice(0, 6).forEach((i, n) =>
        line(`  ${n + 1} [${String(i.score).padStart(6)}] ${i.source || '-'} | ${i.title.slice(0, 44)}`));

      dump();
    } catch (err) {
      line('THROWN: ' + err.message);
      dump();
    }
  });
})();
