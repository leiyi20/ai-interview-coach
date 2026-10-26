/* ===== 分档攻略 ===== */
(async function () {
  Nav.render('tiers.html');
  const D = window.Data;
  const data = await D.loadCatalog();
  const tiers = data.tiers.tiers;
  const order = ['bigtech', 'startup', 'foreign', 'civserv'];
  const names = { bigtech:'大厂', startup:'小厂', foreign:'外企', civserv:'体制内' };

  const $tabs = document.getElementById('tabs');
  const $detail = document.getElementById('tier-detail');
  const $cross = document.getElementById('cross');

  $tabs.innerHTML = order.map(k => `<div class="tab" data-k="${k}">${names[k]}</div>`).join('');

  function renderDetail(k) {
    const t = tiers[k];
    const w = t.competency_weights;
    // 权重条（取可见维度）
    const wrows = Object.keys(w).filter(key => w[key] > 0).map(key => {
      const labelMap = {
        professional:'专业能力', logic:'逻辑思维', communication:'沟通表达', learning:'学习潜力',
        teamwork:'团队合作', resilience:'抗压稳定', responsibility:'责任心', leadership:'领导力', stability:'稳定性/价值观'
      };
      return `<div class="wrow"><div class="wname">${labelMap[key]||key}</div>
        <div class="wtrack"><div class="wfill" style="width:${w[key]*100}%"></div></div>
        <div class="wval">${Math.round(w[key]*100)}%</div></div>`;
    }).join('');

    const rounds = t.process_model.rounds.map(r => `<span class="tag">${r}</span>`).join(' ');
    const prep = t.prep_advice.map(p => `<li>${p}</li>`).join('');

    $detail.innerHTML = `
      <div class="card">
        <div class="card-title"><span class="ic"></span>${t.name}</div>
        <div class="grid-2">
          <div>
            <div class="field"><div class="field-label">招聘逻辑</div><div>${t.hiring_logic}</div></div>
            <div class="field"><div class="field-label">核心问题</div><div><b style="color:var(--wb-blue)">${t.core_question}</b></div></div>
            <div class="field"><div class="field-label">决策模型</div><div>${t.decision_model}</div></div>
          </div>
          <div>
            <div class="field"><div class="field-label">面试流程</div><div class="tags">${rounds}</div>
              <div class="qdiff" style="margin-top:6px;">单轮约 ${t.process_model.single_round_minutes} 分钟 · 总周期 ${t.process_model.total_duration}</div></div>
            <div class="field"><div class="field-label">题库侧重</div><div>${t.question_bias.emphasis}</div></div>
            <div class="field"><div class="field-label">评分方式</div><div>${t.scoring_note}</div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ic"></span>能力权重分布（${names[k]}）</div>
        ${wrows}
      </div>

      <div class="card">
        <div class="card-title"><span class="ic"></span>备考策略</div>
        <ul style="margin:0;padding-left:20px;line-height:2;">${prep}</ul>
        <div style="margin-top:12px;"><a class="btn btn-primary" href="index.html?tier=${k}">用「${names[k]}」档位开始模拟 →</a></div>
      </div>`;
  }

  // 对比表
  const cc = data.tiers.cross_comparison;
  const dims = cc.dimensions;
  const rows = order.map(k => {
    const cells = cc.rows[k].map(c => `<td>${c}</td>`).join('');
    return `<tr><td><b>${names[k]}</b></td>${cells}</tr>`;
  }).join('');
  $cross.innerHTML = `<table class="tbl"><thead><tr><th>维度</th>${order.map(k=>`<th>${names[k]}</th>`).join('')}</tr></thead>
    <tbody>${dims.map((d,i)=>`<tr><td><b>${d}</b></td>${order.map(k=>`<td>${cc.rows[k][i]}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  $tabs.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    $tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderDetail(tab.dataset.k);
  });

  $tabs.querySelector('.tab').classList.add('active');
  renderDetail('bigtech');
})();
