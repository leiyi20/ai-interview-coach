/* ===== 简历提交页：输入 → 解析 → 双引擎匹配 → 通过/停止判定 ===== */
(async function () {
  Nav.render('resume.html');

  const D = window.Data, C = window.SITE_CONFIG;
  const qs = new URLSearchParams(location.search);

  const industry = qs.get('industry') || C.BENCHMARK_INDUSTRY;
  const role = qs.get('role') || '';
  const level = qs.get('level') || '通用';
  const tierKey = qs.get('tier') || 'bigtech';
  const lenParam = qs.get('len') || '';   // 面试长度 3/6/9，原样带给面试页
  const practiceParam = qs.get('practice') || '';   // 练习模式 1，原样带给面试页
  const depth = qs.get('depth') || '';

  if (!role) { location.href = 'index.html'; return; }

  await D.loadCatalog();
  await D.loadIndustry(industry);

  const roleData = D.getRole(industry, role);
  if (!roleData) {
    // 岗位不存在（可能 URL 被改坏）
    location.href = 'index.html';
    return;
  }

  let tierName = '大厂';
  try {
    const t = (await D.loadCatalog()).tiers.tiers[tierKey];
    if (t && t.name) tierName = t.name.split('（')[0];
  } catch (e) { /* ignore */ }

  const $pos = document.getElementById('rs-pos');
  const $text = document.getElementById('rs-text');
  const $file = document.getElementById('rs-file');
  const $filemsg = document.getElementById('rs-filemsg');
  const $count = document.getElementById('rs-count');
  const $go = document.getElementById('rs-go');
  const $skip = document.getElementById('rs-skip');
  const $msg = document.getElementById('rs-msg');
  const $result = document.getElementById('rs-result');
  const $actions = document.getElementById('rs-actions');
  const $formCard = document.getElementById('rs-form-card');

  // 当前目标岗位（可切换）——不匹配时在停止页直接换岗位重跑，简历不必重新粘贴
  let curIndustry = industry, curRole = role, curLevel = level, curRoleData = roleData;

  function renderPos() {
    $pos.innerHTML =
      '<span class="rs-pill">行业 <b>' + esc(curIndustry) + '</b></span>' +
      '<span class="rs-pill">岗位 <b>' + esc(curRole) + '</b></span>' +
      '<span class="rs-pill">层级 <b>' + esc(curLevel) + '</b></span>' +
      '<span class="rs-pill">档位 <b>' + esc(tierName) + '</b></span>';
  }
  renderPos();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function track(name, props) {
    try { if (window.Analytics) window.Analytics.track(name, props || {}); } catch (e) { /* ignore */ }
  }

  function setMsg(text, kind) {
    $msg.textContent = text || '';
    $msg.className = 'fb-msg' + (kind ? ' ' + kind : '');
  }

  function interviewUrl(extra) {
    const p = new URLSearchParams({ industry: curIndustry, role: curRole, level: curLevel, tier: tierKey });
    if (lenParam) p.set('len', lenParam);
    if (practiceParam) p.set('practice', practiceParam);   // 透传练习模式
    if (depth && depth !== 'auto') p.set('depth', depth);
    Object.keys(extra || {}).forEach(k => { if (extra[k]) p.set(k, extra[k]); });
    return 'interview.html?' + p.toString();
  }

  function storeResume(text, match, forced) {
    // 经统一存储层写入：resume 被声明为 private（仅 session、离开即清），
    // 若有人误改成 localStorage，Store 会直接拒绝并报错
    window.Store.set('resume', {
      text: text,
      match: match,
      industry: curIndustry,
      role: curRole,
      level: curLevel,
      tier: tierKey,
      lowMatch: !match.pass,
      forced: !!forced,
      at: Date.now()
    });
  }

  // ---- 字数统计 ----
  function refreshCount() {
    $count.textContent = ($text.value.trim().length) + ' 字';
  }
  $text.addEventListener('input', refreshCount);
  refreshCount();

  // ---- 跳过简历 ----
  $skip.addEventListener('click', () => {
    window.Store.remove('resume');
    track('resume_skip', { role: curRole, industry: curIndustry });
    location.href = interviewUrl();
  });

  // ---- 文件解析 ----
  const SCRIPT_LOADED = {};
  function loadScript(src) {
    if (SCRIPT_LOADED[src]) return SCRIPT_LOADED[src];
    SCRIPT_LOADED[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('解析库加载失败：' + src));
      document.head.appendChild(s);
    });
    return SCRIPT_LOADED[src];
  }

  async function parsePdf(file) {
    await loadScript('assets/js/vendor/pdf.min.js');
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('PDF 解析库未就绪');
    lib.GlobalWorkerOptions.workerSrc = 'assets/js/vendor/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
    const parts = [];
    const maxPages = Math.min(pdf.numPages, 30); // 简历一般不超过 30 页，防卡死
    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      let line = '';
      tc.items.forEach(it => {
        line += it.str || '';
        if (it.hasEOL) line += '\n';
      });
      parts.push(line);
    }
    return parts.join('\n').replace(/[ \t]+/g, ' ').trim();
  }

  async function parseDocx(file) {
    await loadScript('assets/js/vendor/mammoth.browser.min.js');
    if (!window.mammoth) throw new Error('Word 解析库未就绪');
    const buf = await file.arrayBuffer();
    const out = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return String((out && out.value) || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  async function parseTxt(file) {
    return await file.text();
  }

  $file.addEventListener('change', async () => {
    const f = $file.files && $file.files[0];
    if (!f) return;
    const name = f.name || '';
    const ext = (name.split('.').pop() || '').toLowerCase();
    $filemsg.className = 'fb-msg';
    $filemsg.textContent = '正在解析 ' + name + ' …';

    try {
      let text = '';
      if (ext === 'pdf') text = await parsePdf(f);
      else if (ext === 'docx') text = await parseDocx(f);
      else if (ext === 'txt' || ext === 'md' || ext === 'markdown') text = await parseTxt(f);
      else if (ext === 'doc') throw new Error('不支持老版 .doc，请在 Word 里另存为 .docx 或直接粘贴');
      else throw new Error('不支持的文件类型：.' + ext);

      text = String(text || '').trim();
      if (!text || text.length < 20) {
        throw new Error('没解析出文字（可能是扫描版 PDF 或纯图片）。请直接粘贴简历正文');
      }

      $text.value = text;
      refreshCount();
      $filemsg.className = 'fb-msg ok';
      $filemsg.textContent = '已导入 ' + name + '（' + text.length + ' 字）';
      track('resume_file_parse', { ext: ext, ok: true, chars: text.length });
    } catch (e) {
      $filemsg.className = 'fb-msg err';
      $filemsg.textContent = e && e.message ? e.message : '解析失败，请直接粘贴';
      track('resume_file_parse', { ext: ext, ok: false });
    } finally {
      $file.value = ''; // 允许重复选同一个文件
    }
  });

  // ---- 匹配 ----
  function renderResult(match, text) {
    const passed = !!match.pass;
    const low = !passed;
    const scoreCls = passed ? 'rs-score' : 'rs-score low';

    const listHTML = (title, arr, cls) => {
      if (!arr || !arr.length) return '';
      return '<div class="rs-list ' + (cls || '') + '"><h4>' + title + '</h4><ul>' +
        arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
    };

    // 只有通过（或强行继续）时才展示深挖点；不匹配时面试不会开始，展示会误导
    const probe = passed ? listHTML('面试会重点深挖（来自你的简历）', match.probe_points, 'probe') : '';
    const hits = listHTML('与你岗位相符的点', match.hits);
    const gaps = listHTML('相对岗位要求的缺口', match.gaps);

    let actionsHTML = '';
    if (passed) {
      actionsHTML =
        '<div class="rs-result-actions">' +
        '<button class="btn btn-primary btn-lg" id="rs-enter">进入面试 →</button>' +
        '<a class="btn btn-ghost" href="index.html">换个岗位</a>' +
        '</div>';
    } else {
      actionsHTML =
        '<div class="rs-switch">' +
        '<div class="rs-switch-title">换个更合适的岗位，用这份简历重新匹配（不用重新粘贴）：</div>' +
        '<div class="rs-switch-row">' +
        '<select id="rs-sw-ind"></select>' +
        '<select id="rs-sw-role"></select>' +
        '<button class="btn btn-primary btn-sm" id="rs-sw-go">重新匹配 →</button>' +
        '</div></div>' +
        '<div class="rs-result-actions">' +
        '<button class="btn btn-ghost" id="rs-retry">重新填写简历</button>' +
        '<a class="btn btn-ghost" href="index.html">回首页换行业</a>' +
        '</div>' +
        '<button class="rs-force" id="rs-force">我了解风险，仍要继续这场面试 →</button>';
    }

    $result.innerHTML =
      '<div class="card-title"><span class="ic"></span>简历与岗位匹配分析</div>' +
      '<div class="rs-score-wrap">' +
      '<div class="' + scoreCls + '">' + match.score + '<small>/ 100</small></div>' +
      '<div class="rs-verdict">' + esc(match.verdict) +
      '<br><span class="rs-tag ' + (passed ? 'ok' : 'warn') + '">' +
      (match.lenient
        ? '基础匹配（未接 AI）· 已放行，严格判定请开启 AI'
        : (passed ? '匹配 · 可以开始针对性面试' : '匹配度不足 · 建议先调整岗位或补充经历')) +
      '</span></div>' +
      '</div>' +
      (match.fallbackReason ? '<div class="rs-fallback">' + esc(match.fallbackReason) + '</div>' : '') +
      (hits || gaps ? '<div class="rs-lists">' + hits + gaps + '</div>' : '') +
      probe +
      actionsHTML;

    $result.classList.add('show');
    if ($actions) $actions.style.display = 'none';
    if ($formCard) $formCard.style.display = 'none';
    setMsg('');

    if (passed) {
      const $enter = document.getElementById('rs-enter');
      $enter.addEventListener('click', () => {
        storeResume(text, match, false);
        track('resume_match', { engine: match.engine, score: match.score, pass: true });
        location.href = interviewUrl({ resume: '1' });
      });
    } else {
      const $retry = document.getElementById('rs-retry');
      if ($retry) $retry.addEventListener('click', () => {
        $result.classList.remove('show');
        if ($actions) $actions.style.display = '';
        if ($formCard) $formCard.style.display = '';
        $text.focus();
        $text.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const $force = document.getElementById('rs-force');
      if ($force) $force.addEventListener('click', () => {
        storeResume(text, match, true);
        track('resume_match', { engine: match.engine, score: match.score, pass: false, forced: true });
        location.href = interviewUrl({ resume: '1', lowmatch: '1' });
      });
      bindSwitcher(text);
    }
    $result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // 停止页的「换岗位」选择器：切换行业/岗位后原地重跑匹配，简历始终留在页面上
  function bindSwitcher(text) {
    const $ind = document.getElementById('rs-sw-ind');
    const $role = document.getElementById('rs-sw-role');
    const $swGo = document.getElementById('rs-sw-go');
    if (!$ind || !$role || !$swGo) return;

    const inds = D.listIndustries().slice();
    $ind.innerHTML = inds.map(i => '<option value="' + esc(i) + '"' + (i === curIndustry ? ' selected' : '') + '>' + esc(i) + '</option>').join('');
    $role.innerHTML = D.listRoles($ind.value).map(r => '<option value="' + esc(r) + '"' + (r === curRole ? ' selected' : '') + '>' + esc(r) + '</option>').join('');

    $ind.addEventListener('change', async () => {
      $role.disabled = true;
      try {
        await D.loadIndustry($ind.value);
        $role.innerHTML = D.listRoles($ind.value).map(r => '<option value="' + esc(r) + '">' + esc(r) + '</option>').join('');
      } catch (e) {
        $role.innerHTML = '';
      } finally {
        $role.disabled = false;
      }
    });

    $swGo.addEventListener('click', async () => {
      const ni = $ind.value, nr = $role.value;
      if (!ni || !nr) return;
      if (ni === curIndustry && nr === curRole) {
        setMsg('已经选的是这个岗位了，换一个试试。', 'err');
        return;
      }
      $swGo.disabled = true;
      const old = $swGo.textContent;
      $swGo.textContent = '匹配中…';
      try {
        await D.loadIndustry(ni);
        const rd = D.getRole(ni, nr);
        if (!rd) { setMsg('该岗位暂无题库数据，换一个试试。', 'err'); return; }
        curIndustry = ni;
        curRole = nr;
        curRoleData = rd;
        const lvls = D.listLevels(ni, nr);
        curLevel = lvls.indexOf(curLevel) >= 0 ? curLevel : (lvls[0] || '通用');
        renderPos();
        try {
          const p = new URLSearchParams({ industry: ni, role: nr, level: curLevel, tier: tierKey });
          if (depth && depth !== 'auto') p.set('depth', depth);
          history.replaceState(null, '', 'resume.html?' + p.toString());
        } catch (e) { /* ignore */ }
        track('resume_switch_role', { industry: ni, role: nr });
        await runMatch(text);
      } finally {
        $swGo.disabled = false;
        $swGo.textContent = old;
      }
    });
  }

  async function runMatch(text) {
    $go.disabled = true;
    const oldLabel = $go.textContent;
    $go.textContent = 'AI 正在比对简历与岗位…';
    setMsg('正在分析，通常需要几秒。若云端较慢，会自动降级为基础匹配。');

    let match;
    try {
      match = await ResumeMatcher.check(text, {
        industry: curIndustry, role: curRole, level: curLevel, roleData: curRoleData
      });
    } catch (e) {
      match = {
        score: 0, pass: false, hits: [], gaps: [], probe_points: [],
        verdict: '匹配分析失败：' + (e && e.message ? e.message : '未知错误') + '。你可以重试，或先跳过简历直接面试。',
        engine: 'error'
      };
    }

    $go.disabled = false;
    $go.textContent = oldLabel;

    if (match.invalid) {
      setMsg(match.verdict, 'err');
      return;
    }
    renderResult(match, text);
  }

  $go.addEventListener('click', () => {
    const text = $text.value.trim();
    if (text.length < (window.ResumeMatcher ? ResumeMatcher.MIN_RESUME : 30)) {
      setMsg('简历还太短，至少写 30 字：教育背景、工作经历或项目经历都行。', 'err');
      $text.focus();
      return;
    }
    runMatch(text);
  });
})();
