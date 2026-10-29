/* ===== 简历 × 岗位 匹配引擎（双引擎：云端 LLM 优先，本地规则兜底） =====
 * 设计原则：
 *   1. 两条引擎返回**同一个结构**，上层 gate 不关心是谁算的；
 *   2. 无 AI（未开启 / 云端不可用 / 限流）时必须仍能给出判定，不能让流程卡死；
 *   3. 只输出判定所需的最小信息，简历正文本身不落库、不写埋点。
 *
 * 返回结构：
 *   { score:0-100, pass:boolean, hits:[], gaps:[], probe_points:[],
 *     verdict:string, engine:'llm'|'rule', fallbackReason?:string, invalid?:boolean }
 */
window.ResumeMatcher = (function () {
  const PASS_SCORE = Number((window.SITE_CONFIG && window.SITE_CONFIG.RESUME_PASS_SCORE) || 40);
  const MAX_RESUME = 8000;      // 传给模型的简历上限，防超长拖垮上下文
  const MIN_RESUME = 30;        // 少于该字数视为无效

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function uniq(arr) {
    const seen = Object.create(null);
    const out = [];
    (arr || []).forEach(x => {
      const s = String(x == null ? '' : x).trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (seen[k]) return;
      seen[k] = 1; out.push(s);
    });
    return out;
  }

  // 从岗位数据抽取「岗位要求画像」：rubric 能力维度 + 题目标签 / 关键词 + 别名
  function buildRoleProfile(roleData) {
    const rd = roleData || {};
    const dims = ((rd.rubric && rd.rubric.dimensions) || []).map(d => ({
      name: String(d.name || '').trim(),
      weight: Number(d.weight) || 0,
      focus: String(d.focus || d.excellent || d.good || '').trim()
    })).filter(d => d.name);

    const keywords = [];
    const tags = [];
    (rd.questions || []).forEach(q => {
      (q.keywords || []).forEach(k => keywords.push(k));
      (q.tags || []).forEach(t => tags.push(t));
    });
    (rd.aliases || []).forEach(a => keywords.push(a));

    return {
      dims,
      keywords: uniq(keywords),
      tags: uniq(tags),
      aliases: uniq(rd.aliases || []),
      roleName: String(rd.role || '').trim()
    };
  }

  function profileText(p) {
    if (!p.dims.length) return '';
    const lines = ['岗位核心能力维度（来自该岗位评分表，权重即重要程度）：'];
    p.dims.forEach(d => {
      const w = d.weight ? '（权重 ' + Math.round(d.weight * 100) + '%）' : '';
      // 只截取前 70 字，控制 prompt 长度；focus 取自 rubric 的 excellent/good 描述
      const f = d.focus ? '：' + d.focus.slice(0, 70) : '';
      lines.push('- ' + d.name + w + f);
    });
    return lines.join('\n');
  }

  // ---- 规则兜底：宽松放行，只做正相关加分 ----
  // 题库 tags 是全局词典硬打上去的（每个岗位都混入房地产/建筑工程等无关词），
  // 因此不能拿它做「不匹配就拦」的判据——误杀真人比放过一个更糟。
  // 规则引擎只负责：命中了就加分、给出方向性提示；一律放行，不阻断流程。
  function ruleCheck(resumeText, profile, ctx) {
    const low = String(resumeText || '').toLowerCase();

    const vocab = uniq([].concat(profile.tags, profile.keywords))
      .filter(w => w.length >= 2 && w.length <= 12);
    const hit = vocab.filter(w => low.indexOf(w.toLowerCase()) >= 0);

    const roleTerms = uniq([profile.roleName].concat(profile.aliases || []));
    const roleHit = roleTerms.some(t => t && t.length >= 2 && low.indexOf(t.toLowerCase()) >= 0);

    let score = 50 + Math.min(30, hit.length * 3) + (roleHit ? 8 : 0);
    score = clamp(score, 0, 100);

    return {
      score,
      pass: true,                 // 兜底不拦截
      lenient: true,
      hits: hit.slice(0, 8),
      gaps: [],                   // 信息不可靠，不编造缺口
      probe_points: [],
      verdict: '当前未启用云端 AI，本次只做了基础匹配：方向大体可用，已放行。想要严格的匹配判定与简历深挖点，请在设置里开启 AI。',
      engine: 'rule'
    };
  }

  // ---- LLM 匹配 ----
  async function llmCheck(resumeText, profile, ctx) {
    const system = [
      '你是一位严谨、克制的招聘筛选专家，负责判断候选人简历与目标岗位的匹配程度。',
      '判定纪律（必须遵守）：',
      '1. 只看简历中能观察到的内容，不得因院校、性别、年龄、婚育、民族、宗教、户籍、外貌、口音等与岗位能力无关的因素加减分。',
      '2. 匹配度综合三方面：岗位方向一致性、核心能力/技术栈覆盖度、经验层级是否相当。',
      '3. 不因简历文笔、排版、格式规范扣分；简历写得朴素但经历对口，应判为匹配。',
      '4. 允许跨行业转岗：可迁移能力清晰时，不因行业名称不同判低分。',
      '5. 拿不准时倾向“可面试”，宁放过不错杀——这是练习工具，不是真实招聘。',
      '6. 严格只输出一个 JSON 对象，不要解释、不要前言、不要 Markdown 代码块标记。'
    ].join('\n');

    const user = [
      '目标岗位：',
      '行业「' + ctx.industry + '」，岗位「' + ctx.role + '」，层级「' + ctx.level + '」。',
      '',
      '岗位要求（该岗位的能力模型与评分维度）：',
      profileText(profile) || '（该岗位缺少结构化能力模型，请按岗位名称与层级常识判断）',
      '',
      '候选人简历：',
      String(resumeText || '').slice(0, MAX_RESUME),
      '',
      '请严格输出如下 JSON：',
      '{',
      '  "score": 0 到 100 的整数（匹配度，50 表示大致对口）;',
      '  "verdict": "一句话判断，35 字以内，给候选人看，语气客观";',
      '  "hits": ["简历中能对应岗位要求的点，最多 5 条，每条≤20字"];',
      '  "gaps": ["简历相对岗位要求的缺口，最多 5 条，每条≤20字"];',
      '  "probe_points": ["简历里值得在面试中深挖的具体点（项目、技术、职责、结果），最多 5 条，每条≤20字"]',
      '}'
    ].join('\n');

    const out = await window.LLM.chat(
      [{ role: 'system', content: system }, { role: 'user', content: user }],
      { temperature: 0.2 }
    );

    const obj = parseJsonObject(out);
    if (!obj) throw new Error('匹配结果不是合法 JSON');

    const score = clamp(Math.round(Number(obj.score) || 0), 0, 100);
    const arr = v => (Array.isArray(v) ? uniq(v.map(x => String(x).trim())).slice(0, 6) : []);
    const pass = score >= PASS_SCORE;

    return {
      score,
      pass,
      hits: arr(obj.hits),
      gaps: arr(obj.gaps),
      probe_points: arr(obj.probe_points || obj.probes || obj.probePoints),
      verdict: String(obj.verdict || '').trim() || (pass ? '简历与岗位基本匹配。' : '简历与岗位匹配度偏低。'),
      engine: 'llm'
    };
  }

  function parseJsonObject(text) {
    let t = String(text || '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const s = t.indexOf('{'), e = t.lastIndexOf('}');
    if (s < 0 || e <= s) return null;
    try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { return null; }
  }

  function canUseLLM() {
    if (typeof window.LLM === 'undefined') return false;
    if (!(window.Cloud && typeof window.Cloud.ready === 'function' && window.Cloud.ready())) return false;
    // 用户显式关闭了 AI（对话与语义评分都关）时，不再调用模型
    return !!(window.LLM.isEnabled() || window.LLM.isScoreEnabled());
  }

  // 对外主入口
  async function check(resumeText, ctx) {
    const text = String(resumeText || '').trim();

    if (text.length < MIN_RESUME) {
      return {
        score: 0, pass: false, hits: [], gaps: [], probe_points: [],
        verdict: '简历内容太短，无法判断匹配度。请补充教育、工作与项目经历后重试。',
        engine: 'invalid', invalid: true
      };
    }

    const profile = buildRoleProfile(ctx && ctx.roleData);

    if (canUseLLM()) {
      try {
        return await llmCheck(text, profile, ctx || {});
      } catch (e) {
        const r = ruleCheck(text, profile, ctx);
        r.fallbackReason = 'AI 暂不可用（' + (e && e.message ? e.message : '调用失败') + '），已改用基础匹配';
        return r;
      }
    }

    const r = ruleCheck(text, profile, ctx);
    r.fallbackReason = '未启用云端 AI 匹配，已使用本地基础匹配（准度有限，仅供参考）';
    return r;
  }

  return { check, buildRoleProfile, PASS_SCORE, MIN_RESUME, MAX_RESUME };
})();
