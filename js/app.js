/* ============================================================
   MLSD Web Map — основной модуль
   Режимы: точки, кластеры, круговые диаграммы, гексагоны,
   агрегация по округам и районам (картодиаграмма).
   Фильтры, тултипы, попапы границ, рисование зоны,
   выгрузка CSV / XLSX / GeoJSON, подложки Positron/Dark/OSM.
   ============================================================ */

'use strict';

/* ------------------------------------------------------------
   КОНФИГУРАЦИЯ — здесь меняются названия полей и настройки.
   ------------------------------------------------------------ */
const CONFIG = {
  // Папка с данными и манифест (список csv-файлов)
  dataDir: 'MLSD_moscow_data/',
  manifest: 'MLSD_moscow_data/manifest.json',

  // Координаты
  fieldLat: 'Широта',
  fieldLon: 'Долгота',

  // Двухуровневая агрегация: группа 1 (слайд) → группа 2 (категория)
  fieldGroup1: 'Главная рубрика',
  fieldGroup2: 'Специализация сети',

  // Поля, показываемые в тултипе при наведении (в этом порядке).
  // Контакты и время работы не показываем.
  fieldName: 'Наименование',
  tooltipFields: [
    'Название сети',
    'Главная рубрика',
    'Специализация сети',
    'Рубрики',
    'Адрес',
    'Район',
    'Округ',
    'Рейтинг'
  ],

  emptyLabel: 'Не указано',

  // Границы (GeoJSON, WGS84)
  okrugaFile: 'data/okruga.geojson',
  rayonyFile: 'data/rayony.geojson',
  moscowFile: 'data/moscow.geojson',  // вся Москва (объединение округов)
  ringsFile:  'data/rings.geojson',   // Садовое кольцо, ТТК, МКАД

  // Поля атрибутивных таблиц округов/районов (индикативные показатели)
  adminFields: {
    nameCandidates: ['адм округ', 'мун округ', 'name:ru', 'name'],
    shortName: 'адм округ кратко',
    area: 'area km2',                   // площадь, км²
    pop:  'Насел пост (скоррект)',      // оценка населения, чел.
    housing: 'Жилпл 2025 (скоррект)'    // жилая площадь, кв.м
  },

  // Акцентная палитра проекта
  accent: {
    blue:  '#365D7E',
    teal:  '#44ACAA',
    peach: '#F0B398',
    coral: '#F67380',
    plum:  '#C06D84'
  },

  // Палитра для групп 1-го уровня (категории точек)
  palette: [
    '#365D7E', '#44ACAA', '#F67380', '#C06D84', '#E89A6C',
    '#5C8A64', '#7A6FB0', '#B08948', '#4A8FB5', '#A85C5C',
    '#6C8F7C', '#8E5C91', '#C2894E', '#587DA8', '#9C6F5A', '#69797E'
  ],

  // Шкала насыщенности для гексагонов и картодиаграмм —
  // последовательная палитра CARTO «DarkMint» (плавный переток).
  // Другие палитры с carto.com/carto-colors (заменить массив целиком):
  //   Mint:   ['#e4f1e1','#b4d9cc','#89c0b6','#63a6a0','#337f7f']
  //   Teal:   ['#d1eeea','#a8dbd9','#85c4c9','#68abb8','#3b738f']
  //   BluYl:  ['#f7feae','#b7e6a5','#7ccba2','#46aea0','#089099']
  //   Sunset: ['#f3e79b','#fac484','#f8a07e','#eb7f86','#ce6693']
  scaleColors: ['#d2fbd4', '#a5dbc2', '#7bbcb0', '#559c9e', '#235d72'],

  mapCenter: [55.751, 37.618],
  mapZoom: 10
};

/* ------------------------------------------------------------
   СОСТОЯНИЕ
   ------------------------------------------------------------ */
const state = {
  points: [],            // {row, lat, lon, g1, g2}
  headers: [],           // объединённые заголовки всех csv
  activeKeys: new Set(), // активные пары "g1␟g2"
  tree: new Map(),       // g1 -> Map(g2 -> count)
  colors: new Map(),     // g1 -> цвет
  mode: 'clusters',      // points | clusters | pie | hex | okruga | rayony
  indicator: 'abs',      // знаменатель картосхемы: abs | area | pop
  hexSizeHa: 10,
  selection: null,       // точки в нарисованной зоне
  filesLoaded: []
};

const SEP = '␟'; // разделитель ключей g1/g2

/* ------------------------------------------------------------
   КАРТА И ПОДЛОЖКИ
   ------------------------------------------------------------ */
const map = L.map('map', { preferCanvas: true, zoomControl: false })
  .setView(CONFIG.mapCenter, CONFIG.mapZoom);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

const basemaps = {
  positron: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', maxZoom: 20
  }),
  // Positron с CSS-фильтром: более серая, приглушённая версия
  gray: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', maxZoom: 20, className: 'gray-tiles'
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap, © CARTO', maxZoom: 20
  }),
  osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19
  })
};
basemaps.positron.addTo(map);

const BASEMAPS = ['positron', 'gray', 'dark', 'osm'];
BASEMAPS.forEach(k =>
  document.getElementById('base-' + k).addEventListener('click', () => setBasemap(k)));

function setBasemap(name) {
  Object.entries(basemaps).forEach(([k, layer]) => {
    if (k === name) { if (!map.hasLayer(layer)) layer.addTo(map); layer.bringToBack(); }
    else map.removeLayer(layer);
  });
  BASEMAPS.forEach(k =>
    document.getElementById('base-' + k).classList.toggle('active', k === name));
  document.getElementById('map').classList.toggle('dark-base', name === 'dark');
}

/* ------------------------------------------------------------
   СЛОИ ДАННЫХ
   ------------------------------------------------------------ */

/* Обычные кластеры */
const clusterGroup = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 55,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 17,
  iconCreateFunction: (cluster) => {
    const n = cluster.getChildCount();
    let size = 'c-s', px = 28;
    if (n >= 1000)     { size = 'c-xl'; px = 70; }
    else if (n >= 250) { size = 'c-l';  px = 56; }
    else if (n >= 50)  { size = 'c-m';  px = 42; }
    return L.divIcon({
      html: `<div>${n.toLocaleString('ru-RU')}</div>`,
      className: `mlsd-cluster ${size}`,
      iconSize: [px, px]
    });
  }
});

/* Кластеры — круговые диаграммы (как на chill-time) */
const pieGroup = L.markerClusterGroup({
  chunkedLoading: true,
  maxClusterRadius: 60,
  spiderfyOnMaxZoom: true,
  disableClusteringAtZoom: 17,
  iconCreateFunction: (cluster) => {
    const children = cluster.getAllChildMarkers();
    const n = children.length;
    const tally = new Map();
    for (const m of children) {
      const g = m.options.g1 || CONFIG.emptyLabel;
      tally.set(g, (tally.get(g) || 0) + 1);
    }
    const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
    let acc = 0;
    const stops = sorted.map(([g, c]) => {
      const from = acc / n * 360;
      acc += c;
      const to = acc / n * 360;
      return `${state.colors.get(g) || '#69797E'} ${from.toFixed(1)}deg ${to.toFixed(1)}deg`;
    }).join(', ');
    let px = 32;
    if (n >= 1000) px = 76; else if (n >= 250) px = 62; else if (n >= 50) px = 46;
    return L.divIcon({
      html: `<div class="pie" style="background:conic-gradient(${stops})"><span>${n.toLocaleString('ru-RU')}</span></div>`,
      className: 'mlsd-pie',
      iconSize: [px, px]
    });
  }
});

const pointsLayer = L.layerGroup();  // просто точки, без агрегации
let hexLayer = null;                 // гексагоны
let aggLayer = null;                 // картодиаграмма по округам/районам

const drawnItems = new L.FeatureGroup().addTo(map);
let zoneLayer = null;                // текущая нарисованная зона

/* ------------------------------------------------------------
   ЗАГРУЗКА ДАННЫХ
   ------------------------------------------------------------ */
async function loadData() {
  let files;
  try {
    const resp = await fetch(CONFIG.manifest, { cache: 'no-store' });
    if (!resp.ok) throw new Error('manifest not found');
    files = (await resp.json()).files;
  } catch (e) {
    showLoadError();
    return;
  }

  for (const f of files) {
    try {
      const rows = await parseCsvUrl(CONFIG.dataDir + encodeURIComponent(f));
      addRows(rows, f);
    } catch (e) {
      console.error('Не удалось загрузить', f, e);
    }
  }

  if (state.points.length === 0) { showLoadError(); return; }
  finishLoading();
}

function parseCsvUrl(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: reject
    });
  });
}

function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => resolve(res.data),
      error: reject
    });
  });
}

function addRows(rows, sourceName) {
  let added = 0;
  for (const row of rows) {
    const lat = parseFloat(String(row[CONFIG.fieldLat] ?? '').replace(',', '.'));
    const lon = parseFloat(String(row[CONFIG.fieldLon] ?? '').replace(',', '.'));
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const g1 = (row[CONFIG.fieldGroup1] || '').trim() || CONFIG.emptyLabel;
    const g2 = (row[CONFIG.fieldGroup2] || '').trim() || CONFIG.emptyLabel;
    state.points.push({ row, lat, lon, g1, g2 });
    added++;
    for (const h of Object.keys(row)) if (!state.headers.includes(h)) state.headers.push(h);
  }
  state.filesLoaded.push({ name: sourceName, count: added });
}

function finishLoading() {
  buildTree();
  buildFilterUI();
  refreshMap();
  renderFileList();
  const b = L.latLngBounds(state.points.map(p => [p.lat, p.lon]));
  if (b.isValid()) map.fitBounds(b.pad(0.05));
}

function showLoadError() {
  document.getElementById('load-error').classList.remove('hidden');
  document.getElementById('header-stats').textContent = 'Данные не загружены';
}

document.getElementById('manual-files').addEventListener('change', async (e) => {
  for (const f of e.target.files) {
    const rows = await parseCsvFile(f);
    addRows(rows, f.name);
  }
  if (state.points.length) {
    document.getElementById('load-error').classList.add('hidden');
    finishLoading();
  }
});

/* ------------------------------------------------------------
   ДЕРЕВО ФИЛЬТРОВ (группа 1 → группа 2)
   ------------------------------------------------------------ */
function buildTree() {
  state.tree.clear();
  state.colors.clear();
  state.activeKeys.clear();

  for (const p of state.points) {
    if (!state.tree.has(p.g1)) state.tree.set(p.g1, new Map());
    const sub = state.tree.get(p.g1);
    sub.set(p.g2, (sub.get(p.g2) || 0) + 1);
    state.activeKeys.add(p.g1 + SEP + p.g2);
  }

  const sorted = [...state.tree.entries()]
    .sort((a, b) => sumMap(b[1]) - sumMap(a[1]));
  state.tree = new Map(sorted);

  let i = 0;
  for (const g1 of state.tree.keys()) {
    state.colors.set(g1, CONFIG.palette[i % CONFIG.palette.length]);
    i++;
  }
}

const sumMap = (m) => [...m.values()].reduce((a, b) => a + b, 0);

function buildFilterUI() {
  const root = document.getElementById('filter-tree');
  root.innerHTML = '';

  for (const [g1, subs] of state.tree) {
    const color = state.colors.get(g1);
    const grp = document.createElement('div');
    grp.className = 'ft-group';

    const head = document.createElement('div');
    head.className = 'ft-group-head';
    head.innerHTML = `
      <button class="ft-toggle" title="Развернуть">▶</button>
      <input type="checkbox" checked data-g1="${escAttr(g1)}">
      <input type="color" class="ft-color-input" value="${color}" title="Цвет слайда">
      <span class="ft-name">${escHtml(g1)}</span>
      <span class="ft-count">${sumMap(subs).toLocaleString('ru-RU')}</span>`;
    grp.appendChild(head);

    // смена цвета слайда: перекрашиваются точки, кластеры-диаграммы и дэшборд
    head.querySelector('.ft-color-input').addEventListener('change', (e) => {
      state.colors.set(g1, e.target.value);
      refreshMap();
    });

    const children = document.createElement('div');
    children.className = 'ft-children hidden';
    const sortedSubs = [...subs.entries()].sort((a, b) => b[1] - a[1]);
    for (const [g2, cnt] of sortedSubs) {
      const lbl = document.createElement('label');
      lbl.className = 'ft-child';
      lbl.innerHTML = `
        <input type="checkbox" checked data-g1="${escAttr(g1)}" data-g2="${escAttr(g2)}">
        <span class="ft-name">${escHtml(g2)}</span>
        <span class="ft-count">${cnt.toLocaleString('ru-RU')}</span>`;
      children.appendChild(lbl);
    }
    grp.appendChild(children);
    root.appendChild(grp);

    head.querySelector('.ft-toggle').addEventListener('click', (e) => {
      e.stopPropagation();
      children.classList.toggle('hidden');
      e.target.textContent = children.classList.contains('hidden') ? '▶' : '▼';
    });

    head.querySelector('input').addEventListener('change', (e) => {
      const on = e.target.checked;
      children.querySelectorAll('input').forEach(cb => {
        cb.checked = on;
        toggleKey(cb.dataset.g1, cb.dataset.g2, on);
      });
      refreshMap();
    });

    children.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', () => {
        toggleKey(cb.dataset.g1, cb.dataset.g2, cb.checked);
        syncGroupCheckbox(grp);
        refreshMap();
      });
    });
  }
}

function toggleKey(g1, g2, on) {
  const key = g1 + SEP + g2;
  if (on) state.activeKeys.add(key); else state.activeKeys.delete(key);
}

function syncGroupCheckbox(grpEl) {
  const subs = [...grpEl.querySelectorAll('.ft-children input')];
  const head = grpEl.querySelector('.ft-group-head input');
  const checked = subs.filter(cb => cb.checked).length;
  head.checked = checked > 0;
  head.indeterminate = checked > 0 && checked < subs.length;
}

document.getElementById('btn-filter-all').addEventListener('click', () => setAllFilters(true));
document.getElementById('btn-filter-none').addEventListener('click', () => setAllFilters(false));

function setAllFilters(on) {
  state.activeKeys.clear();
  if (on) {
    for (const [g1, subs] of state.tree)
      for (const g2 of subs.keys()) state.activeKeys.add(g1 + SEP + g2);
  }
  document.querySelectorAll('#filter-tree input').forEach(cb => {
    cb.checked = on; cb.indeterminate = false;
  });
  refreshMap();
}

const filteredPoints = () =>
  state.points.filter(p => state.activeKeys.has(p.g1 + SEP + p.g2));

/* ------------------------------------------------------------
   ДИСПЕТЧЕР РЕЖИМОВ ОТОБРАЖЕНИЯ
   ------------------------------------------------------------ */
function clearDataLayers() {
  if (map.hasLayer(clusterGroup)) map.removeLayer(clusterGroup);
  if (map.hasLayer(pieGroup)) map.removeLayer(pieGroup);
  if (map.hasLayer(pointsLayer)) map.removeLayer(pointsLayer);
  if (hexLayer) { map.removeLayer(hexLayer); hexLayer = null; }
  if (aggLayer) { map.removeLayer(aggLayer); aggLayer = null; }
}

function refreshMap() {
  const pts = filteredPoints();
  updateStats(pts.length);
  clearDataLayers();
  hideLegend();

  switch (state.mode) {
    case 'points':   renderPoints(pts); break;
    case 'clusters': renderClusters(pts, clusterGroup); break;
    case 'pie':      renderClusters(pts, pieGroup); break;
    case 'hex':      renderHexes(pts); break;
    case 'okruga':   renderChoropleth('okruga', pts); break;
    case 'rayony':   renderChoropleth('rayony', pts); break;
  }
  if (state.selection) updateSelection(); // пересчёт зоны при смене фильтра
  if (typeof applyOverlayOrder === 'function') applyOverlayOrder();
  if (window.updateDashboard) window.updateDashboard();
}

const MODES = ['points', 'clusters', 'pie', 'hex', 'okruga', 'rayony'];
MODES.forEach(m =>
  document.getElementById('mode-' + m).addEventListener('click', () => setMode(m)));

function setMode(mode) {
  state.mode = mode;
  MODES.forEach(m =>
    document.getElementById('mode-' + m).classList.toggle('active', m === mode));
  document.getElementById('hex-controls').classList.toggle('hidden', mode !== 'hex');
  document.getElementById('indicator-controls').classList.toggle(
    'hidden', mode !== 'okruga' && mode !== 'rayony');
  refreshMap();
}

/* --- знаменатель картосхемы (индикативные показатели) --- */
const INDICATORS = ['abs', 'area', 'pop'];
INDICATORS.forEach(ind =>
  document.getElementById('ind-' + ind).addEventListener('click', () => {
    state.indicator = ind;
    INDICATORS.forEach(i =>
      document.getElementById('ind-' + i).classList.toggle('active', i === ind));
    if (state.mode === 'okruga' || state.mode === 'rayony') refreshMap();
  }));

/* ------------------------------------------------------------
   ТОЧКИ / КЛАСТЕРЫ
   ------------------------------------------------------------ */
function makeMarker(p) {
  const m = L.circleMarker([p.lat, p.lon], {
    radius: 4.5,
    stroke: false,
    fillColor: state.colors.get(p.g1) || CONFIG.accent.blue,
    fillOpacity: 0.92,
    g1: p.g1
  });
  m.bindTooltip(buildTooltip(p), {
    className: 'poi-tooltip',
    direction: 'top',
    offset: [0, -6],
    opacity: 1
  });
  return m;
}

function renderPoints(pts) {
  pointsLayer.clearLayers();
  for (const p of pts) pointsLayer.addLayer(makeMarker(p));
  pointsLayer.addTo(map);
}

function renderClusters(pts, group) {
  group.clearLayers();
  group.addLayers(pts.map(makeMarker));
  map.addLayer(group);
}

function buildTooltip(p) {
  const name = p.row[CONFIG.fieldName] || CONFIG.emptyLabel;
  let html = `<div class="tt-name">${escHtml(name)}</div>`;
  for (const f of CONFIG.tooltipFields) {
    const v = (p.row[f] || '').toString().trim();
    if (!v) continue;
    const shown = v.length > 120 ? v.slice(0, 117) + '…' : v;
    html += `<div class="tt-row"><span>${escHtml(f)}</span><b>${escHtml(shown)}</b></div>`;
  }
  return html;
}

/* ------------------------------------------------------------
   ГЕКСАГОНАЛЬНАЯ СЕТКА
   Биннинг по осевым координатам (pointy-top hex), только
   занятые ячейки — быстро при любом объёме данных.
   ------------------------------------------------------------ */
const M_PER_DEG_LAT = 111320;

function renderHexes(pts) {
  if (!pts.length) return;

  // сторона (радиус) гексагона из площади ячейки: A = 3√3/2 · s²
  const areaM2 = state.hexSizeHa * 10000;
  const s = Math.sqrt((2 * areaM2) / (3 * Math.sqrt(3)));

  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos(lat0 * Math.PI / 180);

  const bins = new Map();
  for (const p of pts) {
    const x = p.lon * mPerDegLon;
    const y = p.lat * M_PER_DEG_LAT;
    const qf = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / s;
    const rf = (2 / 3 * y) / s;
    const [q, r] = hexRound(qf, rf);
    const key = q + ',' + r;
    let b = bins.get(key);
    if (!b) { b = { q, r, count: 0, groups: new Map() }; bins.set(key, b); }
    b.count++;
    b.groups.set(p.g1, (b.groups.get(p.g1) || 0) + 1);
  }

  const cls = makeClasses([...bins.values()].map(b => b.count));

  const features = [];
  for (const b of bins.values()) {
    const cx = s * Math.sqrt(3) * (b.q + b.r / 2);
    const cy = s * 1.5 * b.r;
    const ring = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      ring.push([(cx + s * Math.cos(a)) / mPerDegLon, (cy + s * Math.sin(a)) / M_PER_DEG_LAT]);
    }
    ring.push(ring[0]);
    features.push({
      type: 'Feature',
      properties: { count: b.count, groups: b.groups },
      geometry: { type: 'Polygon', coordinates: [ring] }
    });
  }

  hexLayer = L.geoJSON({ type: 'FeatureCollection', features }, {
    style: (f) => ({
      fillColor: colorFor(f.properties.count, cls),
      fillOpacity: 0.75,
      color: '#ffffff',
      weight: 1
    }),
    onEachFeature: (f, layer) => {
      const top = [...f.properties.groups.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 3)
        .map(([g, c]) => `${escHtml(g)}: ${c}`).join('<br>');
      layer.bindTooltip(
        `<b>Точек: ${f.properties.count.toLocaleString('ru-RU')}</b><br>${top}`,
        { className: 'hex-tooltip', sticky: true }
      );
    }
  }).addTo(map);

  showLegend(cls, 'точек в ячейке');
}

function hexRound(qf, rf) {
  let x = qf, z = rf, y = -x - z;
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return [rx, rz];
}

/* --- классификация по Дженксу (natural breaks) --- */

/* Взвешенный Fisher–Jenks по уникальным значениям (быстро при любом
   количестве объектов). Возвращает верхние границы классов. */
function jenksBreaks(values, k) {
  const freq = new Map();
  for (const x of values) freq.set(x, (freq.get(x) || 0) + 1);
  const v = [...freq.keys()].sort((a, b) => a - b);
  const w = v.map(x => freq.get(x));
  const n = v.length;
  if (n === 0) return [];
  if (n <= k) return v;

  // префиксные суммы для дисперсии класса
  const cw = [0], cs = [0], csq = [0];
  for (let i = 0; i < n; i++) {
    cw.push(cw[i] + w[i]);
    cs.push(cs[i] + w[i] * v[i]);
    csq.push(csq[i] + w[i] * v[i] * v[i]);
  }
  const ssd = (i, j) => { // отклонение внутри класса v[i..j]
    const W = cw[j + 1] - cw[i], S = cs[j + 1] - cs[i], Q = csq[j + 1] - csq[i];
    return Q - S * S / W;
  };

  const dp = Array.from({ length: n }, () => new Array(k + 1).fill(Infinity));
  const idx = Array.from({ length: n }, () => new Array(k + 1).fill(0));
  for (let j = 0; j < n; j++) dp[j][1] = ssd(0, j);
  for (let c = 2; c <= k; c++) {
    for (let j = c - 1; j < n; j++) {
      for (let m = c - 2; m < j; m++) {
        const val = dp[m][c - 1] + ssd(m + 1, j);
        if (val < dp[j][c]) { dp[j][c] = val; idx[j][c] = m + 1; }
      }
    }
  }

  const breaks = []; let j = n - 1;
  for (let c = k; c >= 1; c--) { breaks.unshift(v[j]); if (c > 1) j = idx[j][c] - 1; }
  return [...new Set(breaks)].sort((a, b) => a - b);
}

/* Классы для раскраски: пороги Дженкса + цвета, растянутые по шкале */
function makeClasses(values) {
  const thresholds = jenksBreaks(values, CONFIG.scaleColors.length);
  const S = CONFIG.scaleColors;
  const m = thresholds.length;
  const colors = m <= 1 ? [S[S.length - 1]]
    : thresholds.map((_, i) => S[Math.round(i * (S.length - 1) / (m - 1))]);
  return { thresholds, colors };
}

function colorFor(count, cls) {
  for (let i = 0; i < cls.thresholds.length; i++)
    if (count <= cls.thresholds[i]) return cls.colors[i];
  return cls.colors[cls.colors.length - 1];
}

document.getElementById('hex-size').addEventListener('input', (e) => {
  state.hexSizeHa = parseFloat(e.target.value);
  document.getElementById('hex-size-label').textContent = state.hexSizeHa + ' га';
  if (state.mode === 'hex') refreshMap();
});

/* --- легенда шкалы (гексагоны и картодиаграммы) --- */
function showLegend(cls, title) {
  const box = document.getElementById('agg-legend-box');
  const el = document.getElementById('agg-legend');
  document.getElementById('agg-legend-title').textContent = title;
  el.innerHTML = '';
  let prev = null;
  cls.thresholds.forEach((t, i) => {
    const d = document.createElement('div');
    d.className = 'hl-item';
    d.style.background = cls.colors[i];
    // тёмный текст на светлых плашках, белый — на тёмных
    const c = cls.colors[i].replace('#', '');
    const lum = 0.299 * parseInt(c.slice(0, 2), 16)
      + 0.587 * parseInt(c.slice(2, 4), 16)
      + 0.114 * parseInt(c.slice(4, 6), 16);
    d.style.color = lum > 150 ? '#1e1e1e' : '#ffffff';
    d.style.textShadow = 'none';
    d.textContent = prev === null ? `≤${fmtVal(t)}` : `${fmtVal(prev)}–${fmtVal(t)}`;
    d.title = d.textContent;
    el.appendChild(d);
    prev = t;
  });
  box.classList.remove('hidden');
}

function hideLegend() {
  document.getElementById('agg-legend-box').classList.add('hidden');
}

/* ------------------------------------------------------------
   ГРАНИЦЫ: ЗАГРУЗКА И ГЕОМЕТРИЯ
   ------------------------------------------------------------ */
const adminData = { okruga: null, rayony: null, moscow: null }; // {gj, feats:[{f, name, polys}]}

async function getAdminData(kind) {
  if (adminData[kind]) return adminData[kind];
  const url = kind === 'okruga' ? CONFIG.okrugaFile
    : kind === 'rayony' ? CONFIG.rayonyFile : CONFIG.moscowFile;
  const gj = await (await fetch(url)).json();
  const AF = CONFIG.adminFields;
  const feats = gj.features.map(f => {
    const p = f.properties;
    let name = '—';
    for (const c of AF.nameCandidates) if (p[c]) { name = p[c]; break; }
    return {
      f, name,
      area: parseFloat(p[AF.area]) || 0,        // км²
      pop:  parseFloat(p[AF.pop])  || 0,        // чел.
      housing: parseFloat(p[AF.housing]) || 0,  // кв.м
      polys: prepGeometry(f.geometry)
    };
  });
  adminData[kind] = { gj, feats };
  return adminData[kind];
}

/* Подготовка геометрии: список полигонов с bbox внешнего кольца */
function prepGeometry(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  return polys.map(rings => {
    const outer = rings[0];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of outer) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { rings, bbox: [minX, minY, maxX, maxY] };
  });
}

function ptInFeature(x, y, polys) {
  for (const { rings, bbox } of polys) {
    if (x < bbox[0] || x > bbox[2] || y < bbox[1] || y > bbox[3]) continue;
    if (!pointInPolygon([x, y], rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < rings.length; i++)
      if (pointInPolygon([x, y], rings[i])) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

/* Точки внутри административной единицы */
function pointsInFeature(feat, pts) {
  return pts.filter(p => ptInFeature(p.lon, p.lat, feat.polys));
}

/* Формат чисел для плотностей и легенды */
function fmtVal(x) {
  if (!isFinite(x)) return '—';
  const opts = x >= 100 ? { maximumFractionDigits: 0 }
    : x >= 10 ? { maximumFractionDigits: 1 }
    : x >= 0.1 ? { maximumFractionDigits: 2 }
    : { maximumSignificantDigits: 2 }; // очень малые плотности (на кв.м жилья)
  return x.toLocaleString('ru-RU', opts);
}

/* Значение показателя для административной единицы */
function indicatorValue(feat, n) {
  switch (state.indicator) {
    case 'area': return feat.area > 0 ? n / feat.area : null;          // на 1 км²
    case 'pop':  return feat.pop > 0 ? n / feat.pop * 100000 : null;   // на 100 тыс. чел.
    default:     return n;
  }
}

const INDICATOR_TITLES = {
  abs:  { okruga: 'объектов в округе', rayony: 'объектов в районе' },
  area: { okruga: 'объектов на 1 км²', rayony: 'объектов на 1 км²' },
  pop:  { okruga: 'на 100 тыс. жителей', rayony: 'на 100 тыс. жителей' }
};

/* Попап в стиле карточки (как на референсе) */
function adminPopupHtml(feat, ptsIn) {
  const n = ptsIn.length;
  const tally = new Map();
  for (const p of ptsIn) tally.set(p.g1, (tally.get(p.g1) || 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  let html = `<div class="ap-title">${escHtml(feat.name)}</div>`;
  html += `<div class="ap-row"><span>Объектов, шт.</span><b>${n.toLocaleString('ru-RU')}</b></div>`;
  if (feat.area > 0) {
    html += `<div class="ap-row"><span>Площадь, км²</span><b>${fmtVal(feat.area)}</b></div>`;
    html += `<div class="ap-row"><span>Объектов на 1 км²</span><b>${fmtVal(n / feat.area)}</b></div>`;
  }
  if (feat.pop > 0) {
    html += `<div class="ap-row"><span>Население (оценка)</span><b>${Math.round(feat.pop).toLocaleString('ru-RU')}</b></div>`;
    html += `<div class="ap-row"><span>На 100 тыс. жителей</span><b>${fmtVal(n / feat.pop * 100000)}</b></div>`;
  }
  for (const [g, c] of top)
    html += `<div class="ap-row"><span>${escHtml(g)}</span><b>${c.toLocaleString('ru-RU')}</b></div>`;
  return html;
}

const POPUP_OPTS = { className: 'admin-popup', maxWidth: 320, autoPanPadding: [40, 40] };

/* ------------------------------------------------------------
   КАРТОДИАГРАММА ПО ОКРУГАМ / РАЙОНАМ
   ------------------------------------------------------------ */
async function renderChoropleth(kind, pts) {
  let data;
  try { data = await getAdminData(kind); }
  catch (e) { console.error('Не удалось загрузить границы', e); return; }
  if (state.mode !== kind) return; // режим успели переключить

  // подсчёт точек в каждой единице
  const counts = new Map(); // feat -> pts[]
  for (const feat of data.feats) counts.set(feat, []);
  for (const p of pts) {
    for (const feat of data.feats) {
      if (ptInFeature(p.lon, p.lat, feat.polys)) { counts.get(feat).push(p); break; }
    }
  }

  // значение показателя (абсолют или плотность) для каждой единицы
  const values = new Map(); // feat -> number|null
  for (const feat of data.feats)
    values.set(feat, indicatorValue(feat, counts.get(feat).length));

  const positive = [...values.values()].filter(v => v !== null && v > 0);
  const cls = makeClasses(positive.length ? positive : [1]);

  aggLayer = L.geoJSON(
    { type: 'FeatureCollection', features: data.feats.map(ft => ft.f) },
    {
      style: (f) => {
        const feat = data.feats.find(ft => ft.f === f);
        const v = values.get(feat);
        return {
          fillColor: (v === null || v === 0) ? '#bfbfbf' : colorFor(v, cls),
          fillOpacity: 0.68,
          color: '#ffffff',
          weight: 1.5
        };
      },
      onEachFeature: (f, layer) => {
        const feat = data.feats.find(ft => ft.f === f);
        const ptsIn = counts.get(feat);
        const v = values.get(feat);
        const extra = state.indicator === 'abs' ? ''
          : v === null ? ' · нет данных'
          : ` · ${fmtVal(v)} ${state.indicator === 'area' ? 'на км²' : 'на 100 тыс.'}`;
        layer.bindTooltip(
          `${escHtml(feat.name)}: ${ptsIn.length.toLocaleString('ru-RU')}${extra}`,
          { className: 'hex-tooltip', sticky: true }
        );
        layer.bindPopup(adminPopupHtml(feat, ptsIn), POPUP_OPTS);
        layer.on('mouseover', () => layer.setStyle({ weight: 3 }));
        layer.on('mouseout', () => layer.setStyle({ weight: 1.5 }));
      }
    }
  ).addTo(map);

  showLegend(cls, INDICATOR_TITLES[state.indicator][kind]);
  applyOverlayOrder(); // оверлеи (границы, кольца, зоны) — поверх картодиаграммы
}

/* ------------------------------------------------------------
   ОВЕРЛЕИ ГРАНИЦ (контуры поверх любого режима)
   ------------------------------------------------------------ */
const adminOverlays = { okruga: null, rayony: null, moscow: null };

async function toggleAdminOverlay(kind, on, color, dash) {
  if (on) {
    if (!adminOverlays[kind]) {
      let data;
      try { data = await getAdminData(kind); }
      catch (e) { console.error(e); return; }
      adminOverlays[kind] = L.geoJSON(data.gj, {
        style: { color, weight: 2, dashArray: dash, fillColor: color, fillOpacity: 0.03 },
        onEachFeature: (f, layer) => {
          const feat = data.feats.find(ft => ft.f === f);
          layer.bindTooltip(feat.name, { className: 'admin-label', sticky: true });
          // попап со статистикой считается в момент клика по текущим фильтрам
          layer.on('click', (e) => {
            const ptsIn = pointsInFeature(feat, filteredPoints());
            layer.bindPopup(adminPopupHtml(feat, ptsIn), POPUP_OPTS).openPopup(e.latlng);
          });
        }
      });
    }
    adminOverlays[kind].addTo(map);
  } else if (adminOverlays[kind]) {
    map.removeLayer(adminOverlays[kind]);
  }
  applyOverlayOrder();
}

document.getElementById('layer-moscow').addEventListener('change', (e) =>
  toggleAdminOverlay('moscow', e.target.checked, CONFIG.accent.blue, null));
document.getElementById('layer-okruga').addEventListener('change', (e) =>
  toggleAdminOverlay('okruga', e.target.checked, CONFIG.accent.plum, null));
document.getElementById('layer-rayony').addEventListener('change', (e) =>
  toggleAdminOverlay('rayony', e.target.checked, CONFIG.accent.teal, '4 4'));

/* --- транспортные кольца: Садовое, ТТК, МКАД --- */
let ringsGj = null;
const ringLayers = {}; // ключ -> слой
const RING_STYLE = {
  'Садовое кольцо': { color: '#C06D84', weight: 3 },
  'ТТК':            { color: '#44ACAA', weight: 3 },
  'МКАД':           { color: '#365D7E', weight: 3.5 }
};

async function toggleRing(key, on) {
  if (on) {
    if (!ringLayers[key]) {
      if (!ringsGj) {
        try { ringsGj = await (await fetch(CONFIG.ringsFile)).json(); }
        catch (e) { console.error('Нет файла с кольцами (data/rings.geojson)', e); return; }
      }
      const feat = ringsGj.features.find(f => f.properties.name === key);
      if (!feat) { console.error('Кольцо не найдено:', key); return; }
      ringLayers[key] = L.geoJSON(feat, {
        style: { ...RING_STYLE[key], opacity: 0.9, fill: false },
        onEachFeature: (f, layer) =>
          layer.bindTooltip(key, { className: 'admin-label', sticky: true })
      });
    }
    ringLayers[key].addTo(map);
  } else if (ringLayers[key]) {
    map.removeLayer(ringLayers[key]);
  }
  applyOverlayOrder();
}

document.getElementById('layer-sadovoe').addEventListener('change', (e) => toggleRing('Садовое кольцо', e.target.checked));
document.getElementById('layer-ttk').addEventListener('change', (e) => toggleRing('ТТК', e.target.checked));
document.getElementById('layer-mkad').addEventListener('change', (e) => toggleRing('МКАД', e.target.checked));

/* ------------------------------------------------------------
   ПОРЯДОК НАЛОЖЕНИЯ ОВЕРЛЕЕВ
   Верхняя строка в списке = верхний слой на карте.
   Блоки (сверху вниз): зоны доступности → магистрали → границы.
   ------------------------------------------------------------ */
const overlayRegistry = {
  moscow:  () => adminOverlays.moscow && map.hasLayer(adminOverlays.moscow) ? adminOverlays.moscow : null,
  okruga:  () => adminOverlays.okruga && map.hasLayer(adminOverlays.okruga) ? adminOverlays.okruga : null,
  rayony:  () => adminOverlays.rayony && map.hasLayer(adminOverlays.rayony) ? adminOverlays.rayony : null,
  sadovoe: () => ringLayers['Садовое кольцо'] && map.hasLayer(ringLayers['Садовое кольцо']) ? ringLayers['Садовое кольцо'] : null,
  ttk:     () => ringLayers['ТТК'] && map.hasLayer(ringLayers['ТТК']) ? ringLayers['ТТК'] : null,
  mkad:    () => ringLayers['МКАД'] && map.hasLayer(ringLayers['МКАД']) ? ringLayers['МКАД'] : null
};

function applyOverlayOrder() {
  const rows = [
    ...document.querySelectorAll('#zones-list [data-zone-id]'),
    ...document.querySelectorAll('#roads-list .layer-row'),
    ...document.querySelectorAll('#admin-list .layer-row')
  ];
  const layers = [];
  for (const r of rows) {
    let ly = null;
    if (r.dataset.key) ly = overlayRegistry[r.dataset.key]?.();
    else if (r.dataset.zoneId && window.zoneLayerById) ly = window.zoneLayerById(r.dataset.zoneId);
    if (ly) layers.push(ly);
  }
  // снизу вверх: последний вызов bringToFront оказывается верхним
  for (let i = layers.length - 1; i >= 0; i--) layers[i].bringToFront();
}
window.applyOverlayOrder = applyOverlayOrder;

function moveRow(row, dir) {
  if (!row) return;
  const sib = dir < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sib) return;
  if (dir < 0) row.parentNode.insertBefore(row, sib);
  else row.parentNode.insertBefore(sib, row);
  applyOverlayOrder();
}

document.querySelectorAll('.layer-list').forEach(list =>
  list.addEventListener('click', (e) => {
    const up = e.target.closest('.ord-up');
    const down = e.target.closest('.ord-down');
    if (!up && !down) return;
    moveRow(e.target.closest('.layer-row, .zone-row'), up ? -1 : 1);
  }));

/* ------------------------------------------------------------
   РИСОВАНИЕ ЗОНЫ И ВЫГРУЗКА
   ------------------------------------------------------------ */
const drawHandlers = {
  polygon: new L.Draw.Polygon(map, {
    allowIntersection: false,
    shapeOptions: { color: CONFIG.accent.coral, weight: 2, fillOpacity: 0.08 }
  }),
  rectangle: new L.Draw.Rectangle(map, {
    showArea: false, // обход бага leaflet-draw 1.0.4 (ReferenceError: type is not defined)
    shapeOptions: { color: CONFIG.accent.coral, weight: 2, fillOpacity: 0.08 }
  })
};

document.getElementById('btn-draw-polygon').addEventListener('click', () => drawHandlers.polygon.enable());
document.getElementById('btn-draw-rect').addEventListener('click', () => drawHandlers.rectangle.enable());

map.on(L.Draw.Event.CREATED, (e) => {
  clearZone();
  zoneLayer = e.layer;
  drawnItems.addLayer(zoneLayer);
  updateSelection();
});

function updateSelection() {
  if (!zoneLayer) return;
  const ring = zoneLayer.getLatLngs()[0]; // внешнее кольцо
  const poly = ring.map(ll => [ll.lng, ll.lat]);
  state.selection = filteredPoints().filter(p => pointInPolygon([p.lon, p.lat], poly));
  document.getElementById('stat-selected').textContent =
    state.selection.length.toLocaleString('ru-RU');
  document.getElementById('selection-result').classList.remove('hidden');
}

function clearZone() {
  drawnItems.clearLayers();
  zoneLayer = null;
  state.selection = null;
  document.getElementById('selection-result').classList.add('hidden');
}
document.getElementById('btn-clear-zone').addEventListener('click', clearZone);

/* Точка в полигоне (ray casting) */
function pointInPolygon(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* --- выгрузка --- */
const selectionRows = () => state.selection.map(p => p.row);

document.getElementById('btn-export-csv').addEventListener('click', () => {
  if (!state.selection || !state.selection.length) return;
  const csv = Papa.unparse({
    fields: state.headers,
    data: selectionRows().map(r => state.headers.map(h => r[h] ?? ''))
  });
  downloadFile('﻿' + csv, `mlsd_selection_${stamp()}.csv`, 'text/csv;charset=utf-8');
});

document.getElementById('btn-export-xlsx').addEventListener('click', () => {
  if (!state.selection || !state.selection.length) return;
  if (typeof XLSX === 'undefined') { alert('Библиотека XLSX не загрузилась. Проверьте доступ в интернет.'); return; }
  const aoa = [state.headers, ...selectionRows().map(r => state.headers.map(h => r[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Выборка');
  XLSX.writeFile(wb, `mlsd_selection_${stamp()}.xlsx`);
});

document.getElementById('btn-export-geojson').addEventListener('click', () => {
  if (!state.selection || !state.selection.length) return;
  const gj = {
    type: 'FeatureCollection',
    features: state.selection.map(p => ({
      type: 'Feature',
      properties: p.row,
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
    }))
  };
  downloadFile(JSON.stringify(gj, null, 1), `mlsd_selection_${stamp()}.geojson`, 'application/geo+json');
});

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

/* ------------------------------------------------------------
   ИНТЕРФЕЙС
   ------------------------------------------------------------ */
function updateStats(visible) {
  document.getElementById('stat-total').textContent =
    state.points.length.toLocaleString('ru-RU');
  document.getElementById('stat-visible').textContent =
    visible.toLocaleString('ru-RU');
  document.getElementById('header-stats').textContent =
    `${state.points.length.toLocaleString('ru-RU')} точек · ${state.filesLoaded.length} файл(ов)`;
}

function renderFileList() {
  const el = document.getElementById('data-files');
  el.innerHTML = state.filesLoaded
    .map(f => `<div>📄 ${escHtml(f.name)} — ${f.count.toLocaleString('ru-RU')}</div>`)
    .join('');
}

document.getElementById('btn-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
  setTimeout(() => map.invalidateSize(), 260);
});

document.getElementById('btn-goto-dash').addEventListener('click', () =>
  document.getElementById('dashboard').scrollIntoView({ behavior: 'smooth' }));

document.getElementById('btn-goto-map').addEventListener('click', () =>
  window.scrollTo({ top: 0, behavior: 'smooth' }));

/* ------------------------------------------------------------
   УТИЛИТЫ
   ------------------------------------------------------------ */
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = escHtml;

/* ------------------------------------------------------------
   СТАРТ
   ------------------------------------------------------------ */
loadData();
/* v2 */
