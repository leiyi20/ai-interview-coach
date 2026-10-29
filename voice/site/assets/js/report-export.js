/* ===== 报告分享 / 导出：生成自包含 HTML 文件（本地原型无公网，导出最实用） =====
 * 用法：
 *   ReportExport.download(R)        // 把报告 R 导出为独立 .html（接收方直接打开）
 *   ReportExport.copyText(t)        // 复制文本到剪贴板（带降级）
 *   ReportExport.buildHtml(R)       // 返回完整 HTML 字符串（供预览/调试）
 * 注意：导出的 HTML 不依赖本站任何资源，离线可用。
 */
window.ReportExport = (function () {
  function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function round(v, n) { const p = Math.pow(10, n || 2); return Math.round((v || 0) * p) / p; }

  function buildHtml(R) {
    R = R || {};
    const scoreMode = R.scoreMode || 'rule';
    const chatMode = R.chatMode || R.mode || 'rule';
    const v = R.verdict || {};
    const stanine = R.stanine || '-';
    const sub = [
      (R.role || ''), (R.level || ''), (R.tierName || '').split('（')[0],
      '用时 ' + Math.floor((R.timeSeconds || 0) / 60) + '分' + (R.timeSeconds || 0) % 60 + '秒',
      '共 ' + ((R.questions || []).length) + ' 题',
      '对话：' + (chatMode === 'llm' ? 'AI 实时' : '规则模拟'),
      '评分：' + (scoreMode === 'llm' ? 'AI 语义级' : '规则模拟')
    ].filter(Boolean).join(' ｜ ');

    const dimRows = Object.keys(R.weights || {}).map(k => {
      const val = R.dimAvg[k] || 0;
      return `<div class="dim">
        <div class="dim-name">${escapeHtml(k)}<span class="w">权 ${Math.round((R.weights[k] || 0) * 100)}%</span></div>
        <div class="bar"><i style="width:${val / 5 * 100}%"></i></div>
        <div class="dim-val">${val.toFixed(1)}</div>
      </div>`;
    }).join('');

    // 综合评估（总评 / 优势 / 待提升 / 建议动作）
    const ev = R.evaluation || {};
    const evList = (arr, cls) => (Array.isArray(arr) && arr.length)
      ? `<ul class="ev-list ${cls || ''}">` + arr.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ul>' : '';
    const evTiming = (() => {
      const t = R.timing || {};
      const total = t.totalSeconds != null ? t.totalSeconds : (R.timeSeconds || 0);
      const fmt = s => Math.floor((s || 0) / 60) + ':' + String(Math.round((s || 0) % 60)).padStart(2, '0');
      const bits = ['总用时 <b>' + fmt(total) + '</b>'];
      if (t.totalLimitSeconds) bits.push('总限时 <b>' + fmt(t.totalLimitSeconds) + '</b>');
      if (t.overtimeCount != null) bits.push(t.overtimeCount > 0 ? '超限 <b>' + t.overtimeCount + '</b> 道' : '全部在限时内');
      return bits.join(' ｜ ');
    })();
    const hasEv = !!(ev.overall || (Array.isArray(ev.strengths) && ev.strengths.length) || (Array.isArray(ev.gaps) && ev.gaps.length));
    const evalHtml = hasEv ? `<div class="card">
    <div class="card-title">综合评估</div>
    ${ev.overall ? `<p class="ev-overall">${escapeHtml(ev.overall)}</p>` : ''}
    ${(Array.isArray(ev.strengths) && ev.strengths.length) || (Array.isArray(ev.gaps) && ev.gaps.length) ? `<div class="ev-grid">
      <div><div class="ev-label good">优势</div>${evList(ev.strengths)}</div>
      <div><div class="ev-label bad">待提升</div>${evList(ev.gaps)}</div>
    </div>` : ''}
    ${Array.isArray(ev.actions) && ev.actions.length ? `<div class="ev-block"><div class="ev-label">建议动作</div><ol class="ev-list">` + ev.actions.map(x => '<li>' + escapeHtml(x) + '</li>').join('') + '</ol></div>' : ''}
    <div class="ev-time">${evTiming}</div>
  </div>` : '';

    const qHtml = (R.questions || []).map((it, i) => {      const hits = (it.hits || []).map(h => `<span class="kw">✓ ${escapeHtml(h)}</span>`).join('') || '<span class="miss">未命中关键词</span>';
      const miss = (it.miss || []).slice(0, 5).map(m => `<span class="tag">缺：${escapeHtml(m)}</span>`).join(' ');
      return `<div class="qcard">
        <div class="qhead"><span class="qtype">${escapeHtml(it.type || '')}</span><span class="qdiff">关键词命中 ${((it.hits || []).length)}/${((it.keywords || []).length)}（${((it.hitRate || 0) * 100).toFixed(0)}%）</span></div>
        <div class="qtext">${i + 1}. ${escapeHtml(it.q || '')}</div>
        <div class="qdetail"><b>你的回答：</b>${escapeHtml(it.answer || '（未作答）')}</div>
        ${it.followupAnswer ? `<div class="qdetail"><b>追问：</b>${escapeHtml(it.followup)}<br><b>追问作答：</b>${escapeHtml(it.followupAnswer)}</div>` : ''}
        ${it.aiFeedback ? `<div class="qfeedback"><b>AI 点评：</b>${escapeHtml(it.aiFeedback)}</div>` : ''}
        ${it.coach && it.coach.length ? `<div class="qcoach"><b>教练点评（练习模式）：</b>` + it.coach.map(c => '<div>' + escapeHtml(c) + '</div>').join('') + `</div>` : ''}
        <div class="qdetail"><b>命中要点：</b><br>${hits}</div>
        ${miss ? `<div class="qdetail">${miss}</div>` : ''}
      </div>`;
    }).join('');

    // 反问环节（独立印象评价，不计总分；旧报告无此字段不渲染）
    const ra = R.reverseAsk || null;
    const raHtml = !ra ? '' : (() => {
      let h = `<div class="card"><div class="card-title">反问环节（印象评价 · 不计入总分）</div>`;
      if (ra.skipped || !(ra.items || []).length) {
        h += `<div class="ra-skipnote">这一场你在反问环节没有提问。现实中这容易被解读为兴趣不足——哪怕问一个「团队现在最需要解决什么」也比沉默好。</div>`;
      } else {
        const lbl = (ra.overall && ra.overall.label) || '平平';
        const cls = lbl === '加分项' ? 'hire' : (lbl === '减分项' ? 'reject' : 'pending');
        h += `<div class="ra-overall"><span class="verdict ${cls}">${escapeHtml(lbl)}</span>`
          + `<span class="ra-overall-text">${escapeHtml((ra.overall && ra.overall.comment) || '')}</span></div>`;
        (ra.items || []).forEach((it, i) => {
          const dot = it.verdict === 'good' ? '<span class="ra-dot good">好问题</span>'
            : it.verdict === 'bad' ? '<span class="ra-dot bad">欠妥</span>' : '<span class="ra-dot mid">一般</span>';
          h += `<div class="ra-item"><div class="ra-q"><b>问${i + 1}：</b>${escapeHtml(it.q || '')} ${dot}</div>`
            + (it.comment ? `<div class="ra-comment">${escapeHtml(it.comment)}</div>` : '') + `</div>`;
        });
      }
      h += `<div class="ra-tip">好反问的方向：团队当前要解决的问题、岗位的预期产出、真实的工作方式——这些是搜索引擎查不到、也只有面试官能告诉你的。</div></div>`;
      return h;
    })();

    const note = scoreMode === 'llm'
      ? '本份报告采用 AI 语义级评分，由大模型依据六维评分表对作答内容逐题打分，并给出逐题点评。AI 不单独做录用决策，2.5~4.0 区间建议人工复核。'
      : '本份报告为规则模拟评分，基于关键词命中和作答特征估算各维度得分，仅供体验。';

    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>面试评分报告 · ${escapeHtml(R.role || '')}</title>
<style>
  :root{--blue:#3a6df0;--blue-l:#eaf0ff;--green:#1fae8b;--red:#e5484d;--warn:#f5731f;--muted:#8a93a6;--text:#222;--card:#fff;--border:#e6e9f0;--bg:#f6f8fc;}
  *{box-sizing:border-box;} body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.65;}
  .wrap{max-width:820px;margin:0 auto;padding:28px 18px 60px;}
  h1{font-size:22px;margin:0 0 6px;} .sub{color:var(--muted);font-size:13px;margin:0 0 22px;}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:16px;}
  .hero{display:flex;gap:22px;align-items:center;flex-wrap:wrap;}
  .score{width:120px;height:120px;border-radius:50%;background:var(--blue-l);display:flex;flex-direction:column;align-items:center;justify-content:center;flex:0 0 auto;}
  .score .num{font-size:30px;font-weight:700;color:var(--blue);} .score .lab{font-size:11px;color:var(--muted);}
  .verdict{display:inline-block;padding:6px 14px;border-radius:999px;font-weight:600;font-size:14px;}
  .verdict.hire{background:#e6f7f0;color:var(--green);} .verdict.pending{background:#fff2e6;color:var(--warn);} .verdict.reject{background:#fdecec;color:var(--red);}
  .meta{color:var(--muted);font-size:13px;margin-top:10px;} .meta b{color:var(--blue);}
  .note{margin-top:14px;font-size:12.5px;color:var(--muted);}
  .card-title{font-weight:600;margin-bottom:12px;}
  .dim{display:flex;align-items:center;gap:12px;margin-bottom:10px;} .dim-name{flex:0 0 160px;font-size:13px;} .dim-name .w{color:var(--muted);font-size:11px;margin-left:6px;}
  .bar{flex:1;height:10px;background:#eef1f7;border-radius:999px;overflow:hidden;} .bar i{display:block;height:100%;background:var(--blue);border-radius:999px;}
  .dim-val{flex:0 0 36px;text-align:right;font-weight:600;font-size:13px;}
  .qcard{border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px;}
  .qhead{display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;} .qtype{font-size:12px;font-weight:600;background:var(--blue-l);color:#234;padding:3px 10px;border-radius:6px;} .qdiff{font-size:12px;color:var(--muted);}
  .qtext{font-weight:600;font-size:14px;margin-bottom:10px;} .qdetail{font-size:13px;color:#444;margin-top:6px;}
  .qdetail b{color:var(--text);} .kw{display:inline-block;background:#e6f7f0;color:var(--green);padding:2px 8px;border-radius:6px;font-size:12px;margin:2px 4px 2px 0;} .miss{color:var(--muted);font-size:12px;} .tag{display:inline-block;background:#f1f3f8;color:var(--muted);padding:2px 8px;border-radius:6px;font-size:12px;margin:2px 4px 2px 0;}
  .qfeedback{border-left:3px solid var(--blue);background:var(--blue-l);padding:10px 12px;border-radius:0 8px 8px 0;font-size:13px;margin-top:10px;} .qfeedback b{color:#234;}
  .qcoach{border-left:3px solid #f0b400;background:#fff7e6;padding:10px 12px;border-radius:0 8px 8px 0;font-size:13px;margin-top:10px;color:#8a5a00;} .qcoach b{color:#b97700;}
  .ra-overall{display:flex;align-items:center;gap:10px;margin-bottom:12px;} .ra-overall-text{font-size:13.5px;}
  .ra-skipnote{font-size:13px;color:#8a5555;background:#fdf3f3;border:1px solid #f3d8d8;border-radius:8px;padding:10px 12px;}
  .ra-item{border-left:3px solid var(--border);padding:2px 0 2px 12px;margin-top:10px;} .ra-q{font-size:13.5px;} .ra-comment{font-size:12.5px;color:var(--muted);margin-top:3px;}
  .ra-dot{display:inline-block;font-size:11px;font-weight:600;border-radius:999px;padding:1px 8px;margin-left:4px;vertical-align:1px;}
  .ra-dot.good{background:#e6f7f0;color:var(--green);} .ra-dot.mid{background:#eef1f7;color:var(--muted);} .ra-dot.bad{background:#fdecec;color:var(--red);}
  .ra-tip{font-size:12px;color:var(--muted);margin-top:14px;border-top:1px dashed var(--border);padding-top:10px;}
  .ev-overall{font-size:14px;line-height:1.9;margin:0 0 14px;color:var(--text);}
  .ev-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
  .ev-label{font-size:12px;font-weight:600;color:var(--muted);}
  .ev-label.good{color:var(--green);} .ev-label.bad{color:var(--warn);}
  .ev-list{margin:6px 0 0;padding-left:17px;font-size:13px;line-height:1.75;color:#333;}
  .ev-block{margin-bottom:10px;}
  .ev-time{font-size:12px;color:var(--muted);}
  .ev-time b{color:var(--text);}
  @media(max-width:640px){ .ev-grid{grid-template-columns:1fr;} }
  .foot{text-align:center;color:var(--muted);font-size:12px;margin-top:24px;}
</style></head>
<body><div class="wrap">
  <h1>你的面试评分报告</h1>
  <div class="sub">${escapeHtml(sub)}</div>

  <div class="card">
    <div class="hero">
      <div class="score"><div class="num">${round(R.totalScore, 2)}</div><div class="lab">加权总分 /5</div></div>
      <div>
        <div class="verdict ${v.cls || ''}">${escapeHtml(v.label || '—')}</div>
        <div class="meta">量表档位：<b>Band ${stanine}</b> / 9
          <span style="opacity:.75">（按评分量表固定阈值划分，非人群百分位）</span></div>
        <div class="note">${escapeHtml(note)}</div>
        ${R.practiceMode ? '<div class="meta" style="color:#b97700;margin-top:8px;">本报告来自练习模式 · 含逐题教练点评（琥珀色块）</div>' : ''}
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">六维能力得分（按档位权重加权）</div>
    ${dimRows || '<div class="note">无维度数据</div>'}
  </div>

  ${evalHtml}

  <div class="card">
    <div class="card-title">逐题反馈</div>
    ${qHtml || '<div class="note">无题目数据</div>'}
  </div>

  ${raHtml}

  <div class="foot">本报告由「AI 面试教练」生成 · ${new Date((R.ts || Date.now())).toLocaleString('zh-CN')}</div>
</div></body></html>`;
  }

  function download(R) {
    const html = buildHtml(R);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date((R.ts || Date.now()));
    const ts = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    a.href = url;
    a.download = `面试报告_${(R.role || '报告')}_${ts}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  }

  return { buildHtml, download, copyText };
})();
