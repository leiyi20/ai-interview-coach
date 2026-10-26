/* ===== 站点全局配置（含 AI 接口开关，预留后端/LLM 接入） ===== */
window.SITE_CONFIG = {
  // 数据目录（相对站点根）
  dataBase: 'data/',

  // 标杆行业（第一版只把这条业务线彻底打通，其余行业数据也在但不主推）
  BENCHMARK_INDUSTRY: '互联网/IT',

  // 一场模拟面试抽题数量
  QUESTIONS_PER_INTERVIEW: 6,

  // AI 对话/评分实现模式：'rule' = 规则版（离线免费），'llm' = 接真实大模型。
  // 注意：实际是否启用大模型，由「浏览器本地设置」（见 llm.js，导航栏 ⚙ 设置）
  //       决定，而非此处硬编码。这样无需改动代码即可在 规则模拟 ↔ 真实大模型 间切换。
  // 此处 AI_MODE 仅作为回退标记；llm.js 的 isEnabled() 才是运行时的真值来源。
  AI_MODE: 'rule',

  // 真实大模型接入配置（已由 llm.js 接管，设置存于浏览器 localStorage）。
  // 保留此字段以兼容「后端代理」模式：若未来走自建后端 /api/interview，可在此填写。
  LLM: {
    endpoint: '',          // 例如 '/api/interview'（后端代理）或留空使用浏览器本地设置
    apiKey: '',            // 生产环境务必由后端代理保管，勿硬编码在前端
    model: ''
  },

  // ===== WorkBuddy 云服务 publicConfig（云数据库 / 登录 / 免密钥大模型）=====
  // 由云服务激活时下发，前端仅可持有这些公开值；真正的密钥始终在服务端。
  CLOUD: {
    endpoint: 'https://ai-interview-58714.app.workbuddy.host',
    publishableKey: 'wbpk_OnaE7UZAnjGCE1iTCPEh2v_HBRSjHjZt0YTbP9ThN06f35RiUEKU14O',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    resourceId: 'wbcs_qSroaP5Fvmzas2O7k2I8Yr'
  },

  // 兼容旧字段（本地 serve.py 已不参与线上版；保留避免其他代码报错）
  API_BASE: '/api'
};
