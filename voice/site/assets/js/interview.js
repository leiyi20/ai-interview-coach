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

  // 练习模式：逐题即时点评（可选，默认标准模式）。与自创面试的 mode=custom 正交，用 practice=1 控制。
  // 标准模式：全程沉默，只在结尾出报告（沉浸测评）。练习模式：每答一题异步给一句教练点评。
  const practiceMode = qs.get('practice') === '1';

  // —— 简历上下文（来自简历页）——
  // 仅当岗位/行业与简历页一致时才使用，避免直接改 URL 导致简历串岗。
  // 只在本次面试内存中使用；结束写报告后即清除，不上传原始简历文本。
  let resumeCtx = null;
  // 简历是可选增强项：只有从简历页过来（URL 带 resume=1）才启用。
  // 首页「开始模拟面试」直连本页时不带该参数，即使上次的简历还在 sessionStorage 也不会被误用。
  const resumeEnabled = !customMode && qs.get('resume') === '1';
  if (resumeEnabled) {
    const r = window.Store.get('resume');
    if (r) {
      if (r.text && r.role === role && r.industry === industry) resumeCtx = r;
      else window.Store.remove('resume');   // 陈旧 / 串岗数据：直接用不上，清掉
    }
  } else {
    // 自创面试官不使用简历，残留数据不留
    window.Store.remove('resume');
  }

  // 隐私：简历原文只在本次面试期间保留。离开页面（跳转 / 返回 / 关闭标签页）立即清除，
  // 与简历页「离开页面或关闭标签页即清除」的承诺一致。
  // 刻意不用 visibilitychange——用户只是切到别的标签页时不该丢掉简历。
  if (resumeCtx) {
    const clearResume = () => { window.Store.clearPrivate(); };
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
  let interviewLen = 0;    // 本场题量（3 快练 / 6 标准 / 9 全真），组卷时确定
  let backfillCount = 0;   // 本层级题量不足时从相邻层级补的题数（报告需如实标注）
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

  // 手机端没有 Enter / Shift+Enter 键，占位提示换成触屏说法（否则用户会找不到「发送」）
  if ($answer && window.matchMedia('(hover: none) and (pointer: coarse)').matches) {
    $answer.placeholder = '在这里输入你的回答…';
  }

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
    //
    // 面试长度：3 快练 / 6 标准 / 9 全真（URL len 优先，非法值回落到配置默认）。
    // 题池按岗位×层级只有约 6 题，9 题必然要跨层级补——补了多少必须记下来，报告里如实说明。
    const LEN_ALLOWED = [3, 6, 9];
    interviewLen = parseInt(qs.get('len') || '', 10);
    if (LEN_ALLOWED.indexOf(interviewLen) < 0) interviewLen = C.QUESTIONS_PER_INTERVIEW;
    const roleQCount = Math.max(1, interviewLen - 1);
    questions = D.sampleQuestions(industry, role, level, tierKey, roleQCount, paper);
    // 跨层级补题数：'通用' 题适用于任何层级，不计入
    const REAL_LEVELS = ['校招', '初级', '中级', '高级'];
    backfillCount = questions.filter(q => REAL_LEVELS.indexOf(q.level) >= 0 && q.level !== level).length;
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

  // —— 反问环节（面试尾声候选人向面试官提问；现实面试的标配收尾）——
  // 评分独立展示于报告，不计入六维总分（印象分性质，与真实面试一致）。
  const RA_MAX = 3;         // 最多 3 问，与现实节奏一致
  const raData = D.findReverseAsk ? D.findReverseAsk(industry, role) : null; // 岗位反问题话术 + rubric
  const raRecords = [];     // {q, a}：候选人问题 + 面试官回答
  let raDone = false;       // 反问环节是否已结束（含跳过/未提问）
  let raResult = null;      // 评分结果 {items, overall}（写入报告）

  // —— 面试草稿：中途关页 / 刷新不丢进度 ——
  // 隐私边界：只存题目与作答文本，**绝不存简历原文**（简历由 Store 标为 private，离开即清）
  const DRAFT_TTL = 24 * 3600 * 1000;   // 草稿保留 24 小时

  function draftKey() {
    return [customMode ? 'custom' : 'standard', industry, role, level, tierKey, interviewLen || total].join('|');
  }
  function saveDraft() {
    if (customMode) return;                 // 自创模式暂不支持草稿
    if (idx >= total) return;               // 已答完，交给报告流程
    const done = records.slice(0, idx).filter(Boolean);
    if (!done.some(r => r && r.answer)) return;   // 一题都没答，不值得存
    window.Store.set('draft', {
      v: 1, key: draftKey(),
      params: { industry, role, level, tier: tierKey, resume: resumeEnabled ? '1' : '' },
      paper, idx, total, questions, records: done,
      elapsedMs: Date.now() - startTime,
      ts: Date.now()
    });
  }
  function loadDraft() {
    const d = window.Store.get('draft');
    if (!d || d.v !== 1 || d.key !== draftKey()) return null;
    if (!Array.isArray(d.questions) || d.questions.length !== total) return null;
    if (!(d.idx > 0) || d.idx >= d.questions.length) return null;
    if (Date.now() - (d.ts || 0) > DRAFT_TTL) { clearDraft(); return null; }
    return d;
  }
  function clearDraft() { window.Store.remove('draft'); }

  // 重放已答内容，让恢复后的对话看起来是连续的
  function replayRecords(list) {
    (list || []).forEach(r => {
      if (!r) return;
      if (r.q) bubble('【题】' + r.q, 'ai');
      if (r.answer) bubble(r.answer, 'me');
      (r.rounds || []).forEach(rd => {
        if (rd && rd.q) bubble(rd.q, 'ai');
        if (rd && rd.a) bubble(rd.a, 'me');
      });
    });
  }

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
    let scoreFailReason = ''; // AI 评分失败原因（非空表示已降级为规则分）
    let progEl = null; // 评分进度气泡
    if (useLLMScore) {
      await aiSay('我正在按评分表逐题核对你的作答，然后生成综合评估。分批并行评分，通常 15–30 秒…', '评分中');
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
        const scoreCtx = {
          industry, role, level, tierName: tierData.name, weights, rubrics,
          guidelines: (st && st.scoring_guidelines) || []
        };

        // 一次请求评 6 题实测约 43 秒（约 5.3 秒固定开销 + 6.3 秒/题）——用户多半以为卡死而关页。
        // 拆成每题一批并行（实测 6 路并发 11 秒、未被限流），单批失败先重试一次，仍失败才整体降级规则分。
        const BATCH = 1;
        const batches = [];
        for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
        let doneBatches = 0;
        const unit = BATCH === 1 ? '题' : '批';
        progEl = bubble('正在评分 0 / ' + batches.length + ' ' + unit + '（共 ' + items.length + ' 题）…', '评分中');
        const setProg = t => { if (progEl && progEl.firstChild) progEl.firstChild.nodeValue = t; };

        const runBatch = async (slice) => {
          let part;
          try {
            part = await LLM.scoreInterview(slice, scoreCtx);
          } catch (e1) {
            await delay(700);
            part = await LLM.scoreInterview(slice, scoreCtx); // 再失败则抛出，交给外层降级
          }
          doneBatches += 1;
          setProg('已完成 ' + doneBatches + ' / ' + batches.length + ' ' + unit + '…');
          return part;
        };

        const parts = await Promise.all(batches.map(runBatch));
        llmScores = [].concat.apply([], parts);
        setProg('语义评分完成，共 ' + items.length + ' 题；正在生成综合评估…');
      } catch (e) {
        console.warn('AI 语义评分失败，回退规则评分：', e);
        llmScores = null;
        // 记下失败原因：规则兜底不能静默进行，报告里要明确告诉用户这份分是怎么来的
        scoreFailReason = (e && e.message) ? String(e.message).slice(0, 120) : '未知原因';
        if (progEl && progEl.firstChild) {
          progEl.firstChild.nodeValue = '语义评分未完成，已改用规则参考分（具体原因见报告）。';
        }
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
          // 练习模式逐题教练点评（标准模式为空）。B3 报告→练习闭环：复盘报告时复用。
          coach: (p.r.coach && p.r.coach.length) ? p.r.coach : null,
          spentSeconds: (p.r.spentSeconds == null ? null : p.r.spentSeconds),
          limitSeconds: p.r.limitSeconds || qLimitSeconds(p.r),
          overSeconds: p.r.overSeconds || 0,
          timedOut: !!p.r.timedOut
        };
      }),
      mode: C.AI_MODE,
      // B3 报告→练习闭环：标记本场是否练习模式，报告据此渲染逐题教练点评并给出回练入口
      practiceMode: !!practiceMode,
      // 反问环节（面试尾声候选人提问）：独立印象评价，不计六维总分。
      // 未走到反问环节（提前结束等）时为 null，报告不渲染该卡片。
      reverseAsk: raResult || null,
      chatMode: useLLM ? 'llm' : 'rule',
      scoreMode,
      length: interviewLen || total,      // 本场题量：3/6/9，常模后续可按长度分组
      backfill: backfillCount,            // 跨层级补题数（本层级题量不足时）
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
        failReason: scoreFailReason || null,
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

    window.Store.set('result', payload);
    // 简历原文到此为止：报告只保留匹配元信息，不再保留简历正文
    window.Store.clearPrivate();
    // 面试已完成，草稿使命结束
    clearDraft();
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
      window.Store.set('pending', payload);
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
    if (!records[idx].coach) records[idx].coach = [];   // 练习模式逐题点评（标准模式为空）
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
        coach(text, questions[idx], null);   // 练习模式：主答案即时点评（异步，不阻塞追问）

        if (maxFollowups <= 0) { await finishQuestion(); return; }

        phase = 'followup';
        followupIdx = 0;
        await askFollowup(text);
        // 用户答追问的空档里后台预取下一题，缩短下一题的首字等待
        nextQPromise = (useLLM && idx + 1 < total) ? prefetchQuestion(idx + 1) : null;
      } else if (phase === 'followup') {
        if (records[idx].rounds[followupIdx]) records[idx].rounds[followupIdx].a = text;
        coach(text, questions[idx], followupIdx);   // 练习模式：追问作答也点评
        followupIdx += 1;
        records[idx].spentSeconds = Math.floor(elapsedQ());
        if (followupIdx < maxFollowups) {
          await askFollowup(text);
        } else {
          await finishQuestion();
        }
      } else if (phase === 'reverseask') {
        // 反问环节：这里的输入是「问题」不是「作答」，走独立处理
        await handleReverseAsk(text);
      }
    } finally {
      submitting = false;
      saveDraft();   // 每次提交后落盘：中途关页 / 刷新不丢进度
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

  // 练习模式：对一条作答异步给一句即时点评。fire-and-forget，不阻塞面试官追问/下一题。
  // 用独立 system prompt 调 LLM（coachComment），不写入 llmHistory，不污染面试官出题上下文。
  function coach(answer, q, roundIdx) {
    if (!practiceMode || !useLLM) return;
    const ci = idx;
    const el = bubble('教练点评生成中…', 'coach');
    LLM.coachComment(String(answer).slice(0, 600), q, { industry, role, level, tierName: tierData.name })
      .then(function (txt) {
        if (txt && el && el.firstChild) {
          el.firstChild.nodeValue = txt;
          if (records[ci] && Array.isArray(records[ci].coach)) records[ci].coach.push(txt);
        } else if (el) {
          el.remove();   // 取不到点评就悄悄撤掉占位，不干扰对话
        }
      })
      .catch(function () { if (el) el.remove(); });
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
    saveDraft();   // 推进到下一题时落盘（覆盖超时自动提交等不经 send 的路径）
    if (idx < total) {
      const p = nextQPromise; nextQPromise = null;
      await delay(400);
      await askQuestion(p);
      return;
    }
    // 题已答完：进入反问环节（现实面试里「你有什么想问我的吗」是标配收尾；
    // 反问时间计入面试总时长，endTime 在反问结束后冻结）
    await enterReverseAsk();
  }

  // —— 反问环节 ——
  // 引导：用该岗位反问题的引导话术开场 + 一条可收起的提示条（好问题方向 + 跳过按钮）。
  async function enterReverseAsk() {
    phase = 'reverseask';
    const guide = (raData && raData.q) || '我的问题都问完了。你有什么想问我们的吗？可以问 2-3 个你真正关心的问题。';
    await aiSay(guide, '反问环节');
    raHint();
  }

  // 提示条：好问题方向（来自岗位反问题 keywords，即评分 rubric）+ 结束方式说明 + 跳过按钮
  function raHint() {
    const ex = (D.reverseAskExamples ? D.reverseAskExamples(industry, role) : []).slice(0, 4);
    const el = document.createElement('div');
    el.className = 'bubble sys';
    el.style.textAlign = 'left';
    let html = '<div>不知道问什么？可以从这些方向想（也完全可以按你自己的关心点问）：</div>';
    if (ex.length) {
      html += '<ul style="margin:6px 0 0 16px;padding:0;font-size:12.5px;color:var(--wb-muted);line-height:1.9;">'
        + ex.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul>';
    }
    html += '<div style="margin-top:8px;">问 1–3 个都可以；不想问了，直接说「没有了」，或点下面按钮。</div>'
      + '<div style="margin-top:8px;"><button class="btn btn-ghost" id="ra-skip" style="padding:5px 12px;font-size:12px;">我不问了，直接出报告</button></div>';
    el.innerHTML = html;
    chat.appendChild(el);
    el.querySelector('#ra-skip').addEventListener('click', function () {
      if (phase === 'reverseask') endReverseAsk();
    });
    chat.scrollTop = chat.scrollHeight;
  }

  // 规则模式的面试官回答：分域通用回复（诚实降级，不假装知道公司内部信息）
  function ruleInterviewerAnswer(text) {
    if (/薪资|工资|待遇|薪水|薪酬/.test(text)) return '薪资区间和结构在我们这是统一标准，HR 环节会和你详细沟通，这里就不报具体数字了。';
    if (/加班|强度|作息|大小周|几点下班/.test(text)) return '节奏跟着项目和阶段走，忙的时候肯定有，但整体是有计划地推进，不鼓励无意义的耗时间。';
    if (/培训|成长|导师|带教|晋升|发展/.test(text)) return '新人有导师带，前三个月以熟悉业务为主；后面的发展按能力和产出说话，路径是清楚的。';
    if (/技术栈|架构|框架|系统/.test(text)) return '团队用的都是业内主流的方案，具体细节入职后会有系统介绍，这里就不展开了。';
    return '简单说，团队目前正处在业务上升期，要做的事有挑战也有空间。更多细节等你入职后会了解得更全面。';
  }

  // 练习模式：对一个反问给即时教练点评（fire-and-forget，不阻塞面试官回答）
  function coachRA(question) {
    if (!practiceMode || !useLLM) return;
    const el = bubble('教练点评生成中…', 'coach');
    LLM.coachReverseAsk(String(question).slice(0, 300), {
      role, level, tierName: tierData.name, keywords: (raData && raData.keywords) || []
    }).then(function (txt) {
      if (txt && el && el.firstChild) el.firstChild.nodeValue = txt;
      else if (el) el.remove();
    }).catch(function () { if (el) el.remove(); });
  }

  // 候选人在反问环节说了一句话：结束语检测 → 结束；否则当作一个问题处理
  async function handleReverseAsk(text) {
    if (/^(没|不)(有)?了?(什么)?(想问的?)?[了嘛呢吗]?[，。!！~\s]*$|^(就|先)这些[，。!！~\s]*$|^没有(什么)?(想问的?|问题)[了嘛呢吗]?[，。!！~\s]*$|^ok$|^好的?[，。!！~\s]*$/i.test(text)) {
      await endReverseAsk();
      return;
    }
    if (raRecords.length >= RA_MAX) { await endReverseAsk(); return; }   // 防御：满 3 问自动收
    const rec = { q: text, a: null };
    raRecords.push(rec);
    coachRA(text);
    const meta = '反问 ' + (raRecords.length);
    if (useLLM) {
      try {
        const ans = await llmTurn(
          sysPrompt(),
          '候选人在反问环节提出了一个问题，请你以面试官身份直接回答这个问题本身（2-3 句，自然口语，可信具体）。'
          + '不要出题、不要评价他的问题、不要反问他。遇到薪资具体数字等 HR 环节的话题，用面试官的标准话术礼貌绕开。\n'
          + '候选人的问题：「' + text + '」',
          0.7,
          meta
        );
        rec.a = ans;
      } catch (e) {
        const fb = ruleInterviewerAnswer(text);
        rec.a = fb;
        await aiSay(fb, meta);
      }
    } else {
      const fb = ruleInterviewerAnswer(text);
      rec.a = fb;
      await aiSay(fb, meta);
    }
    if (raRecords.length >= RA_MAX) {
      await delay(300);
      await aiSay('好的，今天的问题就到这里，感谢你的时间。');
      await endReverseAsk();
    } else {
      await aiSay('还有其他想了解的吗？');
    }
  }

  // 反问环节评分：LLM 优先（rubric 用岗位反问题 keywords），失败降级规则评分。
  // 一个问题都没问也照实评（现实中不问就是减分项），评语给建设性建议。
  async function scoreRA() {
    if (!raRecords.length) {
      return {
        items: [], skipped: true,
        overall: { label: '减分项', comment: '反问环节没有提出任何问题。现实面试中这容易被解读为兴趣不足或准备不足——哪怕只问一个团队现状或岗位预期类的问题，也会完全不同。' }
      };
    }
    if (useLLM && window.LLM && LLM.scoreReverseAsk) {
      try {
        const r = await LLM.scoreReverseAsk(raRecords, { role, level, keywords: (raData && raData.keywords) || [] });
        if (r) return r;
      } catch (e) { /* 降级 */ }
    }
    return ruleScoreReverseAsk();
  }

  // 规则评分：按岗位 keywords 的核心词命中 + 敏感/偷懒问题特征分档
  function ruleScoreReverseAsk() {
    const kw = (raData && raData.keywords) || [];
    const items = raRecords.map(r => {
      const t = String(r.q || '');
      const good = kw.some(k => {
        const core = (String(k).split('：')[1] || k).replace(/[^一-鿿a-zA-Z0-9]/g, '').slice(0, 6);
        return core && t.includes(core);
      });
      const sensitive = /薪资|工资|待遇|薪水|加班|福利|年终/.test(t);
      const lazy = /公司(是做什么|主营|介绍)|官网|百度/.test(t);
      let verdict = 'neutral';
      let comment = '问题合理但偏通用——补一句你为什么关心这一点，信息量和印象都会更好。';
      if (good) { verdict = 'good'; comment = '问题切中要害，能看出你对岗位做过思考。'; }
      else if (lazy) { verdict = 'bad'; comment = '这类信息公开渠道就能查到，反问它等于告诉对方你没做功课。'; }
      else if (sensitive) { verdict = 'neutral'; comment = '关心待遇很正常，但作为反问首选显得动机单薄，建议搭配业务/成长类问题。'; }
      return { q: t, verdict, comment };
    });
    const goods = items.filter(i => i.verdict === 'good').length;
    const bads = items.filter(i => i.verdict === 'bad').length;
    const allMoney = items.length > 0 && items.every(i => /薪资|工资|待遇|薪水|加班|福利/.test(i.q));
    let label = '平平';
    let comment = '反问中规中矩。想加分，可以问团队正在解决的问题、或这个岗位半年内的预期产出。';
    if (goods >= 1 && bads === 0 && items.length >= 2) { label = '加分项'; comment = '反问有分量、有准备痕迹，能看出你对这个岗位是认真的。'; }
    else if (bads >= 1 || allMoney) { label = '减分项'; comment = '反问没体现出对岗位本身的兴趣——先问业务与成长，再谈待遇，印象会完全不同。'; }
    return { items, overall: { label, comment } };
  }

  // 结束反问：评分 → 收尾寒暄 → 出报告。反问时间计入面试总时长（此处冻结 endTime）。
  async function endReverseAsk() {
    if (raDone) return;
    raDone = true;
    if (!endTime) endTime = Date.now();
    raResult = await scoreRA();
    if (useLLM) {
      try {
        await llmTurn(sysPrompt(), '面试已结束，请简短收尾（一两句话），告诉候选人稍后查看评分报告。', 0.5, null);
      } catch (e) {
        await aiSay('好的，今天的交流就到这里。感谢你的时间，稍后见分晓。');
      }
    } else {
      await aiSay('好的，今天的交流就到这里。感谢你的时间，稍后见分晓。');
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
    // 反问环节中提前结束：已问的问题照常评分进报告（不问出报告 = 减分项，如实呈现）
    if (phase === 'reverseask') { endReverseAsk(); return; }
    if (!endTime) endTime = Date.now();   // 点下即冻结，避免把提示语的时间也算进去
    aiSay('好的，我们提前结束，正在为你生成已作答部分的报告…').then(finish);
  });

  // 草稿恢复：询问用户要继续还是重来（选择前不自动出题）
  function offerDraftResume(draft) {
    return new Promise(resolve => {
      const answered = (draft.records || []).filter(r => r && r.answer).length;
      const mins = Math.floor((draft.elapsedMs || 0) / 60000);
      const el = document.createElement('div');
      el.className = 'bubble sys';
      el.style.textAlign = 'left';
      el.innerHTML =
        '<div>你有一场未完成的面试：已答 <b>' + answered + '</b> / ' + draft.total + ' 题' +
        (mins > 0 ? '，已用时约 ' + mins + ' 分钟' : '') + '。</div>' +
        '<div style="margin-top:4px;">作答内容保存在本机；简历不会留存。</div>' +
        '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn" id="draft-go" style="padding:7px 14px;font-size:13px;">继续这场面试</button>' +
        '<button class="btn btn-ghost" id="draft-new" style="padding:7px 14px;font-size:13px;">重新开始</button>' +
        '</div>';
      chat.appendChild(el);
      chat.scrollTop = chat.scrollHeight;
      $send.disabled = true; $answer.disabled = true;   // 选之前不能作答
      const done = v => {
        el.remove();
        $send.disabled = false; $answer.disabled = false;
        resolve(v);
      };
      el.querySelector('#draft-go').addEventListener('click', () => done(true));
      el.querySelector('#draft-new').addEventListener('click', () => done(false));
    });
  }

  const draft = loadDraft();
  let resumed = false;
  if (draft) {
    const goOn = await offerDraftResume(draft);
    if (goOn) {
      // 用草稿里的题目与进度，保证恢复后题目与原来一致
      questions = draft.questions;
      if (draft.paper) paper = draft.paper;
      idx = draft.idx;
      records.length = 0;
      (draft.records || []).forEach(r => records.push(r));
      updateProgress();
      replayRecords(draft.records);
      clearDraft();   // 草稿内容已进内存，之后每次提交会重新落盘；不留在原地
      await delay(300);
      if (idx >= total) {
        // 上次已在反问环节中断：题目已答完，重进反问（反问进度不进草稿，重新问）
        await finishQuestion();
      } else {
        await askQuestion(null);
      }
      resumed = true;
    } else {
      clearDraft();
    }
  }

  // 开场白 + 第一题（开场白期间预取第一题，隐藏首 token 等待）
  const firstQPromise = (!resumed && useLLM) ? prefetchQuestion(0) : null;
  if (!resumed) {
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
    // 题量不足时会从相邻层级补题——开场就说清，别等报告出来才发现难度不对
    if (backfillCount > 0) {
      await delay(200);
      await aiSay('先说明一下：本场 ' + total + ' 道题里有 ' + backfillCount + ' 道来自相邻层级——' +
        '该岗位在「' + level + '」层级的可用题目不够，已由相邻层级补足，评分照常。', '面试官');
    }
    // 练习模式开场说明：用系统提示（不是面试官说的），避免人设混淆
    if (practiceMode) {
      await delay(200);
      sysBubble('已开启练习模式：每答一题会收到一条独立的教练点评（琥珀色气泡），面试官的节奏不受影响。');
    }
  }
  await delay(500);
  await askQuestion(firstQPromise);
  }
})();
