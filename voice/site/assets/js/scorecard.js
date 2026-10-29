/* ===== C1 成绩卡图片：把报告画成一张可分享的卡片（纯 Canvas，无外部依赖） =====
 * 用法：window.ScoreCard.open(report, norms)
 *  - report：与 report.js 收到的 R 同结构
 *  - norms ：报告页的常模对象（可能为 null），用于显示同岗位百分位
 * 卡片只含「分数 + 六维概览」，不含任何具体作答文本，可放心转发。
 */
(function () {
  const SITE_URL = 'ai-interview-58714.app.workbuddy.host';
  const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC",sans-serif';
  const COL = {
    blue: '#3a6df0', blueD: '#2b54c9', teal: '#1fae8b',
    text: '#1f2329', muted: '#646a73', faint: '#9aa0a8',
    border: '#e6e8eb', trackBg: '#eef1f5'
  };
  const VERDICT = {
    hire:    { bg: '#e6f7ee', fg: '#1aa05a', bd: '#bfe6cf' },
    pending: { bg: '#fff4e0', fg: '#c9820a', bd: '#f7e0b8' },
    reject:  { bg: '#fdeaea', fg: '#e04848', bd: '#f6c9c9' }
  };

  /* ===== C2 二维码：预生成矩阵（segno 权威生成，内容=站点首页+sharecode，固定不变） ===== */
  const QR_SIZE = 37;
  const QR_ROWS = [
    '1111111011010011110111111111001111111',
    '1000001011001011011100000010101000001',
    '1011101011100011001101010100101011101',
    '1011101000001111110001100100001011101',
    '1011101011010010101101101100101011101',
    '1000001001111001000010110110001000001',
    '1111111010101010101010101010101111111',
    '0000000001001101111000010100100000000',
    '1001111111011100000001100001010010111',
    '1110010000111010111000111001100111110',
    '1001101000111001101111110101111001001',
    '0110110000100000110110110000001000111',
    '0110011010111001100010110000101101001',
    '0101000110001001101001011111100011010',
    '1000011110111001101110001001111011111',
    '1101100101010001000101101010011101110',
    '0100101000111010011001100001101100111',
    '0001110001000000010001101111110101000',
    '0001111010101010101100010111010010001',
    '0101110001011101101110001100111110001',
    '0000111001000000110110000011001110000',
    '1110010101011011110100111111000010110',
    '0010111101011101100011010111011101001',
    '1111100110010000101110010001000111100',
    '1001001010011010010011110100101100000',
    '1111000011000100001100100101100011100',
    '1111011110111101000001100111110100011',
    '1011010010101100100100001000011001110',
    '1010001101000011100110110101111110111',
    '0000000010000011011101001010100010110',
    '1111111011110011111110010000101010001',
    '1000001010010110100111000111100010001',
    '1011101010001011101111011111111110000',
    '1011101010100110000010100011111000101',
    '1011101000100110010001010101110010101',
    '1000001001101101011000111010000011111',
    '1111111011101100100100001010100101001'
  ];
  // 在 (x,y) 处绘制 size×size 的二维码（含白底圆角与 4 模块静区）
  function drawQR(ctx, x, y, size) {
    roundRect(ctx, x, y, size, size, 16);
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1.5; ctx.stroke();
    const cell = size / (QR_SIZE + 8); // 每边含 4 模块静区
    const pad = cell * 4;
    ctx.fillStyle = '#1f2329';
    for (let r = 0; r < QR_SIZE; r++) {
      const row = QR_ROWS[r];
      for (let c = 0; c < QR_SIZE; c++) {
        if (row.charAt(c) === '1') {
          ctx.fillRect(Math.round(x + pad + c * cell), Math.round(y + pad + r * cell), Math.ceil(cell), Math.ceil(cell));
        }
      }
    }
  }
  // 弹窗用的独立小二维码 canvas
  function makeQRCanvas(px) {
    const c = document.createElement('canvas');
    c.width = px * 2; c.height = px * 2;
    const ctx = c.getContext('2d');
    if (ctx.scale) ctx.scale(2, 2);
    drawQR(ctx, 0, 0, px);
    return c;
  }

  function roundRect(ctx, x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function pctText(score, norms) {
    if (!norms) return '';
    const { p25, p50, p75, p90 } = norms;
    if (p90 != null && score >= p90) return '前 10%';
    if (p75 != null && score >= p75) return '前 25%';
    if (p50 != null && score >= p50) return '前 50%';
    if (p25 != null && score >= p25) return '前 75%';
    return '后 25%';
  }

  // 返回一张已绘制好的 canvas（逻辑尺寸 1080x1350，dpr 倍超采样保证清晰）
  function buildCanvas(R, norms) {
    const dpr = 2;
    const W = 1080, H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#eef3ff');
    bg.addColorStop(1, '#eaeef7');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 海报白卡 + 阴影
    const px = 44, py = 44, pw = W - 88, ph = H - 88;
    ctx.save();
    ctx.shadowColor = 'rgba(22,34,70,.18)';
    ctx.shadowBlur = 38;
    ctx.shadowOffsetY = 18;
    roundRect(ctx, px, py, pw, ph, 34);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    const cx0 = px + 56, cx1 = px + pw - 56;
    let cy = py + 64;

    // 品牌行
    roundRect(ctx, cx0, cy - 11, 22, 22, 6);
    ctx.fillStyle = COL.blue; ctx.fill();
    ctx.font = '700 30px ' + FONT; ctx.fillStyle = COL.text;
    ctx.fillText('AI 模拟面试', cx0 + 34, cy);
    ctx.font = '500 22px ' + FONT; ctx.fillStyle = COL.muted; ctx.textAlign = 'right';
    ctx.fillText('六维能力测评报告', cx1, cy);
    ctx.textAlign = 'left';

    // 分隔线
    cy += 36;
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx0, cy); ctx.lineTo(cx1, cy); ctx.stroke();
    cy += 44;

    // 总分
    const score = Number(R.totalScore || 0).toFixed(2);
    ctx.font = '800 132px ' + FONT; ctx.fillStyle = COL.blue;
    ctx.fillText(score, cx0, cy + 66);
    const sw = ctx.measureText(score).width;
    ctx.font = '500 34px ' + FONT; ctx.fillStyle = COL.muted;
    ctx.fillText('/5', cx0 + sw + 16, cy + 66);

    // 档位胶囊
    const v = R.verdict || {};
    const vc = VERDICT[v.cls] || VERDICT.pending;
    const pillText = v.label || '—';
    ctx.font = '700 28px ' + FONT;
    const pw2 = ctx.measureText(pillText).width + 44;
    const pillH = 56, pillX = cx0 + sw + 96, pillY = cy + 66 - pillH / 2;
    roundRect(ctx, pillX, pillY, pw2, pillH, pillH / 2);
    ctx.fillStyle = vc.bg; ctx.fill();
    ctx.strokeStyle = vc.bd; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = vc.fg; ctx.textAlign = 'center';
    ctx.fillText(pillText, pillX + pw2 / 2, pillY + pillH / 2);
    ctx.textAlign = 'left';

    // 岗位行
    cy += 150;
    const roleLine = [R.role, R.level, R.industry].filter(Boolean).join(' · ');
    ctx.font = '600 28px ' + FONT; ctx.fillStyle = COL.text;
    ctx.fillText(roleLine, cx0, cy);

    // 百分位（仅标准报告 + 样本充足）
    if (!R.customMode && norms && norms.n >= 30 && norms.p50 != null) {
      const pt = pctText(Number(R.totalScore) || 0, norms);
      cy += 44;
      ctx.font = '500 22px ' + FONT; ctx.fillStyle = COL.muted;
      ctx.fillText('同岗位百分位：约 ' + pt + '（样本 n=' + norms.n + '，仅供参考）', cx0, cy);
    }

    // 六维标题
    cy += 72;
    ctx.font = '700 24px ' + FONT; ctx.fillStyle = COL.muted;
    ctx.fillText('六维能力（按档位权重加权）', cx0, cy);
    cy += 30;

    // 六维条
    const dims = Object.keys(R.weights || {});
    const nameX = cx0, nameW = 150;
    const valW = 64, valX = cx1 - valW;
    const trackX = nameX + nameW + 18, trackW = valX - trackX - 14;
    const rowH = 16, step = 78;
    dims.forEach((k, i) => {
      const y = cy + i * step;
      const val = Number((R.dimAvg && R.dimAvg[k]) || 0);
      ctx.font = '500 25px ' + FONT; ctx.fillStyle = COL.text;
      ctx.fillText(k, nameX, y + 10);
      // 轨道
      roundRect(ctx, trackX, y + 2, trackW, rowH, rowH / 2);
      ctx.fillStyle = COL.trackBg; ctx.fill();
      // 填充
      const fw = Math.max(0, Math.min(1, val / 5)) * trackW;
      if (fw > 2) {
        roundRect(ctx, trackX, y + 2, fw, rowH, rowH / 2);
        const g = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
        g.addColorStop(0, COL.blue); g.addColorStop(1, '#6b95ff');
        ctx.fillStyle = g; ctx.fill();
      }
      ctx.font = '700 26px ' + FONT; ctx.fillStyle = COL.blue; ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), valX + valW, y + 10);
      ctx.textAlign = 'left';
    });

    // 最稳 / 最该补
    cy += dims.length * step + 8;
    const entries = dims.map(k => ({ k, v: Number((R.dimAvg && R.dimAvg[k]) || 0) }))
      .sort((a, b) => b.v - a.v);
    if (entries.length) {
      const top = entries[0], low = entries[entries.length - 1];
      ctx.font = '500 23px ' + FONT;
      const labelY = cy + 16;
      let x = cx0;
      const seg = (text, color, bold) => {
        ctx.font = (bold ? '700 ' : '500 ') + '23px ' + FONT;
        ctx.fillStyle = color; ctx.textAlign = 'left';
        ctx.fillText(text, x, labelY);
        x += ctx.measureText(text).width;
      };
      seg('最稳 ', COL.muted, false);
      seg(top.k + ' ' + top.v.toFixed(1), COL.blue, true);
      seg('　·　最该补 ', COL.muted, false);
      seg(low.k + ' ' + low.v.toFixed(1), '#e04848', true);
    }

    // 页脚 + 二维码（C2）
    const fy = py + ph - 64;
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx0, fy - 26); ctx.lineTo(cx1, fy - 26); ctx.stroke();
    // 右下二维码（分隔线上方）
    const qz = 200;
    const qx = cx1 - qz, qy = fy - 26 - qz - 12;
    drawQR(ctx, qx, qy, qz);
    // 二维码左侧扫码提示
    ctx.font = '600 27px ' + FONT; ctx.fillStyle = COL.text;
    ctx.fillText('扫码免费测一测', cx0, qy + qz / 2 - 16);
    ctx.font = '500 20px ' + FONT; ctx.fillStyle = COL.faint;
    ctx.fillText('微信 / 相机扫一扫直达', cx0, qy + qz / 2 + 24);

    ctx.font = '700 25px ' + FONT; ctx.fillStyle = COL.blue;
    ctx.fillText(SITE_URL, cx0, fy);
    ctx.font = '500 19px ' + FONT; ctx.fillStyle = COL.faint;
    ctx.fillText('免费测一测你的面试力 · 覆盖 6 大行业 113 个岗位', cx0, fy + 30);

    return canvas;
  }

  function toast(msg, isErr) {
    let t = document.getElementById('sc-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'sc-toast';
      t.className = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = isErr ? 'var(--wb-red)' : 'rgba(30,34,42,.92)';
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function open(R, norms) {
    if (!R) return;
    let canvas;
    try { canvas = buildCanvas(R, norms); }
    catch (e) { toast('生成成绩卡失败：' + e.message, true); return; }

    const overlay = document.createElement('div');
    overlay.className = 'sc-overlay';
    overlay.innerHTML =
      '<div class="sc-panel" role="dialog" aria-label="成绩卡预览">' +
        '<div class="sc-head"><b>面试成绩卡</b><button class="sc-x" aria-label="关闭">×</button></div>' +
        '<div class="sc-canvas-wrap"></div>' +
        '<div class="sc-actions">' +
          '<button class="btn btn-primary sc-dl">下载图片</button>' +
          '<button class="btn sc-cp">复制图片</button>' +
        '</div>' +
        '<div class="sc-qr-wrap">' +
          '<div class="sc-qr"></div>' +
          '<div class="sc-qr-info"><b>扫码访问站点</b><span>免费测一测你的面试力 · 6 大行业 113 个岗位</span></div>' +
        '</div>' +
        '<div class="sc-foot">卡片只含分数与维度概览，不含具体作答，可放心转发到朋友圈 / 小红书 / 微信群。</div>' +
      '</div>';
    overlay.querySelector('.sc-canvas-wrap').appendChild(canvas);
    try { overlay.querySelector('.sc-qr').appendChild(makeQRCanvas(132)); } catch (e) { /* 二维码失败不影响主流程 */ }
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.querySelector('.sc-x').addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

    const dl = overlay.querySelector('.sc-dl');
    const cp = overlay.querySelector('.sc-cp');
    const finishBlob = (cb) => {
      if (canvas.toBlob) canvas.toBlob(b => cb(b), 'image/png');
      else { try { cb(dataURLtoBlob(canvas.toDataURL('image/png'))); } catch (e) { cb(null); } }
    };
    dl.addEventListener('click', () => {
      finishBlob(blob => {
        if (!blob) { toast('下载失败，请重试', true); return; }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '面试成绩卡.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast('已保存为 面试成绩卡.png');
      });
    });
    cp.addEventListener('click', () => {
      if (!navigator.clipboard || !window.ClipboardItem) { toast('当前浏览器不支持复制图片，请改用下载', true); return; }
      finishBlob(async blob => {
        if (!blob) { toast('复制失败，请改用下载', true); return; }
        try {
          await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]);
          toast('图片已复制到剪贴板');
        } catch (e) { toast('复制失败，请改用下载', true); }
      });
    });
  }

  function dataURLtoBlob(url) {
    const arr = url.split(','), mime = arr[0].match(/:(.*?);/)[1];
    const dec = atob(arr[1]), n = dec.length, u8 = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8[i] = dec.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  window.ScoreCard = { open };
})();
