// 鉴权适配层：不同厂商鉴权逻辑严格分离，禁止"一套转发逻辑通吃"。
// 当前启用：阿里云百炼 DashScope（LLM/TTS/ASR 统一 Bearer sk-）。
// 备用：腾讯云（混元 LLM 用 Bearer sk；ASR/TTS 用 AKID+SecretKey 的 TC3 签名）——
//       两者鉴权不可混用，故单独适配，当前默认不启用。
const crypto = require('crypto');

// ================= 阿里云百炼 DashScope =================
// 该厂商的模型：LLM/TTS/ASR 共用同一个 Bearer sk- 密钥（这是"厂商鉴权模型"，
// 不是我们把不同密钥混用）。
const dashscope = {
  name: 'dashscope',
  base(ws) { return ws ? `https://${ws}.cn-beijing.maas.aliyuncs.com` : 'https://dashscope.aliyuncs.com'; },
  authHeaders(key) { return { 'Authorization': 'Bearer ' + key }; },
  paths: {
    llm: '/compatible-mode/v1/chat/completions',
    tts: '/api/v1/services/audio/tts/SpeechSynthesizer',
    asrSubmit: '/api/v1/services/audio/asr/transcription',
    asrQuery: (id) => '/api/v1/tasks/' + id,
    // 同步识别（fun-asr-flash）：音频可直接传 data URL(base64)，无需公网 URL
    asrSync: '/api/v1/services/aigc/multimodal-generation/generation',
  },
};

// ================= 腾讯云（备用适配器） =================
// 混元 LLM：OpenAI 兼容，Bearer sk-；ASR/TTS：AKID + SecretKey，TC3-HMAC-SHA256 签名。
// 两套鉴权完全分开（llmAuth vs asrTtsAuth），不可用同一 header 通吃。
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function hmac(key, msg, enc) { const h = crypto.createHmac('sha256', key).update(msg); return enc ? h.digest(enc) : h.digest(); }

function tc3Headers(creds, { service, host, action, version, region = 'ap-guangzhou', payload = '{}' }) {
  const ts = Math.floor(Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const ct = 'application/json; charset=utf-8';
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalHeaders = `content-type:${ct}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)].join('\n');
  const scope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(ts), scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('TC3' + creds.secretKey, date);
  const kService = hmac(kDate, service);
  const kSigning = hmac(kService, 'tc3_request');
  const signature = hmac(kSigning, stringToSign, 'hex');
  return {
    'Authorization': `TC3-HMAC-SHA256 Credential=${creds.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': ct, 'Host': host, 'X-TC-Action': action,
    'X-TC-Version': version, 'X-TC-Region': region, 'X-TC-Timestamp': String(ts),
  };
}

const tencent = {
  name: 'tencent',
  // 混元 LLM：Bearer sk
  llmAuth(key) { return { 'Authorization': 'Bearer ' + key }; },
  // 腾讯 ASR / TTS：AK/SK 签名（与上面 llmAuth 是两套，禁止混用）
  asrTtsAuth(creds, opts) { return tc3Headers(creds, opts); },
};

module.exports = { dashscope, tencent, tc3Headers };
