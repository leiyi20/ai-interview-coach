/* ===== 内容纠错通道（面试者 → 题库） =====
 *
 * 定位：不是「意见反馈箱」，而是**可核对的内容校准**。
 * 因此每条反馈必须绑定具体对象（题目 id / 维度 / 档位），否则无法处理。
 *
 * 设计约束：
 * 1. 结构化优先：先选问题类型，再写说明，避免收到无法落地的空泛评论。
 * 2. 只收「考点、考察角度、追问方向」，**不收真实公司原题原文**（保密与版权风险）。
 * 3. 不自动改题库：反馈只进云表，经人工审核后才写回题目数据。
 * 4. 匿名可提交；任何人都读不到别人的反馈（RLS 限制为仅本人可读自己的）。
 */
window.Feedback = (function () {
  const STORE_KEY = 'wb_feedback_sent';   // 本地去重：同一对象 7 天内不重复提示
  const NOTE_MAX = 300;
  const ISSUES = [
    { v: 'keyword', t: '关键词 / 评分要点缺失或标错' },
    { v: 'difficulty', t: '难度定得不准' },
    { v: 'intent', t: '考察意图写得不对' },
    { v: 'outdated', t: '这题已经过时了' },
    { v: 'followup', t: '追问不成立 / 追错了方向' },
    { v: 'notReal', t: '真实面试不会这么问' },
    { v: 'other', t: '其他问题' }
  ];

  function sent() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; }
  }
  function markSent(key) {
    try {
      const s = sent();
      s[key] = Date.now();
      // 只保留 90 天内的记录，避免无限增长
      const cut = Date.now() - 90 * 86400000;
      Object.keys(s).forEach(k => { if (s[k] < cut) delete s[k]; });
      localStorage.setItem(STORE_KEY, JSON.stringify(s));
    } catch (e) { /* ignore */ }
  }
  function wasSent(key) {
    const s = sent();
    return !!(s[key] && Date.now() - s[key] < 7 * 86400000);
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // 给页面用的小按钮（就地纠错）
  function btnHtml(ctx) {
    const k = ctx && ctx.questionId ? ctx.questionId : ((ctx && ctx.q) || '');
    const json = escapeHtml(JSON.stringify(ctx || {}));
    return `<button class="fb-btn" data-fb="${json}" data-fbkey="${escapeHtml(String(k))}" title="指出这道题的问题">这题有问题</button>`;
  }

  function close() {
    const m = document.getElementById('fb-modal');
    if (m) m.remove();
  }

  function open(ctx) {
    ctx = ctx || {};
    close();
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = 'fb-modal';
    const target = [ctx.industry, ctx.roleName, ctx.qtype, ctx.difficulty].filter(Boolean).join(' · ');
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">指出这道题的问题
          <button class="modal-x" id="fb-x" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          ${target ? `<div class="fb-target">${escapeHtml(target)}</div>` : ''}
          <div class="fb-field">
            <div class="fb-label">问题类型 <span class="fb-req">必选</span></div>
            <select id="fb-issue">
              <option value="">请选择…</option>
              ${ISSUES.map(i => `<option value="${i.v}">${i.t}</option>`).join('')}
            </select>
          </div>
          <div class="fb-field">
            <div class="fb-label">具体哪里不对 <span class="fb-req">必填</span></div>
            <textarea id="fb-note" rows="3" maxlength="${NOTE_MAX}" placeholder="例：这题实际考的是幂等设计，但评分要点里一个幂等相关的都没有。"></textarea>
            <div class="fb-count"><span id="fb-n">0</span>/${NOTE_MAX}</div>
          </div>
          <div class="fb-field">
            <div class="fb-label">建议改成（选填）</div>
            <textarea id="fb-sug" rows="2" maxlength="200" placeholder="例：应该追问「重复提交怎么处理」，关键词补「幂等」「去重表」「Token」"></textarea>
          </div>
          <div class="fb-redline">
            只写考点、考察角度与追问方向，<b>请勿粘贴真实公司的原题原文</b>（涉及保密与版权）。
          </div>
          <div class="fb-actions">
            <button class="btn" id="fb-cancel">取消</button>
            <button class="btn btn-primary" id="fb-send">提交</button>
          </div>
          <div class="fb-msg" id="fb-msg"></div>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const $ = id => document.getElementById(id);
    const note = $('fb-note');
    note.addEventListener('input', () => { $('fb-n').textContent = note.value.length; });
    $('fb-x').onclick = close;
    $('fb-cancel').onclick = close;
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    note.focus();

    $('fb-send').onclick = async () => {
      const issue = $('fb-issue').value;
      const text = (note.value || '').trim();
      const msg = $('fb-msg');
      if (!issue) { msg.className = 'fb-msg err'; msg.textContent = '请先选择问题类型。'; return; }
      if (text.length < 5) { msg.className = 'fb-msg err'; msg.textContent = '请至少写清楚哪里不对（不少于 5 个字）。'; return; }
      const payload = {
        kind: 'question',
        question_id: ctx.questionId || null,
        industry: ctx.industry || null,
        role_name: ctx.roleName || null,
        qtype: ctx.qtype || null,
        difficulty: ctx.difficulty || null,
        issue: issue,
        note: text.slice(0, NOTE_MAX),
        suggestion: ($('fb-sug').value || '').trim().slice(0, 200) || null,
        page: (location.pathname || '').split('/').pop() || null
      };
      $('fb-send').disabled = true;
      msg.className = 'fb-msg';
      msg.textContent = '提交中…';
      try {
        await submit(payload);
        const key = ctx.questionId || (ctx.q || '');
        if (key) markSent(String(key));
        msg.className = 'fb-msg ok';
        msg.textContent = '已收到，感谢。若被采纳，这道题会标注「经面试者校准」。';
        const b = document.querySelector(`[data-fbkey="${CSS.escape(String(key))}"]`);
        if (b) { b.classList.add('done'); b.textContent = '已反馈'; b.disabled = true; }
        setTimeout(close, 1400);
      } catch (e) {
        $('fb-send').disabled = false;
        msg.className = 'fb-msg err';
        msg.textContent = '提交失败：' + (e && e.message ? e.message : '未知错误') + '（可稍后重试）';
      }
    };
  }

  async function submit(payload) {
    const cloud = window.Cloud.get();
    const res = await cloud.database
      .from('feedback')
      .insert([Object.assign({ created_at: new Date().toISOString() }, payload)]);
    if (res && res.error) throw new Error(res.error.message || '提交被拒绝');
    if (window.Analytics) window.Analytics.track('feedback_submit', { issue: payload.issue || null, has_qid: !!payload.question_id });
    return res;
  }

  // 事件委托：页面重渲染后按钮依然有效
  function bind(root) {
    const el = root || document;
    el.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('.fb-btn');
      if (!b || b.disabled) return;
      let ctx = {};
      try { ctx = JSON.parse(b.getAttribute('data-fb') || '{}'); } catch (err) { ctx = {}; }
      open(ctx);
    });
  }

  // 已校准标记（由人工审核后写入题目数据）
  function calibratedChip(q) {
    const n = q && q.calibrated_by;
    if (!n) return '';
    return `<span class="fb-cal" title="经面试者校准">✓ 经 ${Number(n) || 1} 位面试者校准</span>`;
  }

  document.addEventListener('DOMContentLoaded', () => bind(document));

  return { open, close, submit, bind, btnHtml, calibratedChip, wasSent, ISSUES };
})();
