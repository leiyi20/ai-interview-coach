/* ===== 真实大模型接入层（WorkBuddy 云 LLM，免密钥） =====
 * 走 cloud.llm.chat.completions.create，只支持流式（stream: true）。
 * 只能在该应用发布后的 HTTPS 域名下调用（Origin 校验）；本地预览会失败。
 *
 * 设置项仅剩：是否启用对话、是否启用语义评分、模型（默认 auto=云端第一个可用模型）。
 */
window.LLM = (function () {
  const KEY = 'wb_interview_llm';
  const DEFAULTS = {
    enabled: false,          // AI 实时对话（出题/追问）
    scoreEnabled: true,      // AI 语义评分：默认开启，规则分只作失败兜底
    model: 'hunyuan-chat'
  };

  let _modelCache = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw));
    } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function save(cfg) { localStorage.setItem(KEY, JSON.stringify(cfg)); }
  function clear() { localStorage.removeItem(KEY); }
  function isEnabled() { return !!load().enabled; }
  // 语义评分独立于对话开关：即使不开 AI 对话（走规则出题），仍可做 AI 语义评分
  function isScoreEnabled() { return !!load().scoreEnabled; }

  // 云端可用模型列表：[{ id, name, disabled, ... }]
  async function listModels() {
    const cloud = window.Cloud.get();
    const res = await cloud.llm.models.list();
    const arr = Array.isArray(res) ? res : (res && res.data) || [];
    return arr;
  }

  async function resolveModel() {
    const c = load();
    if (c.model && c.model !== 'auto') return c.model;
    // 不要用 auto：云端 auto 也是纯推理模型，评分要 70s+。
    // 也不要在这里调 models.list()（多一次请求会占限流配额）。
    return 'hunyuan-chat';
  }

  function friendlyError(err) {
    const e = (err && err.error) || {};
    const code = e.code || '';
    if (String(code).startsWith('quota_')) return new Error('云端额度不足或触发限流，请稍后再试');
    if (String(code).startsWith('auth_')) return new Error('云服务鉴权失败（请确认是在发布后的线上地址使用）');
    if (String(code).startsWith('model_')) return new Error('模型服务暂时不可用，请稍后重试');
    if (String(code).startsWith('request_')) return new Error('请求参数不合法：' + (e.message || code));
    return new Error(e.message || (err && err.message) || '大模型调用失败');
  }

  // 调用大模型（流式收集完整文本）。messages[0] 必须是 system，否则自动补一条。
  // 云端有 QPS 限流，对「限流 / 网关 / 模型暂不可用」做有限退避重试。
  async function chat(messages, opts) {
    opts = opts || {};
    const cloud = window.Cloud.get();
    const model = await resolveModel();
    let msgs = (messages || []).slice();
    if (!msgs.length || msgs[0].role !== 'system') {
      msgs = [{ role: 'system', content: 'You are a helpful assistant. Be concise and helpful.' }].concat(msgs);
    }
    const req = { model: model, messages: msgs, stream: true };
    if (typeof opts.temperature === 'number') req.temperature = opts.temperature;
    if (opts.conversationId) req.conversationId = opts.conversationId;

    const MAX_ATTEMPTS = 3;
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let out = '';
      try {
        for await (const chunk of cloud.llm.chat.completions.create(req)) {
          const d = chunk && chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
          if (d && typeof d.content === 'string' && d.content) {
            out += d.content;
            // 流式回调：把「截至目前的完整文本」交给调用方逐字渲染
            if (typeof opts.onDelta === 'function') {
              try { opts.onDelta(out); } catch (e) { /* 渲染失败不影响生成 */ }
            }
          }
        }
        return out.trim();
      } catch (err) {
        lastErr = err;
        const code = String((err && err.error && err.error.code) || '');
        const retryable = /^(quota_|gateway_|model_|internal_)/.test(code) || (err && err.status === 429);
        if (!retryable || attempt === MAX_ATTEMPTS - 1) break;
        // 重试前清空已渲染内容，避免叠加重复
        if (typeof opts.onDelta === 'function') {
          try { opts.onDelta(''); } catch (e) { /* ignore */ }
        }
        // 优先用服务端给的 retryAfterMs，否则指数退避（0.8s / 1.6s）
        const wait = (err && typeof err.retryAfterMs === 'number' && err.retryAfterMs > 0)
          ? Math.min(err.retryAfterMs, 8000)
          : 800 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw friendlyError(lastErr);
  }

  // 构造面试官系统提示词（面试官角色 + 岗位/档位约束 + 行为规则）
  function buildSystem(industry, role, level, tier) {
    const name = (tier && tier.name) ? tier.name : '';
    const logic = (tier && tier.hiring_logic) ? tier.hiring_logic : '';
    let bias = '';
    const b = tier && tier.question_bias;
    if (b) {
      if (typeof b === 'string') bias = b;
      else if (b.emphasis) bias = b.emphasis;
      else if (Array.isArray(b.preferred_types)) bias = b.preferred_types.join('、');
    }
    bias = bias ? ('该档位尤其看重：' + bias + '。') : '';
    return [
      `你是一位专业、严谨的模拟面试官，正在对一位应聘「${industry}」行业「${role}」岗位（层级：${level}）的候选人进行对话式模拟面试。`,
      `目标公司档位：${name}（${logic}）。${bias}`,
      `你的要求：`,
      `1. 每次只输出一句面试官的发言（出题或追问），不要解释、不要列大纲、不要使用 Markdown 列表或编号。`,
      `2. 语气自然、口语化，像真实面试官，可用「我们」「你」。`,
      `3. 必须围绕我给你的【本题核心问题】来提问，可以换种自然的表达方式，但考察点不能跑偏；追问必须基于候选人刚才的回答。`,
      `4. 不要主动透露标准答案或考点关键词。`,
      `5. 当我说“面试结束”时，用一两句话自然收尾，并提示候选人稍后查看评分报告。`
    ].join('\n');
  }

  // —— AI 语义级评分 ——
  // items: [{q,type,intent,keywords,answer,followup,followupAnswer}, ...]（按题序）
  // ctx:   {industry, role, level, tierName, weights, rubrics}
  // 返回: [{raw:{六维:1~5}, comment:string}, ...]（与 items 同序）
  async function scoreInterview(items, ctx) {
    ctx = ctx || {};
    const rubrics = (ctx.rubrics || []).filter(r => r && r.name);
    if (!rubrics.length) throw new Error('缺少评分维度定义');

    // 完整五档锚点（1/2/3/4/5），单条截断到 90 字以控制输入长度
    const dimLines = rubrics.map((r, i) => {
      const lv = r.levels || {};
      const lines = ['5', '4', '3', '2', '1']
        .map(k => {
          let t = lv[k] ? String(lv[k]) : '';
          if (t.length > 90) t = t.slice(0, 90) + '…';
          return t ? `   ${k} 分：${t}` : '';
        })
        .filter(Boolean)
        .join('\n');
      return `${i + 1}. 「${r.name}」——考察点：${r.focus || ''}\n${lines}`;
    }).join('\n\n');

    const weightsText = Object.entries(ctx.weights || {})
      .map(([k, v]) => `${k}：${Math.round(v * 100)}%`).join('、');

    const qLines = items.map((it, i) => {
      const ans = (it.answer || '（未作答）').trim();
      const fq = (it.followup || '').trim();
      const fa = (it.followupAnswer || '').trim();
      return [
        `【第 ${i + 1} 题】题型：${it.type || ''}；考察意图：${it.intent || ''}`,
        `问题：${it.q || ''}`,
        `候选人回答：${ans}`,
        fq ? `追问：${fq}` : '',
        fa ? `候选人追问作答：${fa}` : '',
        `参考考点关键词：${(it.keywords || []).join('、') || '无'}`
      ].filter(Boolean).join('\n');
    }).join('\n\n');

    const guideLines = (ctx.guidelines || [])
      .map((g, i) => `${i + 1}. ${typeof g === 'string' ? g : JSON.stringify(g)}`)
      .join('\n');

    const system = [
      '你是一位资深、严谨的招聘评估专家。请依据下方的结构化评分表，对候选人的作答做语义级评分。',
      '必须遵守的评分纪律：',
      '1. 先证据、后打分：每个维度先找到候选人原话或明确缺失，再定档；禁止凭「感觉不错」给分。',
      '2. 以四档锚点为准：先判断落在 5/4/3/2/1 哪一档，再在档内允许 0.5 微调；锚点描述优先于你自己的印象。',
      '3. 维度相互独立：逐维单独判断，某一维优秀不得带动其他维度，避免晕轮效应。',
      '4. 区分团队与个人：候选人大量使用「我们」且追问后仍说不清个人动作时，相关维度最高 3 分。',
      '5. 只评作答中能观察到的内容：无法判断的维度给中性 3 分，并在 evidence 里写明「作答未涉及」。',
      '6. 公平性：不得把性别、年龄、婚育、民族、宗教、户籍、外貌、口音等与岗位胜任力无关的因素计入任何维度。',
      '7. 每个维度必须给出 1~5 之间（含 0.5 档）的分数，严禁 0 分或留空。',
      '8. 严格只输出一个 JSON 数组，不要解释、前言或 Markdown 代码块标记。',
      guideLines ? `\n评分准则（来自评分规范，必须遵守）：\n${guideLines}` : '',
      '',
      '六维评分表（含完整锚点）：',
      dimLines
    ].filter(Boolean).join('\n');

    const user = [
      `岗位背景：行业 ${ctx.industry || ''}，岗位 ${ctx.role || ''}，层级 ${ctx.level || ''}，公司档位 ${ctx.tierName || ''}。`,
      `本次面试权重（仅供理解侧重；请逐题给六维原始分，加权由系统计算）：${weightsText}。`,
      `请对以下 ${items.length} 道作答逐题评分。必须输出 JSON 数组，**数组长度必须等于题目数（共 ${items.length} 个元素）**，按题目顺序排列。`,
      `每个元素的格式（必须逐题分组，禁止把六个维度平铺）：`,
      `{"idx":0,"scores":{"${rubrics[0].name}":4.0},"evidence":[{"dim":"${rubrics[0].name}","basis":"引用候选人原话片段（可截断），或写「作答未涉及」"}],"comment":"一句话点评：最大亮点 + 最该改进的一点"}`,
      `scores 必须包含且仅包含这 ${rubrics.length} 个维度：${rubrics.map(r => '「' + r.name + '」').join('、')}。`,
      `evidence 是数组，每个元素一个维度，dim 用上面的维度名，basis 给出可核对的行为依据（引用原话，不超过 40 字）；不得编造候选人没说过的话。`,
      '',
      '题目与作答：',
      qLines
    ].join('\n');

    const out = await chat([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature: 0.1 });
    const arr = parseScoreJson(out);
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('评分结果不是有效的 JSON 数组');
    }
    return normalizeScores(arr, rubrics, items.length);
  }

  // 从模型输出中稳健提取 JSON 对象
  function parseScoreObject(text) {
    let t = (text || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('未找到 JSON 对象');
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }
  }

  // —— 综合评估：基于【已经算好的六维分 + 逐题点评】生成总评与建议 ——
  // 输入全部来自系统已算出的结果，模型只做归纳与表达，不得新增事实。
  async function summarize(payload) {
    const p = payload || {};
    const dimAvg = p.dimAvg || {};
    const names = Object.keys(dimAvg);
    if (!names.length) throw new Error('缺少维度分，无法生成综合评估');

    const dimLines = names
      .map(n => `「${n}」${Number(dimAvg[n]).toFixed(1)} 分 / 5，权重 ${Math.round((p.weights && p.weights[n] || 0) * 100)}%`)
      .join('\n');

    const qLines = (p.questions || []).map((it, i) => {
      const t = [];
      t.push(`第 ${i + 1} 题（${it.type || ''}·${it.difficulty || ''}，用时 ${it.spentSeconds != null ? it.spentSeconds + 's' : '—'}${it.overSeconds ? '（超限 ' + it.overSeconds + 's）' : ''}）`);
      t.push(`  问题：${String(it.q || '').slice(0, 60)}`);
      if (it.aiFeedback) t.push(`  逐题点评：${String(it.aiFeedback).slice(0, 80)}`);
      const dr = it.dimRaw || {};
      t.push('  该题六维：' + Object.keys(dr).map(k => k + dr[k]).join(' / '));
      return t.join('\n');
    }).join('\n');

    const system = [
      '你是一位资深面试评估专家，负责撰写候选人评估结论。',
      '写作要求：',
      '1. 只能依据下方已经给出的分数、点评与用时，不得编造任何未提供的信息（不得虚构经历、公司、项目）。',
      '2. 先给结论、再给依据；用词克制，避免空话与套话（如“表现优秀”“有待提高”必须带具体指向）。',
      '3. 不得涉及性别、年龄、婚育、民族、户籍、院校、外貌、口音等与岗位能力无关的信息。',
      '4. 不得给出录用/不录用结论，只做能力评估；结论口径由系统按分数阈值另行给出。',
      '5. 严格只输出一个 JSON 对象，不要解释、不要 Markdown 代码块。'
    ].join('\n');

    const user = [
      `岗位背景：行业 ${p.industry || ''}，岗位 ${p.role || ''}，层级 ${p.level || ''}，公司档位 ${p.tierName || ''}。`,
      `加权总分 ${Number(p.totalScore || 0).toFixed(2)} / 5；量表档位 Band ${p.band || '—'} / 9。`,
      `总用时 ${Math.round((p.timing && p.timing.totalSeconds || 0) / 60)} 分钟 / 限时 ${Math.round((p.timing && p.timing.totalLimitSeconds || 0) / 60)} 分钟，超限题目 ${(p.timing && p.timing.overtimeCount) || 0} 道。`,
      '',
      '六维得分：',
      dimLines,
      '',
      '逐题结果：',
      qLines || '（无）',
      '',
      '请输出如下 JSON 对象：',
      '{',
      '  "overall": "总评，160~220 字。第一句给整体判断（与分数一致），随后指出最突出的能力证据与最关键短板，最后一句给方向。",',
      '  "strengths": ["优势 1（≤40 字，须指明哪个维度/哪道题的具体表现）", "优势 2"],',
      '  "gaps": ["短板 1（≤40 字，须指明具体缺口）", "短板 2"],',
      '  "actions": ["改进动作 1（≤45 字，下次面试可直接执行）", "改进动作 2", "改进动作 3"]',
      '}',
      'strengths 与 gaps 各 2~3 条，actions 恰好 3 条。'
    ].join('\n');

    const out = await chat(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.3 }
    );
    const obj = parseScoreObject(out);

    const arr = v => Array.isArray(v)
      ? v.map(x => (typeof x === 'string' ? x.trim() : (x && (x.text || x.content)) || '')).filter(Boolean).slice(0, 4)
      : [];
    const overall = String(obj.overall || obj.summary || '').trim();
    if (!overall) throw new Error('综合评估缺少 overall');

    return {
      overall: overall,
      strengths: arr(obj.strengths || obj.优势),
      gaps: arr(obj.gaps || obj.短板 || obj.weaknesses),
      actions: arr(obj.actions || obj.建议 || obj.suggestions).slice(0, 3),
      source: 'llm'
    };
  }

  // 从模型输出中稳健提取 JSON 数组
  function parseScoreJson(text) {
    let t = (text || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('[');
    const end = t.lastIndexOf(']');
    if (start < 0 || end <= start) throw new Error('未找到 JSON 数组');
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch (e) {
      throw new Error('JSON 解析失败：' + e.message);
    }
  }

  // —— 评分结果归一化 ——
  function clamp05(v) { return Math.max(1, Math.min(5, Math.round(v * 2) / 2)); }

  // 把模型给的 evidence 归一化成 {维度:依据}
  // 兼容：数组 [{dim,basis}] / 干净对象 / 把多维度塞进一个值的"污染对象" / 一整段字符串
  function normalizeEvidence(ev, rubrics) {
    const names = rubrics.map(r => r.name);
    const out = {};

    function splitFlat(text) {
      const flat = String(text || '');
      names.forEach(n => {
        const start = flat.indexOf(n);
        if (start < 0) return;
        let end = flat.length;
        names.forEach(n2 => {
          if (n2 === n) return;
          const p = flat.indexOf(n2, start + n.length);
          if (p > start && p < end) end = p;
        });
        let seg = flat.slice(start + n.length, end)
          .replace(/^[\s:：'"“”‘’，,；;、]+/, '')
          .replace(/[\s'"，,；;]+$/, '')
          .trim();
        if (seg) out[n] = seg;
      });
    }

    if (Array.isArray(ev)) {
      ev.forEach(x => {
        if (!x || typeof x !== 'object') return;
        const dim = x.dim || x.name || x['维度'] || x.dimension;
        const basis = x.basis || x.evidence || x.reason || x['依据'] || x.quote || '';
        if (dim && names.indexOf(String(dim).trim()) >= 0) {
          out[String(dim).trim()] = String(basis || '').trim();
        }
      });
      return Object.keys(out).length ? out : null;
    }

    if (ev && typeof ev === 'object') {
      const keys = Object.keys(ev);
      let polluted = false;
      keys.forEach(k => {
        const v = String(ev[k] == null ? '' : ev[k]);
        const hits = names.filter(n => n !== k && v.indexOf(n) >= 0).length;
        if (hits >= 2) polluted = true;
      });
      if (polluted) {
        splitFlat(keys.map(k => k + '：' + (ev[k] == null ? '' : ev[k])).join('；'));
        return Object.keys(out).length ? out : null;
      }
      names.forEach(n => { if (ev[n] != null) out[n] = String(ev[n]).trim(); });
      return Object.keys(out).length ? out : (keys.length ? ev : null);
    }

    if (typeof ev === 'string' && ev.trim()) {
      splitFlat(ev);
      return Object.keys(out).length ? out : null;
    }
    return null;
  }

  function sanitizeRaw(pairs, rubrics) {
    const raw = {};
    rubrics.forEach(r => {
      let v = Number(pairs && pairs[r.name]);
      if (!isFinite(v) || v <= 0) v = 3;     // 1~5 分制，缺失/非法一律给中性分
      raw[r.name] = clamp05(v);
    });
    return raw;
  }

  // 把模型输出的各种形状统一成 [{raw:{六维}, comment}]
  // 兼容：{idx,scores,comment} / 扁平 {维度:分} / [{维度:"专业能力",评分:3.5}] / 单对象多维度
  function normalizeScores(arr, rubrics, count) {
    const names = rubrics.map(r => r.name);
    const NUMKEY = /分|score|rating|value|评级/i;

    function scoreFromPair(row) {
      const nameVal = Object.values(row).map(v => String(v).trim()).find(v => names.indexOf(v) >= 0);
      if (!nameVal) return null;
      let num = null;
      Object.keys(row).forEach(k => {
        if (num === null && NUMKEY.test(k) && isFinite(Number(row[k]))) num = Number(row[k]);
      });
      if (num === null) {
        for (const v of Object.values(row)) {
          if (typeof v !== 'boolean' && v !== nameVal && isFinite(Number(v))) { num = Number(v); break; }
        }
      }
      return num === null ? null : { name: nameVal, value: num };
    }

    // 收集「一组整体分」（按维度平铺 / 单对象多维度）
    function asFlatSet() {
      const pairs = {};
      let hit = 0;
      arr.forEach(row => {
        if (!row || typeof row !== 'object') return;
        if (row.scores && typeof row.scores === 'object') { Object.assign(pairs, row.scores); hit++; return; }
        const p = scoreFromPair(row);
        if (p) { pairs[p.name] = p.value; hit++; return; }
        names.forEach(n => { if (isFinite(Number(row[n]))) { pairs[n] = Number(row[n]); hit++; } });
      });
      return hit >= Math.min(3, names.length) ? pairs : null;
    }

    // A) 逐题输出：长度≈题数，且元素带 idx 或 scores
    const looksPerItem = arr.length === count && arr.some(row => row && (row.scores || isFinite(Number(row.idx))));
    if (looksPerItem) {
      const byIdx = {};
      arr.forEach((row, k) => {
        const idx = Number(row && row.idx);
        byIdx[isFinite(idx) ? idx : k] = row;
      });
      return Array.from({ length: count }, (_, i) => {
        const row = byIdx[i] || {};
        const src = (row.scores && typeof row.scores === 'object') ? row.scores : row;
        return {
          raw: sanitizeRaw(src, rubrics),
          comment: typeof row.comment === 'string' ? row.comment.trim() : '',
          evidence: normalizeEvidence(row.evidence, rubrics)
        };
      });
    }

    // B) 模型只给了一组整体分（常见于把六维平铺）→ 应用到每道题
    const flat = asFlatSet();
    if (flat) {
      const raw = sanitizeRaw(flat, rubrics);
      return Array.from({ length: count }, () => ({ raw: Object.assign({}, raw), comment: '', evidence: null }));
    }

    // C) 兜底：按顺序尽力取，缺失给中性分
    return Array.from({ length: count }, (_, i) => {
      const row = arr[i] || {};
      return {
        raw: sanitizeRaw(row.scores || row, rubrics),
        comment: typeof row.comment === 'string' ? row.comment.trim() : '',
        evidence: normalizeEvidence(row.evidence, rubrics)
      };
    });
  }

  return {
    load, save, clear, isEnabled, isScoreEnabled,
    listModels, chat, buildSystem, scoreInterview, summarize, DEFAULTS
  };
})();
