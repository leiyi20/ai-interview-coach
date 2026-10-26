/* ===== 首页：四级联动选择 ===== */
(async function () {
  Nav.render('index.html');
  const D = window.Data;
  await D.loadCatalog();

  // 新手提示：可关闭，记住选择
  const $onboard = document.getElementById('onboard-tip');
  if ($onboard) {
    try { if (localStorage.getItem('wb_onboard_dismissed') === '1') $onboard.style.display = 'none'; } catch (e) { /* ignore */ }
    const $close = document.getElementById('ot-close');
    if ($close) $close.onclick = () => {
      $onboard.style.display = 'none';
      try { localStorage.setItem('wb_onboard_dismissed', '1'); } catch (e) { /* ignore */ }
    };
  }

  const $ind = document.getElementById('sel-industry');
  const $role = document.getElementById('sel-role');
  const $lvl = document.getElementById('sel-level');
  const $grid = document.getElementById('tier-grid');
  const $start = document.getElementById('btn-start');
  const $resumeBtn = document.getElementById('btn-resume');
  const $hint = document.getElementById('hint');

  let selectedTier = null;

  // 行业（标档置顶）—— 横向铺开：全部行业领域均可选
  const industries = D.listIndustries();
  const bm = window.SITE_CONFIG.BENCHMARK_INDUSTRY;
  industries.sort((a, b) => (a === bm ? -1 : b === bm ? 1 : 0));

  // 覆盖度横幅
  const g = D.globalStats();
  document.getElementById('cov-ind').textContent = g.industries;
  document.getElementById('cov-role').textContent = g.roles;
  document.getElementById('cov-q').textContent = g.questions;

  // 行业快捷卡（含该行业考察侧重与热门岗位）
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const $indGrid = document.getElementById('industry-grid');
  $indGrid.innerHTML = industries.map(i => {
    const s = D.industryStats(i);
    const blurb = D.getIndustryBlurb(i);
    const ind = D.getIndustry(i);
    const hot = (ind && ind.roles ? ind.roles : []).slice(0, 3).map(r => r.role).join(' · ');
    return `<div class="ind-card${i === bm ? ' active' : ''}" data-ind="${i}">
      <div class="ind-name">${esc(i)}</div>
      ${blurb ? `<div class="ind-blurb">${esc(blurb)}</div>` : ''}
      <div class="ind-sub">${s.roles} 个岗位 · ${s.questions} 道题</div>
      ${hot ? `<div class="ind-hot">常考：${esc(hot)}</div>` : ''}
    </div>`;
  }).join('');
  $indGrid.querySelectorAll('.ind-card').forEach(card => {
    card.addEventListener('click', () => {
      $ind.value = card.dataset.ind;
      $indGrid.querySelectorAll('.ind-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      fillRoles();
    });
  });

  $ind.innerHTML = industries.map(i => {
    const s = D.industryStats(i);
    return `<option value="${i}">${i}（${s.roles}岗·${s.questions}题）</option>`;
  }).join('');
  $ind.value = bm;

  function fillRoles() {
    const roles = D.listRoles($ind.value);
    $role.innerHTML = roles.map(r => `<option value="${r}">${r}</option>`).join('');
    fillLevels();
  }
  function fillLevels() {
    const lvls = D.listLevels($ind.value, $role.value);
    $lvl.innerHTML = lvls.map(l => `<option value="${l}">${l}</option>`).join('');
    updateHint();
  }

  // 档位卡片
  const tierData = (await D.loadCatalog()).tiers.tiers;
  const tierOrder = ['bigtech', 'startup', 'foreign', 'civserv'];
  $grid.innerHTML = tierOrder.map(k => {
    const t = tierData[k];
    return `<div class="tier-card" data-tier="${k}">
      <div class="check">✓</div>
      <div class="tname">${t.name.split('（')[0]}</div>
      <div class="tdesc">${t.core_question}</div>
    </div>`;
  }).join('');
  $grid.querySelectorAll('.tier-card').forEach(card => {
    card.addEventListener('click', () => {
      $grid.querySelectorAll('.tier-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      selectedTier = card.dataset.tier;
      updateHint();
    });
  });

  // 支持从分档攻略页带 ?tier= 自动选中档位
  const presetTier = new URLSearchParams(location.search).get('tier');
  if (presetTier && tierData[presetTier]) {
    const c = $grid.querySelector(`.tier-card[data-tier="${presetTier}"]`);
    if (c) c.click();
  }

  function updateHint() {
    const ready = $role.value && $lvl.value && selectedTier;
    $start.disabled = !ready;
    if ($resumeBtn) $resumeBtn.disabled = !ready;
    if (ready) {
      const tname = tierData[selectedTier].name.split('（')[0];
      $hint.textContent = `即将进入「${$role.value} · ${$lvl.value} · ${tname}」的对话式模拟面试`;
    } else {
      $hint.textContent = selectedTier ? '' : '请选择一个公司档位';
    }
  }

  // 组装面试参数（直连面试与走简历页共用）
  function interviewParams() {
    const params = new URLSearchParams({
      industry: $ind.value,
      role: $role.value,
      level: $lvl.value,
      tier: selectedTier
    });
    const $depth = document.getElementById('sel-depth');
    const dv = $depth ? $depth.value : 'auto';
    if (dv && dv !== 'auto') params.set('depth', dv);
    return params;
  }

  $ind.addEventListener('change', fillRoles);
  $role.addEventListener('change', fillLevels);

  // 主入口：直接开面，简历不是必经步骤
  $start.addEventListener('click', () => {
    if (window.Analytics) window.Analytics.track('start_direct', {
      role: $role.value, industry: $ind.value, tier: selectedTier
    });
    location.href = 'interview.html?' + interviewParams().toString();
  });

  // 增强入口：先传简历做匹配，通过后再按简历出题
  if ($resumeBtn) {
    $resumeBtn.addEventListener('click', () => {
      if (window.Analytics) window.Analytics.track('start_with_resume', {
        role: $role.value, industry: $ind.value, tier: selectedTier
      });
      location.href = 'resume.html?' + interviewParams().toString();
    });
  }

  fillRoles();
})();
