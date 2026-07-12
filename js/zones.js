/* ============================================================
   MLSD Web Map — пользовательские зоны (изохроны)
   Загрузка GeoJSON / JSON / GPKG через кнопку или из папки
   data/zones/ (manifest.json). Вкл/выкл, цвет, линия/пунктир.
   GPKG читается в браузере: sql.js (WASM) + WKB-парсер,
   поддержка проекций EPSG:4326, 3857, UTM 326xx/327xx.
   ============================================================ */

'use strict';

(function () {

  const ZONES_DIR = 'data/zones/';
  const ZONES_MANIFEST = 'data/zones/manifest.json';
  const ZONE_COLORS = ['#C06D84', '#365D7E', '#44ACAA', '#F67380', '#E89A6C', '#7A6FB0', '#5C8A64'];

  let zoneSeq = 0;
  const zones = []; // {id, name, gj, color, dash, visible, layer}
  const listEl = document.getElementById('zones-list');

  /* ---------------- зоны на карте и в списке ---------------- */

  const zoneStyle = (z) => ({
    color: z.color,
    weight: 3,
    dashArray: z.dash ? '8 6' : null,
    fillColor: z.color,
    fillOpacity: 0.07
  });

  function zonePopupHtml(z) {
    const props = (z.gj.features[0] && z.gj.features[0].properties) || {};
    let html = `<div class="ap-title">${escHtml(z.name)}</div>`;
    let i = 0;
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || typeof v === 'object') continue;
      if (++i > 8) break;
      const shown = typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v);
      html += `<div class="ap-row"><span>${escHtml(k)}</span><b>${escHtml(shown)}</b></div>`;
    }
    return html;
  }

  function addZone(name, gj, { fit = false, visible = true } = {}) {
    const z = {
      id: ++zoneSeq, name, gj,
      color: ZONE_COLORS[(zoneSeq - 1) % ZONE_COLORS.length],
      dash: false, visible, layer: null
    };
    zones.push(z);
    renderZone(z);
    renderZoneRow(z);
    if (fit && z.layer) {
      const b = z.layer.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.15));
    }
    window.updateDashboard?.(); // список зон в дэшборде
  }

  function renderZone(z) {
    if (z.layer) { map.removeLayer(z.layer); z.layer = null; }
    if (!z.visible) { window.applyOverlayOrder?.(); return; }
    z.layer = L.geoJSON(z.gj, { style: zoneStyle(z) });
    z.layer.bindTooltip(z.name, { className: 'admin-label', sticky: true });
    z.layer.bindPopup(zonePopupHtml(z), { className: 'admin-popup', maxWidth: 320 });
    z.layer.addTo(map);
    window.applyOverlayOrder?.();
  }

  /* слой зоны по id строки — для управления порядком наложения из app.js */
  window.zoneLayerById = function (id) {
    const z = zones.find(z => String(z.id) === String(id));
    return z && z.visible && z.layer ? z.layer : null;
  };

  /* список зон для дэшборда (агрегация по зоне) */
  window.dashboardZones = () => zones.map(z => ({ id: z.id, name: z.name, gj: z.gj }));

  function renderZoneRow(z) {
    const row = document.createElement('div');
    row.className = 'zone-row';
    row.dataset.zoneId = z.id;
    row.innerHTML = `
      <span class="order-btns"><button class="ord-up" title="Выше">▲</button><button class="ord-down" title="Ниже">▼</button></span>
      <input type="checkbox" ${z.visible ? 'checked' : ''} title="Показать / скрыть">
      <span class="zone-name" title="${escHtml(z.name)}">${escHtml(z.name)}</span>
      <input type="color" value="${z.color}" title="Цвет">
      <select title="Начертание">
        <option value="solid">Линия</option>
        <option value="dash">Пунктир</option>
      </select>
      <button class="zone-del" title="Убрать">✕</button>`;

    row.querySelector('input[type=checkbox]').addEventListener('change', (e) => {
      z.visible = e.target.checked;
      renderZone(z);
    });
    row.querySelector('input[type=color]').addEventListener('input', (e) => {
      z.color = e.target.value;
      if (z.layer) z.layer.setStyle(zoneStyle(z));
    });
    row.querySelector('select').addEventListener('change', (e) => {
      z.dash = e.target.value === 'dash';
      if (z.layer) z.layer.setStyle(zoneStyle(z));
    });
    row.querySelector('.zone-del').addEventListener('click', () => {
      if (z.layer) map.removeLayer(z.layer);
      zones.splice(zones.indexOf(z), 1);
      row.remove();
      window.applyOverlayOrder?.();
      window.updateDashboard?.();
    });
    listEl.appendChild(row);
  }

  /* ---------------- загрузка файлов ---------------- */

  const stripExt = (s) => s.replace(/\.(geojson|json|gpkg)$/i, '');

  function normalizeGeojson(o) {
    if (o && o.type === 'FeatureCollection') return o;
    if (o && o.type === 'Feature') return { type: 'FeatureCollection', features: [o] };
    if (o && o.type && o.coordinates)
      return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: o }] };
    throw new Error('файл не похож на GeoJSON');
  }

  document.getElementById('zone-files').addEventListener('change', async (e) => {
    for (const f of e.target.files) {
      try {
        let gj;
        if (/\.gpkg$/i.test(f.name)) gj = await gpkgToGeojson(await f.arrayBuffer());
        else gj = normalizeGeojson(JSON.parse(await f.text()));
        addZone(stripExt(f.name), gj, { fit: true, visible: true });
      } catch (err) {
        alert(`Не удалось загрузить «${f.name}»: ${err.message}`);
      }
    }
    e.target.value = '';
  });

  /* зоны из папки проекта data/zones/ (по manifest.json) */
  (async function loadDirZones() {
    let files;
    try {
      const resp = await fetch(ZONES_MANIFEST, { cache: 'no-store' });
      if (!resp.ok) return;
      files = (await resp.json()).files || [];
    } catch (e) { return; }
    for (const f of files) {
      try {
        const url = ZONES_DIR + encodeURIComponent(f);
        let gj;
        if (/\.gpkg$/i.test(f)) gj = await gpkgToGeojson(await (await fetch(url)).arrayBuffer());
        else gj = normalizeGeojson(await (await fetch(url)).json());
        addZone(stripExt(f), gj, { visible: false }); // по умолчанию выключены
      } catch (e) {
        console.error('Зона из папки не загрузилась:', f, e);
      }
    }
  })();

  /* ---------------- GPKG в браузере ---------------- */

  let sqlJsPromise = null;
  function ensureSqlJs() {
    if (!sqlJsPromise) {
      sqlJsPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.min.js';
        s.onload = () => resolve(initSqlJs({
          locateFile: (f) => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/' + f
        }));
        s.onerror = () => reject(new Error('не удалось загрузить sql.js с CDN'));
        document.head.appendChild(s);
      });
    }
    return sqlJsPromise;
  }

  async function gpkgToGeojson(buf) {
    const SQL = await ensureSqlJs();
    const db = new SQL.Database(new Uint8Array(buf));
    try {
      const t = db.exec("select table_name, srs_id from gpkg_contents where data_type='features'");
      if (!t.length || !t[0].values.length) throw new Error('в GPKG нет векторных слоёв');
      const feats = [];
      for (const [table, srs] of t[0].values) {
        const tf = transformerFor(srs);
        const esc = table.replace(/"/g, '""');
        let geomCol = 'geom';
        const gc = db.exec(
          `select column_name from gpkg_geometry_columns where table_name='${table.replace(/'/g, "''")}'`);
        if (gc.length && gc[0].values.length) geomCol = gc[0].values[0][0];

        const res = db.exec(`select * from "${esc}"`);
        if (!res.length) continue;
        const cols = res[0].columns;
        const gi = cols.indexOf(geomCol);
        if (gi < 0) continue;
        for (const row of res[0].values) {
          if (!row[gi]) continue;
          const geom = parseGpkgGeom(row[gi], tf);
          if (!geom) continue;
          const props = {};
          cols.forEach((c, i) => { if (i !== gi && c !== 'fid') props[c] = row[i]; });
          feats.push({ type: 'Feature', properties: props, geometry: geom });
        }
      }
      if (!feats.length) throw new Error('в GPKG не найдено геометрий');
      return { type: 'FeatureCollection', features: feats };
    } finally {
      db.close();
    }
  }

  /* --- проекции --- */

  function transformerFor(srs) {
    srs = Number(srs);
    if (srs === 4326 || srs === 0 || srs === -1) return null;
    if (srs === 3857) return webMercatorInverse;
    if (srs >= 32601 && srs <= 32660) return utmInverse(srs - 32600, true);
    if (srs >= 32701 && srs <= 32760) return utmInverse(srs - 32700, false);
    throw new Error('неподдерживаемая проекция EPSG:' + srs +
      ' (поддерживаются 4326, 3857, UTM 326xx/327xx)');
  }

  function webMercatorInverse(x, y) {
    const R = 6378137;
    return [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
  }

  /* Обратное преобразование UTM (WGS84), стандартные ряды (Snyder) */
  function utmInverse(zone, north) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const lon0 = (zone * 6 - 183) * Math.PI / 180;
    return function (E, N) {
      const x = E - 500000;
      const y = north ? N : N - 10000000;
      const M = y / k0;
      const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
      const phi1 = mu
        + (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu)
        + (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu)
        + (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu)
        + (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
      const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
      const C1 = ep2 * cos1 * cos1;
      const T1 = tan1 * tan1;
      const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
      const R1 = a * (1 - e2) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
      const D = x / (N1 * k0);
      const lat = phi1 - (N1 * tan1 / R1) * (
        D * D / 2
        - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
      const lon = lon0 + (
        D
        - (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6
        + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / cos1;
      return [lon * 180 / Math.PI, lat * 180 / Math.PI];
    };
  }

  /* --- разбор геометрии GPKG (заголовок + WKB) --- */

  function parseGpkgGeom(blob, tf) {
    const bytes = blob instanceof Uint8Array ? blob : new Uint8Array(blob);
    if (bytes[0] !== 0x47 || bytes[1] !== 0x50) throw new Error('повреждённая геометрия GPKG');
    const flags = bytes[3];
    if (flags & 0x20) return null; // пустая геометрия
    const envLen = { 0: 0, 1: 32, 2: 48, 3: 48, 4: 64 }[(flags >> 1) & 0x07] ?? 0;
    const dv = new DataView(bytes.buffer, bytes.byteOffset + 8 + envLen,
      bytes.byteLength - 8 - envLen);
    return readWkb(dv, 0, tf)[0];
  }

  /* Возвращает [geojson-геометрия, новое смещение] */
  function readWkb(dv, off, tf) {
    const little = dv.getUint8(off) === 1; off += 1;
    let type = dv.getUint32(off, little); off += 4;

    let hasZ = (type & 0x80000000) !== 0;
    let hasM = (type & 0x40000000) !== 0;
    const hasSrid = (type & 0x20000000) !== 0;
    type = type & 0x1FFFFFFF;
    if (type >= 3000) { hasZ = true; hasM = true; type -= 3000; }
    else if (type >= 2000) { hasM = true; type -= 2000; }
    else if (type >= 1000) { hasZ = true; type -= 1000; }
    if (hasSrid) off += 4;
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

    const u32 = () => { const v = dv.getUint32(off, little); off += 4; return v; };
    const pt = () => {
      const x = dv.getFloat64(off, little); off += 8;
      const y = dv.getFloat64(off, little); off += 8;
      off += 8 * (dims - 2);
      return tf ? tf(x, y) : [x, y];
    };
    const ring = () => { const n = u32(); const c = []; for (let i = 0; i < n; i++) c.push(pt()); return c; };

    switch (type) {
      case 1: return [{ type: 'Point', coordinates: pt() }, off];
      case 2: return [{ type: 'LineString', coordinates: ring() }, off];
      case 3: {
        const n = u32(); const rings = [];
        for (let i = 0; i < n; i++) rings.push(ring());
        return [{ type: 'Polygon', coordinates: rings }, off];
      }
      case 4: case 5: case 6: {
        const n = u32(); const parts = [];
        for (let i = 0; i < n; i++) {
          const [g, o2] = readWkb(dv, off, tf);
          parts.push(g.coordinates); off = o2;
        }
        const names = { 4: 'MultiPoint', 5: 'MultiLineString', 6: 'MultiPolygon' };
        return [{ type: names[type], coordinates: parts }, off];
      }
      case 7: {
        const n = u32(); const geoms = [];
        for (let i = 0; i < n; i++) {
          const [g, o2] = readWkb(dv, off, tf);
          geoms.push(g); off = o2;
        }
        return [{ type: 'GeometryCollection', geometries: geoms }, off];
      }
      default:
        throw new Error('неподдерживаемый тип WKB: ' + type);
    }
  }

})();
