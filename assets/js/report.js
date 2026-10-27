/* ===== 评分报告（支持 sessionStorage 直读 / 后端 ?id= 加载） ===== */
(async function () {
  Nav.render('report.html');

  // 六维改进话术（必须在 renderReport 调用前初始化，否则 TDZ 报错）
  // —— P1-8：可执行改进清单（规则生成，不额外调用模型） ——
  // 弱信息维度的判据（const 必须在 renderReport 调用前初始化，否则 TDZ 报错）
  const THIN_PAT = /未涉及|无法判断|未能|未体现|没有提及|无从|信息不足|未提及|不作评价/;
  const DIM_ADVICE = {
    '专业能力': [
      '把回答从「背定义」升级为「讲原理 + 适用边界 + 踩过的坑」',
      '每个知识点准备一个自己主导的落地案例，带量化结果',
      '用「是什么-为什么-怎么用-什么情况不用」四段式组织技术回答'
    ],
    '岗位匹配': [
      '每段经历对应 JD 的一条要求，讲清「我做了什么、结果如何」',
      '准备 2 个与目标岗位最相关的项目，能 3 分钟讲透',
      '主动解释为什么从这个方向转到目标岗位，别让对方猜'
    ],
    '沟通表达': [
      '先说结论再展开（STAR：情境-任务-行动-结果）',
      '单个回答控制在 90 秒内，超时就分层讲「第一、第二」',
      '少用「然后/就是」，用「因此/但是/举例来说」建立结构'
    ],
    '逻辑思维': [
      '遇到大问题先拆成 3 个子问题，再逐个回答',
      '用「假设-验证-结论」组织分析，而不是想到哪说到哪',
      '主动说出取舍：为什么选 A 不选 B'
    ],
    '学习潜力': [
      '准备一个「快速学会新东西」的具体例子（多久、怎么学、产出什么）',
      '说明你如何跟踪领域新技术，最近学到了什么',
      '讲一次做砸后的复盘：发现问题-改了什么-后来怎么样了'
    ],
    '稳定性与价值观': [
      '准备清晰的职业规划（1 年 / 3 年分别想达成什么）',
      '解释为什么选这个行业和公司，而不只是「想试试」',
      '对加班、出差、轮岗给出真实且前后一致的态度'
    ]
  };
  if (window.Auth && window.Auth.ready) { try { await Auth.ready(); } catch (e) { /* ignore */ } }
  const D = window.Data;
  await D.loadCatalog();

  const body = document.getElementById('report-body');
  const noResult = document.getElementById('no-result');
  const qs = new URLSearchParams(location.search);
  const id = qs.get('id');

  let R = null;

  if (id) {
    // 从后端拉取历史报告
    if (!Auth.isLoggedIn()) {
      body.style.display = 'none';
      noResult.style.display = 'block';
      noResult.innerHTML = '<p>该报告需要登录后查看。</p><button class="btn btn-primary" id="r-login">登录 / 注册</button>';
      const b = document.getElementById('r-login');
      if (b) b.onclick = () => { if (window.Nav) window.Nav.openAuth(); };
      return;
    }
    try {
      R = await Auth.api('/reports/' + id, { method: 'GET' });
    } catch (e) {
      body.style.display = 'none';
      noResult.style.display = 'block';
      noResult.innerHTML = '<p>加载报告失败：' + escapeHtml(e.message) + '</p><a class="btn" href="history.html">返回历史</a>';
      return;
    }
  } else {
    // 优先级：本场报告（session）> 未登录暂存（local）
    R = window.Store.get('result') || window.Store.get('pending');
    if (!R) {
      body.style.display = 'none';
      noResult.style.display = 'block';
      return;
    }
  }

  // 同岗位常模（匿名聚合；样本 <30 时回退量表档位）
  let norms = null;
  // 自创面试官：非标准条件，直接跳过常模查询（不参与人群比较）
  if (!R.customMode) {
    try { norms = await D.loadNorm(R.industry, R.role, R.level, R.paper); } catch (e) { norms = null; }
  }
  renderReport(R, norms);

  // —— P0-4：访客报告先存本地，登录成功后自动同步到云端 ——
  let syncing = false, synced = false;
  async function trySync() {
    if (syncing || synced || id || !R) return;
    if (!window.Auth || !Auth.isLoggedIn()) return;
    syncing = true;
    try {
      const r = await Auth.api('/reports', { method: 'POST', body: JSON.stringify({ report: R }) });
      if (r && r.id) {
        synced = true;
        window.Store.remove('pending');
        toast('已保存到云端，正在打开云端报告…');
        setTimeout(() => { location.replace('report.html?id=' + r.id); }, 700);
      }
    } catch (e) {
      toast('同步失败：' + e.message, true);
    } finally {
      syncing = false;
    }
  }
  if (window.Auth && Auth.onChange) Auth.onChange(() => { trySync(); });
  trySync();


  function buildAdvice(R) {
    const dims = R.dimAvg || {};
    const entries = Object.keys(dims).map(k => ({ name: k, v: Number(dims[k]) || 0 }));
    if (!entries.length) return null;
    entries.sort((a, b) => a.v - b.v);
    const low = entries.filter(e => e.v < 4);
    const adviceDims = (low.length ? low : entries).slice(0, 2);

    // 未命中的考点（按出现频次）
    const missCount = {};
    (R.questions || []).forEach(q => {
      (q.miss || []).forEach(k => { missCount[k] = (missCount[k] || 0) + 1; });
    });
    const topMiss = Object.keys(missCount).sort((a, b) => missCount[b] - missCount[a]).slice(0, 6);

    // 决策规则里的行动建议
    let action = '';
    try {
      const rules = (D.getScoring() && D.getScoring().decision_rules) || [];
      const hit = rules.find(r => r.rule_id === (R.verdict && R.verdict.id));
      action = hit ? hit.action : '';
    } catch (e) { action = ''; }

    const el = document.createElement('div');
    el.className = 'card advice-card';
    let html = '<h3 class="advice-title">下一步怎么提升</h3>';

    if (topMiss.length) {
      html += '<div class="advice-block"><div class="advice-label">最该补的知识点</div>'
        + '<div class="advice-tags">' + topMiss.map(k => '<span class="tag">' + escapeHtml(k) + '</span>').join('') + '</div>'
        + '<div class="advice-hint">这些是你在作答中没有提到的考点，下一次试着主动覆盖。</div></div>';
    }

    html += '<div class="advice-block"><div class="advice-label">最需要提升的维度</div>';
    adviceDims.forEach(d => {
      const list = DIM_ADVICE[d.name] || ['复盘这一类问题，找同行对着讲一遍并请对方追问。'];
      html += '<div class="advice-dim"><div class="advice-dim-head">' + escapeHtml(d.name)
        + ' <span class="advice-score">' + d.v.toFixed(1) + ' / 5</span></div><ul>'
        + list.slice(0, 2).map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul></div>';
    });
    html += '</div>';

    if (action) {
      html += '<div class="advice-block"><div class="advice-label">本次结论</div>'
        + '<div class="advice-action">' + escapeHtml(action) + '</div></div>';
    }

    html += '<div class="advice-next">建议：<a href="index.html">再模拟一次</a>（换个档位或层级对照），'
      + '或去 <a href="tiers.html">分档攻略</a> 看目标档位的考察重点。</div>';

    el.innerHTML = html;
    return el;
  }

  // 百分位估算（基于同岗位真实分位数 p25/p50/p75/p90）
  function pctText(score, norms) {
    const p25 = norms.p25, p50 = norms.p50, p75 = norms.p75, p90 = norms.p90;
    if (p90 != null && score >= p90) return '前 10%';
    if (p75 != null && score >= p75) return '前 25%';
    if (p50 != null && score >= p50) return '前 50%';
    if (p25 != null && score >= p25) return '前 75%';
    return '后 25%';
  }
  function bandBlock(R, norms) {
    if (R.customMode) {
      return '<div class="band-note">量表档位：<b>Band ' + (R.stanine || '—') + '</b> / 9'
        + '<span class="band-sub">自创面试官 · 不参与人群常模比较</span></div>'
        + '<div class="band-hint">本次的题目范围、题量与追问强度由你自定义，与其他人的标准测评不具可比性，因此不做百分位对照。</div>';
    }
    if (norms && norms.n >= 30 && norms.p50 != null) {
      return '<div class="band-note">同岗位百分位：约 <b>' + pctText(Number(R.totalScore) || 0, norms) + '</b>'
        + '<span class="band-sub">（样本 n=' + norms.n + '，同行业+岗位+层级' + (R.paper ? '+同卷 ' + R.paper : '') + '）</span></div>'
        + '<div class="band-hint">百分位来自真实历史报告的加权总分分布' + (R.paper ? '，且仅与同卷（卷 ' + R.paper + '）的报告比较——不同卷题目不同，不具可比性' : '')
        + '；样本不足 30 份时自动回退到量表档位。</div>';
    }
    const n = norms ? norms.n : 0;
    return '<div class="band-note">量表档位：<b>Band ' + (R.stanine || '—') + '</b> / 9'
      + '<span class="band-sub">按评分量表固定阈值划分，非人群百分位' + (R.paper ? ' · 卷 ' + R.paper : '') + '</span></div>'
      + '<div class="band-hint">同岗位' + (R.paper ? '同卷（卷 ' + R.paper + '）' : '') + '已累计 ' + n + ' 份样本，达到 30 份后启用真实百分位对照；在此之前以量表档位与加权总分为准。</div>';
  }
  function normStateText(R, norms) {
    if (R.customMode) return '不适用：自创面试官为非标准条件，不进常模、不做跨人比较。';
    if (norms && norms.n >= 30) return '已启用同岗位常模（' + (R.paper ? '同卷 ' + R.paper + '，' : '') + '样本 n=' + norms.n + '）。';
    const n = norms ? norms.n : 0;
    return '待校准：量表分档（Band ' + (R.stanine || '—') + ' / 9），当前样本 n=' + n + '，需 30 份后启用真实百分位。分数用于自我对照，不与他人比较。';
  }

  // 评分口径：让分数可被理解和核对（方法 / 权重 / 使用边界）
  function buildRubricCard(R, norms) {
    const w = R.weights || {};
    const entries = Object.keys(w).map(k => k + ' ' + Math.round(w[k] * 100) + '%').join(' · ');
    if (!entries) return null;
    const meta = R.scoreMeta || {};
    const failReason = meta.failReason ? String(meta.failReason) : '';
    const modeTxt = (R.scoreMode === 'llm')
      ? ('AI 语义评分' + (meta.model ? '（' + meta.model + '）' : ''))
      : (failReason
        ? 'AI 评分未完成（' + failReason + '），已降级为规则关键词评分'
        : '规则关键词评分（仅供参考，建议开启 AI 语义评分）');
    const el = document.createElement('div');
    el.className = 'card rubric-card';
    el.innerHTML = '<h3 class="advice-title">评分口径</h3>'
      + '<div class="rubric-row"><b>评分方式</b><span>' + escapeHtml(modeTxt) + '</span></div>'
      + '<div class="rubric-row"><b>维度权重</b><span>' + escapeHtml(entries) + '</span></div>'
      + '<div class="rubric-row"><b>常模状态</b><span>' + escapeHtml(normStateText(R, norms)) + '</span></div>'
      + '<div class="rubric-row"><b>使用说明</b><span>AI 不单独做录用决策；加权总分 2.5–4.0 区间建议人工复核。模型评分存在一定波动，建议结合多次结果看趋势，而非单次分数。</span></div>';
    return el;
  }

  // 追问轮次渲染（兼容多轮 / 旧单轮数据）
  function roundsHtml(it) {
    const rounds = Array.isArray(it.rounds) ? it.rounds : [];
    if (rounds.length) {
      return rounds.map((r, i) => '<div class="qdetail"><b>追问' + (rounds.length > 1 ? ' ' + (i + 1) : '') + '：</b>'
        + escapeHtml(r.q || '') + '<br><b>你的作答：</b>' + escapeHtml(r.a || '（未作答）') + '</div>').join('');
    }
    if (it.followupAnswer) {
      return '<div class="qdetail"><b>追问：</b>' + escapeHtml(it.followup)
        + '<br><b>你的追问作答：</b>' + escapeHtml(it.followupAnswer) + '</div>';
    }
    return '';
  }

  function fmtDur(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // 综合评估：总评 + 优势 / 待提升 + 建议动作 + 时间表现
  // 内容来自面试时保存的 evaluation（AI 撰写或本地归纳），此处只做呈现，不改写结论。
  function buildEvaluation(R) {
    const ev = R.evaluation || {};
    const tm = R.timing || {};
    const overall = String(ev.overall || '').trim();
    const strengths = Array.isArray(ev.strengths) ? ev.strengths.filter(Boolean) : [];
    const gaps = Array.isArray(ev.gaps) ? ev.gaps.filter(Boolean) : [];
    const actions = Array.isArray(ev.actions) ? ev.actions.filter(Boolean) : [];
    if (!overall && !strengths.length && !gaps.length) return null;

    const total = tm.totalSeconds != null ? tm.totalSeconds : R.timeSeconds;
    const limit = tm.totalLimitSeconds;
    const over = tm.overtimeCount || 0;

    const el = document.createElement('div');
    el.className = 'card eval-card';
    let html = '<div class="card-title"><span class="ic"></span>综合评估</div>';
    if (overall) html += '<p class="eval-overall">' + escapeHtml(overall) + '</p>';

    if (strengths.length || gaps.length) {
      html += '<div class="eval-grid">';
      if (strengths.length) {
        html += '<div class="eval-col"><div class="eval-label good">优势</div><ul>'
          + strengths.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul></div>';
      }
      if (gaps.length) {
        html += '<div class="eval-col"><div class="eval-label bad">待提升</div><ul>'
          + gaps.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul></div>';
      }
      html += '</div>';
    }

    if (actions.length) {
      html += '<div class="eval-block"><div class="eval-label">建议动作</div><ol class="eval-actions">'
        + actions.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ol></div>';
    }

    const timeBits = ['总用时 <b>' + fmtDur(total) + '</b>'];
    if (limit) timeBits.push('总限时 <b>' + fmtDur(limit) + '</b>');
    if (tm.overtimeCount != null) timeBits.push(over > 0 ? '<b class="red">超限 ' + over + ' 道</b>' : '全部在限时内');
    html += '<div class="eval-time">' + timeBits.join(' ｜ ') + '</div>';
    html += '<div class="eval-src">' + (ev.source === 'llm'
      ? '本段由 AI 依据上方六维得分与逐题点评归纳，未引入作答以外的信息。'
      : '本次未完成 AI 语义评分，本段为按六维得分自动归纳，仅供定位问题。') + '</div>';

    el.innerHTML = html;
    return el;
  }

  // 自创面试官的标签 + 结论置信度提示
  // 简历定制标记：让候选人看到这场是按自己简历出的题
  // 低匹配的情况由顶部黄色提示负责，这里不重复
  // 评分降级提示：AI 评分失败时明确告知，避免用户把规则参考分当成正式结论
  function scoreFallbackNotice(R) {
    if (R.scoreMode === 'llm') return '';
    const reason = (R.scoreMeta && R.scoreMeta.failReason) ? String(R.scoreMeta.failReason) : '';
    return '<div class="resume-badge" style="background:#fff4e0;color:#9a6400;border-color:#f7d9a8;">'
      + '规则参考分 · AI 语义评分未完成'
      + (reason ? '（' + escapeHtml(reason) + '）' : '')
      + '<div class="resume-badge-sub">分数由关键词命中估算，不给出录用结论。可稍后重试一场以获得 AI 逐题点评。</div>'
      + '</div>';
  }

  // 跨层级补题说明：岗位在该层级的题量不足以支撑本场题量时，会从相邻层级补题。
  // 这是既有行为（此前一直静默），报告必须如实说明，否则用户会以为抽到的都是本层级题。
  function backfillNotice(R) {
    const n = Number(R.backfill || 0);
    if (!n) return '';
    return '<div class="resume-badge" style="background:#eef4ff;color:#2b5fae;border-color:#cddffa;">'
      + '含 ' + n + ' 道相邻层级题'
      + '<div class="resume-badge-sub">该岗位在「' + escapeHtml(R.level || '') + '」层级的题量不足以支撑本场 '
      + escapeHtml(String(R.length || (R.questions || []).length)) + ' 题，其余从相邻层级补充，报告会照常评分。</div>'
      + '</div>';
  }

  function resumeBadge(R) {
    const r = R.resume;
    if (!r || r.lowMatch) return '';
    const sc = (r.score != null) ? (' · 匹配度 ' + r.score + '/100') : '';
    const probes = (r.probes || []).filter(Boolean).slice(0, 3);
    return '<div class="resume-badge">按简历定制' + sc + '</div>' +
      (probes.length
        ? '<div class="resume-badge-sub">重点深挖：' + probes.map(escapeHtml).join('、') + '</div>'
        : '');
  }

  function customBadge(R) {
    if (!R.customMode) return '';
    const name = (R.persona && R.persona.name) ? '（' + escapeHtml(R.persona.name) + '）' : '';
    const bits = [];
    const n = (R.questions || []).length;
    if (n < 5) bits.push('题量仅 ' + n + ' 道');
    const gen = (R.questions || []).filter(q => q && q.source === 'generated').length;
    if (gen) bits.push('含 ' + gen + ' 道现场生成题');
    const to = (R.timing && R.timing.overtimeCount) || 0;
    if (to) bits.push(to + ' 道超时结束');
    return '<div class="custom-badge">自创面试官 · 非标准条件' + name + '</div>'
      + (bits.length
        ? '<div class="conf-note">⚠ 结论置信度偏低：' + bits.join('、') + '。分数可作练习参考，不宜当作能力定论。</div>'
        : '');
  }

  // 考点覆盖：你选的考点里，这次实际考到了哪些
  function buildCoverageCard(R) {
    const cov = R.coverage;
    if (!cov || !Array.isArray(cov.tags) || !cov.tags.length) return null;
    const covered = cov.covered || [], missing = cov.missing || [];
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<div class="card-title"><span class="ic"></span>考点覆盖</div>'
      + '<div class="cov-line">你选了 <b>' + cov.tags.length + '</b> 个考点，本次实际覆盖 <b>' + covered.length + '</b> 个</div>'
      + (covered.length ? '<div class="cov-tags"><span class="cov-lab">已覆盖</span>' +
        covered.map(t => '<span class="tag ok">✓ ' + escapeHtml(t) + '</span>').join('') + '</div>' : '')
      + (missing.length ? '<div class="cov-tags"><span class="cov-lab">未覆盖</span>' +
        missing.map(t => '<span class="tag soft">' + escapeHtml(t) + '</span>').join('') + '</div>' : '')
      + (missing.length ? '<div class="cov-foot">题库里这些考点的题不够，本次没抽到。下次可以把它们单独拎出来练一场。</div>' : '');
    return el;
  }

  // 找出「信息有限」的维度：语义评分时，若某维度在多数题的评分依据里都写着
  // 「作答未涉及」之类的话，说明这个分是从极少信息里推断的，波动会比较大。
  function thinEvidenceDims(R) {
    const out = {};
    if (R.scoreMode !== 'llm' || !Array.isArray(R.questions)) return out;
    const dims = Object.keys(R.weights || {});
    dims.forEach(k => {
      let withEv = 0, thin = 0;
      R.questions.forEach(it => {
        const ev = it && it.evidence;
        if (!ev || typeof ev !== 'object') return;
        const basis = typeof ev[k] === 'string' ? ev[k].trim() : '';
        if (!basis) return;
        withEv += 1;
        if (THIN_PAT.test(basis) || basis.length < 8) thin += 1;
      });
      if (withEv >= 2 && thin >= Math.ceil(withEv * 0.6)) out[k] = true;
    });
    return out;
  }

  function renderReport(R, norms) {
    const scoreMode = R.scoreMode || 'rule';
    const chatMode = R.chatMode || R.mode || 'rule';
    document.getElementById('sub').textContent =
      `${R.role} · ${R.level} · ${(R.tierName || '').split('（')[0]} ｜ 用时 ${Math.floor((R.timeSeconds||0)/60)}分${(R.timeSeconds||0)%60}秒 ｜ 共 ${R.questions.length} 题 ｜ 对话：${chatMode === 'llm' ? 'AI 实时' : '规则模拟'} ｜ 评分：${scoreMode === 'llm' ? 'AI 语义级' : '规则模拟'}`;

    // 低匹配提示：简历与岗位匹配不足但用户选择继续 → 报告参考性有限
    if (R.resume && R.resume.lowMatch) {
      const warn = document.createElement('div');
      warn.className = 'card';
      warn.style.background = '#fff8ec';
      warn.style.border = '1px solid #f7e0b8';
      const sc = (R.resume.score != null ? R.resume.score : '—');
      warn.innerHTML =
        '<div style="font-size:13.5px;font-weight:600;color:#a86a00;margin-bottom:6px;">低匹配面试 · 结果参考性有限</div>' +
        '<div style="font-size:12.5px;color:#8a6a2f;line-height:1.75;">' +
        '简历与该岗位的匹配度为 <b>' + escapeHtml(String(sc)) + ' / 100</b>' +
        (R.resume.forced ? '（你选择了「仍要继续」）' : '') +
        '。本场的问题与评分可能偏离该岗位真实要求，建议当作表达练习，而不是岗位匹配结论。</div>';
      body.appendChild(warn);
    }

    // 分数盘 + 结论
    const hero = document.createElement('div');
    hero.className = 'card';
    hero.innerHTML = `
      <div class="score-hero">
        <div class="score-circle"><div class="num">${Number(R.totalScore||0).toFixed(2)}</div><div class="lab">加权总分 /5</div></div>
        <div>
          <div class="verdict ${R.verdict.cls}">${R.verdict.label}</div>
          ${customBadge(R)}
          ${resumeBadge(R)}
          ${scoreFallbackNotice(R)}
          ${backfillNotice(R)}
          ${bandBlock(R, norms)}
          <div style="margin-top:14px;">
            <a class="btn" href="index.html">再模拟一次</a>
            <a class="btn" href="history.html" style="margin-left:8px;">我的历史</a>
            <a class="btn" href="tiers.html" style="margin-left:8px;">看分档攻略</a>
          </div>
        </div>
      </div>
      <div class="report-actions" id="report-actions" style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;"></div>
      <div class="note" style="margin-top:16px;margin-bottom:0;">
        ${scoreMode === 'llm'
          ? '说明：本次采用 <b>AI 语义级评分</b>，由大模型依据六维评分表对作答内容逐题打分（非关键词匹配），并给出逐题点评。AI 不单独做录用决策，2.5~4.0 区间建议人工复核。'
          : '说明：本次<b>未完成 AI 语义级评分</b>（云端评分不可用，或已在设置中关闭），上方分数为<b>关键词规则估算的参考分</b>，因此<b>不给出录用结论</b>。参考分只反映考点关键词的覆盖程度，不代表作答质量——内容合格但没踩中关键词，也会被低估。请重新面试，或在 ⚙ 设置中开启「AI 语义级评分」后重试。'}
      </div>`;
    body.appendChild(hero);

    // 考点覆盖（仅自创模式有数据）
    const covEl = buildCoverageCard(R);
    if (covEl) body.appendChild(covEl);

    // 综合评估（总评 + 优势/待提升 + 建议动作 + 时间表现）
    const evalEl = buildEvaluation(R);
    if (evalEl) body.appendChild(evalEl);

    // 可执行改进清单
    const adviceEl = buildAdvice(R);
    if (adviceEl) body.appendChild(adviceEl);

    const rubricEl = buildRubricCard(R, norms);
    if (rubricEl) body.appendChild(rubricEl);

    // 报告操作区：删除（仅后端存档）/ 分享导出 / 复制链接
    const actEl = document.getElementById('report-actions');
    if (actEl) {
      // 访客本地报告：登录即可把这份报告存到云端（P0-4）
      if (!id && window.Auth && !Auth.isLoggedIn()) {
        const save = document.createElement('button');
        save.className = 'btn btn-primary';
        save.textContent = '登录并保存到云端';
        save.onclick = () => { if (window.Nav) window.Nav.openAuth(); };
        actEl.appendChild(save);
        const hint = document.createElement('div');
        hint.className = 'note';
        hint.style.marginTop = '10px';
        hint.textContent = '这份报告目前只保存在你的浏览器里。登录后会自动同步到云端，换设备也能查看、导出和删除。';
        actEl.parentNode.insertBefore(hint, actEl.nextSibling);
      }
      if (id) {
        const del = document.createElement('button');
        del.className = 'btn';
        del.textContent = '删除报告';
        del.onclick = async () => {
          if (!confirm('确定删除这份面试报告？删除后不可恢复。')) return;
          del.disabled = true;
          try {
            await Auth.api('/reports/' + id, { method: 'DELETE' });
            toast('已删除，即将返回历史列表');
            setTimeout(() => { location.href = 'history.html'; }, 900);
          } catch (e) {
            toast('删除失败：' + e.message, true);
            del.disabled = false;
          }
        };
        actEl.appendChild(del);

        const copy = document.createElement('button');
        copy.className = 'btn';
        copy.textContent = '复制链接';
        copy.onclick = async () => {
          try {
            await window.ReportExport.copyText(location.href);
            toast('链接已复制（同一后端账号/同机可打开）');
          } catch (e) { toast('复制失败，请手动复制地址栏', true); }
        };
        actEl.appendChild(copy);
      }
      const share = document.createElement('button');
      share.className = 'btn btn-primary';
      share.textContent = '分享 / 导出 HTML';
      share.onclick = () => {
        window.ReportExport.download(R);
        toast('已导出独立报告 HTML（可发给他人直接打开）');
      };
      actEl.appendChild(share);
    }

    // 六维度
    const dimCard = document.createElement('div');
    dimCard.className = 'card';
    let dimRows = '';
    const thin = thinEvidenceDims(R);   // 本次作答中信息不足的维度
    Object.keys(R.weights || {}).forEach(k => {
      const v = R.dimAvg[k] || 0;
      const flag = thin[k]
        ? `<span class="dim-thin" title="该维度在本次作答中可依据的信息有限，分数仅供参考">信息有限</span>`
        : '';
      dimRows += `<div class="dim-row">
        <div class="dim-name">${escapeHtml(k)}${flag}</div>
        <div class="dim-track"><div class="dim-fill" style="width:${v/5*100}%"></div></div>
        <div class="dim-val">${v.toFixed(1)}</div>
        <div class="wval" style="width:54px;">权 ${Math.round((R.weights[k]||0)*100)}%</div>
      </div>`;
    });
    if (Object.keys(thin).length) {
      dimRows += `<div class="dim-note">标注「信息有限」的维度：本次作答中几乎没有可用于判断的依据（如技术题看不出岗位匹配），
        模型按中性分处理，分数波动相对较大，不宜作为单项结论。</div>`;
    }
    dimCard.innerHTML = `<div class="card-title"><span class="ic"></span>六维能力得分（按档位权重加权）</div>${dimRows}`;
    body.appendChild(dimCard);

    // 逐题反馈
    const qCard = document.createElement('div');
    qCard.className = 'card';
    let qHtml = '<div class="card-title"><span class="ic"></span>逐题反馈</div>';
    (R.questions || []).forEach((it, i) => {
      const kw = (it.hits || []).map(h => `<span class="kw">✓ ${escapeHtml(h)}</span>`).join('') ||
        '<span class="qdiff">未命中关键词</span>';
      const miss = (it.miss || []).slice(0, 5).map(m => `<span class="tag soft">缺：${escapeHtml(m)}</span>`).join(' ');
      const ev = (it.evidence && typeof it.evidence === 'object') ? it.evidence : null;
      const evHtml = ev ? ('<div class="qevidence"><b>评分依据：</b><ul>'
        + Object.keys(ev).map(k => '<li><span class="ev-dim">' + escapeHtml(k) + '</span>' + escapeHtml(String(ev[k] || '')) + '</li>').join('')
        + '</ul></div>') : '';
      qHtml += `<div class="qcard">
        <div class="qhead"><span class="qtype">${escapeHtml(it.type)}</span>${((it.type === '求职动机' || it.type === '简历深挖') && R.scoreMode !== 'llm') ? `<span class="qdiff">${it.type === '简历深挖' ? '本题为简历深挖，无关键词考点，按中性分处理（建议开启 AI 语义评分）' : '要点式评分，关键词匹配不适用（按中性分处理，建议开启 AI 语义评分）'}</span>` : `<span class="qdiff">关键词命中 ${(it.hits||[]).length}/${(it.keywords||[]).length}（${((it.hitRate||0)*100).toFixed(0)}%）</span>`}${it.spentSeconds != null ? `<span class="qdiff${(it.overSeconds || it.timedOut) ? ' over' : ''}">用时 ${fmtDur(it.spentSeconds)}${it.limitSeconds ? ' / 限时 ' + fmtDur(it.limitSeconds) : ''}${it.timedOut ? '（超时结束）' : (it.overSeconds ? '（超 ' + fmtDur(it.overSeconds) + '）' : '')}</span>` : ''}</div>
        <div class="qtext">${i+1}. ${escapeHtml(it.q)}</div>
        ${(R.industry && window.Feedback) ? `<div class="qhead-right">${window.Feedback.calibratedChip({ calibrated_by: it.calibrated })}
          ${window.Feedback.btnHtml({ questionId: it.qid, industry: R.industry, roleName: R.role, qtype: it.type, difficulty: it.difficulty })}</div>` : ''}
        <div class="qdetail"><b>你的回答：</b>${escapeHtml(it.answer || '（未作答）')}</div>
        ${roundsHtml(it)}
        ${it.aiFeedback ? `<div class="qfeedback"><b>AI 点评：</b>${escapeHtml(it.aiFeedback)}</div>` : ''}
        ${evHtml}
        <div style="margin-top:8px;"><b style="font-size:12px;color:var(--wb-muted);">命中要点：</b><br>${kw}</div>
        ${miss ? `<div style="margin-top:6px;">${miss}</div>` : ''}
      </div>`;
    });
    qCard.innerHTML = qHtml;
    body.appendChild(qCard);
  }

  function escapeHtml(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}

  function toast(msg, isErr) {
    let t = document.getElementById('wb-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'wb-toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isErr ? 'var(--wb-red)' : 'rgba(30,34,42,.92)';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }
})();
