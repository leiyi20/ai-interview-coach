/* ===== 顶部导航（所有页面共用）+ 登录弹窗 + AI 设置弹窗 ===== */
window.Nav = (function () {
  const links = [
    { href: 'index.html', label: '开始模拟' },
    { href: 'custom.html', label: '自创面试官' },
    { href: 'question-bank.html', label: '题库 / 知识点' },
    { href: 'tiers.html', label: '分档攻略' },
    { href: 'history.html', label: '我的历史' },
    { href: 'contribute.html', label: '参与共建' },
  ];

  function modeState() {
    const useLLM = (typeof window.LLM !== 'undefined') && window.LLM.isEnabled();
    const useScore = (typeof window.LLM !== 'undefined') && window.LLM.isScoreEnabled();
    if (useLLM) {
      return { label: useScore ? 'AI 实时对话 · 语义评分' : 'AI 实时对话', color: 'var(--wb-blue)' };
    }
    return { label: '规则模拟对话', color: 'var(--wb-green)' };
  }

  function render(activeHref) {
    const cur = activeHref || location.pathname.split('/').pop() || 'index.html';
    // 埋点：页面访问 + 全局错误钩子（Analytics 静默失败，不影响功能）
    if (window.Analytics) {
      window.Analytics.installErrorHook();
      window.Analytics.track('page_view', { page: cur }, 'pv:' + cur);
    }
    const items = links.map(l =>
      `<a href="${l.href}" class="${l.href === cur ? 'active' : ''}">${l.label}</a>`
    ).join('');
    const m = modeState();
    const header = document.createElement('aside');
    header.className = 'wb-side';
    header.id = 'wb-side';
    header.innerHTML = `
      <button class="wb-drawer-close" id="wb-drawer-close" aria-label="关闭菜单">×</button>
      <div class="wb-logo"><span class="dot"></span><span class="wb-logo-text">AI 面试教练</span></div>
      <nav class="wb-nav">${items}</nav>
      <div class="wb-side-foot">
        <div class="wb-mode-tag" id="wb-mode-tag"><span class="led" style="background:${m.color}"></span>${m.label}</div>
        <div class="wb-side-actions">
          <button class="wb-gear" id="btn-theme" title="视觉定调 · 外观自定义">🎨</button>
          <button class="wb-gear" id="btn-settings" title="AI 面试官设置">⚙</button>
        </div>
        <span id="auth-area"></span>
      </div>`;

    // 窄屏顶部条（桌面端隐藏）
    const topbar = document.createElement('div');
    topbar.className = 'wb-topbar';
    topbar.innerHTML = `
      <button class="wb-burger" id="wb-burger" aria-label="打开菜单" aria-expanded="false">☰</button>
      <span class="wb-topbar-title">AI 面试教练</span>`;

    // 抽屉遮罩
    const mask = document.createElement('div');
    mask.className = 'wb-mask';
    mask.id = 'wb-mask';

    document.body.prepend(header);
    document.body.prepend(topbar);
    document.body.appendChild(mask);

    // —— 抽屉开合（仅窄屏生效；宽屏时抽屉常驻，不触发） ——
    function setDrawer(open) {
      header.classList.toggle('open', open);
      mask.classList.toggle('show', open);
      document.body.classList.toggle('drawer-open', open);
      const b = document.getElementById('wb-burger');
      if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    function closeDrawer() { setDrawer(false); }
    const burger = document.getElementById('wb-burger');
    if (burger) burger.addEventListener('click', () => setDrawer(true));
    const closer = document.getElementById('wb-drawer-close');
    if (closer) closer.addEventListener('click', closeDrawer);
    mask.addEventListener('click', closeDrawer);
    header.querySelectorAll('.wb-nav a').forEach(a => a.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
    // 旋转/放大到宽屏时收起抽屉，避免残留锁定滚动
    window.addEventListener('resize', () => { if (window.innerWidth > 860) closeDrawer(); });
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', () => { if (window.Theme) window.Theme.openPanel(); });
    const gear = document.getElementById('btn-settings');
    if (gear) gear.addEventListener('click', openSettings);
    renderAuth();
    // 会话是异步恢复的，恢复完成后刷新登录态
    if (window.Auth && window.Auth.onChange) {
      try { window.Auth.onChange(() => renderAuth()); } catch (e) { /* ignore */ }
    }
  }

  // 登录态区域：未登录显示「登录」；已登录显示用户名 + 退出
  function renderAuth() {
    const el = document.getElementById('auth-area');
    if (!el) return;
    if (window.Auth && window.Auth.isLoggedIn()) {
      const u = window.Auth.getUser();
      el.innerHTML = `<span class="user-chip">${escapeHtml(u)}</span><button class="btn btn-ghost btn-sm" id="btn-logout">退出</button>`;
      const lo = document.getElementById('btn-logout');
      if (lo) lo.onclick = async () => {
        if (window.Auth) await window.Auth.logout();
        renderAuth();
        if (window.Nav) window.Nav.updateModeTag();
      };
    } else {
      el.innerHTML = `<button class="btn btn-primary btn-sm" id="btn-login">登录 / 注册</button>`;
      const lg = document.getElementById('btn-login');
      if (lg) lg.onclick = openAuth;
    }
  }

  function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // 登录 / 注册弹窗（邮箱验证码 + WorkBuddy 账号）
  function openAuth() {
    const old = document.getElementById('auth-modal');
    if (old) { old.style.display = 'flex'; return; }

    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = 'auth-modal';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">登录 / 注册
          <button class="modal-x" id="auth-x" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <div class="field-label">邮箱</div>
            <input type="email" id="auth-email" placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="field">
            <div class="field-label">验证码</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="text" id="auth-code" placeholder="邮箱收到的验证码" inputmode="numeric" autocomplete="one-time-code" style="flex:1;">
              <button class="btn" id="auth-send" type="button" style="white-space:nowrap;">获取验证码</button>
            </div>
          </div>
          <div class="note" id="auth-msg"></div>
          <div class="row" style="display:flex;gap:10px;margin-top:8px;">
            <button class="btn btn-primary" id="auth-verify">登录 / 注册</button>
          </div>
          <div style="text-align:center;color:var(--wb-muted);font-size:12px;margin:14px 0;">或</div>
          <button class="btn" id="auth-wb" style="width:100%;">使用 WorkBuddy 账号登录</button>
          <p class="page-sub" style="margin-top:14px;font-size:12px;line-height:1.6;">
            邮箱验证码登录，新用户自动注册、无需设密码。面试报告保存在云端，仅你本人可见。
            WorkBuddy 账号登录需在<strong>发布后的线上地址</strong>使用（本地预览会被授权服务拒绝）。
          </p>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const $ = sel => mask.querySelector(sel);
    const msg = $('#auth-msg');
    const setMsg = (t, c) => { msg.textContent = t; msg.style.color = c || 'var(--wb-muted)'; };

    $('#auth-x').onclick = () => { mask.style.display = 'none'; };
    mask.onclick = e => { if (e.target === mask) mask.style.display = 'none'; };

    let timer = null, left = 0;
    const sendBtn = $('#auth-send');
    function startCountdown(sec) {
      left = sec;
      sendBtn.disabled = true;
      sendBtn.textContent = left + 's 后重发';
      clearInterval(timer);
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          sendBtn.disabled = false;
          sendBtn.textContent = '获取验证码';
        } else {
          sendBtn.textContent = left + 's 后重发';
        }
      }, 1000);
    }

    sendBtn.onclick = async () => {
      const email = $('#auth-email').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setMsg('请输入正确的邮箱地址', 'var(--wb-warn)');
        return;
      }
      sendBtn.disabled = true;
      setMsg('正在发送验证码…');
      try {
        await window.Auth.sendEmailCode(email);
        setMsg('验证码已发送，请查收邮箱（含垃圾邮件箱）', 'var(--wb-green)');
        startCountdown(60);
        $('#auth-code').focus();
      } catch (e) {
        setMsg('发送失败：' + e.message, 'var(--wb-red)');
        sendBtn.disabled = false;
      }
    };

    const doVerify = async () => {
      const email = $('#auth-email').value.trim();
      const code = $('#auth-code').value.trim();
      if (!email || !code) { setMsg('请填写邮箱和验证码', 'var(--wb-warn)'); return; }
      setMsg('验证中…');
      try {
        await window.Auth.verifyEmailCode(email, code);
        setMsg('登录成功', 'var(--wb-green)');
        mask.style.display = 'none';
        renderAuth();
        if (window.Nav) window.Nav.updateModeTag();
      } catch (e) {
        setMsg('登录失败：' + e.message, 'var(--wb-red)');
      }
    };
    $('#auth-verify').onclick = doVerify;
    $('#auth-code').addEventListener('keydown', e => { if (e.key === 'Enter') doVerify(); });

    $('#auth-wb').onclick = async () => {
      setMsg('正在跳转 WorkBuddy 登录…');
      try {
        await window.Auth.signInWorkBuddy();
      } catch (e) {
        setMsg('无法发起 WorkBuddy 登录：' + e.message, 'var(--wb-red)');
      }
    };
  }

  function updateModeTag() {
    const tag = document.getElementById('wb-mode-tag');
    if (!tag) return;
    const m = modeState();
    tag.innerHTML = `<span class="led" style="background:${m.color}"></span>${m.label}`;
  }

  function openSettings() {
    if (document.getElementById('llm-modal')) {
      document.getElementById('llm-modal').style.display = 'flex';
      return;
    }
    const d = (typeof window.LLM !== 'undefined') ? window.LLM.load() : { enabled: false, scoreEnabled: false, model: 'auto' };
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = 'llm-modal';
    mask.innerHTML = `
      <div class="modal">
        <div class="modal-head">AI 面试官设置
          <button class="modal-x" id="llm-x" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <label class="sw"><input type="checkbox" id="llm-enabled"> 启用真实大模型对话（关闭则用规则模拟，免费离线）</label>
          <label class="sw"><input type="checkbox" id="llm-score"> 启用 AI 语义级评分（默认开启：按六维锚点逐题打分并给出依据；关闭后仅用关键词规则分）</label>

          <div class="field">
            <div class="field-label">模型（云端大模型，免密钥）</div>
            <select id="llm-model-sel">
              <option value="hunyuan-chat">混元 Turbo（快，推荐）</option>
              <option value="auto">Auto（推理模型，很慢，约 70 秒/次）</option>
            </select>
          </div>

          <div class="note" id="llm-msg"></div>
          <div class="row" style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" id="llm-save">保存</button>
            <button class="btn" id="llm-test">测试连接</button>
            <button class="btn" id="llm-clear">恢复默认</button>
          </div>
          <p class="page-sub" style="margin-top:14px;font-size:12px;line-height:1.6;">
            说明：大模型由 WorkBuddy 云端提供，无需填写 API Key。为保证安全，云端只接受本应用<strong>发布后的线上域名</strong>发起的调用，本地预览时测试连接可能失败，属正常现象。
          </p>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const $ = sel => mask.querySelector(sel);
    const msg = $('#llm-msg');
    $('#llm-enabled').checked = !!d.enabled;
    $('#llm-score').checked = !!d.scoreEnabled;

    const sel = $('#llm-model-sel');
    sel.value = d.model || 'hunyuan-chat';
    // 异步拉取云端模型列表填充
    (async () => {
      try {
        const list = await window.LLM.listModels();
        list.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent = (m.name || m.id) + (m.disabled === true ? '（不可用）' : '');
          if (m.disabled === true) opt.disabled = true;
          sel.appendChild(opt);
        });
        sel.value = d.model || 'hunyuan-chat';
      } catch (e) { /* 列表拉取失败时保留「自动」 */ }
    })();

    $('#llm-x').onclick = () => { mask.style.display = 'none'; };
    mask.onclick = (e) => { if (e.target === mask) mask.style.display = 'none'; };

    $('#llm-save').onclick = () => {
      const cfg = {
        enabled: $('#llm-enabled').checked,
        scoreEnabled: $('#llm-score').checked,
        model: sel.value || 'auto'
      };
      window.LLM.save(cfg);
      let txt = cfg.enabled ? '已保存，已启用 AI 实时对话。' : '已保存，当前为规则模拟对话。';
      if (cfg.scoreEnabled) {
        txt += 'AI 语义级评分已开启（面试结束自动逐题打分并给出依据）。';
      }
      msg.style.color = (cfg.enabled ? 'var(--wb-green)' : 'var(--wb-muted)');
      msg.textContent = txt;
      updateModeTag();
    };

    $('#llm-test').onclick = async () => {
      msg.style.color = 'var(--wb-muted)';
      msg.textContent = '正在调用云端模型…';
      try {
        const out = await window.LLM.chat([{ role: 'user', content: '只回复两个字：收到' }], { temperature: 0.3 });
        msg.style.color = 'var(--wb-green)';
        msg.textContent = '连接成功！模型回复：' + out.slice(0, 40);
      } catch (e) {
        msg.style.color = 'var(--wb-red)';
        msg.textContent = '连接失败：' + e.message;
      }
    };

    $('#llm-clear').onclick = () => {
      window.LLM.clear();
      $('#llm-enabled').checked = false;
      $('#llm-score').checked = false;
      sel.value = 'hunyuan-chat';
      msg.style.color = 'var(--wb-muted)';
      msg.textContent = '已恢复默认，当前为规则模拟对话。';
      updateModeTag();
    };
  }

  return { render, updateModeTag, openSettings, renderAuth, openAuth };
})();
