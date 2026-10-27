/* ===== 数据加载与工具函数 ===== */
window.Data = (function () {
  const C = window.SITE_CONFIG;
  let cache = null;

  const industryCache = {};   // 按行业懒加载的完整数据（含题目）

  // 轻量加载：catalog（行业/岗位/题数）+ 四个小文件，首屏约 50KB
  async function loadCatalog() {
    if (cache) return cache;
    const base = C.dataBase;
    const [catalog, tiers, scoring, tags, competency, industryMeta] = await Promise.all([
      fetch(base + 'catalog.json').then(r => r.json()),
      fetch(base + 'company_tiers.json').then(r => r.json()),
      fetch(base + 'scoring_template.json').then(r => r.json()),
      fetch(base + 'knowledge_tags.json').then(r => r.json()),
      fetch(base + 'competency_dictionary.json').then(r => r.json()),
      fetch(base + 'industry_meta.json').then(r => r.json()).catch(() => ({})),
    ]);
    cache = { catalog, tiers, scoring, tags, competency, industryMeta };
    return cache;
  }

  let motivationCache = null; // 求职动机题包（跨行业通用，独立于岗位题库）

  // 求职动机题包：标准模式每场按卷号固定插入 1 道（同卷同题，常模可比）
  async function loadMotivation() {
    if (motivationCache) return motivationCache;
    try {
      motivationCache = await fetch(C.dataBase + 'motivation_questions.json').then(r => r.json());
    } catch (e) {
      motivationCache = { questions: [] };
    }
    return motivationCache;
  }

  // 从动机题包里按（档位+卷号）固定抽 1 道，问法用该档位的变体。
  // 三卷通过「档位 hash + 卷号偏移」错开，保证 A/B/C 拿到不同的动机题。
  async function sampleMotivation(tierKey, paper) {
    const pack = await loadMotivation();
    const qs = (pack && pack.questions) || [];
    if (!qs.length) return null;
    const PAPERS = ['A', 'B', 'C'];
    const off = Math.max(0, PAPERS.indexOf(paper || 'A'));
    const idx = (hashStr(tierKey || '通用') + off) % qs.length;
    const q = Object.assign({}, qs[idx]);
    const variants = q.tier_variants || {};
    if (variants[tierKey]) q.q = variants[tierKey];
    return q;
  }

  // 按需加载某个行业的完整题目（约 110~370KB），加载后缓存
  async function loadIndustry(name) {
    await loadCatalog();
    if (industryCache[name]) return industryCache[name];
    const meta = cache.catalog.industries.find(i => i.industry === name);
    if (!meta) return null;
    const data = await fetch(C.dataBase + meta.file).then(r => r.json());
    industryCache[name] = data;
    return data;
  }

  // 同岗位常模（云库匿名聚合）：返回样本量与分位数。样本 <30 时由调用方回退量表档位。
  async function loadNorm(industryName, roleName, level, paper) {
    try {
      const cloud = (window.Cloud && window.Cloud.get) ? window.Cloud.get() : null;
      if (!cloud) return null;
      const { data, error } = await cloud.database.rpc('report_norms', {
        p_industry: industryName || '',
        p_role: roleName || '',
        p_level: level || null,
        p_paper: paper || null
      });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      const num = v => (v == null || isNaN(Number(v))) ? null : Number(v);
      return {
        n: Number(row.sample_n) || 0,
        p25: num(row.p25), p50: num(row.p50), p75: num(row.p75), p90: num(row.p90)
      };
    } catch (e) { return null; }
  }

  // —— 自创面试官：按知识点标签组卷 ——
  let tagIndexCache = null;
  async function loadTagIndex() {
    if (!tagIndexCache) {
      tagIndexCache = await fetch(C.dataBase + 'tag_index.json').then(r => r.json());
    }
    return tagIndexCache;
  }

  // 在给定标签范围内组卷：主行业优先 → 主行业其他岗位 → 其他行业（按题量补）
  // 返回 { questions, coverage:{tags, covered, missing}, pools }
  async function sampleByTags(opts) {
    opts = opts || {};
    const tags = (opts.tags || []).filter(Boolean);
    const empty = { questions: [], coverage: { tags, covered: [], missing: tags.slice() }, pools: [] };
    if (!tags.length) return empty;

    const want = Math.max(1, Math.min(20, opts.count || 6));
    const diff = (opts.difficulty && opts.difficulty !== 'mixed') ? opts.difficulty : null;
    const idx = await loadTagIndex();

    // 需要加载的行业：主行业 + 其他标签题量最高的最多 2 个
    const score = {};
    tags.forEach(t => {
      const bi = (idx.tags[t] && idx.tags[t].byIndustry) || {};
      Object.keys(bi).forEach(k => { if (k !== opts.industry) score[k] = (score[k] || 0) + bi[k]; });
    });
    const others = Object.keys(score).sort((a, b) => score[b] - score[a]).slice(0, 2);
    const wantIndustries = [opts.industry].concat(others).filter(Boolean);

    const pools = [];
    for (const name of wantIndustries) {
      try {
        const d = await loadIndustry(name);
        if (d) pools.push(d);
      } catch (e) { /* 单个行业加载失败不影响整体 */ }
    }

    // 收集候选：命中任一标签的题
    const seen = {};
    const cands = [];
    pools.forEach(pool => {
      const isMain = pool.industry === opts.industry;
      (pool.roles || []).forEach(role => {
        const isMainRole = isMain && role.role === opts.role;
        (role.questions || []).forEach(q => {
          const hit = (q.tags || []).filter(t => tags.indexOf(t) >= 0);
          if (!hit.length) return;
          if (diff && q.difficulty !== diff) return;
          const key = q.id || (q.q || '').slice(0, 40);
          if (seen[key]) return;
          seen[key] = 1;
          cands.push(Object.assign({}, q, {
            _industry: pool.industry,
            _role: role.role,
            _hitTags: hit,
            _rank: (isMainRole ? 2 : isMain ? 1 : 0)
          }));
        });
      });
    });

    if (!cands.length) return empty;

    // 先保证每个标签至少出一道，再随机补足，避免只考到一两个标签
    const picked = [];
    const taken = {};
    const take = q => {
      const key = q.id || (q.q || '').slice(0, 40);
      if (taken[key]) return false;
      taken[key] = 1; picked.push(q); return true;
    };
    const byTag = {};
    cands.forEach(q => q._hitTags.forEach(t => { (byTag[t] = byTag[t] || []).push(q); }));
    shuffle(tags.slice()).forEach(t => {
      if (picked.length >= want) return;
      const pool = (byTag[t] || []).slice().sort((a, b) => b._rank - a._rank);
      for (const q of pool) { if (take(q)) break; }
    });
    shuffle(cands.slice()).sort((a, b) => b._rank - a._rank).forEach(q => {
      if (picked.length < want) take(q);
    });

    const covered = [];
    picked.forEach(q => q._hitTags.forEach(t => { if (covered.indexOf(t) < 0) covered.push(t); }));
    const missing = tags.filter(t => covered.indexOf(t) < 0);

    return {
      questions: shuffle(picked).slice(0, want),
      coverage: { tags: tags.slice(), covered, missing },
      pools: wantIndustries
    };
  }

  // 兼容旧接口：加载全部行业（题库页/跨行业统计用）。首屏路径不再调用。
  async function loadAll() {
    await loadCatalog();
    for (const ind of cache.catalog.industries) {
      if (!industryCache[ind.industry]) await loadIndustry(ind.industry);
    }
    return cache;
  }

  // 归一化：questions.json 中同一行业名被拆成多条记录（如"实体行业"8 条、
  // "公务员/事业单位/国企"5 条、"创意/媒体/设计/文娱"6 条），这里按行业名归并，
  // 合并其下全部岗位与题目，避免首页下拉重名、且 getIndustry 丢失大量数据。
  function normalizeIndustries(rawList) {
    const map = new Map();
    for (const ind of (rawList || [])) {
      if (!map.has(ind.industry)) map.set(ind.industry, { industry: ind.industry, roles: [] });
      const target = map.get(ind.industry);
      for (const r of (ind.roles || [])) {
        const ex = target.roles.find(x => x.role === r.role);
        if (ex) {
          ex.questions = (ex.questions || []).concat(r.questions || []);
          if (r.levels) ex.levels = Array.from(new Set((ex.levels || []).concat(r.levels)));
        } else {
          target.roles.push(JSON.parse(JSON.stringify(r)));
        }
      }
    }
    return Array.from(map.values());
  }
  function normalizeQuestions(raw) {
    return { meta: raw.meta, industries: normalizeIndustries(raw.industries || []) };
  }

  // —— 检索辅助 ——
  function getIndustry(name) {
    if (industryCache[name]) return industryCache[name];   // 已加载：含题目
    const meta = cache && cache.catalog ? cache.catalog.industries.find(i => i.industry === name) : null;
    return meta ? { industry: meta.industry, roles: meta.roles || [] } : null;  // 未加载：仅元信息
  }
  function listIndustries() {
    return (cache && cache.catalog ? cache.catalog.industries : []).map(i => i.industry);
  }
  function getIndustryBlurb(name) {
    return (cache && cache.industryMeta && cache.industryMeta[name]) || '';
  }
  function listRoles(industryName) {
    const ind = getIndustry(industryName);
    return ind ? ind.roles.map(r => r.role) : [];
  }
  function listLevels(industryName, roleName) {
    const ind = getIndustry(industryName);
    const role = ind && ind.roles.find(r => r.role === roleName);
    return role ? role.levels : [];
  }
  function getRole(industryName, roleName) {
    const ind = getIndustry(industryName);
    return ind && ind.roles.find(r => r.role === roleName);
  }
  function getQuestions(industryName, roleName) {
    const role = getRole(industryName, roleName);
    // 懒加载下 catalog 的岗位只有 questionCount、没有 questions，必须兜底成空数组
    return (role && role.questions) ? role.questions : [];
  }
  // 按层级过滤（层级为"通用"或目标层级都纳入，提升可选题量）
  function getQuestionsByLevel(industryName, roleName, level) {
    const all = getQuestions(industryName, roleName);
    if (!level || level === '通用') return all;
    return all.filter(q => q.level === level || q.level === '通用');
  }

  // —— 抽题（结合 tier 题库侧重） ——
  // 可复现的伪随机（mulberry32）：同一 seed 永远得到同一套卷，这是常模可比性的基础
  function seededRandom(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let x = t;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // 轮换 3 套卷：paper 为 'A'/'B'/'C'。同岗位+层级+档位+卷号 = 固定一套题，
  // 报告记录卷号，常模按卷号分组，跨人才可比。paper 为空时退回随机（自创模式用）。
  function sampleQuestions(industryName, roleName, level, tierKey, n, paper) {
    let pool = getQuestionsByLevel(industryName, roleName, level);
    // 兜底：当前层级题量不足时，纳入同岗位其他层级，保证一场面试题量充足
    if (pool.length < n) {
      const all = getQuestions(industryName, roleName);
      const extra = all.filter(q => !pool.includes(q));
      pool = pool.concat(extra);
    }
    const tier = cache.tiers.tiers[tierKey];
    const preferred = tier ? (tier.question_bias.preferred_types || []) : [];
    let rnd;
    if (paper) {
      rnd = seededRandom(hashStr([industryName, roleName, level, tierKey, paper].join('|')));
    } else {
      rnd = Math.random;
    }
    // 层级优先级：本层级 > 通用 > 相邻层级（跨度越大越靠后）。
    // 补题时必须先紧着本层级，否则「选初级」可能抽到一堆高级题——报告就算标注也晚了。
    const LEVEL_ORDER = ['校招', '初级', '中级', '高级'];
    const base = LEVEL_ORDER.indexOf(level);
    const lvRank = q => {
      if (q.level === level) return 0;
      if (q.level === '通用' || LEVEL_ORDER.indexOf(q.level) < 0) return 1;
      return 2 + Math.abs(LEVEL_ORDER.indexOf(q.level) - base);
    };
    // 排序键：层级优先 → 档位偏好题型 → （种子）随机稳定排序
    const scored = pool.map(q => {
      const pref = preferred.includes(q.type) ? 1 : 0;
      return { q, lv: lvRank(q), pref, r: rnd() };
    });
    scored.sort((a, b) => (a.lv - b.lv) || (b.pref - a.pref) || (a.r - b.r));
    return scored.slice(0, n).map(s => s.q);
  }

  // —— 关键词命中（规则版评分核心） ——
  // 返回 {hits:[命中的关键词], miss:[未命中的关键词], rate:0~1, hitCount, total}
  function keywordHit(answerText, keywords) {
    const text = (answerText || '').toLowerCase();
    const hits = [], miss = [];
    let hitCount = 0;
    (keywords || []).forEach(kw => {
      // 关键词可能含中文，直接子串匹配（规则版基线）
      if (text.includes(kw.toLowerCase())) { hits.push(kw); hitCount++; }
      else miss.push(kw);
    });
    const total = (keywords || []).length || 1;
    return { hits, miss, hitCount, total, rate: hitCount / total };
  }

  // 洗牌
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // —— 规则版评分：把单题作答映射到 6 维度原始分（1~5） ——
  // 透明、可解释；非真实大模型评分
  function scoreQuestion(answerText, keywords, followupAnswered) {
    const kh = keywordHit(answerText, keywords);
    const len = (answerText || '').replace(/\s/g, '').length;
    // 专业深度：关键词命中率 -> 1~5
    const professional = clamp(1 + 4 * kh.rate, 1, 5);
    // 沟通表达：作答长度与结构（粗略启发）-> 1~5
    let communication = 3;
    if (len >= 120) communication = 4;
    if (len >= 260) communication = 4.5;
    if (len < 40) communication = 2;
    // 逻辑：关键词覆盖多样性（命中数/总关键词，越分散越高）
    const logic = clamp(1 + 4 * (kh.hitCount / Math.max(kh.total, 1)), 1, 5);
    // 学习潜力：是否覆盖追问（有追问作答视为更深入）
    const learning = followupAnswered ? clamp(professional - 0.3, 1, 5) : 2.5;
    // 岗位匹配：整体命中率映射
    const match = clamp(1 + 3.5 * kh.rate, 1, 5);
    // 稳定性：默认中值（规则版无法判定价值观，保守给中）
    const stability = 3;
    return {
      raw: {
        '专业能力': round1(professional),
        '沟通表达': round1(communication),
        '逻辑思维': round1(logic),
        '学习潜力': round1(learning),
        '岗位匹配': round1(match),
        '稳定性与价值观': stability
      },
      kh
    };
  }

  // 按 行业/岗位/档位 得到 6 维度权重（横向铺开后各业态用更贴切的预设）
  function dimensionWeights(industryName, roleName, tierKey) {
    const st = cache.scoring;
    let presetName = 'default';
    if (industryName === '互联网/IT') presetName = '技术专业类';
    else if (roleName) {
      if (/(销售|商务|客户|渠道|BD|经纪|理财|大客户|电话销售|置业顾问|招商)/.test(roleName)) presetName = '销售类';
      else if (/(经理|总监|主管|负责人|店长|厂长|行长|校长|院长|科长|处长|部长|总裁|合伙人|区域|城市|支行|门店)/.test(roleName)) presetName = '管理岗';
    }
    const preset = st.weight_presets[presetName] || st.weight_presets.default;
    // 体制内：稳定性与价值观高权重，且权重和严格 = 1.0
    if (tierKey === 'civserv') {
      return {
        '专业能力': 0.25, '岗位匹配': 0.15, '沟通表达': 0.10,
        '逻辑思维': 0.10, '学习潜力': 0.10, '稳定性与价值观': 0.30
      };
    }
    return preset;
  }

  function weightedTotal(dimScores, weights) {
    let sum = 0;
    for (const k in weights) sum += (dimScores[k] || 0) * weights[k];
    return round2(sum);
  }

  // 量表档位 Band 1-9：按评分量表固定阈值划分，**不是人群百分位**。
  // 真实常模需同岗位样本 n>=30 才启用；未达标时以本档位与加权总分为准。
  function stanineOf(total) {
    const f = cache.competency.norm_framework.stanine;
    if (total <= 2.0) return 1;
    if (total <= 2.5) return 2;
    if (total <= 3.0) return 3;
    if (total <= 3.4) return 4;
    if (total <= 3.8) return 5;
    if (total <= 4.1) return 6;
    if (total <= 4.4) return 7;
    if (total <= 4.7) return 8;
    return 9;
  }

  // 决策（来自 scoring_template.decision_rules）
  function verdict(total) {
    const r = cache.scoring.decision_rules;
    if (total >= 4.0) return { id: 'hire', label: '建议录用', cls: 'hire' };
    if (total >= 3.0) return { id: 'pending', label: '待定（建议加面/复核）', cls: 'pending' };
    return { id: 'reject', label: '不通过', cls: 'reject' };
  }

  // 返回评分模板（含六维定义），供 LLM 语义评分构建 rubric
  function getScoring() {
    return cache ? cache.scoring : null;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function round2(v) { return Math.round(v * 100) / 100; }

  // 行业覆盖统计（供首页"覆盖各行各业"展示）
  function industryStats(industryName) {
    // 优先用 catalog 的预统计（首页无需加载题目正文）
    const meta = cache && cache.catalog ? cache.catalog.industries.find(i => i.industry === industryName) : null;
    if (meta) return { roles: (meta.roles || []).length, questions: meta.questionCount || 0 };
    const ind = industryCache[industryName];
    if (!ind) return { roles: 0, questions: 0 };
    let q = 0;
    (ind.roles || []).forEach(r => { q += (r.questions || []).length; });
    return { roles: (ind.roles || []).length, questions: q };
  }
  function globalStats() {
    if (cache && cache.catalog && cache.catalog.meta) {
      const m = cache.catalog.meta;
      return { industries: m.industries || 0, roles: m.roles || 0, questions: m.questions || 0 };
    }
    let roles = 0, questions = 0;
    listIndustries().forEach(n => {
      const s = industryStats(n);
      roles += s.roles; questions += s.questions;
    });
    return { industries: listIndustries().length, roles, questions };
  }

  return {
    loadAll, loadCatalog, loadIndustry, loadNorm, loadTagIndex, sampleByTags, loadMotivation, sampleMotivation,
    getIndustry, listIndustries, getIndustryBlurb, listRoles, listLevels,
    getRole, getQuestions, getQuestionsByLevel, sampleQuestions,
    keywordHit, scoreQuestion, dimensionWeights, weightedTotal,
    stanineOf, verdict, shuffle, clamp, round1, round2,
    getScoring,
    industryStats, globalStats
  };
})();
