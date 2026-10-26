/* ===== 自创面试官配置页 ===== */
(async function () {
  Nav.render('custom.html');
  const D = window.Data, C = window.SITE_CONFIG;
  await D.loadCatalog();
  const tagIndex = await D.loadTagIndex();
  const TAG_META = tagIndex.tags || {};

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  const state = { cfg: null, tags: [], domain: '全部', text: '' };

  // —— 行业 / 岗位 / 层级 ——
  const $ind = $('sel-industry'), $role = $('sel-role'), $lvl = $('sel-level');
  const bm = C.BENCHMARK_INDUSTRY;
  const industries = D.listIndustries().slice().sort((a, b) => (a === bm ? -1 : b === bm ? 1 : 0));
  $ind.innerHTML = industries.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');

  function fillRoles() {
    const roles = D.listRoles($ind.value);
    $role.innerHTML = roles.map(r => `<option value="${esc(r)}">${esc(r)}</option>`).join('');
    fillLevels();
  }
  function fillLevels() {
    const levels = D.listLevels($ind.value, $role.value);
    $lvl.innerHTML = levels.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  }
  $ind.addEventListener('change', fillRoles);
  $role.addEventListener('change', fillLevels);
  fillRoles();

  // —— 标签选择 ——
  const domains = ['全部'].concat(Array.from(new Set(Object.keys(TAG_META).map(k => TAG_META[k].domain).filter(Boolean))));
  $('domain-filter').innerHTML = domains.map(d =>
    `<button class="dom-btn${d === '全部' ? ' active' : ''}" data-dom="${esc(d)}">${esc(d)}</button>`
  ).join('');
  $('domain-filter').addEventListener('click', e => {
    const b = e.target.closest('.dom-btn'); if (!b) return;
    state.domain = b.dataset.dom;
    Array.from(document.querySelectorAll('.dom-btn')).forEach(x => x.classList.toggle('active', x === b));
    renderTags();
  });

  function renderTags() {
    const list = Object.keys(TAG_META).filter(t => state.domain === '全部' || TAG_META[t].domain === state.domain);
    list.sort((a, b) => (TAG_META[b].total || 0) - (TAG_META[a].total || 0));
    $('tag-pool').innerHTML = list.map(t => {
      const on = state.tags.indexOf(t) >= 0;
      return `<button class="tag-pick${on ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}<em>${TAG_META[t].total || 0}</em></button>`;
    }).join('') || '<div class="hint">该分类下没有标签</div>';
  }
  $('tag-pool').addEventListener('click', e => {
    const b = e.target.closest('.tag-pick'); if (!b) return;
    const t = b.dataset.tag;
    const i = state.tags.indexOf(t);
    if (i >= 0) state.tags.splice(i, 1); else state.tags.push(t);
    if (state.tags.length > 8) { state.tags.pop(); }
    renderTags(); renderPicked(); updateReady();
  });

  function renderPicked() {
    const box = $('picked-tags');
    if (!state.tags.length) { box.innerHTML = '还没选标签'; return; }
    const total = state.tags.reduce((a, t) => a + (TAG_META[t].total || 0), 0);
    box.innerHTML = '<b>已选 ' + state.tags.length + ' 个（共 ' + total + ' 道题）：</b>' +
      state.tags.map(t => `<span class="tag picked-tag" data-tag="${esc(t)}">${esc(t)} ×</span>`).join(' ');
  }
  $('picked-tags').addEventListener('click', e => {
    const s = e.target.closest('.picked-tag'); if (!s) return;
    const t = s.dataset.tag;
    const i = state.tags.indexOf(t);
    if (i >= 0) { state.tags.splice(i, 1); renderTags(); renderPicked(); updateReady(); }
  });

  function updateCovHint() {
    const want = Number($('sel-count').value) || 6;
    const total = state.tags.reduce((a, t) => a + (TAG_META[t].total || 0), 0);
    const el = $('cov-hint');
    if (!state.tags.length) { el.textContent = ''; return; }
    if (total < want) {
      el.className = 'cov-hint warn';
      el.textContent = `已选标签只有 ${total} 道题，不足 ${want} 题——会用同岗位相近考点补足，仍不足则本次减少题量并在报告里说明。`;
    } else {
      el.className = 'cov-hint';
      el.textContent = `已选范围共 ${total} 道题，本次抽 ${want} 题；系统会尽量让每个标签都考到。`;
    }
  }
  ['sel-count', 'sel-diff', 'sel-follow'].forEach(id => $(id).addEventListener('change', updateCovHint));

  // —— 人格示例 chips ——
  const CHIPS = [
    '说话很简短、有点不耐烦的技术负责人，会一直追到我答不上来',
    '很温和的 HR，会顺着我的经历慢慢问，也会追问细节',
    '压力面：不断质疑我的答案，说“这个说法不成立”',
    '像师兄一样边聊边带，答完会告诉我哪里可以更好',
    '只看结果不关心过程，要求每个回答都有数据',
    '用英文面试我，问题要专业一点'
  ];
  $('persona-chips').innerHTML = CHIPS.map(c => `<button class="chip" data-txt="${esc(c)}">${esc(c.slice(0, 18))}…</button>`).join('');
  $('persona-chips').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    $('persona-text').value = b.dataset.txt;
    state.text = b.dataset.txt;
    state.cfg = null;
    $('parsed').hidden = true;
    updateReady();
  });

  // —— 解析 ——
  $('btn-parse').addEventListener('click', async () => {
    const text = $('persona-text').value.trim();
    const msg = $('parse-msg');
    if (!text) { msg.textContent = '先写一句你想要的面试官'; msg.className = 'hint warn'; return; }
    msg.className = 'hint';
    msg.textContent = '解析中…';
    $('btn-parse').disabled = true;
    try {
      const cfg = await Persona.parse(text, { tagNames: Object.keys(TAG_META) });
      state.cfg = cfg;
      state.text = text;
      $('parsed').hidden = false;
      $('p-summary').textContent = cfg.summary || '—';
      $('p-desc').textContent = Persona.describe(cfg) || '—';
      $('p-interrupt').checked = cfg.interrupt;
      $('p-feedback').checked = cfg.instantFeedback;
      $('p-answer').checked = cfg.answerMode;
      $('p-lang').value = cfg.language;

      // 描述里提到的范围，回写到标签选择
      if (cfg.scopeTags && cfg.scopeTags.length) {
        cfg.scopeTags.forEach(t => { if (TAG_META[t] && state.tags.indexOf(t) < 0 && state.tags.length < 8) state.tags.push(t); });
        renderTags(); renderPicked(); updateCovHint();
        msg.textContent = '已按描述自动勾选 ' + cfg.scopeTags.length + ' 个考点，可在下方增删';
      } else {
        msg.textContent = '解析完成，请在下面圈定考察范围';
      }

      const w = $('p-unsupported');
      if (cfg.unsupported && cfg.unsupported.length) {
        w.hidden = false;
        w.textContent = '以下指令不支持，已忽略：' + cfg.unsupported.join('；') + '（评分口径不会被任何描述改变）';
      } else { w.hidden = true; }

      updateReady();
    } catch (e) {
      msg.className = 'hint warn';
      msg.textContent = '解析失败：' + (e.message || e) + '（可以再点一次，或直接选范围开始）';
      // 解析失败也允许用默认人格继续
      state.cfg = Persona.normalize(text, { summary: text.slice(0, 20) });
    } finally {
      $('btn-parse').disabled = false;
    }
  });

  // 解析结果里的开关被手动改动后，同步到 cfg
  function syncCfgFromUI() {
    if (!state.cfg) return;
    state.cfg.interrupt = $('p-interrupt').checked;
    state.cfg.instantFeedback = $('p-feedback').checked;
    state.cfg.answerMode = $('p-answer').checked;
    state.cfg.language = $('p-lang').value;
    $('p-desc').textContent = Persona.describe(state.cfg) || '—';
  }
  ['p-interrupt', 'p-feedback', 'p-answer', 'p-lang'].forEach(id => $(id).addEventListener('change', syncCfgFromUI));

  // —— 试问 ——
  $('btn-preview').addEventListener('click', async () => {
    const msg = $('preview-msg'), box = $('preview-box');
    if (!state.cfg && state.text) state.cfg = Persona.normalize(state.text, { summary: state.text.slice(0, 20) });
    if (!state.cfg) { msg.className = 'hint warn'; msg.textContent = '先写一句面试官描述并解析'; return; }
    if (!state.tags.length) { msg.className = 'hint warn'; msg.textContent = '先选至少一个考点，这样试问才贴近你的场景'; return; }
    msg.className = 'hint'; msg.textContent = '正在让它开口…';
    $('btn-preview').disabled = true;
    try {
      const pack = await D.sampleByTags({
        industry: $ind.value, role: $role.value, level: $lvl.value,
        tags: state.tags, count: 1, difficulty: 'mixed'
      });
      const q = pack.questions[0];
      const say = await Persona.preview(state.cfg, { industry: $ind.value, role: $role.value, level: $lvl.value }, q ? q.q : '');
      box.hidden = false;
      box.innerHTML = '<div class="pv-who">' + esc(state.cfg.summary || '面试官') + '</div>' +
        '<div class="pv-text">' + esc(say) + '</div>' +
        (q ? '<div class="pv-src">考察点：' + esc(q.q) + '（' + esc(q._industry || '') + '）</div>' : '');
      msg.textContent = '听着不对就回去改描述，再点一次';
    } catch (e) {
      msg.className = 'hint warn';
      msg.textContent = '试问失败：' + (e.message || e);
    } finally { $('btn-preview').disabled = false; }
  });

  // —— 就绪判断 ——
  function ready() {
    const hasPersona = !!($('persona-text').value.trim() && state.cfg);
    return { ok: hasPersona && state.tags.length > 0, hasPersona, hasTags: state.tags.length > 0 };
  }
  function updateReady() {
    const r = ready();
    $('btn-start').disabled = !r.ok;
    const hint = $('start-hint');
    if (r.ok) hint.textContent = '将按「' + (state.cfg.summary || '自创人格') + '」问 ' + $('sel-count').value + ' 道题，范围 ' + state.tags.length + ' 个考点';
    else if (!r.hasPersona) hint.textContent = '先写一句面试官描述并点「解析这段描述」';
    else hint.textContent = '再选至少一个考点';
    updateCovHint();
  }
  $('persona-text').addEventListener('input', e => {
    state.text = e.target.value.trim();
    if (state.cfg && state.cfg.rawText !== state.text) { state.cfg = null; $('parsed').hidden = true; }
    updateReady();
  });

  // —— 开始 ——
  $('btn-start').addEventListener('click', () => {
    const r = ready();
    if (!r.ok) return;
    const cfg = Object.assign({}, state.cfg);
    cfg.rawText = state.text;
    cfg.skipTypes = cfg.skipTypes || [];
    Persona.save({
      name: cfg.summary || '我的面试官',
      description: state.text,
      config: cfg,
      scope: {
        industry: $ind.value,
        role: $role.value,
        level: $lvl.value,
        tags: state.tags.slice(),
        count: Number($('sel-count').value) || 6,
        difficulty: $('sel-diff').value,
        maxFollowups: Number($('sel-follow') ? $('sel-follow').value : 1)
      },
      createdAt: Date.now()
    });
    location.href = 'interview.html?mode=custom';
  });

  // 自动恢复上次草稿
  const saved = Persona.load();
  if (saved && saved.scope) {
    try {
      state.cfg = saved.config; state.text = saved.description || '';
      $('persona-text').value = state.text;
      if (saved.scope.industry) { $ind.value = saved.scope.industry; fillRoles(); }
      if (saved.scope.role) $role.value = saved.scope.role;
      fillLevels();
      if (saved.scope.level) $lvl.value = saved.scope.level;
      state.tags = (saved.scope.tags || []).filter(t => TAG_META[t]);
      $('sel-count').value = String(saved.scope.count || 6);
      $('sel-diff').value = saved.scope.difficulty || 'mixed';
      $('sel-follow').value = String(saved.scope.maxFollowups == null ? 1 : saved.scope.maxFollowups);
      $('parsed').hidden = false;
      $('p-summary').textContent = state.cfg.summary || '—';
      $('p-desc').textContent = Persona.describe(state.cfg) || '—';
      $('p-interrupt').checked = !!state.cfg.interrupt;
      $('p-feedback').checked = !!state.cfg.instantFeedback;
      $('p-answer').checked = !!state.cfg.answerMode;
      $('p-lang').value = state.cfg.language || 'zh';
      renderTags(); renderPicked();
    } catch (e) { /* 恢复失败忽略 */ }
  }

  renderTags(); renderPicked(); updateReady();
})();
