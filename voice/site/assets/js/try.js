/* 先试一题：不用选岗的 30 秒体验
 * 单题作答 → AI 六维语义评分 → 即时点评 + 追问 + 答题要点
 * 隐私：答案不落任何存储，不写报告、不进埋点正文，刷新即清。
 * 频控：每个会话最多 3 次（避免被刷额度），超过后引导去正式面试。
 */
(function () {
  const MAX_TRIES = 3;
  const STORE_N = 'wb_try_n';     // 本会话已试次数
  const STORE_LAST = 'wb_try_last'; // 上一题 id（换一题时避免重复）

  const $q = document.getElementById('try-q');
  const $type = document.getElementById('try-type');
  const $count = document.getElementById('try-count');
  const $answer = document.getElementById('try-answer');
  const $len = document.getElementById('try-len');
  const $msg = document.getElementById('try-msg');
  const $go = document.getElementById('try-go');
  const $quota = document.getElementById('try-quota');
  const $result = document.getElementById('try-result');
  const $cta = document.getElementById('try-cta');
  const $swap = document.getElementById('try-swap');
  const $again = document.getElementById('try-again');

  let list = [];
  let cur = null;
  let busy = false;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const track = (n, p) => { if (window.Analytics) window.Analytics.track(n, p || {}); };

  function triesUsed() {
    try { return parseInt(sessionStorage.getItem(STORE_N) || '0', 10) || 0; } catch (e) { return 0; }
  }
  function bumpTries() {
    try { sessionStorage.setItem(STORE_N, String(triesUsed() + 1)); } catch (e) { /* ignore */ }
  }
  function paintQuota() {
    const used = triesUsed();
    if (used >= MAX_TRIES) {
      $quota.textContent = '体验次数已用完（' + MAX_TRIES + ' 次）。正式面试可以继续练，还能保存报告。';
    } else {
      $quota.textContent = '本次会话还可以试 ' + (MAX_TRIES - used) + ' 次。';
    }
  }

  function setMsg(t, kind) {
    $msg.textContent = t || '';
    $msg.className = 'try-msg' + (kind ? ' ' + kind : '');
  }

  function pick(avoidId) {
    const pool = list.filter(x => x.id !== avoidId);
    const arr = pool.length ? pool : list;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function render() {
    $type.textContent = cur.type;
    $q.textContent = cur.q;
    const idx = list.indexOf(cur) + 1;
    $count.textContent = '第 ' + idx + ' / ' + list.length + ' 题';
    try { sessionStorage.setItem(STORE_LAST, cur.id); } catch (e) { /* ignore */ }
  }

  function resetView() {
    $answer.value = '';
    $len.textContent = '0 字';
    setMsg('');
    $result.style.display = 'none';
    $result.innerHTML = '';
    $go.disabled = false;
    $go.textContent = '让 AI 评一评 →';
    render();
  }

  function nextQuestion() {
    let lastName = '';
    try { lastName = sessionStorage.getItem(STORE_LAST) || ''; } catch (e) { /* ignore */ }
    cur = pick(lastName);
    resetView();
    $answer.focus();
  }

  // —— 规则兜底：AI 不可用时只做要点覆盖，不给分数，避免误导 ——
  function ruleFallback() {
    const text = $answer.value.toLowerCase();
    const hit = (cur.keywords || []).filter(k => text.indexOf(String(k).toLowerCase()) >= 0);
    const miss = (cur.keywords || []).filter(k => hit.indexOf(k) < 0);
    const html = [
      '<div class="card-title"><span class="ic"></span>AI 评分暂时不可用</div>',
      '<p class="page-sub">没能连上语义评分服务，所以这次不给分数——凭空报个分只会误导你。可以稍后重试，或先看这题的要点。</p>',
      '<p style="font-size:13.5px;margin:12px 0 6px;"><b>你已覆盖的要点</b>（' + hit.length + '/' + (cur.keywords || []).length + '）：' +
        (hit.length ? hit.map(esc).join('、') : '<span style="color:#c0392b;">一个都没提到</span>') + '</p>',
      miss.length ? '<p style="font-size:13.5px;margin:0 0 6px;"><b>还没提到的</b>：' + miss.map(esc).join('、') + '</p>' : '',
      '<div class="try-comment"><b>这题在考什么：</b>' + esc(cur.intent) + '</div>',
      '<p style="font-size:13.5px;"><b>答题要点：</b>' + esc(cur.tip) + '</p>',
      '<p style="font-size:13.5px;"><b>真实面试里会接着追问：</b>' + esc(cur.followup) + '</p>'
    ].join('');
    $result.innerHTML = html;
    $result.style.display = 'block';
    $cta.style.display = 'block';
  }

  function scoreLabel(v) {
    if (v >= 4.2) return '优秀';
    if (v >= 3.5) return '良好';
    if (v >= 2.8) return '中等';
    return '待提升';
  }

  function renderAI(sc, dims) {
    const raw = sc.raw || {};
    const names = Object.keys(raw);
    // 强项 / 弱项（按分排序，取 2 / 1 个）
    const sorted = names.slice().sort((a, b) => (raw[b] || 0) - (raw[a] || 0));
    const strong = sorted.slice(0, 2).filter(n => (raw[n] || 0) >= 3);
    const weak = sorted.slice(-1);
    // evidence 已由 llm.js 归一化成 { 维度名: 依据 }
    const evid = (sc.evidence && typeof sc.evidence === 'object') ? sc.evidence : {};
    const weakBasis = weak[0] ? (evid[weak[0]] || '') : '';

    const D = window.Data;
    const total = D && D.weightedTotal ? D.weightedTotal(raw, dims) : (names.reduce((a, b) => a + (raw[b] || 0), 0) / (names.length || 1));

    // 只有强弱差距明显时才点名短板；六项都差不多时说「均衡」，别硬凑一个缺点
    const topScore = sorted.length ? (raw[sorted[0]] || 0) : 0;
    const weakScore = weak[0] ? (raw[weak[0]] || 0) : 0;
    const hasGap = topScore - weakScore >= 0.5;

    const bars = names.map(n =>
      '<div class="try-dim"><b>' + esc(n) + '</b> ' + Number(raw[n] || 0).toFixed(1) +
      '<div class="try-bar"><i style="width:' + Math.max(4, Math.min(100, (raw[n] || 0) / 5 * 100)) + '%"></i></div></div>'
    ).join('');

    const html = [
      '<div style="display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;">',
      '<div class="try-score">' + total.toFixed(1) + ' <em>/ 5</em></div>',
      '<div style="font-size:15px;font-weight:700;color:var(--wb-text);">' + scoreLabel(total) + '</div>',
      '<div class="try-meta">单题评分 · 由 AI 依据六维评分表给出</div>',
      '</div>',
      sc.comment ? '<div class="try-comment">' + esc(sc.comment) + '</div>' : '',
      '<div style="font-size:12.5px;color:var(--wb-muted);margin-bottom:6px;">六维原始分</div>',
      '<div class="try-dims">' + bars + '</div>',
      strong.length ? '<p style="font-size:13.5px;margin:14px 0 4px;"><b>站得住的地方</b>：' + strong.map(n => esc(n) + '（' + Number(raw[n]).toFixed(1) + '）').join('、') + '</p>' : '',
      hasGap && weak[0]
        ? '<p style="font-size:13.5px;margin:0 0 4px;"><b>最该补的一维</b>：' + esc(weak[0]) + '（' + weakScore.toFixed(1) + '）' +
          (weakBasis ? '——' + esc(weakBasis) : '') + '</p>'
        : '<p style="font-size:13.5px;margin:0 0 4px;"><b>六维比较均衡</b>：没有明显短板，提升空间在把每一点的证据讲得更具体。</p>',
      '<p style="font-size:13.5px;margin:10px 0 4px;"><b>答题要点：</b>' + esc(cur.tip) + '</p>',
      '<p style="font-size:13.5px;margin:0;"><b>真实面试里会接着追问：</b>' + esc(cur.followup) + '</p>'
    ].filter(Boolean).join('');

    $result.innerHTML = html;
    $result.style.display = 'block';
    $cta.style.display = 'block';
  }

  async function submit() {
    if (busy) return;
    if (triesUsed() >= MAX_TRIES) {
      setMsg('本次会话的体验次数已用完，正式面试可以继续练。', 'err');
      $cta.style.display = 'block';
      return;
    }
    const text = $answer.value.trim();
    if (text.length < 20) {
      setMsg('再多写一点：至少 20 字，AI 才有东西可评。', 'err');
      $answer.focus();
      return;
    }

    busy = true;
    $go.disabled = true;
    const t0 = Date.now();
    const useAI = (typeof window.LLM !== 'undefined') && window.LLM.isScoreEnabled();
    if (useAI) {
      $go.textContent = 'AI 正在读你的回答…';
      setMsg('大约 15 秒，别关页面。');
    } else {
      setMsg('AI 评分未开启，先看要点覆盖。');
    }

    try {
      if (!useAI) { ruleFallback(); bumpTries(); paintQuota(); return; }

      const st = (window.Data && window.Data.getScoring && window.Data.getScoring()) || {};
      const dims = (st.dimensions || []).map(d => ({ name: d.name, focus: d.observation_focus, levels: d.levels || {} }));
      if (!dims.length) throw new Error('评分维度未加载');
      const weights = window.Data.dimensionWeights('', '', 'bigtech');

      const res = await window.LLM.scoreInterview([{
        q: cur.q, type: cur.type, intent: cur.intent, keywords: cur.keywords, answer: text
      }], {
        industry: '通用', role: '通用岗位', level: '不限', tierName: '通用档位',
        weights, rubrics: dims, guidelines: st.scoring_guidelines || []
      });

      const sc = (res && res[0]) || null;
      if (!sc) throw new Error('评分结果为空');
      renderAI(sc, weights);
      bumpTries();
      paintQuota();
      track('try_score', { ok: true, ms: Date.now() - t0, qid: cur.id });
    } catch (e) {
      console.warn('试做评分失败，降级为要点覆盖：', e);
      setMsg('AI 评分没成功（' + (e && e.message ? String(e.message).slice(0, 40) : '未知原因') + '），先看要点覆盖。', 'err');
      ruleFallback();
      bumpTries();
      paintQuota();
      track('try_score', { ok: false, ms: Date.now() - t0, qid: cur.id });
    } finally {
      busy = false;
      $go.disabled = false;
      $go.textContent = '再评一次 →';
    }
  }

  async function init() {
    try {
      const res = await fetch('data/try_questions.json', { cache: 'no-cache' });
      list = (await res.json()).questions || [];
    } catch (e) { list = []; }
    if (!list.length) {
      $q.textContent = '题目加载失败，请刷新重试。';
      $go.disabled = true;
      return;
    }
    // 数据/评分表是单题评分需要的（维度锚点）
    try { if (window.Data && window.Data.loadCatalog) await window.Data.loadCatalog(); } catch (e) { /* 评分时再兜底 */ }

    let lastName = '';
    try { lastName = sessionStorage.getItem(STORE_LAST) || ''; } catch (e) { /* ignore */ }
    cur = pick(lastName);
    render();
    paintQuota();
    track('try_view', {});
  }

  $go.addEventListener('click', submit);
  $swap.addEventListener('click', () => { if (!busy) nextQuestion(); });
  if ($again) $again.addEventListener('click', () => {
    if (triesUsed() >= MAX_TRIES) {
      setMsg('体验次数已用完，去正式面试继续练吧。', 'err');
      return;
    }
    nextQuestion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $answer.addEventListener('input', () => { $len.textContent = $answer.value.length + ' 字'; });

  init();
})();
