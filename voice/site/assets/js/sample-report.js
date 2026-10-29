/* ===== A3 报告样例预览：首屏放一张脱敏真实报告缩略图，点开看完整样例 =====
 * 目标：让首访用户一眼看懂「面完能得到什么」，降低首访门槛、提升转化。
 * 设计：内置一份脱敏样例数据（不含任何真实用户作答），首屏渲染缩略卡，
 *       点击弹灯箱看完整样例。纯前端、无依赖、可离线、移动端可用。
 */
(function () {
  'use strict';

  // —— 脱敏样例报告（非真实用户数据，仅用于展示报告长什么样）——
  var SAMPLE_REPORT = {
    sample: true,
    role: '后端工程师', level: '校招', industry: '互联网/IT', tierName: '大厂',
    timeSeconds: 312, totalScore: 3.6, stanine: 6,
    verdict: { label: '待定', cls: 'pending' },
    weights: { 专业能力: 0.3, 岗位匹配: 0.2, 沟通表达: 0.2, 逻辑思维: 0.15, 学习潜力: 0.1, 稳定性与价值观: 0.05 },
    dimAvg: { 专业能力: 3.8, 岗位匹配: 3.3, 沟通表达: 3.1, 逻辑思维: 3.9, 学习潜力: 3.4, 稳定性与价值观: 3.5 },
    questions: [
      { type: '专业知识', q: '讲讲你做过的并发场景，怎么保证线程安全？', hits: ['锁粒度', '原子类', '无锁队列'], miss: ['伪共享'], hitRate: 0.75,
        aiFeedback: '答到了锁与原子类，但没提伪共享与缓存行对齐；整体合格，建议补一句性能边界。' },
      { type: '项目经历', q: '介绍一个你主导的项目，最大的技术挑战是什么？', hits: ['问题拆解', '量化结果'], miss: ['踩坑复盘'], hitRate: 0.8,
        aiFeedback: '用「问题-动作-结果」讲清楚了，有量化；可加一段踩坑后的复盘，更有说服力。' },
      { type: '行为面试', q: '和同事出现技术分歧，你怎么解决？', hits: ['数据验证', '小步试错'], miss: ['向上同步'], hitRate: 0.67,
        aiFeedback: '「用数据说话」的思路很好；重大事项建议补一句及时同步 leader，避免信息差。' }
    ],
    evaluation: {
      overall: '基础扎实，分布式与并发有真实经验；表达可更结构化，稳定性叙事偏弱。',
      strengths: ['逻辑思维清晰', '专业能力扎实'],
      gaps: ['沟通表达偏口语化', '稳定性叙事偏弱']
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function dimCls(v) { return v >= 4 ? 'good' : (v >= 3 ? 'weak' : 'reject'); }
  function pct(v) { return Math.max(0, Math.min(100, Math.round((Number(v) || 0) / 5 * 100))); }

  function dimRows(R) {
    var dims = R.dimAvg || {};
    return Object.keys(dims).map(function (k) {
      var v = Number(dims[k]) || 0;
      return '<div class="sr-dimrow"><span class="dn">' + esc(k) + '</span>' +
        '<div class="dim-track"><div class="dim-fill ' + dimCls(v) + '" style="width:' + pct(v) + '%"></div></div>' +
        '<span class="dim-val">' + v.toFixed(1) + '</span></div>';
    }).join('');
  }

  function miniBars(R) {
    var dims = R.dimAvg || {};
    return Object.keys(dims).map(function (k) {
      var v = Number(dims[k]) || 0;
      return '<div class="sample-mini"><div class="sm-top"><span>' + esc(k) + '</span><b>' + v.toFixed(1) + '</b></div>' +
        '<div class="sm-track"><div class="sm-fill ' + dimCls(v) + '" style="width:' + pct(v) + '%"></div></div></div>';
    }).join('');
  }

  function bestWorst(R) {
    var dims = R.dimAvg || {};
    var entries = Object.keys(dims).map(function (k) { return { k: k, v: Number(dims[k]) || 0 }; });
    if (!entries.length) return '';
    entries.sort(function (a, b) { return b.v - a.v; });
    var best = entries[0], worst = entries[entries.length - 1];
    return '<div class="sr-bw"><span class="bw-best">最稳 · ' + esc(best.k) + '</span>' +
      '<span class="bw-worst">最该补 · ' + esc(worst.k) + '</span></div>';
  }

  function renderTeaser(mount) {
    var R = SAMPLE_REPORT;
    mount.innerHTML =
      '<div class="sample-teaser-inner">' +
        '<div class="sample-kicker">面完你能拿到这样一份报告</div>' +
        '<div class="sample-card">' +
          '<div class="sample-top">' +
            '<span class="sample-tag">样例 · 脱敏</span>' +
            '<span class="sample-role">' + esc(R.industry) + ' · ' + esc(R.role) + ' · ' + esc(R.level) + '</span>' +
          '</div>' +
          '<div class="sample-main">' +
            '<div class="sample-score">' + R.totalScore.toFixed(1) + '<span>/5</span></div>' +
            '<div class="sample-meta">' +
              '<span class="verdict ' + esc(R.verdict.cls) + '">' + esc(R.verdict.label) + '</span>' +
              '<div class="sample-sub">综合分 · 同岗位约前 40%（示例）</div>' +
            '</div>' +
          '</div>' +
          '<div class="sample-bars">' + miniBars(R) + '</div>' +
          '<button class="sample-open" id="sample-open" type="button">查看完整样例报告 →</button>' +
        '</div>' +
      '</div>';
    var btn = document.getElementById('sample-open');
    if (btn) btn.onclick = function () { openModal(); };
  }

  function openModal() {
    if (window.Analytics) { try { window.Analytics.track('sample_open', {}); } catch (e) {} }
    var R = SAMPLE_REPORT;
    var overlay = document.createElement('div');
    overlay.className = 'sr-overlay';
    overlay.innerHTML =
      '<div class="sr-panel" role="dialog" aria-modal="true">' +
        '<div class="sr-head"><b>样例报告（脱敏）</b>' +
          '<button class="sr-x" type="button" aria-label="关闭">×</button></div>' +
        '<div class="sr-note">以下为示例数据，仅用于展示报告长什么样；开始你的面试会生成一份专属报告，含你的真实作答与点评。</div>' +
        '<div class="sr-hero">' +
          '<div class="sr-score">' + R.totalScore.toFixed(1) + '<span>/5</span></div>' +
          '<div class="sr-herometa"><span class="verdict ' + esc(R.verdict.cls) + '">' + esc(R.verdict.label) + '</span>' +
            '<div class="sr-sub">综合面试分 · 满分 5</div></div>' +
        '</div>' +
        '<div class="sr-chips"><span class="sr-chip">' + esc(R.industry) + '</span>' +
          '<span class="sr-chip">' + esc(R.role) + '</span>' +
          '<span class="sr-chip">' + esc(R.level) + '</span>' +
          '<span class="sr-chip">' + esc(R.tierName) + '档</span></div>' +
        '<div class="sr-sec-title">六维评分</div>' +
        dimRows(R) +
        bestWorst(R) +
        '<div class="sr-sec-title">逐题反馈</div>' +
        R.questions.map(function (it) {
          return '<div class="sr-qcard">' +
            '<div class="sr-qtop"><span class="sr-qtype">' + esc(it.type) + '</span></div>' +
            '<div class="sr-q">' + esc(it.q) + '</div>' +
            '<div class="sr-hits">命中：<b>' + (it.hits || []).map(esc).join('、') + '</b>' +
              (it.miss && it.miss.length ? '　未命中：<span class="sr-miss">' + it.miss.map(esc).join('、') + '</span>' : '') + '</div>' +
            (it.aiFeedback ? '<div class="sr-fb"><b>AI 点评：</b>' + esc(it.aiFeedback) + '</div>' : '') +
          '</div>';
        }).join('') +
        '<div class="sr-sec-title">综合建议</div>' +
        '<div class="sr-overall">' + esc(R.evaluation.overall) + '</div>' +
        '<div class="eval-col-wrap">' +
          '<div class="eval-col"><div class="eval-label good">站得住</div><ul>' +
            (R.evaluation.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="eval-col"><div class="eval-label">最该补</div><ul>' +
            (R.evaluation.gaps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' +
        '</div>' +
        '<div class="sr-cta">' +
          '<a class="sr-btn primary" href="index.html?len=3">开始我的面试，生成专属报告 →</a>' +
          '<button class="sr-btn ghost" type="button" id="sr-close2">关闭</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.sr-x').onclick = close;
    var c2 = overlay.querySelector('#sr-close2'); if (c2) c2.onclick = close;
    document.addEventListener('keydown', onKey);
  }

  // 自初始化：脚本位于 body 末尾，DOM 已就绪
  var mount = document.getElementById('sample-teaser');
  if (mount) renderTeaser(mount);
})();
