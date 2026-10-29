/* ===== 统一存储层 =====
 *
 * 之前的问题：6 个存储键散落在 5 个文件里，而「简历不许持久化」「离开页面即清」
 * 这类隐私约束全靠开发者写代码时记得，没有任何机制阻止后人（包括未来的我）
 * 在不该存的地方把简历落盘。
 *
 * 这里做三件事：
 *   1. 所有存储键集中声明 —— 接手的人一眼能看到全局有哪些键、各存什么
 *   2. 隐私级别由代码强制 —— privacy:'private' 的键写入 localStorage 会被拒绝
 *   3. 一处调用清空隐私数据 —— Store.clearPrivate()，不必逐个记得
 *
 * 隐私级别：
 *   public   可持久保存，不含个人信息
 *   private  含用户隐私（简历等）：禁止写 localStorage，离开页面必须清除
 *
 * 用法：
 *   Store.get('resume')          // 读取（自动 JSON 解析，不存在返回 null）
 *   Store.set('draft', obj)      // 写入（隐私键写入持久层会被拒绝）
 *   Store.remove('resume')
 *   Store.clearPrivate()         // 清空全部隐私数据
 *   Store.audit()                // 调试：列出所有键的存在与占用
 */
(function () {
  'use strict';

  var KEYS = {
    // —— 持久层（localStorage）——
    llm:      { key: 'wb_interview_llm',      store: 'local',   privacy: 'public',  desc: 'AI 对话 / 评分设置' },
    theme:    { key: 'wb_theme_v1',           store: 'local',   privacy: 'public',  desc: '外观设置' },
    persona:  { key: 'wb_persona',            store: 'local',   privacy: 'public',  desc: '自创面试官配置' },
    onboard:  { key: 'wb_onboard_dismissed',  store: 'local',   privacy: 'public',  desc: '新手提示已关闭' },
    feedback: { key: 'wb_feedback_sent',      store: 'local',   privacy: 'public',  desc: '反馈去重（7 天）' },
    analytics:{ key: 'wb_analytics_sent',     store: 'local',   privacy: 'public',  desc: '埋点会话去重' },
    draft:    { key: 'wb_interview_draft',    store: 'local',   privacy: 'public',  desc: '面试草稿（只含题目与作答，绝不含简历）' },
    pending:  { key: 'wb_pending_report',     store: 'local',   privacy: 'public',  desc: '未登录时暂存的报告' },

    // —— 会话层（sessionStorage，关闭标签页即失效）——
    result:   { key: 'interview_result',      store: 'session', privacy: 'public',  desc: '本场面试报告' },
    resume:   { key: 'wb_resume',             store: 'session', privacy: 'private', desc: '简历上下文（含原文，禁止持久化）' }
  };

  function metaOf(name) {
    var m = KEYS[name];
    if (!m) throw new Error('[Store] 未登记的存储键: ' + name + '（请先在 storage.js 中声明）');
    return m;
  }
  function backend(m) {
    return m.store === 'session' ? window.sessionStorage : window.localStorage;
  }

  var Store = {
    KEYS: KEYS,

    get: function (name) {
      var m = metaOf(name);
      try {
        var raw = backend(m).getItem(m.key);
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch (e) { return raw; }
      } catch (e) { return null; }
    },

    set: function (name, value) {
      var m = metaOf(name);
      // 硬约束：隐私数据不允许落持久层（这条不靠人记，靠代码拦）
      if (m.privacy === 'private' && m.store !== 'session') {
        console.error('[Store] 拒绝写入：' + name + ' 属于隐私数据，必须存 session 且离开即清');
        return false;
      }
      try {
        backend(m).setItem(m.key, JSON.stringify(value));
        return true;
      } catch (e) { return false; }   // 配额不足 / 隐私模式
    },

    remove: function (name) {
      var m = metaOf(name);
      try { backend(m).removeItem(m.key); return true; } catch (e) { return false; }
    },

    // 清空全部隐私数据（离开面试页、面试结束、退出登录时调用）
    clearPrivate: function () {
      var self = this;
      Object.keys(KEYS).forEach(function (n) {
        if (KEYS[n].privacy === 'private') self.remove(n);
      });
    },

    // 调试 / 自检：列出每个键是否存在于当前浏览器
    audit: function () {
      return Object.keys(KEYS).map(function (n) {
        var m = KEYS[n], present = false, size = 0;
        try {
          var v = backend(m).getItem(m.key);
          present = v != null;
          size = v ? v.length : 0;
        } catch (e) { /* ignore */ }
        return { name: n, key: m.key, store: m.store, privacy: m.privacy, present: present, size: size, desc: m.desc };
      });
    }
  };

  window.Store = Store;
})();
