/* ===== 轻量埋点（只写不读） =====
 *
 * 目的：回答「有没有人来、走到哪一步、哪里报错」。这是当前所有产品决策的盲区。
 *
 * 隐私设计：
 * - 云表 events 只授予 INSERT、未授予 SELECT——浏览器端连自己的记录都读不出来；
 *   数据只能通过管理端（维护者）查看。
 * - 只记事件名与少量属性（页面路径/模式/字数），不记作答内容、不记输入文本。
 * - 全部静默失败：埋点永远不影响产品功能。
 */
window.Analytics = (function () {
  const QUEUE_KEY = 'wb_analytics_sent';
  let cloudOk = null;   // null=未检测

  function canTrack() {
    if (cloudOk !== null) return cloudOk;
    try { cloudOk = !!(window.Cloud && window.Cloud.ready() && window.Cloud.get()); }
    catch (e) { cloudOk = false; }
    return cloudOk;
  }

  // 同一浏览器对同一事件键的会话级去重（如 page_view 每页一次）
  function oncePerSession(key) {
    try {
      const s = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '{}');
      if (s[key]) return false;
      s[key] = 1;
      sessionStorage.setItem(QUEUE_KEY, JSON.stringify(s));
      return true;
    } catch (e) { return true; }
  }

  async function track(name, props, dedupeKey) {
    try {
      if (dedupeKey && !oncePerSession(dedupeKey)) return;
      if (!canTrack()) return;
      const cloud = window.Cloud.get();
      await cloud.database.from('events').insert([{
        name: String(name).slice(0, 60),
        props: props || {},
        created_at: new Date().toISOString()
      }]);
    } catch (e) { /* 静默：埋点失败不影响功能 */ }
  }

  // 全局错误上报（截断，不含用户输入内容）
  function installErrorHook() {
    window.addEventListener('error', e => {
      track('js_error', {
        msg: String(e && e.message || '').slice(0, 160),
        file: String(e && e.filename || '').split('/').pop(),
        line: e && e.lineno || 0
      }, undefined);
    });
    window.addEventListener('unhandledrejection', e => {
      track('js_rejection', {
        msg: String(e && e.reason && (e.reason.message || e.reason) || '').slice(0, 160)
      });
    });
  }

  return { track, installErrorHook };
})();
