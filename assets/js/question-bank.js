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

  function render() {
    let qs = D.getQuestions($ind.value, $role.value);
    const t = $type.value, tag = $tag.value;
    if (t) qs = qs.filter(q => q.type === t);
    if (tag) qs = qs.filter(q => (q.tags || []).includes(tag));
    $count.textContent = `共 ${qs.length} 题`;
    if (!qs.length) { $list.innerHTML = '<div class="empty">该筛选条件下暂无题目。</div>'; return; }
    // 性能：最多渲染 60 条
    const shown = qs.slice(0, 60);
    $list.innerHTML = shown.map((q, i) => {
      const kw = (q.keywords || []).map(k => `<span class="kw">${k}</span>`).join('');
      const fu = (q.followups || []).map(f => `<div class="qdetail">↳ ${escapeHtml(f)}</div>`).join('');
      const tg = (q.tags || []).slice(0, 8).map(t => `<span class="tag soft">${t}</span>`).join(' ');
      return `<div class="qcard">
        <div class="qhead"><span class="qtype">${q.type}</span><span class="qdiff">${q.difficulty} · ${q.level}</span>
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

  $ind.addEventListener('change', async () => { await D.loadIndustry($ind.value); fillRoles(); });
  $role.addEventListener('change', () => { fillTypes(); });
  $type.addEventListener('change', render);
  $tag.addEventListener('change', render);

  fillRoles();
  fillTypes();
})();
