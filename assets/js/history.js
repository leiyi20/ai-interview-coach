/* ===== 我的历史：从后端拉取报告列表 + 删除 / 分享 ===== */
(async function () {
  Nav.render('history.html');
  if (window.Auth && window.Auth.ready) { try { await Auth.ready(); } catch (e) { /* ignore */ } }
  const listEl = document.getElementById('history-list');
  const emptyEl = document.getElementById('history-empty');
  const loginEl = document.getElementById('history-login');

  if (!Auth.isLoggedIn()) {
    loginEl.style.display = 'block';
    const btn = document.getElementById('btn-goto-login');
    if (btn) btn.onclick = () => { if (window.Nav) window.Nav.openAuth(); };
    // 本机未同步的报告入口（P0-4）
    const pending = window.Store.get('pending');
    if (pending && !document.getElementById('local-report-tip')) {
      const tip = document.createElement('p');
      tip.id = 'local-report-tip';
      tip.className = 'page-sub';
      tip.style.marginTop = '12px';
      tip.innerHTML = '本机还有一份未同步的报告（' + escapeHtml(pending.role || '') + '）。'
        + '<a href="report.html">查看本机报告</a>，登录后即可自动同步到云端。';
      loginEl.appendChild(tip);
    }
    return;
  }

  // 失败提示
  function fail(msg) {
    loginEl.style.display = 'none';
    emptyEl.style.display = 'none';
    const d = document.createElement('div');
    d.className = 'card';
    d.style.color = 'var(--wb-red)';
    d.textContent = msg;
    listEl.appendChild(d);
  }

  function escapeHtml(s) {
    return (s == null ? '' : String(s)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  let reports;
  try {
    reports = await Auth.api('/reports', { method: 'GET' });
  } catch (e) {
    fail('加载失败：' + e.message);
    return;
  }

  if (!reports || reports.length === 0) {
    emptyEl.style.display = 'block';
    return;
  }

  renderTrends(reports);

  // —— 多次面试趋势：同岗位+层级，至少 2 次才显示 ——
  function renderTrends(list) {
    const host = document.getElementById('trends');
    if (!host) return;
    const groups = {};
    list.forEach(r => {
      const key = (r.role || '未命名岗位') + '|' + (r.level || '');
      (groups[key] = groups[key] || []).push(r);
    });
    const cards = Object.keys(groups)
      .map(k => {
        const items = groups[k].slice().sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
        return { role: items[0].role || '未命名岗位', level: items[0].level || '', items: items };
      })
      .filter(g => g.items.length >= 2)
      .sort((a, b) => b.items.length - a.items.length);
    if (!cards.length) return;

    host.innerHTML = cards.slice(0, 4).map(g => {
      const scores = g.items.map(it => Number(it.total_score) || 0);
      const first = scores[0];
      const last = scores[scores.length - 1];
      const delta = last - first;
      const cls = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
      const sign = delta > 0.05 ? '+' : '';
      return '<div class="trend-card">'
        + '<div class="trend-head"><b>' + escapeHtml(g.role) + '</b><span>' + escapeHtml(g.level || '通用') + ' · ' + g.items.length + ' 次</span></div>'
        + sparkline(scores)
        + '<div class="trend-foot">'
        + '<span class="trend-delta ' + cls + '">' + sign + delta.toFixed(2) + '</span>'
        + '<span class="trend-range">' + first.toFixed(2) + ' → ' + last.toFixed(2) + '</span>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  // 极简折线：纵轴固定 1~5，虚线为 3.0 / 4.0 参考线
  function sparkline(scores) {
    const W = 260, H = 84, pad = 10;
    const n = scores.length;
    const xs = scores.map((_, i) => pad + (n === 1 ? 0 : i * (W - pad * 2) / (n - 1)));
    const y = s => H - pad - ((Math.max(1, Math.min(5, s)) - 1) / 4) * (H - pad * 2);
    const pts = scores.map((s, i) => xs[i].toFixed(1) + ',' + y(s).toFixed(1)).join(' ');
    const dots = scores.map((s, i) =>
      '<circle cx="' + xs[i].toFixed(1) + '" cy="' + y(s).toFixed(1) + '" r="3.2" fill="#fff" stroke="var(--wb-blue)" stroke-width="2"/>'
    ).join('');
    return '<svg class="trend-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="分数趋势">'
      + '<line x1="' + pad + '" y1="' + y(3).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y(3).toFixed(1) + '" stroke="var(--wb-border)" stroke-dasharray="3 3"/>'
      + '<line x1="' + pad + '" y1="' + y(4).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y(4).toFixed(1) + '" stroke="var(--wb-border)" stroke-dasharray="3 3"/>'
      + '<polyline points="' + pts + '" fill="none" stroke="var(--wb-blue)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>'
      + dots
      + '</svg>';
  }

  reports.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card history-card';
    card.dataset.id = r.id;
    const d = new Date(r.created_at * 1000);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const vl = String(r.verdict_label || '');
    const verdictCls = /录用/.test(vl) ? 'green'
      : /待定|加面|复核|参考|未评定|未做/.test(vl) ? 'warn' : 'red';
    card.innerHTML = `
      <div class="hc-top">
        <div class="hc-role">${escapeHtml(r.role || '')}<span class="hc-lvl">${escapeHtml(r.level || '')} · ${escapeHtml(r.tier_name || '')}</span></div>
        <div class="hc-time">${dateStr}</div>
      </div>
      <div class="hc-bottom">
        <div class="hc-score">${Number(r.total_score || 0).toFixed(2)}<span>加权总分</span></div>
        <div class="hc-stanine">Band ${r.stanine || '-'}<span>量表档位</span></div>
        <div class="verdict ${verdictCls}" style="margin:0;">${escapeHtml(r.verdict_label || '—')}</div>
      </div>
      <div class="hc-actions">
        <button class="hc-btn" data-act="view">查看</button>
        <button class="hc-btn" data-act="share">分享 / 导出</button>
        <button class="hc-btn danger" data-act="del">删除</button>
      </div>`;

    card.querySelector('[data-act="view"]').onclick = () => { location.href = 'report.html?id=' + r.id; };
    card.querySelector('[data-act="share"]').onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        const full = await Auth.api('/reports/' + r.id, { method: 'GET' });
        window.ReportExport.download(full);
        toast('已导出独立报告 HTML（可发给他人直接打开）');
      } catch (e) {
        toast('导出失败：' + e.message, true);
      } finally {
        ev.target.disabled = false;
      }
    };
    card.querySelector('[data-act="del"]').onclick = async (ev) => {
      if (!confirm('确定删除这份面试报告？删除后不可恢复。')) return;
      ev.target.disabled = true;
      try {
        await Auth.api('/reports/' + r.id, { method: 'DELETE' });
        card.remove();
        if (!listEl.querySelector('.history-card')) {
          emptyEl.style.display = 'block';
        }
        toast('已删除');
      } catch (e) {
        toast('删除失败：' + e.message, true);
        ev.target.disabled = false;
      }
    };
    listEl.appendChild(card);
  });

  // 轻量提示
  function toast(msg, isErr) {
    let t = document.getElementById('wb-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'wb-toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isErr ? 'var(--wb-red)' : 'rgba(30,34,42,.92)';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2200);
  }
})();
