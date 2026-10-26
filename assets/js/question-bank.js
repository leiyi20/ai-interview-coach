/* ===== 题库 / 知识点浏览 ===== */
(async function () {
  Nav.render('question-bank.html');
  const D = window.Data;
  await D.loadCatalog();

  const $ind = document.getElementById('f-industry');
  const $role = document.getElementById('f-role');
  const $type = document.getElementById('f-type');
  const $tag = document.getElementById('f-tag');
  const $list = document.getElementById('list');
  const $count = document.getElementById('count');
  const $q = document.getElementById('f-q');
  const $btnAll = document.getElementById('btn-search-all');
  const $btnClear = document.getElementById('btn-clear');
  const $qHint = document.getElementById('q-hint');

  // 搜索范围：'industry'（当前行业/岗位内）| 'all'（跨全库）
  let scope = 'industry';
  let allPool = null;   // 全库题目缓存（首次搜全库时加载一次）

  // 中文无需分词，子串匹配即可；多关键词为「全部命中」
  function terms() {
    return ($q.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  }
  function haystack(q) {
    return [q.q, q.intent, q.type, q.level, (q.keywords || []).join(' '), (q.tags || []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
  }
  function matchQ(q, ts) {
    if (!ts.length) return true;
    const hay = haystack(q);
    return ts.every(t => hay.indexOf(t) >= 0);
  }

  // 行业
  const industries = D.listIndustries();
  const bm = window.SITE_CONFIG.BENCHMARK_INDUSTRY;
  industries.sort((a, b) => (a === bm ? -1 : b === bm ? 1 : 0));
  $ind.innerHTML = industries.map(i => `<option value="${i}">${i}</option>`).join('');
  $ind.value = bm;
  await D.loadIndustry(bm);   // 只加载当前行业的题目

  function fillRoles() {
    $role.innerHTML = D.listRoles($ind.value).map(r => `<option value="${r}">${r}</option>`).join('');
    render();
  }
  function fillTypes() {
    const qs = D.getQuestions($ind.value, $role.value);
    const types = [...new Set(qs.map(q => q.type))];
    $type.innerHTML = `<option value="">全部题型</option>` + types.map(t => `<option value="${t}">${t}</option>`).join('');
    render();
  }

  // 知识点标签（来自 knowledge_tags.json）
  const tags = (await D.loadCatalog()).tags.tags;
  $tag.innerHTML = `<option value="">全部知识点</option>` +
    tags.map(t => `<option value="${t.name}">${t.name}（${t.domain}）</option>`).join('');

  // 全库题目池（首次「搜全库」时加载，之后缓存复用）
  async function loadAllPool() {
    const pool = [];
    for (const ind of industries) {
      await D.loadIndustry(ind);
      for (const r of D.listRoles(ind)) {
        (D.getQuestions(ind, r) || []).forEach(q => {
          pool.push(Object.assign({}, q, { _industry: ind, _role: r }));
        });
      }
    }
    return pool;
  }

  async function render() {
    const ts = terms();
    let qs;
    if (scope === 'all' && ts.length) {
      if (!allPool) {
        $count.textContent = '正在加载全库题目…';
        $list.innerHTML = '<div class="empty">首次搜索全库需要载入约 2800 题，请稍候…</div>';
        allPool = await loadAllPool();
      }
      qs = allPool.filter(q => matchQ(q, ts));
    } else {
      scope = 'industry';
      qs = (D.getQuestions($ind.value, $role.value) || []).map(q =>
        Object.assign({}, q, { _industry: $ind.value, _role: $role.value }));
      qs = qs.filter(q => matchQ(q, ts));
    }
    const t = $type.value, tag = $tag.value;
    if (t) qs = qs.filter(q => q.type === t);
    if (tag) qs = qs.filter(q => (q.tags || []).includes(tag));
    $count.textContent = `共 ${qs.length} 题` +
      (ts.length ? `（关键词：${ts.join(' + ')}${scope === 'all' ? ' · 全库' : ' · 本岗位'}）` : '');
    if (!qs.length) { $list.innerHTML = '<div class="empty">该筛选条件下暂无题目。</div>'; return; }
    // 性能：最多渲染 60 条
    const shown = qs.slice(0, 60);
    $list.innerHTML = shown.map((q, i) => {
      const kw = (q.keywords || []).map(k => `<span class="kw">${k}</span>`).join('');
      const fu = (q.followups || []).map(f => `<div class="qdetail">↳ ${escapeHtml(f)}</div>`).join('');
      const tg = (q.tags || []).slice(0, 8).map(t => `<span class="tag soft">${t}</span>`).join(' ');
      return `<div class="qcard">
        <div class="qhead"><span class="qtype">${q.type}</span><span class="qdiff">${q.difficulty} · ${q.level}</span>${scope === 'all' ? `<span class="qdiff">${escapeHtml(q._industry || '')} · ${escapeHtml(q._role || '')}</span>` : ''}
          <span class="qhead-right">${window.Feedback ? window.Feedback.calibratedChip(q) : ''}${window.Feedback ? window.Feedback.btnHtml({ questionId: q.id, industry: $ind.value, roleName: $role.value, qtype: q.type, difficulty: q.difficulty }) : ''}</span>
        </div>
        <div class="qtext">${i+1}. ${escapeHtml(q.q)}</div>
        <div class="qdetail"><b>考察意图：</b>${escapeHtml(q.intent || '—')}</div>
        <div style="margin-top:8px;"><b style="font-size:12px;color:var(--wb-muted);">评分要点 / 参考答案框架：</b><br>${kw}</div>
        ${q.followups && q.followups.length ? `<div style="margin-top:8px;"><b style="font-size:12px;color:var(--wb-muted);">追问链路：</b>${fu}</div>` : ''}
        <div style="margin-top:8px;" class="tags">${tg}</div>
      </div>`;
    }).join('') + (qs.length > 60 ? `<div class="empty">仅展示前 60 题，共 ${qs.length} 题。</div>` : '');
  }

  function escapeHtml(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

  function updateHint() {
    if (!$qHint) return;
    const ts = terms();
    if (!ts.length) { $qHint.textContent = '输入关键词回车或点「搜全库」；多个词用空格分隔（需全部命中）。'; return; }
    $qHint.textContent = scope === 'all'
      ? `正在全库搜索「${ts.join(' + ')}」，可用下方题型/知识点继续筛选。`
      : `在当前岗位内搜到结果。想跨行业找？点「搜全库」。`;
  }

  let timer = null;
  $q.addEventListener('input', () => {
    scope = 'industry';
    clearTimeout(timer);
    timer = setTimeout(() => { render(); updateHint(); }, 220);
  });
  $q.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); scope = 'all'; render(); updateHint(); }
  });
  $btnAll.addEventListener('click', () => {
    const ts = terms();
    if (!ts.length) { $q.focus(); if ($qHint) $qHint.textContent = '请先输入关键词，再搜全库。'; return; }
    scope = 'all';
    render(); updateHint();
  });
  $btnClear.addEventListener('click', () => {
    $q.value = ''; scope = 'industry';
    $type.value = ''; $tag.value = '';
    render(); updateHint();
  });

  $ind.addEventListener('change', async () => { scope = 'industry'; await D.loadIndustry($ind.value); fillRoles(); updateHint(); });
  $role.addEventListener('change', () => { scope = 'industry'; fillTypes(); updateHint(); });
  $type.addEventListener('change', render);
  $tag.addEventListener('change', render);

  fillRoles();
  fillTypes();
  updateHint();
})();
