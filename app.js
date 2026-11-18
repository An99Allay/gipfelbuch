/* Gipfelbuch – Berge-Bucketlist ab Kriens */
(() => {
  "use strict";

  const KRIENS = { lon: 8.2786, lat: 47.0336 };
  const START_VIEW = { center: [8.262, 47.002], zoom: 12.1, pitch: 66, bearing: 218 };
  const RINGS = [25, 100, 500, 2000, 6000, 12000];
  const STORE = "gipfelbuch.v1";
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = () => innerWidth <= 820;

  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (n) => Math.round(n).toLocaleString("de-CH").replace(/,/g, "'");

  /* ---------- Geo ---------- */
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  function dist(a, b) {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function destination(p, brg, km) {
    const d = km / R, b = rad(brg), la = rad(p.lat), lo = rad(p.lon);
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return [deg(lo2), deg(la2)];
  }
  function greatCircle(a, b, n = 160) {
    const la1 = rad(a.lat), lo1 = rad(a.lon), la2 = rad(b.lat), lo2 = rad(b.lon);
    const d = dist(a, b) / R;
    const pts = [];
    if (d < 1e-6) return [[a.lon, a.lat], [b.lon, b.lat]];
    for (let i = 0; i <= n; i++) {
      const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      const z = A * Math.sin(la1) + B * Math.sin(la2);
      pts.push([deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))]);
    }
    for (let i = 1; i < pts.length; i++) {           // Längengrade stetig halten (Datumsgrenze)
      while (pts[i][0] - pts[i - 1][0] > 180) pts[i][0] -= 360;
      while (pts[i][0] - pts[i - 1][0] < -180) pts[i][0] += 360;
    }
    return pts;
  }
  function bearingOf(a, b) {
    const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
    const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /* ---------- Schwierigkeit ---------- */
  const TIERS = [
    { max: 2, key: "wander", name: "Wanderweg", stripe: false },
    { max: 3, key: "berg", name: "Bergweg", stripe: true },
    { max: 4, key: "alpin", name: "Alpinweg", stripe: true },
    { max: 6, key: "hoch", name: "Hochtour", stripe: false },
    { max: 7, key: "schwer", name: "Anspruchsvoll", stripe: false },
    { max: 8, key: "sehr", name: "Sehr schwierig", stripe: false },
    { max: 10, key: "extrem", name: "Extrem", stripe: false },
  ];
  const tier = (lvl) => TIERS.find((t) => lvl <= t.max);
  const color = (lvl) => `var(--d-${tier(lvl).key})`;
  const short = (scale) => scale.split(/[\s(/·]/)[0];
  const SCALE_TEXT = {
    T1: "Wandern", T2: "Bergwandern", T3: "Anspruchsvolles Bergwandern", T4: "Alpinwandern", T5: "Anspruchsvolles Alpinwandern", T6: "Schwieriges Alpinwandern",
    L: "Leicht", WS: "Wenig schwierig", ZS: "Ziemlich schwierig", S: "Schwierig", SS: "Sehr schwierig", AS: "Äusserst schwierig",
    K2: "Klettersteig mittel", K3: "Klettersteig ziemlich schwierig",
  };
  const scaleText = (scale) => SCALE_TEXT[short(scale).replace(/[+-]$/, "")] || "";
  /* Skala als 6 Stufen: T1–T6, K1–K6 oder L–AS; +/- als Teilfüllung */
  function scaleBar(m) {
    const s = short(m.scale), base = s.replace(/[+-]$/, ""), mod = s.endsWith("+") ? 0.33 : s.endsWith("-") ? -0.33 : 0;
    let labels, pos;
    if (/^T\d/.test(base)) { labels = ["T1", "T2", "T3", "T4", "T5", "T6"]; pos = +base.slice(1); }
    else if (/^K\d/.test(base)) { labels = ["K1", "K2", "K3", "K4", "K5", "K6"]; pos = +base.slice(1); }
    else { labels = ["L", "WS", "ZS", "S", "SS", "AS"]; pos = labels.indexOf(base) + 1; }
    pos = clamp(pos + mod, 0, 6);
    const segs = labels.map((l, i) => {
      const f = clamp(pos - i, 0, 1);
      return `<span class="seg"><i style="--f:${f};animation-delay:${i * 70}ms"></i></span>`;
    }).join("");
    const lab = labels.map((l, i) => `<span class="${Math.ceil(pos) === i + 1 ? "cur" : ""}">${l}</span>`).join("");
    return `<div class="diff-bar">${segs}</div><div class="diff-scale">${lab}</div>`;
  }
  function plaque(m, cls = "") {
    const t = tier(m.lvl);
    return `<span class="plq ${t.stripe ? "stripe" : ""} ${cls}" style="--c:${color(m.lvl)}"><span>${esc(short(m.scale))}</span></span>`;
  }

  /* ---------- Daten ---------- */
  const MOUNTAINS = (window.MOUNTAINS || []).map((m) => ({ ...m, km: dist(KRIENS, m) }));
  const byId = Object.fromEntries(MOUNTAINS.map((m) => [m.id, m]));

  const SECTIONS = ["Hausberge · zum Üben", "Alpen", "Europa & Kaukasus", "Afrika", "Anden & Amerika", "Himalaya & Karakorum", "Asien & Ozeanien", "Antarktis"];
  function sectionOf(m) {
    if (m.cat === "uebung") return SECTIONS[0];
    if (m.km < 800) return SECTIONS[1];
    if (m.lat < -60) return SECTIONS[7];
    if (m.lon < -30) return SECTIONS[4];
    if (m.lat > 25 && m.lat < 37 && m.lon > 70 && m.lon < 92) return SECTIONS[5];
    if (m.lon > -20 && m.lon < 55 && m.lat < 30) return SECTIONS[3];
    if (m.lon > -20 && m.lon < 55) return SECTIONS[2];
    return SECTIONS[6];
  }

  let state = { done: {} };
  try { state = JSON.parse(localStorage.getItem(STORE)) || state; } catch (e) {}
  if (!state.init) {
    state.init = true;
    MOUNTAINS.forEach((m) => { if (m.done) state.done[m.id] = typeof m.done === "string" ? m.done : ""; });
  }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) {} };
  save();
  const isDone = (id) => Object.prototype.hasOwnProperty.call(state.done, id);

  /* ---------- Bilder (Wikimedia) ---------- */
  function imgUrl(im, w) {
    const u = im.full.split("?")[0];
    if (w >= im.w) return u;
    if (u.includes("/thumb/")) return u.replace(/\/\d+px-([^/]+)$/, `/${w}px-$1`);
    const m = u.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/commons)\/(.+)\/([^/]+)$/);
    return m ? `${m[1]}/thumb/${m[2]}/${m[3]}/${w}px-${m[3]}` : u;
  }
  const is4k = (im) => im.w >= 3840;
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.decoding = "async"; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }

  /* ---------- Ladeschleier ---------- */
  (function contours() {
    const svg = $("#contours");
    const seed = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    let out = "";
    for (let k = 1; k <= 16; k++) {
      const r0 = k * 12;
      let d = "";
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const n = Math.sin(a * 3 + seed[0] + k * 0.18) * 0.12 + Math.sin(a * 5 + seed[1] - k * 0.11) * 0.07 + Math.sin(a * 2 + seed[2]) * 0.1;
        const r = r0 * (1 + n * (0.6 + k * 0.04));
        d += (i ? "L" : "M") + (Math.cos(a) * r * 1.15).toFixed(1) + " " + (Math.sin(a) * r * 0.85).toFixed(1);
      }
      out += `<path d="${d}Z" class="${k % 5 === 0 ? "major" : ""}" style="animation-delay:${(16 - k) * 0.09}s"/>`;
    }
    svg.innerHTML = out;
    svg.querySelectorAll("path").forEach((p) => p.style.setProperty("--len", Math.ceil(p.getTotalLength())));
  })();

  /* ---------- Karte ---------- */
  if (!window.maplibregl) { $("#veilSub").textContent = "Karte konnte nicht geladen werden. Internetverbindung prüfen."; return; }

  const MOBILE = matchMedia("(max-width: 820px)").matches;
  try { maplibregl.setWorkerCount(2); } catch (e) {}
  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
      glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
      projection: { type: "globe" },
      sources: {
        sat: {
          type: "raster", tileSize: 256, maxzoom: 19,
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
          attribution: "Bilder © Esri, Maxar, Earthstar Geographics",
        },
        places: {
          type: "raster", tileSize: 256, maxzoom: 13,
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
        },
        dem: {
          type: "raster-dem", tileSize: 256, maxzoom: MOBILE ? 12 : 13, encoding: "terrarium",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          attribution: "Gelände: Mapzen / AWS Terrain Tiles",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#05080b" } },
        { id: "sat", type: "raster", source: "sat", paint: { "raster-contrast": 0.06, "raster-saturation": 0.05, "raster-fade-duration": MOBILE ? 0 : 300 } },
        { id: "places", type: "raster", source: "places", minzoom: 2.5, maxzoom: 9, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 2.5, 0.5, 6, 0.8, 8, 0.6, 9, 0] } },
      ],
      sky: {
        "sky-color": "#0d2236",
        "sky-horizon-blend": 0.55,
        "horizon-color": "#a9cbe6",
        "horizon-fog-blend": 0.5,
        "fog-color": "#bcd2e2",
        "fog-ground-blend": 0.35,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 8, 0],
      },
      terrain: { source: "dem", exaggeration: 1.35 },
    },
    ...START_VIEW,
    maxPitch: 72,
    attributionControl: { compact: true },
    fadeDuration: MOBILE ? 0 : 300,
    /* Handys rendern sonst mit 3× Pixeldichte – 1.5× sieht gleich scharf aus und ist ~4× schneller */
    pixelRatio: Math.min(devicePixelRatio || 1, matchMedia("(max-width: 820px)").matches ? 1.5 : 1.75),
    maxTileCacheSize: 400,
  });
  window.__map = map;
  /* Karte folgt jeder Grössenänderung (Handy drehen, Adressleiste ein/aus) */
  try {
    let rz = 0;
    new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => map.resize()); }).observe(document.getElementById("map"));
  } catch (e) {}
  addEventListener("orientationchange", () => setTimeout(() => map.resize(), 250));

  /* Automatische Qualität: ruckelt es (viele Bilder > 34 ms), Pixeldichte schrittweise senken */
  (() => {
    if (!map.setPixelRatio) return;
    let last = 0, frames = 0, slow = 0;
    map.on("render", () => {
      const now = performance.now(), dt = now - last; last = now;
      if (dt > 250) return;                       // Pause, kein Ruckeln
      frames++; if (dt > 34) slow++;
      if (frames < 60) return;
      const pr = map.getPixelRatio();
      if (slow / frames > 0.35 && pr > 1.01) map.setPixelRatio(Math.max(1, +(pr - 0.25).toFixed(2)));
      frames = 0; slow = 0;
    });
  })();

  /* 3D-Gelände nur, wenn man nah genug dran ist – auf dem ganzen Globus sieht man es ohnehin nicht */
  let terrainOn = true;
  function syncTerrain() {
    const z = map.getZoom();
    const want = terrainOn ? z > 4.2 : z > 5.2;
    if (want !== terrainOn) { terrainOn = want; map.setTerrain(want ? { source: "dem", exaggeration: 1.35 } : null); }
  }
  map.on("zoom", syncTerrain);

  /* Ladebalken */
  const loadbar = $("#loadbar");
  let lbTimer;
  map.on("dataloading", () => { clearTimeout(lbTimer); loadbar.classList.add("on"); });
  map.on("idle", () => { lbTimer = setTimeout(() => loadbar.classList.remove("on"), 200); });

  /* Gipfelpunkte als GPU-Ebene (statt 128 HTML-Elementen, die bei jeder Bewegung neu platziert werden mussten) */
  const HEX = { "--d-wander": "#f5c542", "--d-berg": "#ef4b3f", "--d-alpin": "#3b82f6", "--d-hoch": "#5fd4e8", "--d-schwer": "#a78bfa", "--d-sehr": "#f05fb0", "--d-extrem": "#ffffff" };
  const IDX = {};
  MOUNTAINS.forEach((m, i) => (IDX[m.id] = i));
  const revealed = new Set();
  let hotIds = [];
  const peakState = (id, st) => { if (IDX[id] != null && map.getSource("peaks")) map.setFeatureState({ source: "peaks", id: IDX[id] }, st); };
  function buildMarkers() {
    map.addSource("peaks", {
      type: "geojson",
      data: { type: "FeatureCollection", features: MOUNTAINS.map((m, i) => ({
        type: "Feature", id: i, geometry: { type: "Point", coordinates: [m.lon, m.lat] },
        properties: { id: m.id, name: m.name, alt: fmt(m.alt) + " m", c: HEX[color(m.lvl).replace(/^var\(|\)$/g, "")] || "#ffffff", km: m.km } })) },
    });
    const S = (k) => ["boolean", ["feature-state", k], false];
    const on = ["case", S("on"), 1, 0];
    map.addLayer({ id: "peaks-ring", type: "circle", source: "peaks", paint: {
      "circle-radius": ["case", S("sel"), 17, 12], "circle-color": "rgba(0,0,0,0)", "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      "circle-stroke-width": 2, "circle-stroke-color": ["get", "c"],
      "circle-stroke-opacity": ["case", ["all", S("on"), S("sel")], 0.45, 0] } });
    map.addLayer({ id: "peaks", type: "circle", source: "peaks", paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1.5, ["case", S("sel"), 8, S("hl"), 7, 5], 6, ["case", S("sel"), 9.5, S("hl"), 8.5, 6.5], 10, ["case", S("sel"), 10.5, S("hl"), 9.5, 7.5]],
      "circle-color": ["case", S("done"), "#f5c542", "rgba(7,11,15,0.82)"],
      "circle-stroke-color": ["case", S("done"), "#ffffff", ["get", "c"]],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1.5, 2, 8, 2.6],
      "circle-pitch-alignment": "viewport", "circle-pitch-scale": "viewport",
      "circle-opacity": on, "circle-stroke-opacity": on } });
    const label = (id, extra) => ({ id, type: "symbol", source: "peaks", ...extra,
      layout: { "text-field": ["format", ["get", "name"], {}, "  ", {}, ["get", "alt"], { "font-scale": 0.82, "text-color": "#9fb0ba" }],
        "text-font": ["Open Sans Semibold"], "text-size": 12.5, "text-anchor": "left", "text-offset": [0.95, 0],
        "text-max-width": 30, "text-pitch-alignment": "viewport", "text-rotation-alignment": "viewport", ...(extra.layout || {}) },
      paint: { "text-color": "#eef3f5", "text-halo-color": "rgba(7,11,15,0.92)", "text-halo-width": 1.8, "text-opacity": on } });
    map.addLayer(label("peaks-label", { minzoom: 6.8, layout: { "symbol-sort-key": ["get", "km"] } }));
    map.addLayer(label("peaks-label-hot", { filter: ["in", ["get", "id"], ["literal", []]], layout: { "text-allow-overlap": true, "text-ignore-placement": true } }));
    const h = el("div", "home", `<div class="home-pulse"></div><div class="home-core"></div><div class="home-label">Kriens</div>`);
    new maplibregl.Marker({ element: h, anchor: "center" }).setLngLat([KRIENS.lon, KRIENS.lat]).addTo(map);
    refreshMarkers();
  }
  function refreshMarkers() { MOUNTAINS.forEach((m) => peakState(m.id, { done: isDone(m.id) })); }
  function revealPeak(id) { if (revealed.has(id)) return; revealed.add(id); peakState(id, { on: true }); }
  function updateHot() { map.getLayer("peaks-label-hot") && map.setFilter("peaks-label-hot", ["in", ["get", "id"], ["literal", hotIds]]); }
  function setSel(id, on) {
    if (!id) return;
    peakState(id, { sel: on });
    hotIds = hotIds.filter((x) => x !== id); if (on) hotIds.push(id); updateHot();
  }
  function hl(id, on) {
    peakState(id, { hl: on });
    if (on) { if (!hotIds.includes(id)) hotIds.push(id); } else if (id !== selected) hotIds = hotIds.filter((x) => x !== id);
    updateHot();
    document.querySelector(`.row[data-id="${id}"]`)?.classList.toggle("hl", on);
  }
  /* Treffer mit etwas Toleranz (Finger) */
  function peakAt(pt, tol = 14) {
    if (!map.getLayer("peaks")) return null;
    const f = map.queryRenderedFeatures([[pt.x - tol, pt.y - tol], [pt.x + tol, pt.y + tol]], { layers: ["peaks"] });
    if (!f.length) return null;
    f.sort((a, b) => { const pa = map.project(a.geometry.coordinates), pb = map.project(b.geometry.coordinates); return Math.hypot(pa.x - pt.x, pa.y - pt.y) - Math.hypot(pb.x - pt.x, pb.y - pt.y); });
    return f[0].properties.id;
  }
  let hoverId = null;
  map.on("mousemove", (e) => {
    const id = peakAt(e.point, 8);
    if (id === hoverId) return;
    if (hoverId) hl(hoverId, false);
    hoverId = id; if (id) hl(id, true);
    map.getCanvas().style.cursor = id ? "pointer" : "";
  });

  /* Distanzringe um Kriens */
  function ringsGeo() {
    return {
      type: "FeatureCollection",
      features: RINGS.map((km) => ({
        type: "Feature", properties: { km },
        geometry: { type: "LineString", coordinates: Array.from({ length: 181 }, (_, i) => destination(KRIENS, i * 2, km)) },
      })),
    };
  }
  function addRings() {
    map.addSource("rings", { type: "geojson", data: ringsGeo() });
    map.addLayer({ id: "rings", type: "line", source: "rings", paint: { "line-color": "#ffffff", "line-opacity": 0.22, "line-width": 1, "line-dasharray": [2, 3] } });
    RINGS.forEach((km) => {
      const lab = el("div", "ring-label", km >= 1000 ? `${fmt(km)} km` : `${km} km`);
      ringLabels.push({ km, el: lab });
      new maplibregl.Marker({ element: lab, anchor: "bottom" }).setLngLat(destination(KRIENS, 0, km)).addTo(map);
    });
    updateRingLabels();
  }
  const ringLabels = [];
  function updateRingLabels() {
    const pxPerKm = (512 * Math.pow(2, map.getZoom())) / 40075;
    let lastPx = -1;
    ringLabels.forEach((r) => {
      const px = r.km * pxPerKm;
      const show = px > 46 && px - lastPx > 30 && px < innerHeight * 1.2;
      r.el.style.visibility = show ? "visible" : "hidden";
      if (show) lastPx = px;
    });
  }
  map.on("zoom", updateRingLabels);

  /* Route der bestiegenen Gipfel */
  function routeStops() {
    const list = MOUNTAINS.filter((m) => isDone(m.id)).map((m, i) => ({ m, date: state.done[m.id] || "", i }));
    list.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : a.date ? -1 : b.date ? 1 : a.m.km - b.m.km));
    return list.map((x) => x.m);
  }
  function routeLegs() {
    const stops = [KRIENS, ...routeStops()];
    const legs = [];
    for (let i = 1; i < stops.length; i++) legs.push(greatCircle(stops[i - 1], stops[i]));
    return legs;
  }
  const lineFC = (coords) => ({ type: "FeatureCollection", features: coords.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [] });
  function fullRoute() {
    const all = [];
    routeLegs().forEach((leg) => { const off = all.length ? all[all.length - 1][0] - leg[0][0] : 0; const k = Math.round(off / 360) * 360; leg.forEach((p) => all.push([p[0] + k, p[1]])); });
    return all;
  }
  function addRoute() {
    map.addSource("route", { type: "geojson", data: lineFC(fullRoute()), lineMetrics: true });
    map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f5c542", "line-width": 10, "line-blur": 8, "line-opacity": 0.45 } });
    map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 2.6, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#ff6a3d", 1, "#f5c542"] } });
    addClimb();
  }
  const setRoute = (coords) => map.getSource("route")?.setData(lineFC(coords));

  /* ---------- Aufstiegsrouten pro Berg ---------- */
  const ROUTES = window.ROUTES || {};
  let campMarkers = [], climbSel = null;
  function addClimb() {
    map.addSource("climb", { type: "geojson", data: lineFC([]), lineMetrics: true });
    map.addLayer({ id: "climb-glow", type: "line", source: "climb", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-blur": 6, "line-opacity": 0.35 } });
    map.addLayer({ id: "climb", type: "line", source: "climb", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-width": 3.4, "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#5fd4e8", 0.6, "#ffffff", 1, "#ff6a3d"] } });
  }
  function clearClimb() {
    map.getSource("climb")?.setData(lineFC([]));
    campMarkers.forEach((c) => c.remove()); campMarkers = [];
    climbSel = null;
  }
  function campsFor(r, upto = Infinity) {
    campMarkers.forEach((c) => c.remove()); campMarkers = [];
    r.camps.forEach((c, i) => {
      if (i >= upto || c.top) return;
      const e = el("div", "camp" + (i === 0 ? " start" : ""), `<i></i><span>${esc(c.n)}${c.alt ? `<b>${fmt(c.alt)} m</b>` : ""}</span>`);
      campMarkers.push(new maplibregl.Marker({ element: e, anchor: "center" }).setLngLat([c.lon, c.lat]).addTo(map));
    });
  }
  function showClimb(m, idx, fly) {
    const r = (ROUTES[m.id] || [])[idx]; if (!r) return;
    climbSel = { id: m.id, idx };
    document.querySelectorAll("#routes .rt").forEach((b) => b.classList.toggle("on", +b.dataset.i === idx));
    renderStations(m, r);
    const coords = r.coords.map((c) => [c[0], c[1]]);
    if (!fly || reduceMotion) { map.getSource("climb")?.setData(lineFC(coords)); campsFor(r); return; }
    climbFly(m, r, coords);
  }
  /* Stationen-Leiste: Foto, Name, Höhe je Lager/Hütte; antippen = hinfliegen + Foto gross */
  function renderStations(m, r) {
    const box = $("#stations"); if (!box) return;
    box.innerHTML = r.camps.map((c, i) => `<button class="st${c.top ? " top" : ""}" data-i="${i}" style="--d:${i * 60}ms">
      <span class="st-ph">${c.ph ? `<img alt="" loading="lazy" src="${esc(imgUrl(c.ph, 330))}">` : `<svg viewBox="0 0 24 24"><path d="M3 19 10 7l4 6 2-3 5 9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`}</span>
      <span class="st-i">${c.top ? "▲" : i === 0 ? "Start" : i}</span>
      <b>${esc(c.n)}</b><small>${c.alt ? fmt(c.alt) + " m" : "&nbsp;"}</small></button>`).join("");
    box.querySelectorAll(".st img").forEach((img) => (img.onload = () => img.classList.add("on")));
    box.querySelectorAll(".st").forEach((b) => b.addEventListener("click", () => {
      const c = r.camps[+b.dataset.i];
      stopOrbit(); if (anim) anim.cancel = true;
      stationOn(+b.dataset.i, true);
      map.flyTo({ center: [c.lon, c.lat], zoom: c.top ? 13.2 : 14.2, pitch: 62, bearing: map.getBearing() + 25, duration: 2200, essential: true });
    }));
  }
  function stationOn(i, showPhoto) {
    const box = $("#stations"); if (!box) return;
    box.querySelectorAll(".st").forEach((b) => b.classList.toggle("on", +b.dataset.i === i));
    const b = box.querySelector(`.st[data-i="${i}"]`);
    if (b) box.scrollTo({ left: b.offsetLeft - box.clientWidth / 2 + b.clientWidth / 2, behavior: "smooth" });
    const r = climbSel && (ROUTES[climbSel.id] || [])[climbSel.idx], c = r?.camps[i];
    if (showPhoto && c?.ph) heroPhoto(c.ph, c.n + (c.alt ? ` · ${fmt(c.alt)} m` : ""));
  }
  async function heroPhoto(im, label) {
    const hero = $("#hero"); if (!hero) return;
    const token = ++heroToken;
    $("#heroBadges").innerHTML = `<span class="badge">${esc(label)}</span>${is4k(im) ? `<span class="badge k4">4K</span>` : ""}`;
    $("#credit").innerHTML = `Foto: ${esc(im.by || "unbekannt")} · ${esc(im.lic || "")} · <a href="${esc(im.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
    try {
      const img = await loadImg(imgUrl(im, 960));
      if (token !== heroToken) return;
      put(hero, img);
    } catch (e) {}
  }

  /* Kamera folgt der Route vom Start bis zum Gipfel, die Linie wächst mit */
  async function climbFly(m, r, coords) {
    stopOrbit(); if (anim) anim.cancel = true;
    map.getSource("climb")?.setData(lineFC([]));
    campsFor(r, 1);
    stationOn(0, true);
    const pad = isMobile() ? { top: 40, bottom: innerHeight * 0.62, left: 0, right: 0 } : { top: 60, bottom: 40, left: 360, right: 480 };
    const b0 = bearingOf(coords[0], [m.lon, m.lat]);
    await flyTo({ center: coords[0], zoom: 13.4, pitch: 64, bearing: b0, padding: pad, duration: 2200 });
    if (climbSel?.id !== m.id) return;
    const n = coords.length, dur = clamp(5000 + r.km * 900, 7000, 16000);
    let shown = 1;
    const ok = await animate(dur, (t) => {
      const k = easeInOut(t), idx = Math.max(1, Math.round(k * (n - 1)));
      map.getSource("climb")?.setData(lineFC(coords.slice(0, idx + 1)));
      const look = coords[Math.min(n - 1, idx + Math.round(n * 0.08))];
      const camp = r.camps.findIndex((c, i) => i >= shown && dist({ lat: c.lat, lon: c.lon }, { lat: coords[idx][1], lon: coords[idx][0] }) < 0.12);
      if (camp > 0) { shown = camp + 1; campsFor(r, shown); stationOn(camp, true); }
      map.jumpTo({ center: coords[idx], zoom: 13.6 - Math.sin(Math.PI * t) * 0.6, pitch: 66, bearing: lerp(b0, bearingOf(coords[idx], look) || b0, 0.15) });
    });
    map.getSource("climb")?.setData(lineFC(coords));
    campsFor(r);
    if (ok && selected === m.id) {
      toast(`${m.name} erreicht · ${fmt(m.alt)} m`);
      stationOn(r.camps.length - 1, true);
      /* zum Schluss die ganze Route mit allen Lagern zeigen */
      const bb = coords.reduce((b, c) => [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])], [180, 90, -180, -90]);
      const cam = map.cameraForBounds([[bb[0], bb[1]], [bb[2], bb[3]]], { padding: { top: pad.top + 60, bottom: pad.bottom + 60, left: pad.left + 60, right: pad.right + 60 } });
      if (cam) await easeTo({ center: cam.center, zoom: Math.min(14, cam.zoom - 0.4), pitch: 58, bearing: map.getBearing(), padding: pad, duration: 2600 });
      if (selected === m.id) orbit(3);
    }
  }

  /* ---------- Kamera-Helfer ---------- */
  let anim = null, orbitRAF = null, touring = false;
  function stopOrbit() { if (orbitRAF) cancelAnimationFrame(orbitRAF); orbitRAF = null; }
  /* Kamera dreht sich langsam – aber nur kurz, sonst rendert die Karte pausenlos und das Handy ruckelt/heizt */
  function orbit(speed = 2.2, maxMs = 8000) {
    stopOrbit();
    if (reduceMotion) return;
    let last = performance.now();
    const end = last + maxMs;
    const step = (now) => {
      const dt = Math.min(64, now - last); last = now;
      const fade = clamp((end - now) / 1500, 0, 1);          // sanft auslaufen
      map.setBearing(map.getBearing() + (speed * fade * dt) / 1000);
      if (now >= end) { orbitRAF = null; return; }
      orbitRAF = requestAnimationFrame(step);
    };
    orbitRAF = requestAnimationFrame(step);
  }
  ["mousedown", "touchstart", "wheel"].forEach((ev) => map.getCanvasContainer().addEventListener(ev, () => { stopOrbit(); if (anim) anim.cancel = true; }, { passive: true }));

  function animate(duration, frame) {
    return new Promise((resolve) => {
      const a = { cancel: false };
      anim = a;
      const t0 = performance.now();
      const step = (now) => {
        if (a.cancel) return resolve(false);
        const t = clamp((now - t0) / duration, 0, 1);
        frame(t);
        if (t < 1) requestAnimationFrame(step); else { anim = null; resolve(true); }
      };
      requestAnimationFrame(step);
    });
  }
  const flyTo = (opts) => new Promise((res) => { map.once("moveend", () => res()); map.flyTo({ essential: true, ...opts }); });
  const easeTo = (opts) => new Promise((res) => { map.once("moveend", () => res()); map.easeTo({ essential: true, ...opts }); });

  /* ---------- Intro: von Kriens in die Welt ---------- */
  async function intro() {
    const ordered = [...MOUNTAINS].sort((a, b) => a.km - b.km);
    const reveal = (km) => ordered.forEach((m) => {
      if (m.km <= km) revealPeak(m.id);
    });
    if (reduceMotion) { reveal(Infinity); map.jumpTo({ center: [20, 22], zoom: 1.6, pitch: 0, bearing: 0 }); return; }
    introRunning = true;
    reveal(15);
    await sleep(700);
    const s = { ...START_VIEW }, e = { center: [28, 22], zoom: 1.55, pitch: 0, bearing: 360 };
    await animate(9000, (t) => {
      const k = easeInOut(t);
      const zk = 1 - Math.pow(1 - t, 2.2);                       // schneller raus, sanft auslaufen
      const zoom = lerp(s.zoom, e.zoom, zk);
      const ck = Math.pow(k, 1.6);
      map.jumpTo({
        center: [lerp(s.center[0], e.center[0], ck), lerp(s.center[1], e.center[1], ck)],
        zoom, pitch: lerp(s.pitch, e.pitch, Math.min(1, t * 1.4)), bearing: lerp(s.bearing, e.bearing, k),
      });
      const radius = (20000 * (innerWidth / 512)) / Math.pow(2, zoom);
      reveal(radius * 1.15);
    });
    reveal(Infinity);
    introRunning = false;
    if (!touring) hint(true);
  }
  let introRunning = false;

  /* Hinweis zum Tippen */
  let hintShown = false, hintUsed = false;
  function hint(on) {
    const t = $("#toast");
    if (on && !hintUsed) { hintShown = true; t.textContent = "Tippe auf die Karte, um deine Gipfelroute zu fliegen"; t.hidden = false; }
    else if (!on) { t.hidden = true; hintShown = false; }
  }
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.hidden = true; void t.offsetWidth;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------- Routenfahrt ---------- */
  async function tour() {
    if (touring) { if (anim) anim.cancel = true; return; }
    const stops = routeStops();
    if (!stops.length) { toast("Noch kein Gipfel eingetragen. Öffne einen Berg und tippe auf «Bestiegen»."); return; }
    if (anim) anim.cancel = true;
    hint(false); hintUsed = true;
    closeDetail(true);
    touring = true; stopOrbit();
    await sleep(40);
    document.body.classList.add("touring");
    const btn = $("#routeBtn"); btn.classList.add("running"); btn.querySelector("span").textContent = "Stopp";
    const legs = routeLegs();
    let drawn = [], ok = true;
    setRoute([]);
    await flyTo({ center: [KRIENS.lon, KRIENS.lat], zoom: 11.2, pitch: 58, bearing: bearingOf([KRIENS.lon, KRIENS.lat], [stops[0].lon, stops[0].lat]), duration: 2600, curve: 1.5 });
    showArrival(null, 0, stops.length);
    await sleep(1300);
    let total = 0;
    for (let i = 0; i < legs.length && ok; i++) {
      const leg = legs[i];
      const off = drawn.length ? Math.round((drawn[drawn.length - 1][0] - leg[0][0]) / 360) * 360 : 0;
      const path = leg.map((p) => [p[0] + off, p[1]]);
      const from = i ? stops[i - 1] : KRIENS, to = stops[i];
      const km = dist(from, to); total += km;
      const zs = 11.2, ze = 11.6, zm = clamp(13.2 - Math.log2(km / 2.5), 1.5, 10);
      const dur = clamp(2600 + 950 * Math.log2(1 + km / 50), 3000, 10000);
      const b0 = map.getBearing(), b1 = bearingOf(path[0], path[path.length - 1]);
      const base = drawn.slice();
      hideArrival();
      ok = await animate(dur, (t) => {
        const k = easeInOut(t);
        const idx = Math.max(1, Math.round(k * (path.length - 1)));
        const head = path[idx];
        setRoute(base.concat(path.slice(0, idx + 1)));
        const arc = Math.sin(Math.PI * t);
        const zoom = arc > 0 ? lerp(t < 0.5 ? zs : ze, zm, Math.pow(arc, 0.65)) : (t < 0.5 ? zs : ze);
        map.jumpTo({ center: head, zoom, pitch: clamp((zoom - 2.5) * 8, 0, 60), bearing: lerp(b0, b1, Math.min(1, t * 2)) * (1 - arc * 0.2) });
      });
      drawn = base.concat(path);
      if (!ok) break;
      setRoute(drawn);
      setSel(to.id, true);
      showArrival(to, i + 1, stops.length, total);
      if (!reduceMotion) orbit(6, 2600);
      await sleep(2600);
      stopOrbit();
      setSel(to.id, false);
    }
    hideArrival();
    setRoute(fullRoute());
    if (ok) {
      const all = [KRIENS, ...stops];
      const mid = all.reduce((a, p) => [a[0] + p.lon / all.length, a[1] + p.lat / all.length], [0, 0]);
      await easeTo({ center: mid, zoom: clamp(1.4 + 6 - Math.log2(1 + total / 60), 1.4, 8), pitch: 0, bearing: 0, duration: 3200 });
      toast(`${stops.length} ${stops.length === 1 ? "Gipfel" : "Gipfel"} · ${fmt(total)} km Luftlinie ab Kriens`, 4200);
    }
    touring = false;
    document.body.classList.remove("touring");
    btn.classList.remove("running"); btn.querySelector("span").textContent = "Meine Route";
  }
  function showArrival(m, n, of, total = 0) {
    const a = $("#arrival");
    a.hidden = true; void a.offsetWidth;
    if (!m) {
      a.innerHTML = `<div><div class="a-step">Start</div><b>Kriens</b><small>${of} ${of === 1 ? "Gipfel" : "Gipfel"} auf deiner Route</small></div>`;
    } else {
      const im = m.images?.[0];
      a.innerHTML = `${im ? `<img src="${esc(imgUrl(im, 330))}" alt="">` : ""}<div><div class="a-step">Gipfel ${n} / ${of}${state.done[m.id] ? " · " + esc(fmtDate(state.done[m.id])) : ""}</div><b>${esc(m.name)}</b><small>${fmt(m.alt)} m · ${fmt(total)} km geflogen</small></div>`;
    }
    a.hidden = false;
  }
  const hideArrival = () => ($("#arrival").hidden = true);
  const fmtDate = (d) => { if (!d) return ""; const [y, mo, da] = d.split("-"); return `${+da}.${+mo}.${y}`; };

  /* ---------- Liste ---------- */
  let filter = "all", query = "", selected = null;
  function renderList() {
    const body = $("#listBody");
    const q = query.trim().toLowerCase();
    const items = MOUNTAINS.filter((m) =>
      (filter === "all" || (filter === "done") === isDone(m.id)) &&
      (!q || (m.name + " " + (m.sub || "") + " " + m.region + " " + m.range).toLowerCase().includes(q)));
    const groups = {};
    items.forEach((m) => (groups[sectionOf(m)] ||= []).push(m));
    body.innerHTML = "";
    let n = 0;
    SECTIONS.forEach((s) => {
      const g = groups[s]; if (!g) return;
      g.sort((a, b) => a.km - b.km);
      const done = g.filter((m) => isDone(m.id)).length;
      body.append(el("div", "sec-h", `<h3>${esc(s)}</h3><span>${done}/${g.length}</span>`));
      g.forEach((m) => {
        const r = el("button", "row" + (isDone(m.id) ? " done" : "") + (selected === m.id ? " sel" : ""));
        r.dataset.id = m.id;
        r.style.animationDelay = Math.min(n++ * 18, 600) + "ms";
        r.innerHTML = `${plaque(m)}<span class="row-name"><b>${esc(m.name)}</b><small>${esc(m.type)} · ${esc(m.scale)}${(window.ROUTES || {})[m.id] ? ` · <em class="row-rt">${window.ROUTES[m.id].length} ${window.ROUTES[m.id].length === 1 ? "Route" : "Routen"}</em>` : ""}</small></span><span class="row-alt">${fmt(m.alt)} m<small>${m.km < 10 ? m.km.toFixed(1) : fmt(m.km)} km</small></span>`;
        r.addEventListener("click", () => select(m.id));
        r.addEventListener("mouseenter", () => hl(m.id, true));
        r.addEventListener("mouseleave", () => hl(m.id, false));
        body.append(r);
      });
    });
    if (!items.length) body.append(el("p", "credit", filter === "done" ? "Noch nichts bestiegen in dieser Auswahl." : "Kein Berg gefunden."));
  }
  function renderProgress() {
    const d = MOUNTAINS.filter((m) => isDone(m.id)).length;
    $("#doneCount").textContent = d;
    $("#totalCount").textContent = MOUNTAINS.length;
    $("#progressFill").style.width = (100 * d) / MOUNTAINS.length + "%";
  }
  $("#q").addEventListener("input", (e) => { query = e.target.value; renderList(); });
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c));
    filter = c.dataset.f; renderList();
  }));
  $("#listGrip").addEventListener("click", () => $("#list").classList.toggle("tall"));
  $("#q").addEventListener("focus", () => isMobile() && $("#list").classList.add("tall"));

  /* ---------- Steckbrief ---------- */
  let gallery = { m: null, i: 0 };
  async function select(id) {
    const m = byId[id]; if (!m) return;
    if (touring) return;
    if (anim) anim.cancel = true;
    hint(false); hintUsed = true;
    if (selected) setSel(selected, false);
    selected = id;
    setSel(id, true);
    document.querySelectorAll(".row").forEach((r) => r.classList.toggle("sel", r.dataset.id === id));
    if (isMobile()) $("#list").classList.remove("tall");
    renderDetail(m);
    stopOrbit();
    await sleep(40);
    const big = m.alt > 5000;
    const pad = isMobile() ? { top: 40, bottom: innerHeight * 0.62, left: 0, right: 0 } : { top: 60, bottom: 40, left: 360, right: 480 };
    await flyTo({
      center: [m.lon, m.lat], zoom: big ? 11.6 : m.alt > 3000 ? 12.3 : 12.8, pitch: 66,
      bearing: (map.getBearing() + 40) % 360, padding: pad,
      speed: 0.9, curve: 1.6, maxDuration: 9000,
    });
    if (selected === id) orbit(2.2);
  }

  function renderDetail(m) {
    const box = $("#detail");
    box.hidden = false; box.classList.remove("out");
    box.style.animation = "none"; void box.offsetWidth; box.style.animation = "";
    document.body.classList.add("has-detail");
    gallery = { m, i: 0 };
    const t = tier(m.lvl);
    const done = isDone(m.id);
    const tScale = /^T/.test(m.scale);
    const warn = m.alt >= 8000 ? "Todeszone über 8000 m: Flaschensauerstoff und Expeditionserfahrung nötig."
      : m.alt >= 5000 ? "Grosse Höhe: mehrere Tage Akklimatisation einplanen."
      : m.alt >= 4000 ? "Über 4000 m: Höhe spürbar, vorher akklimatisieren." : "";
    const imgs = m.images || [];
    $("#detailScroll").innerHTML = `
      <div class="hero" id="hero">
        <div class="hero-shimmer"></div>
        <div class="hero-badges" id="heroBadges"></div>
        <button class="hero-open" id="heroOpen" aria-label="Foto gross ansehen"></button>
        ${imgs.length > 1 ? `<div class="hero-nav"><button id="hPrev" aria-label="Vorheriges Foto"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2"/></svg></button><button id="hNext" aria-label="Nächstes Foto"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div>` : ""}
      </div>
      <div class="d-head">
        <div class="d-region">${esc(m.region)} · ${esc(m.range)}</div>
        <h2 class="d-name">${esc(m.name)}</h2>
        ${m.sub ? `<div class="d-sub">${esc(m.sub)}</div>` : ""}
        <div class="d-alt"><b>${fmt(m.alt)}</b><span>m ü. M.</span></div>
      </div>
      <div class="d-body">
        <p class="d-text">${esc(m.text)}</p>
        <div class="diff" style="--c:${color(m.lvl)}">
          <div class="diff-top">${plaque(m)}<div><b>${esc(m.scale)} · ${esc(t.name)}</b><small>${esc(scaleText(m.scale) || m.type)} · ${esc(m.type)}</small></div></div>
          ${scaleBar(m)}
          ${warn ? `<div class="warn"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 3 2 20h20z M12 10v4 M12 17v.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>${esc(warn)}</div>` : ""}
        </div>
        <div class="stats">
          <div class="stat"><small>Ab Kriens</small><b>${m.km < 10 ? m.km.toFixed(1) : fmt(m.km)} km</b></div>
          <div class="stat"><small>Höhenmeter</small><b>${fmt(m.hm)} hm</b></div>
          <div class="stat"><small>Dauer</small><b>${esc(m.dauer)}</b></div>
          <div class="stat"><small>Beste Zeit</small><b>${esc(m.saison)}</b></div>
          <div class="stat wide"><small>Normalroute</small><b>${esc(m.route)}</b></div>
          ${m.erst ? `<div class="stat wide"><small>Erstbesteigung</small><b>${esc(m.erst)}</b></div>` : ""}
        </div>
        ${(ROUTES[m.id] || []).length ? `<div><p class="h-label">Routen · ${ROUTES[m.id].length} · antippen zum Abfliegen</p><div class="routes" id="routes">${ROUTES[m.id].map((r, i) => `<button class="rt" data-i="${i}"><span class="rt-n">${esc(r.name)}</span><span class="rt-m">${r.km.toFixed(1)} km · ${fmt(r.up)} hm${r.camps.length > 2 ? ` · ${r.camps.length} Stationen` : ""}</span>${r.schematic ? `<span class="rt-tag">schematisch</span>` : `<span class="rt-tag real">echter Weg</span>`}<svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" fill="currentColor"/></svg></button>`).join("")}</div><p class="h-label" style="margin-top:14px">Stationen · antippen zum Hinfliegen</p><div class="stations" id="stations"></div></div>` : ""}
        <div class="actions">
          <button class="btn summit ${done ? "is-done" : ""}" id="doneBtn">${done ? "✓ Bestiegen" : "Als bestiegen markieren"}</button>
          ${done ? `<label class="date-row" style="grid-column:span 2">Datum <input type="date" id="doneDate" value="${esc(state.done[m.id] || "")}"></label>` : ""}
          <button class="btn" id="flyBtn"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m21 3-1 6-6-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>3D-Rundflug</button>
          <button class="btn" id="photosBtn" ${imgs.length ? "" : "disabled"}><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m3 16 5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Fotos in 4K</button>
        </div>
        ${imgs.length ? `<div><p class="h-label">Fotos · ${imgs.length}</p><div class="thumbs" id="thumbs">${imgs.map((im, i) => `<button data-i="${i}" aria-label="Foto ${i + 1}"><img alt="" loading="lazy" data-src="${esc(imgUrl(im, 330))}"></button>`).join("")}</div></div>` : ""}
        <div class="credit" id="credit"></div>
        <div class="coords">${Math.abs(m.lat).toFixed(4)}° ${m.lat >= 0 ? "N" : "S"} · ${Math.abs(m.lon).toFixed(4)}° ${m.lon >= 0 ? "E" : "W"}</div>
      </div>`;
    $("#detailScroll").scrollTop = 0;
    countUp($("#detailScroll .d-alt b"), m.alt);
    $("#doneBtn").addEventListener("click", () => toggleDone(m));
    $("#doneDate")?.addEventListener("change", (e) => { state.done[m.id] = e.target.value; save(); setRoute(fullRoute()); });
    $("#flyBtn").addEventListener("click", () => flyAround(m));
    document.querySelectorAll("#routes .rt").forEach((b) => b.addEventListener("click", () => showClimb(m, +b.dataset.i, true)));
    if (ROUTES[m.id] && climbSel?.id !== m.id) showClimb(m, 0, false);
    else if (climbSel?.id === m.id) document.querySelectorAll("#routes .rt").forEach((b) => b.classList.toggle("on", +b.dataset.i === climbSel.idx));
    if (!ROUTES[m.id]) clearClimb();
    $("#photosBtn").addEventListener("click", () => openLightbox(gallery.i));
    $("#heroOpen").addEventListener("click", () => imgs.length && openLightbox(gallery.i));
    $("#hPrev")?.addEventListener("click", () => showHero(gallery.i - 1));
    $("#hNext")?.addEventListener("click", () => showHero(gallery.i + 1));
    document.querySelectorAll("#thumbs button").forEach((b) => b.addEventListener("click", () => showHero(+b.dataset.i)));
    document.querySelectorAll("#thumbs img").forEach((img) => { img.onload = () => img.classList.add("on"); img.src = img.dataset.src; });
    if (imgs.length) showHero(0);
    else {
      const hero = $("#hero");
      hero.classList.add("empty");
      hero.querySelector(".hero-shimmer")?.remove();
      hero.insertAdjacentHTML("afterbegin", `<svg class="hero-ph" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M0 230 L90 140 L140 185 L210 90 L270 160 L310 125 L400 210 V300 H0Z" fill="currentColor" opacity=".18"/><path d="M0 260 L70 200 L130 235 L190 170 L250 220 L320 180 L400 240 V300 H0Z" fill="currentColor" opacity=".3"/></svg><span class="hero-note">Fotos werden noch gesucht</span>`);
    }
  }

  function countUp(node, to) {
    if (!node || reduceMotion) return;
    const t0 = performance.now(), dur = 1100;
    const step = (now) => {
      const t = clamp((now - t0) / dur, 0, 1), k = 1 - Math.pow(1 - t, 4);
      node.textContent = fmt(to * k);
      if (t < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let heroToken = 0;
  async function showHero(i) {
    const m = gallery.m, imgs = m.images || [];
    if (!imgs.length) return;
    i = (i + imgs.length) % imgs.length; gallery.i = i;
    const im = imgs[i], token = ++heroToken;
    document.querySelectorAll("#thumbs button").forEach((b) => b.classList.toggle("cur", +b.dataset.i === i));
    $("#heroBadges").innerHTML = `${is4k(im) ? `<span class="badge k4">4K</span>` : ""}<span class="badge">${im.w}×${im.h}</span>${im.q === "featured" ? `<span class="badge star">★ Exzellent</span>` : im.q === "quality" ? `<span class="badge star">Qualitätsbild</span>` : ""}`;
    $("#credit").innerHTML = `Foto: ${esc(im.by || "unbekannt")} · ${esc(im.lic || "")} · <a href="${esc(im.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
    const hero = $("#hero");
    try {
      const small = await loadImg(imgUrl(im, 960));
      if (token !== heroToken) return;
      put(hero, small);
      const big = await loadImg(imgUrl(im, isMobile() ? 1920 : 1920));
      if (token !== heroToken) return;
      put(hero, big, true);
    } catch (e) { /* Foto nicht erreichbar */ }
  }
  function put(hero, img, swap) {
    hero.querySelector(".hero-shimmer")?.remove();
    img.alt = gallery.m.name;
    const old = [...hero.querySelectorAll("img")];
    hero.prepend(img);
    if (swap && old.length) { img.classList.add("on"); old.forEach((o) => o.remove()); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add("on")));
    setTimeout(() => old.forEach((o) => o.remove()), 1100);
  }

  function closeDetail(silent) {
    const box = $("#detail");
    if (box.hidden) return;
    box.classList.add("out");
    document.body.classList.remove("has-detail");
    setTimeout(() => { box.hidden = true; box.classList.remove("out"); }, 340);
    if (selected) setSel(selected, false);
    document.querySelectorAll(".row.sel").forEach((r) => r.classList.remove("sel"));
    selected = null;
    clearClimb();
    applyPadding();
    if (!silent) stopOrbit();
  }
  $("#closeDetail").addEventListener("click", () => closeDetail());

  function toggleDone(m) {
    if (isDone(m.id)) delete state.done[m.id];
    else { state.done[m.id] = new Date().toISOString().slice(0, 10); }
    save();
    refreshMarkers(); renderProgress(); renderList(); setRoute(fullRoute());
    const done = isDone(m.id);
    renderDetail(m);
    const b = $("#doneBtn"); b.classList.add("burst");
    if (done) { toast(`Eingetragen: ${m.name}, ${fmt(m.alt)} m`); burstAt($("#doneBtn")); }
  }

  /* kleine Gipfel-Feier: goldene Dreiecke fliegen aus dem Knopf */
  function burstAt(node) {
    if (!node || reduceMotion) return;
    const r = node.getBoundingClientRect(), box = el("div", "burst-box");
    box.style.left = r.left + r.width / 2 + "px"; box.style.top = r.top + r.height / 2 + "px";
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3, d = 60 + Math.random() * 90;
      const p = el("i"); p.style.setProperty("--x", Math.cos(a) * d + "px"); p.style.setProperty("--y", Math.sin(a) * d - 30 + "px");
      p.style.setProperty("--r", Math.round(Math.random() * 360) + "deg"); p.style.animationDelay = Math.random() * 80 + "ms";
      if (i % 3 === 0) p.className = "w";
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1300);
  }

  async function flyAround(m) {
    stopOrbit();
    await easeTo({ center: [m.lon, m.lat], zoom: (m.alt > 5000 ? 11.8 : 12.6) + 0.2, pitch: 62, duration: 1800 });
    if (selected === m.id) orbit(7, 30000);
  }

  /* ---------- Lightbox ---------- */
  let lbI = 0;
  function openLightbox(i) {
    const lb = $("#lightbox"); lb.hidden = false; lbShow(i);
  }
  async function lbShow(i) {
    const imgs = gallery.m.images; lbI = (i + imgs.length) % imgs.length;
    const im = imgs[lbI], img = $("#lbImg");
    $("#lbCount").textContent = `${lbI + 1} / ${imgs.length}`;
    $("#lbMeta").innerHTML = `<b>${esc(gallery.m.name)}</b>${im.w}×${im.h}${is4k(im) ? " · 4K" : ""} · ${esc(im.by || "")} · ${esc(im.lic || "")} · <a href="${esc(im.page)}" target="_blank" rel="noopener">Quelle</a>`;
    img.style.opacity = 0.35;
    img.src = imgUrl(im, 1280);
    try { const full = await loadImg(imgUrl(im, 3840)); if (gallery.m.images[lbI] === im) img.src = full.src; } catch (e) {}
    img.style.opacity = 1;
  }
  $("#lbPrev").addEventListener("click", () => lbShow(lbI - 1));
  $("#lbNext").addEventListener("click", () => lbShow(lbI + 1));
  $("#lbClose").addEventListener("click", () => ($("#lightbox").hidden = true));
  addEventListener("keydown", (e) => {
    if ($("#lightbox").hidden) { if (e.key === "Escape") closeDetail(); return; }
    if (e.key === "Escape") $("#lightbox").hidden = true;
    if (e.key === "ArrowLeft") lbShow(lbI - 1);
    if (e.key === "ArrowRight") lbShow(lbI + 1);
  });

  /* ---------- Skyline ---------- */
  function openSkyline() {
    const box = $("#skyline"), svg = $("#skySvg");
    const list = [...MOUNTAINS].sort((a, b) => a.km - b.km);
    const step = 16, W = Math.max(list.length * step + 60, box.clientWidth || innerWidth), H = 190, base = H - 22, top = 26;
    const y = (alt) => base - ((base - top) * alt) / 8849;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.width = W + "px"; svg.style.height = H + "px";
    const x0 = (W - list.length * step) / 2;
    let html = "";
    [2000, 4000, 6000, 8000].forEach((a) => {
      html += `<line x1="0" x2="${W}" y1="${y(a)}" y2="${y(a)}" class="sky-grid"/><text x="6" y="${y(a) - 4}" class="sky-gl">${fmt(a)} m</text>`;
    });
    list.forEach((m, i) => {
      const cx = x0 + i * step + step / 2, py = y(m.alt), hw = 9 + (m.alt / 8849) * 26;
      const done = isDone(m.id);
      html += `<g class="peak${done ? " done" : ""}" data-id="${m.id}" style="--c:${done ? "var(--summit)" : color(m.lvl)};animation-delay:${i * 9}ms">
        <path d="M${cx - hw} ${base} L${cx} ${py} L${cx + hw} ${base}Z"/><circle cx="${cx}" cy="${py}" r="2.4"/></g>`;
    });
    const label = new Set(["pilatus", "matterhorn", "montblanc", "kilimanjaro", "aconcagua", "everest", "k2", "tafelberg", "denali", "eiger"]);
    list.forEach((m, i) => {
      if (!label.has(m.id) && !isDone(m.id)) return;
      const cx = x0 + i * step + step / 2;
      html += `<text x="${cx}" y="${y(m.alt) - 8}" class="sky-lab${isDone(m.id) ? " done" : ""}" text-anchor="middle">${esc(m.name)}</text>`;
    });
    html += `<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="sky-base"/>`;
    svg.innerHTML = html;
    box.hidden = false;
    box.classList.remove("in"); void box.offsetWidth; box.classList.add("in");
    const tip = $("#skyTip");
    svg.querySelectorAll(".peak").forEach((g) => {
      const m = byId[g.dataset.id];
      g.addEventListener("mouseenter", () => {
        tip.innerHTML = `<b>${esc(m.name)}</b> ${fmt(m.alt)} m · ${esc(m.scale)} · ${fmt(m.km)} km`;
        tip.hidden = false; hl(m.id, true);
      });
      g.addEventListener("mouseleave", () => { tip.hidden = true; hl(m.id, false); });
      g.addEventListener("click", () => { closeSkyline(); select(m.id); });
    });
  }
  function closeSkyline() { $("#skyline").hidden = true; }
  $("#skyBtn").addEventListener("click", () => ($("#skyline").hidden ? openSkyline() : closeSkyline()));
  $("#skyClose").addEventListener("click", closeSkyline);

  /* ---------- Werkzeuge ---------- */
  $("#routeBtn").addEventListener("click", tour);
  $("#worldBtn").addEventListener("click", () => { closeDetail(); stopOrbit(); map.flyTo({ center: [28, 22], zoom: 1.55, pitch: 0, bearing: 0, duration: 3200, essential: true }); });
  $("#homeBtn").addEventListener("click", () => { closeDetail(); stopOrbit(); map.flyTo({ ...START_VIEW, duration: 4200, curve: 1.6, essential: true }); });
  $("#tiltBtn").addEventListener("click", () => {
    const flat = map.getPitch() < 20;
    map.easeTo({ pitch: flat ? 65 : 0, duration: 1200 });
  });
  map.on("pitchend", () => ($("#tiltLabel").textContent = map.getPitch() < 20 ? "3D" : "2D"));
  map.on("click", (e) => {
    if (touring) return;
    const hit = !introRunning && peakAt(e.point);
    if (hit) { select(hit); return; }
    if (introRunning || (hintShown && !hintUsed)) { tour(); return; }
    if (!$("#detail").hidden && !isMobile()) return;
    if (!$("#detail").hidden) closeDetail();
  });

  /* ---------- Start ---------- */
  renderList(); renderProgress();
  let started = false;
  async function start() {
    if (started) return; started = true;
    $("#veilSub").textContent = "Bereit";
    await sleep(350);
    $("#veil").classList.add("gone");
    applyPadding();
    intro();
  }
  function applyPadding() {
    map.setPadding(isMobile() ? { top: 60, bottom: innerHeight * 0.33, left: 0, right: 0 } : { top: 70, bottom: 0, left: 356, right: 0 });
  }
  addEventListener("resize", () => !selected && applyPadding());
  setTimeout(() => { if (!started) { $("#veilSub").textContent = "Karte lädt langsam …"; } }, 9000);
  setTimeout(() => {
    if (started) return;
    const s = $("#veilSub");
    s.innerHTML = 'Die Karte hängt. <button id="reloadBtn" style="margin-left:8px;padding:6px 12px;border-radius:8px;border:1px solid var(--line-strong);background:transparent">Neu laden</button>';
    $("#reloadBtn").addEventListener("click", () => location.reload());
  }, 25000);
  map.on("load", () => {
    addRings(); addRoute(); buildMarkers();
    map.once("idle", start);
    setTimeout(start, 6500);
  });
  map.on("error", (e) => console.warn("Karte:", e?.error?.message || e));
})();
