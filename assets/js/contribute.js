/* ===== 参与共建：经验案例 / 档位实况 / 踩坑复盘 / 主观看法 =====
 *
 * 与「题目纠错」分开：纠错绑题目、可验证、直接改数据；
 * 这类是经验主观内容，审核后才生效，且不直接驱动评分口径改动。
 *
 * 四类分别给不同的字段组，data 以 JSONB 存入云端 contributions 表。
 * 公开案例区只读 status='accepted' 且 public_ok=true 的记录。
 */
(async function () {
  Nav.render('contribute.html');
  const D = window.Data;

  const TYPES = [
    { k: 'experience', t: '经验案例', s: '真实怎么问 + 我怎么答 + 事后反思',
      w: '采纳后沉淀为示范作答，帮后来者看到「过来人是怎么答的」。' },
    { k: 'tier', t: '档位实况', s: '这个档位 / 行业实际看重什么',
      w: '多条同向印证后，用于校准档位模型与维度权重。' },
    { k: 'pitfall', t: '踩坑复盘', s: '我栽在哪、后来怎么补的',
      w: '采纳后补充进「下一步怎么提升」的六维改进话术。' },
    { k: 'opinion', t: '主观看法', s: '对产品、内容、流程的看法',
      w: '只用于优化文案与引导，不改动评分口径与维度权重。' },
    { k: 'jd', t: 'JD 分析', s: '贴一份公开 JD，贡献六维考察点密度',
      w: '多条积累后，用真实招聘要求的分布校准六维权重建议（只存统计，不存原文）。' }
  ];
  const DIMS = ['专业能力', '岗位匹配', '沟通表达', '逻辑思维', '学习潜力', '稳定性与价值观'];

  let kind = 'experience';
  const $ = id => document.getElementById(id);

  // —— 类型卡 ——
  $('ct-types').innerHTML = TYPES.map(t => `
    <div class="ct-type${t.k === kind ? ' on' : ''}" data-k="${t.k}">
      <div class="ct-type-t">${t.t}</div>
      <div class="ct-type-s">${t.s}</div>
    </div>`).join('');
  function showWhy() {
    const t = TYPES.find(x => x.k === kind);
    $('ct-why').textContent = t ? t.w : '';
  }
  showWhy();

  $('ct-types').addEventListener('click', e => {
    const el = e.target.closest('.ct-type');
    if (!el) return;
    kind = el.getAttribute('data-k');
    [...document.querySelectorAll('.ct-type')].forEach(x => x.classList.toggle('on', x.getAttribute('data-k') === kind));
    [...document.querySelectorAll('.ct-group')].forEach(g => {
      g.style.display = g.getAttribute('data-kind') === kind ? '' : 'none';
    });
    $('ct-tier-field').style.display = (kind === 'tier' || kind === 'experience' || kind === 'jd') ? '' : 'none';
    $('ct-form-card').style.display = '';
    showWhy();
    $('ct-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // 档位实况：六维多选
  $('tr-dims').innerHTML = DIMS.map(d => `<span class="ct-dim" data-d="${d}">${d}</span>`).join('');
  $('tr-dims').addEventListener('click', e => {
    const el = e.target.closest('.ct-dim');
    if (el) el.classList.toggle('on');
  });

  // JD 字数统计
  const jdText = $('jd-text');
  jdText.addEventListener('input', () => { $('jd-n').textContent = jdText.value.length; });

  // —— 行业 / 岗位 / 档位 ——
  const catAll = await D.loadCatalog();
  const cat = catAll.catalog || {};
  const industries = D.listIndustries();
  $('ct-industry').innerHTML = `<option value="">不限 / 通用</option>` +
    industries.map(i => `<option value="${i}">${i}</option>`).join('');
  function fillRoles() {
    const ind = $('ct-industry').value;
    const roles = ind ? D.listRoles(ind) : [];
    $('ct-role').innerHTML = `<option value="">不限</option>` + roles.map(r => `<option value="${r}">${r}</option>`).join('');
  }
  $('ct-industry').addEventListener('change', fillRoles);
  fillRoles();

  const tiers = (catAll.tiers && catAll.tiers.tiers) || {};
  $('ct-tier').innerHTML = `<option value="">未指定</option>` +
    Object.keys(tiers).map(k => `<option value="${k}">${tiers[k].name}</option>`).join('');

  // —— JD 六维考察点抽取（在用户浏览器里调云端模型，只回传统计，不回传原文） ——
  const JD_DIMS = ['专业能力', '岗位匹配', '沟通表达', '逻辑思维', '学习潜力', '稳定性与价值观'];
  async function extractJdPoints(text) {
    const cloud = window.Cloud.get();
    const system = [
      '你是招聘 JD 分析器。把一份公开招聘 JD 的要求映射到六个评估维度，输出每个维度的考察点密度。',
      '维度定义（点数 0~5 的整数，0 = 完全没提）：',
      '- 专业能力：技术栈 / 硬技能要求的条数与深度（熟悉、精通、掌握 + 具体技能名）',
      '- 岗位匹配：经验年限、相关项目 / 行业背景、学历等硬性门槛',
      '- 沟通表达：沟通、跨部门协作、表达、汇报、宣讲类要求',
      '- 逻辑思维：分析、拆解、方案设计、问题定位、抽象类要求',
      '- 学习潜力：学习能力、快速上手、好奇心、自驱、成长意愿',
      '- 稳定性与价值观：稳定性、责任心、价值观、文化契合——JD 通常很少写，没有就给 0，不要脑补',
      '规则：按该维度要求出现的条数与显眼程度给点数；signals 里每个维度给一句 JD 原文摘录（≤30 字）作为依据，没出现的写「未提及」。',
      '严格只输出一个 JSON 对象，不要解释、前言或代码块标记。'
    ].join('\n');
    const user = 'JD 全文：\n' + text.slice(0, 3000);
    const out = await window.LLM.chat(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.1 }
    );
    let t = (out || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const s = t.indexOf('{'), e2 = t.lastIndexOf('}');
    if (s < 0 || e2 <= s) throw new Error('模型输出不是 JSON');
    const obj = JSON.parse(t.slice(s, e2 + 1));
    const points = {}, signals = {};
    const src = (obj && obj.points) || obj;
    JD_DIMS.forEach(d => {
      let v = Number(src[d]);
      points[d] = (isFinite(v) && v > 0) ? Math.max(0, Math.min(5, Math.round(v))) : 0;
      signals[d] = (obj && obj.signals && typeof obj.signals[d] === 'string')
        ? obj.signals[d].slice(0, 40) : '未提及';
    });
    return { points, signals };
  }

  // —— 提交 ——
  $('ct-send').onclick = async () => {
    const msg = $('ct-msg');
    let data = null;
    if (kind === 'experience') {
      const asked = $('ex-asked').value.trim();
      const answer = $('ex-answer').value.trim();
      if (asked.length < 5 || answer.length < 20) {
        msg.className = 'fb-msg err';
        msg.textContent = '请填写真实问题（≥5 字）与当时的回答（≥20 字）。';
        return;
      }
      data = { asked, answer, better: $('ex-better').value.trim(), result: $('ex-result').value || null };
    } else if (kind === 'tier') {
      const dims = [...document.querySelectorAll('.ct-dim.on')].map(x => x.getAttribute('data-d'));
      const example = $('tr-example').value.trim();
      const basis = $('tr-basis').value.trim();
      if (!dims.length || example.length < 10 || basis.length < 3) {
        msg.className = 'fb-msg err';
        msg.textContent = '请至少选一个维度，并填写例子（≥10 字）与判断依据。';
        return;
      }
      data = { dims, example, basis };
    } else if (kind === 'pitfall') {
      const topic = $('pf-topic').value.trim();
      const stuck = $('pf-stuck').value.trim();
      const fixed = $('pf-fixed').value.trim();
      if (topic.length < 3 || stuck.length < 10 || fixed.length < 10) {
        msg.className = 'fb-msg err';
        msg.textContent = '请填写考点（≥3 字）、卡在哪（≥10 字）、怎么补的（≥10 字）。';
        return;
      }
      data = { topic, stuck, fixed, advice: $('pf-advice').value.trim() };
    } else if (kind === 'opinion') {
      const target = $('op-target').value;
      const view = $('op-view').value.trim();
      if (!target || view.length < 5) {
        msg.className = 'fb-msg err';
        msg.textContent = '请选择「关于什么」，并写下你的看法（≥5 字）。';
        return;
      }
      data = { target, view, reason: $('op-reason').value.trim() };
    } else if (kind === 'jd') {
      const text = $('jd-text').value.trim();
      if (text.length < 100) {
        msg.className = 'fb-msg err';
        msg.textContent = 'JD 内容太短（需至少 100 字），请粘贴完整的岗位职责 + 任职要求。';
        return;
      }
      $('ct-send').disabled = true;
      msg.className = 'fb-msg';
      msg.textContent = '正在提取六维考察点（约 5~10 秒）…';
      let points = null, signals = null, extractErr = null;
      try {
        const r = await extractJdPoints(text);
        points = r.points; signals = r.signals;
      } catch (e) {
        extractErr = (e && e.message) || String(e);
      }
      // 抽取失败也允许提交（只存文本长度），统计侧按无点数处理
      data = {
        text_len: text.length,
        points: points,            // {维度: 0~5 整数点数}
        signals: signals || null,  // {维度: 依据摘录 ≤40 字}
        extractor: points ? 'llm' : null,
        extract_error: extractErr
      };
      $('ct-msg').className = 'fb-msg';
      $('ct-msg').textContent = points ? '提取完成，正在提交…' : '自动提取未成功，将仅记录字数（仍感谢参与）…';
    }

    $('ct-send').disabled = true;
    msg.className = 'fb-msg';
    msg.textContent = '提交中…';
    try {
      const cloud = window.Cloud.get();
      const res = await cloud.database.from('contributions').insert([{
        kind, industry: $('ct-industry').value || null,
        role_name: $('ct-role').value || null,
        tier: (kind === 'tier' || kind === 'experience') ? ($('ct-tier').value || null) : null,
        nickname: $('ct-nickname').value.trim() || null,
        public_ok: $('ct-public').checked,
        data, status: 'received', created_at: new Date().toISOString()
      }]);
      if (res && res.error) throw new Error(res.error.message || '提交被拒绝');
      if (window.Analytics) window.Analytics.track('contribution_submit', { kind: kind, extracted: kind === 'jd' ? !!data.points : undefined });
      msg.className = 'fb-msg ok';
      msg.textContent = '已收到，感谢。审核通过后会出现在下方案例区。';
      $('ct-form-card').style.display = 'none';
      setTimeout(loadCases, 800);
    } catch (e) {
      $('ct-send').disabled = false;
      msg.className = 'fb-msg err';
      msg.textContent = '提交失败：' + (e && e.message ? e.message : '未知错误') + '（可稍后重试）';
    }
  };

  // —— 公开案例区（只显示已采纳且同意公开的）——
  function esc(s) { return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  async function loadCases() {
    const box = $('ct-cases');
    box.innerHTML = '<div class="empty">加载中…</div>';
    let rows = [];
    try {
      const cloud = window.Cloud.get();
      const r = await cloud.database.from('contributions')
        .select('*').eq('status', 'accepted').eq('public_ok', true)
        .order('created_at', { ascending: false }).limit(20);
      rows = (r && r.data) || [];
    } catch (e) { rows = []; }

    if (!rows.length) {
      box.innerHTML = '<div class="empty">还没有公开的采纳案例。<br>你提交的内容审核通过后会出现在这里。</div>';
      return;
    }
    box.innerHTML = rows.map(r => {
      const d = r.data || {};
      const who = r.nickname ? esc(r.nickname) : '匿名面试者';
      const meta = [r.industry, r.role_name].filter(Boolean).map(esc).join(' · ');
      let body = '';
      if (r.kind === 'experience') {
        body = `<div class="ct-c-q">${esc(d.asked)}</div>
          <div class="ct-c-a"><b>当时怎么答：</b>${esc(d.answer)}</div>
          ${d.better ? `<div class="ct-c-a"><b>事后觉得：</b>${esc(d.better)}</div>` : ''}`;
      } else if (r.kind === 'tier') {
        body = `<div class="ct-c-q">看重维度：${(d.dims || []).map(esc).join('、')}</div>
          <div class="ct-c-a">${esc(d.example)}</div>
          <div class="ct-c-b">依据：${esc(d.basis)}</div>`;
      } else if (r.kind === 'pitfall') {
        body = `<div class="ct-c-q">栽在：${esc(d.topic)}</div>
          <div class="ct-c-a"><b>卡在哪：</b>${esc(d.stuck)}</div>
          <div class="ct-c-a"><b>怎么补的：</b>${esc(d.fixed)}</div>
          ${d.advice ? `<div class="ct-c-b">建议：${esc(d.advice)}</div>` : ''}`;
      } else {
        body = `<div class="ct-c-a">${esc(d.view)}</div>
          ${d.reason ? `<div class="ct-c-b">理由：${esc(d.reason)}</div>` : ''}`;
      }
      const label = (TYPES.find(t => t.k === r.kind) || {}).t || '案例';
      return `<div class="ct-case">
        <div class="ct-case-h"><span class="ct-case-k">${label}</span>${meta ? `<span class="ct-case-m">${meta}</span>` : ''}</div>
        ${body}
        <div class="ct-case-f">— ${who}</div>
      </div>`;
    }).join('');
  }
  loadCases();
})();
