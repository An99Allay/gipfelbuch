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

  try { maplibregl.setWorkerCount(2); } catch (e) {}
  const map = new maplibregl.Map({
    container: "map",
    style: {
      version: 8,
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
          type: "raster-dem", tileSize: 256, maxzoom: 15, encoding: "terrarium",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          attribution: "Gelände: Mapzen / AWS Terrain Tiles",
        },
      },
      layers: [
        { id: "bg", type: "background", paint: { "background-color": "#05080b" } },
        { id: "sat", type: "raster", source: "sat", paint: { "raster-contrast": 0.06, "raster-saturation": 0.05, "raster-fade-duration": 380 } },
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
    maxPitch: 82,
    attributionControl: { compact: true },
    fadeDuration: 300,
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

  /* Marker */
  const markers = {};
  function buildMarkers() {
    MOUNTAINS.forEach((m) => {
      const e = el("div", "mk pending");
      e.style.setProperty("--c", color(m.lvl));
      e.innerHTML = `<div class="mk-dot"></div><div class="mk-label">${esc(m.name)}<i>${fmt(m.alt)} m</i></div>`;
      e.addEventListener("click", (ev) => { ev.stopPropagation(); select(m.id); });
      e.addEventListener("mouseenter", () => hl(m.id, true));
      e.addEventListener("mouseleave", () => hl(m.id, false));
      markers[m.id] = { el: e, mk: new maplibregl.Marker({ element: e, anchor: "center" }).setLngLat([m.lon, m.lat]).addTo(map) };
    });
    const h = el("div", "home", `<div class="home-pulse"></div><div class="home-core"></div><div class="home-label">Kriens</div>`);
    new maplibregl.Marker({ element: h, anchor: "center" }).setLngLat([KRIENS.lon, KRIENS.lat]).addTo(map);
    refreshMarkers();
  }
  function refreshMarkers() {
    MOUNTAINS.forEach((m) => markers[m.id]?.el.classList.toggle("done", isDone(m.id)));
  }
  function hl(id, on) {
    markers[id]?.el.classList.toggle("hl", on);
    document.querySelector(`.row[data-id="${id}"]`)?.classList.toggle("hl", on);
  }
  map.on("zoom", () => $("#map").classList.toggle("labels", map.getZoom() >= 6.8));

  /* Marker hinter dem Horizont ausblenden (Globus + starke Neigung) */
  function cullMarkers() {
    const c = map.getCenter(), z = map.getZoom(), p = map.getPitch();
    const span = (40075 / Math.pow(2, z)) * (innerWidth / 512);
    const limit = z < 4 ? Infinity : span * (0.9 + Math.pow(p / 60, 2) * 1.6);
    const cc = { lat: c.lat, lon: c.lng };
    MOUNTAINS.forEach((m) => {
      const mk = markers[m.id]; if (!mk) return;
      const hide = dist(cc, m) > limit;
      if (mk.hidden !== hide) { mk.hidden = hide; mk.el.style.visibility = hide ? "hidden" : ""; }
    });
  }
  map.on("move", cullMarkers);

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
  }
  const setRoute = (coords) => map.getSource("route")?.setData(lineFC(coords));

  /* ---------- Kamera-Helfer ---------- */
  let anim = null, orbitRAF = null, touring = false;
  function stopOrbit() { if (orbitRAF) cancelAnimationFrame(orbitRAF); orbitRAF = null; }
  function orbit(speed = 2.2) {
    stopOrbit();
    if (reduceMotion) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(64, now - last); last = now;
      map.setBearing(map.getBearing() + (speed * dt) / 1000);
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
      if (m.km <= km) { const e = markers[m.id].el; if (e.classList.contains("pending")) { e.classList.remove("pending"); e.classList.add("pop"); } }
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
      markers[to.id].el.classList.add("sel");
      showArrival(to, i + 1, stops.length, total);
      if (!reduceMotion) orbit(6);
      await sleep(2600);
      stopOrbit();
      markers[to.id].el.classList.remove("sel");
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
        r.innerHTML = `${plaque(m)}<span class="row-name"><b>${esc(m.name)}</b><small>${esc(m.type)} · ${esc(m.scale)}</small></span><span class="row-alt">${fmt(m.alt)} m<small>${m.km < 10 ? m.km.toFixed(1) : fmt(m.km)} km</small></span>`;
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
    if (selected && markers[selected]) markers[selected].el.classList.remove("sel");
    selected = id;
    markers[id].el.classList.add("sel");
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
    if (selected && markers[selected]) markers[selected].el.classList.remove("sel");
    document.querySelectorAll(".row.sel").forEach((r) => r.classList.remove("sel"));
    selected = null;
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
    if (done) toast(`Eingetragen: ${m.name}, ${fmt(m.alt)} m`);
  }

  async function flyAround(m) {
    stopOrbit();
    await easeTo({ center: [m.lon, m.lat], zoom: (m.alt > 5000 ? 11.8 : 12.6) + 0.3, pitch: 76, duration: 1800 });
    if (selected === m.id) orbit(9);
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
  map.on("click", () => {
    if (touring) return;
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
