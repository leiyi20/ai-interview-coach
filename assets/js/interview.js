/* ===== 模拟面试间：对话气泡流（规则版 + 预留 LLM 接口） ===== */
(async function () {
  Nav.render('interview.html');
  const D = window.Data, C = window.SITE_CONFIG;
  await D.loadCatalog();

  const qs = new URLSearchParams(location.search);

  // —— 模式：standard（标准测评）| custom（自创面试官）——
  const customMode = qs.get('mode') === 'custom';
  let personaCfg = null, scope = null, customPack = null;
  if (customMode) {
    const saved = (typeof window.Persona !== 'undefined') ? Persona.load() : null;
    if (!saved || !saved.scope) { location.href = 'custom.html'; return; }
    personaCfg = saved.config || {};
    scope = saved.scope;
  }

  const industry = customMode ? scope.industry : (qs.get('industry') || C.BENCHMARK_INDUSTRY);
  const role = customMode ? scope.role : (qs.get('role') || '');
  const level = customMode ? scope.level : (qs.get('level') || '通用');
  // 自创模式没有档位：用 'custom' 占位，权重按主岗位行业自动选预设（不走体制内分支）
  const tierKey = customMode ? 'custom' : (qs.get('tier') || 'bigtech');
  if (!role) { location.href = 'index.html'; return; }

  // —— 简历上下文（来自简历页）——
  // 仅当岗位/行业与简历页一致时才使用，避免直接改 URL 导致简历串岗。
  // 只在本次面试内存中使用；结束写报告后即清除，不上传原始简历文本。
  let resumeCtx = null;
  if (!customMode) {
    try {
      const raw = sessionStorage.getItem('wb_resume');
      if (raw) {
        const r = JSON.parse(raw);
        if (r && r.text && r.role === role && r.industry === industry) resumeCtx = r;
        else sessionStorage.removeItem('wb_resume');   // 陈旧 / 串岗数据：直接用不上，清掉
      }
    } catch (e) {
      resumeCtx = null;
      try { sessionStorage.removeItem('wb_resume'); } catch (e2) { /* ignore */ }
    }
  } else {
    // 自创面试官不使用简历，残留数据不留
    try { sessionStorage.removeItem('wb_resume'); } catch (e) { /* ignore */ }
  }

  // 隐私：简历原文只在本次面试期间保留。离开页面（跳转 / 返回 / 关闭标签页）立即清除，
  // 与简历页「离开页面或关闭标签页即清除」的承诺一致。
  // 刻意不用 visibilitychange——用户只是切到别的标签页时不该丢掉简历。
  if (resumeCtx) {
    const clearResume = () => { try { sessionStorage.removeItem('wb_resume'); } catch (e) { /* ignore */ } };
    window.addEventListener('pagehide', clearResume);
    window.addEventListener('beforeunload', clearResume);
  }

  // 只加载当前行业的题目（不再首屏拉全量题库）
  await D.loadIndustry(industry);
  const tierData = customMode
    ? { name: '自创面试官 · ' + (personaCfg.summary || role), script_tips: '' }
    : (await D.loadCatalog()).tiers.tiers[tierKey];

  // 追问深度：自创模式按配置；标准模式 URL depth 可覆盖，默认按档位（大厂 2 轮，其余 1 轮）
  const maxFollowups = (function () {
    if (customMode) return Math.max(0, Math.min(3, Number(scope.maxFollowups) || 0));
    const raw = qs.get('depth');
    if (raw !== null && raw !== '') {
      const n = Number(raw);
      if (isFinite(n)) return Math.max(0, Math.min(3, Math.floor(n)));
    }
    return tierKey === 'bigtech' ? 2 : 1;
  })();

  // 是否启用真实大模型对话：自创模式必须走 LLM（人格只能由模型承载）
  const useLLM = customMode
    ? true
    : ((typeof window.LLM !== 'undefined') && window.LLM.isEnabled());
  const llmHistory = [];  // 对话历史（不含 system），用于多轮上下文

  // 简历片段：拼进面试官 system prompt，让出题围绕候选人真实经历
  function resumeBlock() {
    if (!resumeCtx) return '';
    const m = resumeCtx.match || {};
    const probes = (m.probe_points || []).filter(Boolean).slice(0, 5);
    const hits = (m.hits || []).filter(Boolean).slice(0, 5);
    const lines = [
      '',
      '【候选人简历摘要】',
      String(resumeCtx.text || '').slice(0, 1200),
      ''
    ];
    if (hits.length) lines.push('【简历与岗位相符的点】' + hits.join('；'));
    if (probes.length) lines.push('【优先深挖】' + probes.join('；'));
    lines.push(
      '【基于简历的提问要求】',
      '1. 优先围绕简历里的真实项目、技术栈、职责与结果提问，先深挖简历中的具体点，再按岗位能力维度补齐。',
      '2. 不要重复询问简历里已经写清楚的事实（例如「你做过什么项目」），要问细节、取舍、失败与结果。',
      '3. 简历与岗位相关性一般时，仍按岗位能力维度提问，但可从简历中的可迁移经验切入。',
      '4. 不要编造简历里没有的经历；引用简历内容时只用其中出现过的信息。'
    );
    return '\n' + lines.join('\n');
  }

  // 面试官 system prompt：自创模式用解析后的人格，标准模式用档位话术
  function sysPrompt() {
    const base = customMode
      ? Persona.buildSystem(personaCfg, { industry, role, level })
      : LLM.buildSystem(industry, role, level, tierData);
    return base + resumeBlock();
  }

  // 顶部信息
  let paper = null;   // 轮换卷号 A/B/C（仅标准模式）
  if (!customMode) {
    // 卷号要在顶栏渲染前确定：URL 带 paper=A/B/C 则用之，否则自动轮换
    const PAPERS = ['A', 'B', 'C'];
    paper = PAPERS.includes(qs.get('paper')) ? qs.get('paper')
      : PAPERS[Math.floor(Math.random() * PAPERS.length)];
  }
  document.getElementById('pill-role').innerHTML = '岗位 <b>' + role + '</b>';
  document.getElementById('pill-level').innerHTML = '层级 <b>' + level + '</b>';
  document.getElementById('pill-tier').innerHTML = customMode
    ? '自创面试官 <b>' + (personaCfg.summary || '自定义') + '</b>'
    : '档位 <b>' + tierData.name.split('（')[0] + '</b>' + (paper ? ' · <b>卷 ' + paper + '</b>' : '');

  const chat = document.getElementById('chat');
  const $answer = document.getElementById('answer');
  const $send = document.getElementById('btn-send');
  const $bar = document.getElementById('bar');
  const $progress = document.getElementById('pill-progress');

  // 抽题：自创模式按知识点标签组卷，标准模式按岗位+档位抽
  let questions;
  if (customMode) {
    customPack = await D.sampleByTags({
      industry, role, level,
      tags: scope.tags || [],
      count: scope.count || 6,
      difficulty: scope.difficulty || 'mixed'
    });
    questions = customPack.questions;
    if (!questions.length) {
      alert('所选考点在题库里没有可用题目，请回上一页重新选择范围。');
      location.href = 'custom.html';
      return;
    }
  } else {
    // 轮换 3 套卷：卷号已在顶部信息区确定（paper）。
    // 同岗位+层级+档位+卷号 = 固定一套题，报告记录卷号，常模按卷号分组，跨人才可比。
    // 每场留 1 题位给「求职动机」题（HR 面/终面必考），同样纳入卷号体系：
    // 同卷永远同一道动机题、同一个问法变体，且动机题恰好为弱信息维度补证据。
    questions = D.sampleQuestions(industry, role, level, tierKey, Math.max(1, C.QUESTIONS_PER_INTERVIEW - 1), paper);
    const mot = await D.sampleMotivation(tierKey, paper);
    if (mot) questions.push(mot);   // 插在最后：真实面试里动机题多在技术问完后
  }

  // 规则模式（未开 AI 对话）下，用匹配阶段得到的「深挖点」补简历题。
  // 默认访客大多是规则模式，只补 1 道太薄；补 2 道并错开位置，避免连问两句同一句式。
  // LLM 模式由 system prompt 自然覆盖，无需替换题库题。
  function makeResumeQuestion(probe, variant) {
    const q = variant === 2
      ? '你简历里提到「' + probe + '」。这件事里最难处理的一处是什么？你当时怎么判断、怎么取舍的，最后效果如何？'
      : '你简历里提到「' + probe + '」。请具体讲讲：你当时负责哪一部分、怎么做的、最后结果如何？';
    return {
      id: null,
      type: '简历深挖',
      level: level,
      difficulty: '中等',
      q: q,
      intent: '基于候选人简历深挖真实经历，考察是否亲历、细节是否清晰、面对取舍的判断力与可验证的结果',
      followups: [],
      keywords: [],
      minutes: 5,
      _resume: true
    };
  }

  if (!customMode && !useLLM && resumeCtx) {
    const probes = ((resumeCtx.match && resumeCtx.match.probe_points) || []).filter(Boolean);
    if (probes.length && questions.length) {
      questions[0] = makeResumeQuestion(probes[0], 1);
      // 第二道放在中间位置（不碰末位动机题），且避免与首题相邻
      if (probes.length > 1 && questions.length >= 4) {
        const slot = Math.min(2, questions.length - 2);
        if (slot > 0) questions[slot] = makeResumeQuestion(probes[1], 2);
      }
    }
  }

  const total = questions.length;
  $progress.textContent = '0/' + total;
  // 埋点：面试开始（不记任何作答内容）
  if (window.Analytics) window.Analytics.track('interview_start', {
    mode: customMode ? 'custom' : 'standard',
    paper: customMode ? null : paper,
    count: total,
    resume: !!resumeCtx
  });

  // 状态
  let idx = 0;            // 当前第几题
  let phase = 'question'; // question | followup | done
  let followupIdx = 0;    // 当前题追问到第几个
  let nextQPromise = null; // 下一题的预取结果（用户答追问期间在后台请求）
  let submitting = false;  // 正在提交作答（防重复提交 / 防超时与手动提交撞车）
  const records = [];     // 每题作答记录

  // —— 计时：总用时（结束后冻结）+ 每题独立限时 ——
  const startTime = Date.now();
  let endTime = 0;                        // 结束时刻；一旦写入，总用时不再增长
  let totalTimer = null;
  const nowTs = () => (endTime || Date.now());
  function renderTotalTime() {
    const el = document.getElementById('pill-time');
    if (!el) return;
    const s = Math.floor((nowTs() - startTime) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  totalTimer = setInterval(renderTotalTime, 1000);

  // 每题限时：难度决定基础时长（简单 3 / 中等 5 / 困难 7 分钟），
  // 题目自带的建议用时在此基础上 ±1 分钟微调，最终锁死在 1~7 分钟。
  const LIMIT_MIN = 60;          // 最低 1 分钟
  const LIMIT_MAX = 7 * 60;      // 最高 7 分钟
  function qLimitSeconds(q) {
    if (!q) return LIMIT_MIN;
    const base = q.difficulty === '困难' ? 7 : (q.difficulty === '简单' ? 3 : 5);
    let m = base;
    const mins = Number(q.minutes);
    if (isFinite(mins) && mins > 0) {
      if (mins >= base + 3) m = base + 1;        // 题目明显更耗时
      else if (mins <= base - 2) m = base - 1;   // 题目明显更快
    }
    return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, m * 60));
  }

  // —— 工具 ——
  function bubble(text, who, meta) {
    const el = document.createElement('div');
    el.className = 'bubble ' + who;
    el.innerHTML = escapeHtml(text) + (meta ? `<div class="meta">${meta}</div>` : '');
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  }
  // 流式气泡：先建空壳，收到增量就逐字更新（文本用 textContent，天然防 XSS）
  function bubbleStream(meta) {
    const el = document.createElement('div');
    el.className = 'bubble ai';
    const span = document.createElement('span');
    span.className = 'bt';
    el.appendChild(span);
    if (meta) {
      const m = document.createElement('div');
      m.className = 'meta';
      m.textContent = meta;
      el.appendChild(m);
    }
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return {
      el: el,
      update: function (text) {
        span.textContent = text || '';
        chat.scrollTop = chat.scrollHeight;
      }
    };
  }
  function typing() {
    const el = document.createElement('div');
    el.className = 'bubble ai';
    el.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    chat.appendChild(el);
    chat.scrollTop = chat.scrollHeight;
    return el;
  }
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // —— 每题计时：独立限时倒计时；到点强制结束本题（自动提交已输入内容） ——
  // 采用「累计计时」：AI 出题/生成追问期间暂停，只累计考生真正在作答的时间。
  let qStartTime = 0, qTimer = null, qLimit = 0, qAccum = 0, overtimeShown = false, warnShown = false;
  function fmtClock(sec) {
    const s = Math.abs(Math.round(sec));
    return (sec < 0 ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function elapsedQ() {
    const v = qAccum + (qStartTime ? (nowTs() - qStartTime) / 1000 : 0);
    return v > 0 ? v : 0;
  }
  function resetQTimer() {
    qAccum = 0;
    qStartTime = Date.now();
    qLimit = qLimitSeconds(questions[idx]);
    overtimeShown = false;
    warnShown = false;
    if (qTimer) clearInterval(qTimer);
    updateQTimer();
    qTimer = setInterval(updateQTimer, 1000);
  }
  function pauseQTimer() {
    if (!qTimer) return;
    qAccum += (nowTs() - qStartTime) / 1000;
    qStartTime = 0;
    clearInterval(qTimer);
    qTimer = null;
  }
  function resumeQTimer() {
    if (qTimer || !qLimit) return;
    qStartTime = Date.now();
    updateQTimer();
    qTimer = setInterval(updateQTimer, 1000);
  }
  function stopQTimer() {
    if (qStartTime) { qAccum += (nowTs() - qStartTime) / 1000; qStartTime = 0; }
    if (qTimer) { clearInterval(qTimer); qTimer = null; }
  }
  function sysBubble(text) {
    const tip = document.createElement('div');
    tip.className = 'bubble sys';
    tip.textContent = text;
    chat.appendChild(tip);
    chat.scrollTop = chat.scrollHeight;
  }
  function updateQTimer() {
    const el = document.getElementById('pill-qtime');
    if (!el) return;
    if (!questions[idx] || !qLimit) { el.textContent = '本题 —'; return; }
    const left = qLimit - elapsedQ();
    const warnAt = Math.max(30, Math.round(qLimit * 0.2));
    if (left > 0) {
      el.textContent = '剩余 ' + fmtClock(left) + ' / ' + fmtClock(qLimit);
      const warn = left <= warnAt;
      el.style.color = warn ? 'var(--wb-warn)' : '';
      if (warn && !warnShown && phase !== 'done') {
        warnShown = true;
        sysBubble('⏱ 本题还剩 ' + fmtClock(left) + '，到点会自动结束本题并进入下一题。');
      }
      return;
    }
    el.textContent = '时间到 0:00 / ' + fmtClock(qLimit);
    el.style.color = 'var(--wb-red)';
    if (!overtimeShown && phase !== 'done') {
      overtimeShown = true;
      onTimeout();
    }
  }

  // 超时强制结束：提交已输入内容（可为空），跳过剩余追问，直接进入下一题
  async function onTimeout() {
    if (phase === 'done' || submitting) return;
    stopQTimer();
    const raw = ($answer.value || '').trim();
    $answer.value = '';
    sysBubble('⏱ 已到本题限时 ' + fmtClock(qLimit) + '，本题结束。' + (raw ? '已自动提交你写下的作答。' : '本题记为未作答。'));
    submitting = true;
    try {
      if (phase === 'question') {
        fillRecord();
        records[idx].answer = raw;
        records[idx].rounds = [];
        records[idx].timedOut = true;
        await finishQuestion();
      } else if (phase === 'followup') {
        if (raw && records[idx].rounds[followupIdx]) records[idx].rounds[followupIdx].a = raw;
        records[idx].timedOut = true;
        await finishQuestion();
      }
    } finally {
      submitting = false;
    }
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // —— AI 消息生成（规则版 / 预留 LLM） ——
  // 若 AI_MODE='llm' 且配置了 LLM，则调用大模型；否则走规则版。
  async function aiSay(text, meta) {
    const t = typing();
    await delay(500 + Math.random() * 500);
    t.remove();
    bubble(text, 'ai', meta);
  }

  // 调用真实大模型：typing 动效 + 请求 + 返回文本（不在此处 bubble，由调用方决定）
  async function llmTurn(systemPrompt, userMsg, temperature, meta) {
    const t = typing();
    let streamEl = null;
    let out;
    try {
      const messages = [{ role: 'system', content: systemPrompt }]
        .concat(llmHistory)
        .concat([{ role: 'user', content: userMsg }]);
      out = await LLM.chat(messages, {
        temperature: temperature ?? 0.8,
        onDelta: function (text) {
          if (!streamEl) { t.remove(); streamEl = bubbleStream(meta); }
          streamEl.update(text);
        }
      });
      if (!streamEl) { t.remove(); bubble(out, 'ai', meta); }  // 没有增量时的兜底
      llmHistory.push({ role: 'user', content: userMsg });
      llmHistory.push({ role: 'assistant', content: out });
    } finally {
      t.remove();
    }
    return out;
  }

  // 规则版：生成追问（从题库 followups 取，超出则给通用追问）
  function ruleFollowup(q, fi) {
    if (q.followups && q.followups[fi]) return q.followups[fi];
    const generic = [
      '能结合你刚才的回答，再举一个具体的落地例子吗？',
      '如果让你重新做一次，你会在哪里做得不一样？',
      '你刚才提到的方案，遇到资源不足时会怎么取舍？'
    ];
    return generic[fi % generic.length];
  }

  // 出题请求文案（预取与正式出题共用，保证内容一致）
  function questionPrompt(q, i) {
    let p = `【第 ${i + 1}/${total} 题】请出一道面试题。\n本题必须围绕以下核心问题展开（可换自然说法，但考察点不变）：\n「${q.q}」\n题型：${q.type}\n考察意图：${q.intent || ''}\n参考考点关键词：${(q.keywords || []).join('、')}`;
    // 有简历时，把题目锚定到候选人真实经历上（否则模型容易退回空泛通用问法）
    if (resumeCtx) {
      const probes = ((resumeCtx.match && resumeCtx.match.probe_points) || []).filter(Boolean).slice(0, 3);
      const anchor = probes.length
        ? probes.join('、')
        : ((resumeCtx.match && resumeCtx.match.hits) || []).filter(Boolean).slice(0, 3).join('、');
      if (anchor) {
        p += `\n候选人简历里提到：${anchor}。请在不改变考察点的前提下，把问题落到他简历里的具体经历或技术上（点名具体项目 / 方案），不要问「你做过什么项目」这类空泛问题。`;
      }
    }
    return p + '\n只输出题目本身，一句话。';
  }

  // 静默预取某一题（不渲染），把首 token 的固定延迟藏进开场白/上一题的空档
  function prefetchQuestion(i) {
    try {
      const q = questions[i];
      if (!q) return null;
      const sys = sysPrompt();
      const userMsg = questionPrompt(q, i);
      return LLM.chat([{ role: 'system', content: sys }, { role: 'user', content: userMsg }], { temperature: 0.8 })
        .then(function (text) { return { text: text, userMsg: userMsg }; })
        .catch(function () { return null; });
    } catch (e) { return null; }
  }

  // 快速逐字回放预取结果：保持「正在生成」的观感，但几乎零等待
  async function replayBubble(text, meta) {
    const s = bubbleStream(meta);
    const len = Math.max(1, text.length);
    const step = Math.max(6, Math.min(14, Math.round(500 / len)));
    for (let i = 1; i <= text.length; i++) {
      s.update(text.slice(0, i));
      await delay(step);
    }
  }

  // —— 流程控制 ——
  async function askQuestion(prefetched) {
    const q = questions[idx];
    phase = 'question';
    followupIdx = 0;
    // 计时在题目真正显示之后才开始：AI 出题耗时不能算进考生的作答时间
    stopQTimer();
    document.getElementById('pill-qtime').textContent = '出题中…';
    const meta = `${q.type} · ${q.difficulty} · 限时 ${Math.round(qLimitSeconds(q) / 60)} 分钟` + (maxFollowups > 0 ? ` · 追问 ${maxFollowups} 轮` : '');
    if (useLLM) {
      const sys = sysPrompt();
      const userMsg = questionPrompt(q, idx);
      try {
        if (prefetched) {
          const t2 = typing();
          const r = await prefetched;
          t2.remove();
          if (r && r.text) {
            await replayBubble(r.text, meta);
            llmHistory.push({ role: 'user', content: r.userMsg });
            llmHistory.push({ role: 'assistant', content: r.text });
            resetQTimer();
            return;
          }
        }
        await llmTurn(sys, userMsg, 0.8, meta);
      } catch (e) {
        await aiSay('【第 ' + (idx + 1) + ' 题】' + q.q, meta);
      }
    } else {
      await aiSay('【第 ' + (idx + 1) + ' 题】' + q.q, meta);
    }
    resetQTimer();
  }

  function updateProgress() {
    const done = records.length;
    $progress.textContent = done + '/' + total;
    $bar.style.width = (done / total * 100) + '%';
  }

  // —— 综合评估（本地归纳）：保证任何情况下报告都有可核对的结论 ——
  const DIM_FIX = {
    '专业能力': '按「原理 → 取舍 → 边界」三层讲，别只讲会用哪些工具',
    '岗位匹配': '把经历对齐 JD 关键词，明确哪些部分是你独立负责',
    '沟通表达': '先说结论再展开，单个回答控制在 90 秒内',
    '逻辑思维': '用「目标 → 拆解 → 验证」的顺序组织，避免想到哪说到哪',
    '学习潜力': '讲清你如何快速上手陌生领域，给出具体的学习路径',
    '稳定性与价值观': '说明选择动机与长期打算，不要只谈薪资'
  };
  function localEvaluation(dimAvg, timing, scoreMode) {
    const entries = Object.keys(dimAvg || {}).map(k => ({ name: k, v: Number(dimAvg[k]) || 0 }));
    if (!entries.length) return null;
    entries.sort((a, b) => b.v - a.v);
    const strong = entries.slice(0, 2);
    const weak = entries.slice().reverse().slice(0, 2);
    const avg = entries.reduce((a, b) => a + b.v, 0) / entries.length;

    const parts = [`六维均分 ${avg.toFixed(2)}/5。`];
    if (strong.length) {
      parts.push(`相对最扎实的是「${strong[0].name}」(${strong[0].v.toFixed(1)})` +
        (strong[1] ? ` 与「${strong[1].name}」(${strong[1].v.toFixed(1)})` : '') + '；');
    }
    if (weak.length) {
      parts.push(`最明显的短板是「${weak[0].name}」(${weak[0].v.toFixed(1)})` +
        (weak[1] && weak[1].name !== weak[0].name ? ` 与「${weak[1].name}」(${weak[1].v.toFixed(1)})` : '') + '。');
    }
    const over = timing.overtimeCount || 0;
    if (timing.totalLimitSeconds) {
      parts.push(over > 0
        ? `时间上总用时 ${Math.round(timing.totalSeconds / 60)} 分钟、有 ${over} 道题超出限时，说明部分问题的组织速度还有余量。`
        : `时间上总用时 ${Math.round(timing.totalSeconds / 60)} 分钟，全部题目都在限时内完成。`);
    }
    parts.push(scoreMode === 'rule'
      ? '（本次为规则评分，结论只反映考点关键词的覆盖程度，不代表作答质量。）'
      : '建议按下方动作做一次专项练习，再回到同岗位同档位复测，用两次结果对照。');

    const acts = weak.map(d => DIM_FIX[d.name] || `针对「${d.name}」复盘同类问题，找人对练一次`);
    acts.push(over > 0 ? '作答前先花 10 秒列要点，把单题控制在限时内' : '每个回答压缩成「结论 + 一个案例 + 一个数据」三段式');

    return {
      overall: parts.join(''),
      strengths: strong.map(d => `${d.name} ${d.v.toFixed(1)} 分，是本次相对最扎实的维度`),
      gaps: weak.map(d => `${d.name} 仅 ${d.v.toFixed(1)} 分，需要专项补强`),
      actions: acts.slice(0, 3),
      source: 'rule'
    };
  }

  function finish() {
    phase = 'done';
    // 冻结总用时：结束后不再累加（此前定时器无句柄，结束后面试时间仍在走）
    if (!endTime) endTime = Date.now();
    if (totalTimer) { clearInterval(totalTimer); totalTimer = null; }
    stopQTimer();
    renderTotalTime();
    document.getElementById('input-bar').style.display = 'none';
    document.getElementById('btn-end').style.display = 'none';
    computeAndStore();
  }

  async function computeAndStore() {
    // 评分（按行业/岗位/档位选取合适权重预设）
    const weights = D.dimensionWeights(industry, role, tierKey);

    // 是否启用 AI 语义级评分：需开启评分开关且已配置可用大模型；否则走规则评分
    const useLLMScore = (typeof window.LLM !== 'undefined') && window.LLM.isScoreEnabled();
    let llmScores = null; // [{raw, comment}] 与 records 同序
    if (useLLMScore) {
      await aiSay('我先按评分表逐题核对你的作答，然后生成综合评估，大约 15–25 秒，稍等…', '评分中');
      try {
        const st = D.getScoring();
        const rubrics = (st && st.dimensions || []).map(d => ({
          name: d.name,
          focus: d.observation_focus,
          levels: d.levels || {}
        }));
        const items = records.map(r => ({
          q: r.q, type: r.type, intent: r.intent, keywords: r.keywords,
          answer: r.answer,
          followup: (r.rounds && r.rounds[0]) ? r.rounds[0].q : r.followup,
          followupAnswer: (r.rounds && r.rounds.length)
            ? r.rounds.map(x => x.a).filter(Boolean).join('\n')
            : r.followupAnswer
        }));
        llmScores = await LLM.scoreInterview(items, {
          industry, role, level, tierName: tierData.name, weights, rubrics,
          guidelines: (st && st.scoring_guidelines) || []
        });
      } catch (e) {
        console.warn('AI 语义评分失败，回退规则评分：', e);
        llmScores = null;
      }
    }

    const perQ = records.map((r, i) => {
      let kh = D.keywordHit(r.answer + ' ' + (r.followupAnswer || ''), r.keywords);
      let raw, comment = null, evidence = null;
      if (llmScores && llmScores[i]) {
        raw = llmScores[i].raw;
        comment = llmScores[i].comment;
        evidence = llmScores[i].evidence || null;
      } else if (r.type === '求职动机' || r.type === '简历深挖') {
        // 动机题 / 简历深挖题的 keywords 是「评分要点」长句或为空——
        // 词匹配会给出失真的 1 分。规则兜底时按中性 3 分处理，报告已标「参考分」。
        kh = { hits: [], miss: [], rate: 0 };
        raw = {};
        Object.keys(weights).forEach(k => { raw[k] = 3; });
      } else {
        raw = D.scoreQuestion(r.answer + ' ' + (r.followupAnswer || ''), r.keywords, !!r.followupAnswer).raw;
      }
      return { r, kh, raw, comment, evidence };
    });

    // 聚合维度（平均）
    const dimAvg = {};
    Object.keys(weights).forEach(k => {
      const vals = perQ.map(p => p.raw[k] || 0);
      dimAvg[k] = D.round1(vals.reduce((a, b) => a + b, 0) / (vals.length || 1));
    });
    const totalScore = D.weightedTotal(dimAvg, weights);
    const stanine = D.stanineOf(totalScore);

    const scoreMode = llmScores ? 'llm' : 'rule';
    // 严谨性约束：规则评分只依据关键词命中率，无法判断表达质量与思考深度，
    // 不足以支撑录用结论。语义评分不可用时只给参考分，判决置为「未评定」，
    // 避免把内容合格、只是没踩中关键词的作答误判成「不通过」。
    const verdict = scoreMode === 'llm'
      ? D.verdict(totalScore)
      : { id: 'unrated', label: '参考分（未做语义评定）', cls: 'pending' };

    const totalSeconds = Math.floor((nowTs() - startTime) / 1000);
    const totalLimitSeconds = records.reduce((a, r) => a + (r.limitSeconds || qLimitSeconds({ difficulty: r.difficulty, minutes: null })), 0);
    const overtimeCount = records.filter(r => r.timedOut || (r.overSeconds || 0) > 0).length;

    // 综合评估：语义评分成功时才由模型撰写总评；规则兜底时用本地结构化归纳，
    // 保证任何情况下报告都有一份可核对的结论，而不是只有一个数字。
    let evaluation = null;
    if (scoreMode === 'llm') {
      try {
        evaluation = await LLM.summarize({
          industry, role, level, tierName: tierData.name,
          weights, dimAvg, totalScore, band: stanine,
          timing: { totalSeconds, totalLimitSeconds, overtimeCount },
          questions: perQ.map(p => ({
            q: p.r.q, type: p.r.type, difficulty: p.r.difficulty,
            dimRaw: p.raw, aiFeedback: p.comment,
            spentSeconds: p.r.spentSeconds, overSeconds: p.r.overSeconds
          }))
        });
      } catch (e) {
        console.warn('综合评估生成失败，回退本地归纳：', e);
        evaluation = null;
      }
    }
    if (!evaluation) {
      evaluation = localEvaluation(dimAvg, { totalSeconds, totalLimitSeconds, overtimeCount }, scoreMode);
    }

    const payload = {
      industry, role, level, tier: tierKey,
      tierName: tierData.name,
      timeSeconds: totalSeconds,
      timing: {
        totalSeconds: totalSeconds,
        totalLimitSeconds: totalLimitSeconds,
        overtimeCount: overtimeCount,
        questionCount: records.length
      },
      totalScore, stanine, verdict,
      weights, dimAvg,
      questions: perQ.map(p => {
        const rounds = p.r.rounds || [];
        return {
          q: p.r.q, qid: p.r.id || null, calibrated: p.r.calibratedBy || null, type: p.r.type, difficulty: p.r.difficulty,
          answer: p.r.answer,
          followup: rounds[0] ? rounds[0].q : (p.r.followup || null),
          followupAnswer: rounds.length
            ? rounds.map(x => x.a).filter(Boolean).join('\n')
            : (p.r.followupAnswer || null),
          followupRounds: rounds.length || (p.r.followupAnswer ? 1 : 0),
          rounds: rounds,
          keywords: p.r.keywords,
          hits: p.kh.hits, miss: p.kh.miss,
          hitRate: D.round2(p.kh.rate),
          dimRaw: p.raw,
          evidence: p.evidence || null,
          aiFeedback: p.comment || null,
          spentSeconds: (p.r.spentSeconds == null ? null : p.r.spentSeconds),
          limitSeconds: p.r.limitSeconds || qLimitSeconds(p.r),
          overSeconds: p.r.overSeconds || 0,
          timedOut: !!p.r.timedOut
        };
      }),
      mode: C.AI_MODE,
      chatMode: useLLM ? 'llm' : 'rule',
      scoreMode,
      paper: customMode ? null : paper,   // 轮换卷号，常模按卷号分组
      // 自创面试官：标记 + 人格配置 + 考点覆盖，供报告隔离与标注使用
      customMode: customMode,
      persona: customMode ? {
        name: (scope && scope.name) || personaCfg.summary || '自创面试官',
        description: (scope && scope.description) || personaCfg.rawText || '',
        config: personaCfg
      } : null,
      coverage: customPack ? customPack.coverage : null,
      // 简历匹配元信息：只存判定结果，不存简历原文（报告可能上云存档）
      resume: resumeCtx ? {
        score: (resumeCtx.match && resumeCtx.match.score != null) ? resumeCtx.match.score : null,
        engine: (resumeCtx.match && resumeCtx.match.engine) || null,
        lowMatch: !!resumeCtx.lowMatch,
        forced: !!resumeCtx.forced,
        hits: ((resumeCtx.match && resumeCtx.match.hits) || []).slice(0, 6),
        gaps: ((resumeCtx.match && resumeCtx.match.gaps) || []).slice(0, 6),
        probes: ((resumeCtx.match && resumeCtx.match.probe_points) || []).slice(0, 6)
      } : null,
      evaluation: evaluation,
      scoreMeta: {
        mode: scoreMode,
        model: scoreMode === 'llm' ? ((window.LLM.load() || {}).model || 'hunyuan-chat') : null,
        at: Date.now()
      },
      ts: Date.now()
    };

    // 已登录则存档到后端（失败不影响本地查看）
    let savedId = null;
    if (window.Auth && window.Auth.ready) { try { await Auth.ready(); } catch (e) { /* ignore */ } }
    if (window.Auth && window.Auth.isLoggedIn()) {
      try {
        const r = await Auth.api('/reports', { method: 'POST', body: JSON.stringify({ report: payload }) });
        savedId = r.id;
      } catch (e) { /* 存档失败忽略 */ }
    }

    sessionStorage.setItem('interview_result', JSON.stringify(payload));
    // 简历原文到此为止：报告只保留匹配元信息，不再保留简历正文
    try { sessionStorage.removeItem('wb_resume'); } catch (e) { /* ignore */ }
    // 埋点：面试完成（只记结果元信息，不含任何作答内容）
    if (window.Analytics) window.Analytics.track('interview_finish', {
      mode: customMode ? 'custom' : 'standard',
      paper: payload.paper || null,
      scoreMode: scoreMode,
      qCount: (payload.questions || []).length,
      timeSeconds: payload.timeSeconds || 0,
      overtimeCount: (payload.timing && payload.timing.overtimeCount) || 0
    });
    // 访客（未登录）把报告留在本地，登录后可一键同步到云端（P0-4）
    if (!savedId) {
      try { localStorage.setItem('wb_pending_report', JSON.stringify(payload)); } catch (e) { /* ignore */ }
    }
    // 提示跳转
    const tip = savedId
      ? '面试结束，报告已保存到「我的历史」，正在生成评分报告…'
      : '面试结束，正在生成你的评分报告…';
    aiSay(tip).then(() => {
      const href = savedId ? ('report.html?id=' + savedId) : 'report.html';
      const el = document.createElement('div');
      el.style.textAlign = 'center';
      el.style.marginTop = '16px';
      el.innerHTML = '<a class="btn btn-primary btn-lg" href="' + href + '">查看评分报告 →</a>';
      chat.appendChild(el);
      chat.scrollTop = chat.scrollHeight;
    });
  }

  // —— 发送作答 ——
  // 初始化当前题的记录字段（手动作答与超时自动提交共用）
  function fillRecord() {
    records[idx] = records[idx] || {};
    records[idx].q = questions[idx].q;
    records[idx].id = questions[idx].id || null;   // 题目唯一 id，供纠错反馈定位
    records[idx].calibratedBy = questions[idx].calibrated_by || null;   // 已被面试者校准过的次数
    records[idx].type = questions[idx].type;
    records[idx].difficulty = questions[idx].difficulty;
    records[idx].intent = questions[idx].intent;
    records[idx].keywords = questions[idx].keywords;
    if (!records[idx].rounds) records[idx].rounds = [];
  }

  async function send() {
    if (submitting) return;
    const text = $answer.value.trim();
    if (!text) return;
    submitting = true;
    try {
      bubble(text, 'me');
      $answer.value = '';

      if (phase === 'question') {
        fillRecord();
        records[idx].answer = text;

        if (maxFollowups <= 0) { await finishQuestion(); return; }

        phase = 'followup';
        followupIdx = 0;
        await askFollowup(text);
        // 用户答追问的空档里后台预取下一题，缩短下一题的首字等待
        nextQPromise = (useLLM && idx + 1 < total) ? prefetchQuestion(idx + 1) : null;
      } else if (phase === 'followup') {
        if (records[idx].rounds[followupIdx]) records[idx].rounds[followupIdx].a = text;
        followupIdx += 1;
        records[idx].spentSeconds = Math.floor(elapsedQ());
        if (followupIdx < maxFollowups) {
          await askFollowup(text);
        } else {
          await finishQuestion();
        }
      }
    } finally {
      submitting = false;
    }
  }

  // 生成一轮追问（基于上一轮回答；多轮时提示不要重复）
  async function askFollowup(lastAnswer) {
    const q = questions[idx];
    const meta = maxFollowups > 1 ? ('追问 ' + (followupIdx + 1) + '/' + maxFollowups) : '追问';
    // 生成追问期间暂停计时：这段时间考生无法作答，不该计入限时
    pauseQTimer();
    let fq = null;
    try {
      if (useLLM) {
        try {
          fq = await llmTurn(
            sysPrompt(),
            `候选人回答了关于「${q.intent || q.q}」的问题。这是第 ${followupIdx + 1} 轮追问（共 ${maxFollowups} 轮）。\n他刚才的回答是：\n「${lastAnswer}」\n本题参考考点关键词：${(q.keywords || []).join('、')}。\n请基于他刚才的回答提出一个更进一步的追问（一句话）。${followupIdx === 0 ? '可深挖某个点或要求举例。' : '必须针对他回答里的薄弱处继续深挖，不要重复上一轮的问题。'}`,
            0.7,
            meta
          );
        } catch (e) { fq = null; }
      }
      if (!fq) {
        fq = ruleFollowup(q, followupIdx);
        await aiSay(fq, meta);
      }
      records[idx].rounds[followupIdx] = { q: fq, a: null };
    } finally {
      resumeQTimer();
    }
  }

  // 当前题结束：更新进度、进入下一题或收尾
  async function finishQuestion() {
    // 离题时结算用时与限时（是否有追问都要结算，且用冻结时刻计算）
    const rec = records[idx];
    if (rec && (qTimer || qAccum > 0)) {
      const spent = Math.floor(elapsedQ());
      rec.spentSeconds = spent;
      rec.limitSeconds = qLimit || qLimitSeconds(questions[idx]);
      rec.overSeconds = Math.max(0, spent - rec.limitSeconds);
      rec.timedOut = !!rec.timedOut || spent >= (rec.limitSeconds || Infinity);
      qAccum = 0;
    }
    stopQTimer();
    updateProgress();
    idx += 1;
    if (idx < total) {
      const p = nextQPromise; nextQPromise = null;
      await delay(400);
      await askQuestion(p);
      return;
    }
    // 题已答完：先冻结总用时，避免把「AI 收尾寒暄」的时间算进面试时长
    if (!endTime) endTime = Date.now();
    if (useLLM) {
      try {
        await llmTurn(
          sysPrompt(),
          '面试已结束，请简短收尾（一两句话），告诉候选人稍后查看评分报告。',
          0.5,
          null
        );
      } catch (e) {
        await aiSay('好的，今天的所有问题都问完了。感谢你的时间，我们稍后见分晓。');
      }
    } else {
      await aiSay('好的，今天的所有问题都问完了。感谢你的时间，我们稍后见分晓。');
    }
    await delay(600);
    finish();
  }

  $send.addEventListener('click', send);
  $answer.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  document.getElementById('btn-end').addEventListener('click', () => {
    if (records.length === 0) { location.href = 'index.html'; return; }
    if (!endTime) endTime = Date.now();   // 点下即冻结，避免把提示语的时间也算进去
    aiSay('好的，我们提前结束，正在为你生成已作答部分的报告…').then(finish);
  });

  // 开场白 + 第一题（开场白期间预取第一题，隐藏首 token 等待）
  const firstQPromise = useLLM ? prefetchQuestion(0) : null;
  if (customMode) {
    const pname = personaCfg.summary || '你的面试官';
    await aiSay('我是按你的设定来的面试官：' + pname + '。今天就问 ' + total + ' 道题' +
      (maxFollowups > 0 ? '，每题最多追问 ' + maxFollowups + ' 轮' : '') + '，准备好了我们就开始。', '自创面试官');
    // 考点覆盖不足时如实说明，不装作都考到了
    const cov = customPack && customPack.coverage;
    if (cov && cov.missing && cov.missing.length) {
      await delay(200);
      await aiSay('说明一下：你选的 ' + cov.tags.length + ' 个考点里，有 ' + cov.missing.length +
        ' 个在题库里没有可用题目（' + cov.missing.slice(0, 3).join('、') + '），本次实际覆盖 ' +
        cov.covered.length + ' 个。', '范围说明');
    }
  } else {
    // 兜底过滤：script_tips 里可能残留内部文档名（如 xxx.md），不能出现在给用户看的话术里
    const greet = (tierData.script_tips || '')
      .split('；')
      .map(s => s.trim())
      .filter(s => s && !/\.md\b|process_and_scripts/i.test(s))[0] || '';
    await aiSay('你好，我是你的' + tierData.name.split('（')[0] + '模拟面试官。' +
      (greet ? greet + '。' : '接下来我们会进行一场对话式模拟面试，请放松、像真实面试一样作答。') +
      '准备好了我们就开始。', '面试官');
  }
  await delay(500);
  await askQuestion(firstQPromise);
})();
