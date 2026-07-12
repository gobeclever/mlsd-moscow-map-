/* ============================================================
   MLSD Web Map — дэшборд (блок под картой, Z-паттерн)
   1 (верх-лево):  KPI выбранного агрегата
   2 (верх-право): выбор полигональной структуры агрегации
   3 (низ-лево):   структура по слайдам + 100%-стек
   4 (низ-право):  разбивка слайда на категории + 100%-стек
   5 (широкий):    сравнение агрегатов одного уровня
                   (точки, плотности, население, площадь, жилплощадь)
   Учитывает фильтры карты: выключенные слайды/категории
   пропадают из диаграмм.
   ============================================================ */

'use strict';

(function () {

  const el = (id) => document.getElementById(id);

  const dash = {
    scope: 'all',        // all | moscow | okruga | rayony | zones
    unitOkr: null,
    unitRay: null,
    unitZone: null,
    slide: null,         // выбранный слайд (группа 1)
    lastPts: [],
    lastTotal: 0
  };

  /* ---------------- выбор структуры агрегации ---------------- */

  const SCOPES = ['all', 'moscow', 'okruga', 'rayony', 'zones'];
  SCOPES.forEach(s =>
    el('dsc-' + s).addEventListener('click', () => {
      dash.scope = s;
      SCOPES.forEach(x => el('dsc-' + x).classList.toggle('active', x === s));
      updateDashboard();
    }));

  el('dash-unit').addEventListener('change', (e) => {
    if (dash.scope === 'okruga') dash.unitOkr = e.target.value;
    else if (dash.scope === 'rayony') dash.unitRay = e.target.value;
    else if (dash.scope === 'zones') dash.unitZone = e.target.value;
    updateDashboard();
  });

  /* ---------------- геометрия агрегатов ---------------- */

  let moscowPrep = null;
  async function getMoscowPrep() {
    if (!moscowPrep) {
      const gj = await (await fetch('data/moscow.geojson')).json();
      moscowPrep = prepGeometry(gj.features[0].geometry);
    }
    return moscowPrep;
  }

  const zonePreps = new Map(); // zone id -> polys
  function prepForZone(z) {
    if (!zonePreps.has(z.id)) {
      const polys = [];
      for (const f of z.gj.features) {
        const g = f.geometry;
        if (g && (g.type === 'Polygon' || g.type === 'MultiPolygon'))
          polys.push(...prepGeometry(g));
      }
      zonePreps.set(z.id, polys);
    }
    return zonePreps.get(z.id);
  }

  function countInZone(z, pts) {
    const prep = prepForZone(z);
    return prep.length ? pts.filter(p => ptInFeature(p.lon, p.lat, prep)) : [];
  }

  /* ---------------- обновление дэшборда ---------------- */

  let updSeq = 0;
  async function updateDashboard() {
    const my = ++updSeq;
    const all = filteredPoints();
    let pts = all;
    let unitOptions = null, unitValue = null, note = '';

    try {
      if (dash.scope === 'moscow') {
        const prep = await getMoscowPrep();
        pts = all.filter(p => ptInFeature(p.lon, p.lat, prep));

      } else if (dash.scope === 'okruga' || dash.scope === 'rayony') {
        const data = await getAdminData(dash.scope);
        const names = data.feats.map(f => f.name).sort((a, b) => a.localeCompare(b, 'ru'));
        let cur = dash.scope === 'okruga' ? dash.unitOkr : dash.unitRay;
        if (!names.includes(cur)) cur = names[0];
        if (dash.scope === 'okruga') dash.unitOkr = cur; else dash.unitRay = cur;
        unitOptions = names.map(n => ({ value: n, label: n }));
        unitValue = cur;
        const feat = data.feats.find(f => f.name === cur);
        pts = feat ? pointsInFeature(feat, all) : [];

      } else if (dash.scope === 'zones') {
        const zs = window.dashboardZones ? window.dashboardZones() : [];
        if (!zs.length) {
          pts = [];
          unitOptions = [];
          note = 'Зоны не загружены — добавьте их в блоке «Зоны доступности»';
        } else {
          let cur = dash.unitZone;
          if (!zs.some(z => String(z.id) === String(cur))) cur = String(zs[0].id);
          dash.unitZone = cur;
          unitOptions = zs.map(z => ({ value: String(z.id), label: z.name }));
          unitValue = cur;
          pts = countInZone(zs.find(z => String(z.id) === String(cur)), all);
        }
      }
    } catch (e) {
      console.error('Дэшборд: не удалось посчитать агрегат', e);
    }

    if (my !== updSeq) return;
    dash.lastPts = pts;
    dash.lastTotal = all.length;
    renderUnitSelect(unitOptions, unitValue);
    el('dash-note').textContent = note;
    renderDash(pts, all.length);
    renderComparison(true);
  }
  window.updateDashboard = updateDashboard;

  function renderUnitSelect(options, value) {
    const sel = el('dash-unit');
    if (options === null) { sel.classList.add('hidden'); return; }
    sel.classList.remove('hidden');
    sel.innerHTML = options
      .map(o => `<option value="${escHtml(o.value)}"${o.value === value ? ' selected' : ''}>${escHtml(o.label)}</option>`)
      .join('');
    sel.disabled = !options.length;
  }

  /* ---------------- панели 3 и 4: слайды и категории ---------------- */

  function renderDash(pts, totalFiltered) {
    const slides = new Map();
    for (const p of pts) slides.set(p.g1, (slides.get(p.g1) || 0) + 1);
    const slidesSorted = [...slides.entries()].sort((a, b) => b[1] - a[1]);

    if (!slides.has(dash.slide)) dash.slide = slidesSorted.length ? slidesSorted[0][0] : null;

    const cats = new Map();
    for (const p of pts) if (p.g1 === dash.slide) cats.set(p.g2, (cats.get(p.g2) || 0) + 1);
    let catsSorted = [...cats.entries()].sort((a, b) => b[1] - a[1]);
    const slideTotal = catsSorted.reduce((a, e) => a + e[1], 0);

    // после 10-й категории — объединяем в серые «Другие»
    if (catsSorted.length > CAT_COLORS.length) {
      const rest = catsSorted.slice(CAT_COLORS.length).reduce((a, e) => a + e[1], 0);
      catsSorted = catsSorted.slice(0, CAT_COLORS.length);
      catsSorted.push(['Другие', rest]);
    }

    // KPI
    el('dk-count').textContent = pts.length.toLocaleString('ru-RU');
    el('dk-share').textContent = totalFiltered
      ? (pts.length / totalFiltered * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%'
      : '—';
    el('dk-slides').textContent = slides.size.toLocaleString('ru-RU');
    el('dk-cats').textContent = pts.length
      ? new Set(pts.map(p => p.g1 + '␟' + p.g2)).size.toLocaleString('ru-RU')
      : '0';

    // слайды: 100%-стек + бары с долями от агрегата
    const slideColor = (g1) => state.colors.get(g1) || '#69797E';
    renderStack(el('dash-slides-stack'), slidesSorted, slideColor, pts.length);
    renderBars(el('dash-slides'), slidesSorted, {
      colorFn: slideColor,
      activeKey: dash.slide,
      pctTotal: pts.length,
      onClick: (g1) => {
        dash.slide = g1;
        renderDash(dash.lastPts, dash.lastTotal);
      }
    });

    // категории: 100%-стек + бары с долями от слайда
    el('dash-cat-title').textContent = dash.slide || '—';
    renderStack(el('dash-cats-stack'), catsSorted, catColor, slideTotal);
    renderBars(el('dash-cats'), catsSorted, {
      colorFn: catColor,
      pctTotal: slideTotal
    });
  }

  /* Качественная палитра CARTO «Bold» для категорий; хвост — серый */
  const CAT_COLORS = [
    '#7F3C8D', '#11A579', '#3969AC', '#F2B701', '#E73F74',
    '#80BA5A', '#E68310', '#008695', '#CF1C90', '#f97b72'
  ];
  const CAT_GRAY = '#A5AA99';
  const catColor = (name, i) =>
    name === 'Другие' || i >= CAT_COLORS.length ? CAT_GRAY : CAT_COLORS[i];

  /* 100%-стек (столбчатая диаграмма с накоплением) */
  function renderStack(container, entries, colorFn, total) {
    container.innerHTML = '';
    if (!entries.length || !total) { container.classList.add('hidden'); return; }
    container.classList.remove('hidden');
    entries.forEach(([name, count], i) => {
      const s = document.createElement('span');
      s.style.width = (count / total * 100) + '%';
      s.style.background = colorFn(name, i);
      s.title = `${name}: ${count.toLocaleString('ru-RU')} (${(count / total * 100).toFixed(1)}%)`;
      container.appendChild(s);
    });
  }

  /* горизонтальные бары */
  function renderBars(container, entries, { colorFn, activeKey, onClick, pctTotal, fmt } = {}) {
    fmt = fmt || ((v) => v.toLocaleString('ru-RU'));
    container.innerHTML = '';
    if (!entries.length) {
      container.innerHTML = '<div class="dash-empty">Нет данных — проверьте фильтры и агрегат</div>';
      return;
    }
    const max = entries[0][1];
    entries.forEach(([name, value], i) => {
      const row = document.createElement('div');
      row.className = 'bar-row' + (onClick ? ' clickable' : '') + (name === activeKey ? ' active' : '');
      const pct = pctTotal
        ? `<span class="bar-pct">${(value / pctTotal * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%</span>`
        : '';
      row.innerHTML = `
        <span class="bar-label" title="${escHtml(name)}">${escHtml(name)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${(value / max * 100).toFixed(1)}%;background:${colorFn(name, i)}"></span></span>
        <span class="bar-val">${fmt(value)}</span>${pct}`;
      if (onClick) row.addEventListener('click', () => onClick(name));
      container.appendChild(row);
    });
  }

  /* ---------------- панель 5: сравнение агрегатов ---------------- */

  const cmp = { level: 'okruga', metric: 'points', selected: new Set() };

  const CMP_METRICS_ADMIN = [
    ['points', 'Точек (по фильтрам)'],
    ['density_area', 'Точек на 1 км²'],
    ['density_pop', 'Точек на 100 тыс. жителей'],
    ['density_housing', 'Точек на 1 млн кв.м жилья'],
    ['pop', 'Население (оценка), чел.'],
    ['area', 'Площадь, км²'],
    ['housing', 'Жилая площадь, кв.м']
  ];
  const CMP_METRICS_ZONES = [['points', 'Точек (по фильтрам)']];

  const CMP_LEVELS = ['okruga', 'rayony', 'zones'];
  CMP_LEVELS.forEach(l =>
    el('cmp-' + l).addEventListener('click', () => {
      cmp.level = l;
      cmp.selected.clear();
      CMP_LEVELS.forEach(x => el('cmp-' + x).classList.toggle('active', x === l));
      renderComparison(true);
    }));

  el('cmp-metric').addEventListener('change', (e) => {
    cmp.metric = e.target.value;
    renderComparison(false);
  });

  el('cmp-units').addEventListener('change', (e) => {
    cmp.selected = new Set([...e.target.selectedOptions].map(o => o.value));
    renderComparison(false);
  });

  async function getCmpItems() {
    if (cmp.level === 'zones') {
      const zs = window.dashboardZones ? window.dashboardZones() : [];
      return zs.map(z => ({ key: 'z' + z.id, name: z.name, zone: z }));
    }
    const data = await getAdminData(cmp.level);
    return data.feats
      .map(f => ({ key: f.name, name: f.name, feat: f }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }

  let cmpSeq = 0;
  async function renderComparison(repopulate) {
    const my = ++cmpSeq;
    let items;
    try { items = await getCmpItems(); }
    catch (e) { console.error('Сравнение: не удалось загрузить слой', e); return; }
    if (my !== cmpSeq) return;

    // метрики уровня
    const metrics = cmp.level === 'zones' ? CMP_METRICS_ZONES : CMP_METRICS_ADMIN;
    if (!metrics.some(m => m[0] === cmp.metric)) cmp.metric = 'points';
    const msel = el('cmp-metric');
    msel.innerHTML = metrics
      .map(([v, l]) => `<option value="${v}"${v === cmp.metric ? ' selected' : ''}>${l}</option>`)
      .join('');

    // список единиц
    const validKeys = new Set(items.map(i => i.key));
    cmp.selected = new Set([...cmp.selected].filter(k => validKeys.has(k)));
    if (!cmp.selected.size) items.slice(0, 5).forEach(i => cmp.selected.add(i.key));
    if (repopulate) {
      el('cmp-units').innerHTML = items
        .map(i => `<option value="${escHtml(i.key)}"${cmp.selected.has(i.key) ? ' selected' : ''}>${escHtml(i.name)}</option>`)
        .join('');
    }
    el('cmp-note').textContent = cmp.level === 'zones' && !items.length
      ? 'Зоны не загружены — добавьте их в блоке «Зоны доступности»' : '';

    // расчёт метрики
    const chosen = items.filter(i => cmp.selected.has(i.key));
    const all = filteredPoints();
    const needPts = ['points', 'density_area', 'density_pop', 'density_housing'].includes(cmp.metric);
    const rows = [];
    for (const it of chosen) {
      let n = 0;
      if (needPts) {
        n = it.feat ? pointsInFeature(it.feat, all).length : countInZone(it.zone, all).length;
      }
      const f = it.feat || {};
      let v = null;
      switch (cmp.metric) {
        case 'points':       v = n; break;
        case 'density_area': v = f.area > 0 ? n / f.area : null; break;
        case 'density_pop':  v = f.pop > 0 ? n / f.pop * 100000 : null; break;
        case 'density_housing': v = f.housing > 0 ? n / f.housing * 1000000 : null; break;
        case 'pop':          v = f.pop || null; break;
        case 'area':         v = f.area || null; break;
        case 'housing':      v = f.housing || null; break;
      }
      if (v !== null) rows.push([it.name, v]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    renderBars(el('cmp-bars'), rows, {
      colorFn: (name, i) => CONFIG.palette[i % CONFIG.palette.length],
      fmt: fmtVal
    });
  }

})();
