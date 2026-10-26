/* ===== 视觉定调引擎 · 外观自定义窗口 =====
 * 把「视觉定调」拆成 5 个小问题（控件）：
 *  1) 明暗模式  2) 主色  3) 圆角  4) 密度  5) 字体
 * 全部通过 CSS 变量实时注入，存 localStorage，刷新保留。
 */
window.Theme = (function () {
  const STORE_KEY = 'wb_theme_v1';

  const DEFAULTS = {
    mode: 'light',   // light | dark | system
    accent: '#3a6df0',
    radius: 'm',     // s | m | l
    density: 'standard', // compact | standard | loose
    font: 'system'   // system | modern | mono
  };

  // 主色预设（小问题②的候选答案）
  const ACCENTS = [
    { name: 'WorkBuddy 蓝', v: '#3a6df0' },
    { name: '青绿', v: '#1fae8b' },
    { name: '莓紫', v: '#7c5cff' },
    { name: '活力橙', v: '#f5731f' },
    { name: '玫红', v: '#e5488d' },
    { name: '石墨', v: '#3a4452' }
  ];

  const RADIUS = { s: [8, 6], m: [12, 8], l: [18, 12] };

  // —— 颜色工具 ——
  function hexToRgb(hex) {
    hex = (hex || '#000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    const h = x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  }
  function mix(hex, target, t) {
    const [r, g, b] = hexToRgb(hex);
    return rgbToHex(r + (target[0] - r) * t, g + (target[1] - g) * t, b + (target[2] - b) * t);
  }
  const isHex = s => /^#?[0-9a-fA-F]{6}$/.test((s || '').replace('#', '')) || /^#?[0-9a-fA-F]{3}$/.test((s || '').replace('#', ''));

  // —— 状态存取 ——
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return { ...DEFAULTS };
      const p = JSON.parse(raw);
      return { ...DEFAULTS, ...p };
    } catch (e) { return { ...DEFAULTS }; }
  }
  function save(cfg) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {}
    _cfg = cfg;
  }
  let _cfg = load();

  function prefersDark() {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }
  function effectiveMode(cfg) {
    return cfg.mode === 'system' ? (prefersDark() ? 'dark' : 'light') : cfg.mode;
  }

  // —— 应用主题（核心：注入 CSS 变量 + body class） ——
  function apply(cfg) {
    cfg = cfg || _cfg;
    const root = document.documentElement;
    const eff = effectiveMode(cfg);
    root.setAttribute('data-theme', eff === 'dark' ? 'dark' : 'light');

    // 主色衍生：深色 hover/active + 浅色高亮（暗色下高亮改为混深色，避免刺眼）
    const accent = isHex(cfg.accent) ? cfg.accent.replace('#', '').length === 3
      ? '#' + cfg.accent.replace('#', '').split('').map(c => c + c).join('') : cfg.accent : DEFAULTS.accent;
    const soft = eff === 'dark' ? mix(accent, [34, 37, 43], 0.78) : mix(accent, [255, 255, 255], 0.86);
    root.style.setProperty('--wb-blue', accent);
    root.style.setProperty('--wb-blue-d', mix(accent, [0, 0, 0], 0.18));
    root.style.setProperty('--wb-blue-l', soft);

    // 圆角
    const R = RADIUS[cfg.radius] || RADIUS.m;
    root.style.setProperty('--radius', R[0] + 'px');
    root.style.setProperty('--radius-sm', R[1] + 'px');

    // 密度 + 字体（body class）
    const densityClass = 'density-' + cfg.density;
    const fontClass = 'font-' + cfg.font;
    const applyBody = () => {
      document.body.classList.remove('density-compact', 'density-standard', 'density-loose',
        'font-system', 'font-modern', 'font-mono');
      document.body.classList.add(densityClass, fontClass);
    };
    if (document.body) applyBody();
    else document.addEventListener('DOMContentLoaded', applyBody);
  }

  function applyCurrent() { apply(_cfg); }

  // 跟随系统变化时自动刷新
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (_cfg.mode === 'system') applyCurrent();
    });
  } catch (e) {}
  // 首次应用（DOM 解析前对 documentElement 也安全）
  applyCurrent();
  document.addEventListener('DOMContentLoaded', applyCurrent);

  // —— 外观自定义窗口 ——
  function openPanel() {
    const id = 'theme-modal';
    if (document.getElementById(id)) { document.getElementById(id).style.display = 'flex'; return; }
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.id = id;
    const c = load();
    mask.innerHTML = `
      <div class="modal" style="width:520px;">
        <div class="modal-head">视觉定调 · 外观自定义
          <button class="modal-x" id="th-x" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <p class="page-sub" style="margin:-4px 0 18px;">把视觉定调拆成 5 个小问题，逐项设定，右侧/下方实时预览，全部自动保存到本机。</p>

          <div class="theme-q">
            <div class="theme-q-label">① 明暗模式</div>
            <div class="seg" data-group="mode">
              ${['light:亮色', 'dark:暗色', 'system:跟随系统'].map(o => {
                const [v, t] = o.split(':');
                return `<button class="seg-btn ${c.mode === v ? 'active' : ''}" data-v="${v}">${t}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="theme-q">
            <div class="theme-q-label">② 主色（品牌色 / 强调色）</div>
            <div class="swatches">
              ${ACCENTS.map(a => `<button class="swatch ${c.accent.toLowerCase() === a.v.toLowerCase() ? 'active' : ''}" data-v="${a.v}" style="background:${a.v}" title="${a.name}"></button>`).join('')}
              <label class="swatch custom" title="自定义">
                <input type="color" id="th-custom" value="${isHex(c.accent) ? c.accent : DEFAULTS.accent}">
              </label>
            </div>
          </div>

          <div class="theme-q">
            <div class="theme-q-label">③ 圆角风格</div>
            <div class="seg" data-group="radius">
              ${['s:小（干练）', 'm:中（标准）', 'l:大（柔和）'].map(o => {
                const [v, t] = o.split(':');
                return `<button class="seg-btn ${c.radius === v ? 'active' : ''}" data-v="${v}">${t}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="theme-q">
            <div class="theme-q-label">④ 界面密度（留白多少）</div>
            <div class="seg" data-group="density">
              ${['compact:紧凑', 'standard:标准', 'loose:宽松'].map(o => {
                const [v, t] = o.split(':');
                return `<button class="seg-btn ${c.density === v ? 'active' : ''}" data-v="${v}">${t}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="theme-q">
            <div class="theme-q-label">⑤ 字体气质</div>
            <div class="seg" data-group="font">
              ${['system:系统默认', 'modern:现代无衬线', 'mono:等宽技术感'].map(o => {
                const [v, t] = o.split(':');
                return `<button class="seg-btn ${c.font === v ? 'active' : ''}" data-v="${v}">${t}</button>`;
              }).join('')}
            </div>
          </div>

          <div class="row" style="display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;">
            <button class="btn" id="th-reset">恢复默认</button>
            <span class="theme-hint" id="th-hint" style="font-size:12px;color:var(--wb-muted);align-self:center;">已自动保存</span>
          </div>
        </div>
      </div>`;
    document.body.appendChild(mask);

    const reload = () => { const c2 = load(); apply(c2); };
    const flash = () => { const h = mask.querySelector('#th-hint'); h.textContent = '已自动保存 ✓'; h.style.color = 'var(--wb-green)'; };

    // 段选择（mode/radius/density/font）
    mask.querySelectorAll('.seg').forEach(seg => {
      const group = seg.dataset.group;
      seg.querySelectorAll('.seg-btn').forEach(btn => {
        btn.onclick = () => {
          seg.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const cfg = load();
          cfg[group] = btn.dataset.v;
          save(cfg); apply(cfg); flash();
        };
      });
    });

    // 主色板
    mask.querySelectorAll('.swatch[data-v]').forEach(sw => {
      sw.onclick = () => {
        mask.querySelectorAll('.swatch[data-v]').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        const cfg = load();
        cfg.accent = sw.dataset.v;
        save(cfg); apply(cfg); flash();
      };
    });
    const custom = mask.querySelector('#th-custom');
    custom.oninput = () => {
      mask.querySelectorAll('.swatch[data-v]').forEach(s => s.classList.remove('active'));
      const cfg = load();
      cfg.accent = custom.value;
      save(cfg); apply(cfg); flash();
    };

    mask.querySelector('#th-reset').onclick = () => {
      save({ ...DEFAULTS });
      mask.remove();
      openPanel(); // 重开以刷新选中态
      const h = document.getElementById('th-hint'); if (h) { h.textContent = '已恢复默认 ✓'; h.style.color = 'var(--wb-green)'; }
    };

    mask.querySelector('#th-x').onclick = () => { mask.style.display = 'none'; };
    mask.onclick = (e) => { if (e.target === mask) mask.style.display = 'none'; };
  }

  return { load, save, apply, openPanel, DEFAULTS, ACCENTS };
})();
