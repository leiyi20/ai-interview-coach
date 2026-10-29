/* ===== 鉴权模块（WorkBuddy 云认证） =====
 * 登录方式：邮箱验证码（Email OTP，新用户自动注册）+ WorkBuddy 账号登录。
 * 云认证不提供「用户名+密码」，因此这里不再有 username/password 接口。
 *
 * 对外仍然保留 Auth.api(path, opts) —— 它把原来的 /reports REST 语义
 * 映射到云数据库（cloud.database），所以 interview/history/report 三个页面
 * 的调用代码无需改动。
 */
window.Auth = (function () {
  let state = { session: null, user: null, ready: false };
  const listeners = [];
  let pendingOtp = null;          // { email, verificationId, isExistingUser }
  let readyResolve = null;
  const readyPromise = new Promise(r => { readyResolve = r; });

  function emit() {
    listeners.forEach(fn => { try { fn(state); } catch (e) { /* ignore */ } });
  }

  function setSession(session) {
    state.session = session || null;
    state.user = (session && session.user) ? session.user : null;
    state.ready = true;
    emit();
  }

  function displayName(u) {
    if (!u) return null;
    return u.name || u.email || u.phone || '已登录用户';
  }

  // —— 启动：先处理 OAuth 回调，再恢复会话 ——
  (async function boot() {
    try {
      const cloud = window.Cloud.get();
      const url = new URL(location.href);
      if (url.searchParams.has('code') || url.searchParams.has('error')) {
        const provider = url.searchParams.get('provider');
        let res = null;
        if (provider === 'workbuddy' && typeof cloud.auth.handleWorkBuddyCallback === 'function') {
          res = await cloud.auth.handleWorkBuddyCallback();
        } else if (provider === 'wechat' && typeof cloud.auth.handleWechatWebCallback === 'function') {
          res = await cloud.auth.handleWechatWebCallback();
        }
        if (res && res.session) {
          ['code', 'state', 'provider'].forEach(k => url.searchParams.delete(k));
          try { history.replaceState(null, '', url.pathname + url.search + url.hash); } catch (e) { /* ignore */ }
        }
      }
      const { data: session } = await cloud.auth.getSession();
      setSession(session);
      try {
        cloud.auth.onAuthStateChange((ev, sess) => { setSession(sess); });
      } catch (e) { /* ignore */ }
    } catch (e) {
      state.ready = true;
      emit();
    } finally {
      if (readyResolve) { readyResolve(); readyResolve = null; }
    }
  })();

  function ready() { return readyPromise; }
  function onChange(fn) { listeners.push(fn); if (state.ready) { try { fn(state); } catch (e) {} } }

  // —— 邮箱验证码 ——
  async function sendEmailCode(email) {
    const cloud = window.Cloud.get();
    const sent = await cloud.auth.sendOtp({ email });
    if (sent.error) {
      const e = sent.error;
      const raw = String(e.message || '');
      if (e.kind === 'rate-limited' || e.code === 'resource_exhausted' || e.status === 429 || /per minute|rate.?limit/i.test(raw)) {
        throw new Error('发送太频繁了，同一邮箱 1 分钟只能收 1 封，请稍后再试');
      }
      throw new Error(raw || '验证码发送失败');
    }
    pendingOtp = {
      email: email,
      verificationId: sent.data.verificationId,
      isExistingUser: sent.data.isExistingUser
    };
    return pendingOtp;
  }

  async function verifyEmailCode(email, code) {
    if (!pendingOtp || pendingOtp.email !== email) {
      throw new Error('请先获取该邮箱的验证码');
    }
    const cloud = window.Cloud.get();
    const done = await cloud.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token: code
    });
    if (done.error) {
      const e = done.error;
      const raw = String(e.message || '');
      if (e.kind === 'rate-limited' || e.status === 429) {
        throw new Error('尝试太频繁了，请稍后再试');
      }
      if (/expired|invalid|incorrect|wrong/i.test(raw) || e.status === 400) {
        throw new Error('验证码错误或已过期，请重新获取');
      }
      throw new Error(raw || '验证码校验失败');
    }
    pendingOtp = null;
    const { data: session } = await cloud.auth.getSession();
    setSession(session);
    return state.user;
  }

  // —— WorkBuddy 账号登录（仅线上 HTTPS 域名生效，本地预览会被 Relay 拒绝） ——
  async function signInWorkBuddy() {
    const cloud = window.Cloud.get();
    const back = new URL(location.href);
    back.pathname = '/';
    ['code', 'state', 'provider'].forEach(k => back.searchParams.delete(k));
    const { data, error } = await cloud.auth.signInWithOAuth({
      provider: 'workbuddy',
      redirectTo: back.toString()
    });
    if (error) throw new Error(error.message || '无法发起登录');
    location.assign(data.url);
  }

  async function logout() {
    try { await window.Cloud.get().auth.signOut(); } catch (e) { /* ignore */ }
    state = { session: null, user: null, ready: true };
    emit();
  }

  function isLoggedIn() { return !!(state.session && state.user); }
  function getUser() { return displayName(state.user); }
  async function getToken() {
    try { return await window.Cloud.get().auth.getAccessToken(); } catch (e) { return null; }
  }

  // —— 兼容层：把旧的 /reports REST 调用映射到云数据库 ——
  async function api(path, opts) {
    await readyPromise;           // 等首次会话恢复完成，避免带上错误的匿名身份
    opts = opts || {};
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { body = null; } }
    const cloud = window.Cloud.get();

    if (path === '/reports' && method === 'GET') {
      const { data, error } = await cloud.database
        .from('reports')
        .select('id, created_at, role, level, tier_name, total_score, stanine, verdict_label')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message || '加载失败');
      return (data || []).map(r => Object.assign({}, r, {
        // 页面历史代码用 created_at * 1000 构造 Date，这里统一转成 Unix 秒
        created_at: r.created_at ? Date.parse(r.created_at) / 1000 : 0
      }));
    }

    if (path === '/reports' && method === 'POST') {
      const rep = (body && body.report) || {};
      const row = {
        role: rep.role || null,
        level: rep.level || null,
        tier: rep.tier || null,
        tier_name: (rep.tierName || '').split('（')[0] || null,
        total_score: typeof rep.totalScore === 'number' ? rep.totalScore : null,
        stanine: typeof rep.stanine === 'number' ? rep.stanine : null,
        verdict_label: (rep.verdict && rep.verdict.label) || null,
        verdict_cls: (rep.verdict && rep.verdict.cls) || null,
        time_seconds: typeof rep.timeSeconds === 'number' ? rep.timeSeconds : null,
        owner_name: displayName(state.user),
        data: rep
      };
      const { data, error } = await cloud.database.from('reports').insert(row).select('id');
      if (error) throw new Error(error.message || '存档失败');
      return { id: (data && data[0] && data[0].id) || null };
    }

    const m = String(path).match(/^\/reports\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === 'GET') {
        const { data, error } = await cloud.database
          .from('reports').select('data').eq('id', id).maybeSingle();
        if (error) throw new Error(error.message || '读取失败');
        if (!data) throw new Error('报告不存在或无权查看');
        return data.data;
      }
      if (method === 'DELETE') {
        const { data, error } = await cloud.database
          .from('reports').delete().eq('id', id).select('id');
        if (error) throw new Error(error.message || '删除失败');
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('删除失败：报告不存在或无权操作');
        }
        return { ok: true };
      }
    }

    throw new Error('未知接口：' + path);
  }

  return {
    ready, onChange,
    sendEmailCode, verifyEmailCode, signInWorkBuddy, logout,
    isLoggedIn, getUser, getToken, api
  };
})();
