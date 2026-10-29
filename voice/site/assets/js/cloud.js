/* ===== WorkBuddy 云服务客户端（单例） =====
 * 依赖 assets/js/vendor/workbuddy-cloud-sdk.js 暴露的全局 WorkBuddyCloud。
 * 初始化只做一次，Auth / Database / LLM 全部复用同一个 client。
 * endpoint / publishableKey / oauthRelayBaseUrl 来自 config.js 的 SITE_CONFIG.CLOUD
 * （即云服务激活时下发的 publicConfig）。
 */
window.Cloud = (function () {
  let client = null;
  let initErr = null;

  function config() {
    const c = (window.SITE_CONFIG && window.SITE_CONFIG.CLOUD) || {};
    return c;
  }

  function get() {
    if (client) return client;
    const c = config();
    if (typeof window.WorkBuddyCloud === 'undefined') {
      initErr = new Error('云 SDK 未加载（workbuddy-cloud-sdk.js 缺失）');
      throw initErr;
    }
    if (!c.endpoint || !c.publishableKey) {
      initErr = new Error('缺少云服务配置（SITE_CONFIG.CLOUD）');
      throw initErr;
    }
    client = window.WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: c.endpoint,
      publishableKey: c.publishableKey,
      oauthRelayBaseUrl: c.oauthRelayBaseUrl
    });
    return client;
  }

  function ready() {
    try { return !!get(); } catch (e) { return false; }
  }

  return { get, ready, config };
})();
