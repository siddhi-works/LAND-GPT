// Cadastral GIS engine (Leaflet), modelled on the Bhuvan 2D interaction: base maps, layers,
// full/previous/next extent, measure tools, overview map, progressive administrative reveal.
import { villageFabric } from "./fabric.js";
import { t } from "./i18n.js";
import { esc, riskStatus } from "./ui.js";

const L = window.L;
export const Z = { DISTRICT_MAX: 9, VILLAGE_MIN: 9, PARCELS: 12, CONTEXT: 14, PARCEL_ID: 15, PLOT_ID: 17 };
// Citizen maps reveal land parcels only at cadastral zoom (with the village plots around them), so the
// state and district views show places, not dots; officer maps keep parcels visible from district zoom.
export const parcelZoom = (mode) => (mode === "officer" ? Z.PARCELS : Z.CONTEXT);
export const INDIA = [[7.5, 67.5], [31.5, 90.5]];

const esri = (path, opts = {}) => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`,
  { maxZoom: 20, maxNativeZoom: 19, ...opts });
const BASEMAPS = {
  map: () => esri("World_Street_Map", { attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors" }),
  sat: () => esri("World_Imagery", { attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }),
  hybrid: () => L.layerGroup([
    esri("World_Imagery", { attribution: "Imagery © Esri, Maxar · Esri reference" }),
    esri("Reference/World_Transportation", { pane: "labels", opacity: 0.8 }),
    esri("Reference/World_Boundaries_and_Places", { pane: "labels" }),
  ]),
  terrain: () => esri("World_Topo_Map", { attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS" }),
};

/** A fresh base-map layer (for small static maps outside the GIS workspace). */
export const baseLayer = (k = "map") => BASEMAPS[k]();

const STYLE = {
  plot: { color: "#7a5526", weight: 1.1, fillColor: "#f5e2b8", fillOpacity: 0.62, opacity: 1 },
  plotDark: { color: "#ffe9b0", weight: 1.1, fillColor: "#f3e3bf", fillOpacity: 0.07, opacity: 0.95 },
  remainder: { color: "#8a6a3c", weight: 0.5, fillColor: "#eadabc", fillOpacity: 0.45, dashArray: "2 3", interactive: false },
  village: { color: "#5b4a2c", weight: 1.5, fill: false, dashArray: "7 5", interactive: false },
  villageDark: { color: "#ffe8a3", weight: 1.5, fill: false, dashArray: "7 5", interactive: false },
  parcel: { color: "#0b3d91", weight: 2.2, fillColor: "#2f6fd6", fillOpacity: 0.26 },
  selected: { color: "#e07a1f", weight: 3.5, fillColor: "#e07a1f", fillOpacity: 0.25 },
};
const RISK_COLOR = { bad: "#b42318", warn: "#b86e00", ok: "#15803d" };

function ringCentroid(ring) {
  let x = 0, y = 0; const n = ring.length - 1;
  for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
  return { lon: x / n, lat: y / n };
}

export function createMap(el, { features, hierarchy, mode = "citizen", basemap = "map", onSelect = () => {}, overview = null, onDistrict = null, districtColor = null, districtMinZoom = 6 } = {}) {
  const map = L.map(el, { zoomControl: false, preferCanvas: true, minZoom: 4, maxZoom: 20, doubleClickZoom: true, attributionControl: true });
  map.createPane("labels").style.zIndex = 450;
  map.getPane("labels").style.pointerEvents = "none";
  L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 140 }).addTo(map);
  map.fitBounds(INDIA);
  const renderer = L.canvas({ padding: 0.5, tolerance: 5 });
  const dark = () => ["sat", "hybrid"].includes(baseKey);

  let base = null, baseKey = basemap, selected = null;
  const on = { parcels: true, context: true, ids: true, villages: true, places: true, risk: mode === "officer", ghost: false, encumbrance: false, environment: false };
  const g = {
    context: L.layerGroup(), villages: L.layerGroup(), parcels: L.layerGroup(), labels: L.layerGroup().addTo(map),
    places: L.layerGroup().addTo(map), ghost: L.layerGroup(), encumbrance: L.layerGroup(), environment: L.layerGroup(), measure: L.layerGroup().addTo(map),
  };
  const byUlpin = new Map();
  const plotLayers = [], remainders = [], villageLines = [];

  // ---- parcels (ULPIN-linked, real geometry) + village cadastral context ----
  const centers = features.features.map(f => ringCentroid(f.geometry.coordinates[0]));
  for (const [fi, f] of features.features.entries()) {
    const p = f.properties, ring = f.geometry.coordinates[0];
    const c = centers[fi];
    const neighbours = centers.filter((n, j) => j !== fi && Math.abs(n.lat - c.lat) < 0.05 && Math.abs(n.lon - c.lon) < 0.05);
    const layer = L.polygon(ring.map(([x, y]) => [y, x]), { ...STYLE.parcel, renderer });
    layer.feature = f;
    layer.on("click", (e) => { L.DomEvent.stopPropagation(e); if (measuring) return; select(p.ulpin); onSelect(p); });
    layer.on("mouseover", () => { if (selected !== p.ulpin) layer.setStyle({ fillOpacity: 0.45 }); el.style.cursor = measuring ? "crosshair" : "pointer"; });
    layer.on("mouseout", () => { layer.setStyle(styleFor(p)); el.style.cursor = measuring ? "crosshair" : ""; });
    layer.addTo(g.parcels);
    byUlpin.set(p.ulpin, { layer, props: p, center: [c.lat, c.lon], ring });

    const fab = villageFabric({ ulpin: p.ulpin, centroid: c, geometry: ring, context: p.context,
      area: { record: p.record_area_ha }, nativeId: p.native_id }, neighbours);
    villageLines.push(L.polygon(fab.outline, { ...STYLE.village, renderer }).addTo(g.villages));
    if (fab.remainder) remainders.push(L.polygon(fab.remainder, { ...STYLE.remainder, renderer }).addTo(g.context));
    for (const plot of fab.plots) {
      const pl = L.polygon(plot.latlngs, { ...STYLE.plot, renderer });
      pl.plot = plot;
      pl.on("click", (e) => {
        if (measuring) return;
        L.popup({ closeButton: false, maxWidth: 260, className: "plot-pop" }).setLatLng(e.latlng)
          .setContent(`<b>Plot ${esc(plot.label)}</b> · ${esc(p.village)}<br><span>${esc(t("contextPlot"))}</span>`).openOn(map);
      });
      plotLayers.push(pl); pl.addTo(g.context);
    }

    // officer overlays
    const rec = p.record_area_ha, gis = p.gis_area_ha;
    if (rec && gis && Math.abs(gis - rec) / rec > 0.05) {
      const k = Math.sqrt(rec / gis);
      L.polygon(ring.map(([x, y]) => [c.lat + (y - c.lat) * k, c.lon + (x - c.lon) * k]),
        { color: "#b42318", weight: 2, dashArray: "5 4", fill: false, interactive: false, renderer }).addTo(g.ghost);
    }
    if (p.active_encumbrance) L.polygon(ring.map(([x, y]) => [y, x]), { color: "#7f1d1d", weight: 6, opacity: 0.45, fill: false, interactive: false, renderer }).addTo(g.encumbrance);
    if (p.environmental_restriction) L.circle([c.lat, c.lon], { radius: 250, color: "#0f766e", weight: 1.5, dashArray: "4 4", fillColor: "#0f766e", fillOpacity: 0.08, interactive: false, renderer }).addTo(g.environment);
  }

  function styleFor(p) {
    if (selected === p.ulpin) return STYLE.selected;
    if (on.risk) { const col = RISK_COLOR[riskStatus(p.risk_level)]; return { color: col, weight: 2.4, fillColor: col, fillOpacity: 0.3 }; }
    return STYLE.parcel;
  }
  const restyle = () => byUlpin.forEach(({ layer, props }) => layer.setStyle(styleFor(props)));

  // ---- base maps ----
  function setBasemap(k) {
    baseKey = k;
    if (base) map.removeLayer(base);
    base = BASEMAPS[k](); base.addTo(map);
    el.classList.toggle("dark-base", dark());
    plotLayers.forEach(l => l.setStyle(dark() ? STYLE.plotDark : STYLE.plot));
    remainders.forEach(l => l.setStyle({ fillOpacity: dark() ? 0.04 : 0.45, color: dark() ? "#fff1c9" : "#8a6a3c" }));
    villageLines.forEach(l => l.setStyle(dark() ? STYLE.villageDark : STYLE.village));
    drawLabels();
  }

  // ---- progressive labels: district names -> village places -> parcel ids -> plot numbers ----
  const districtCenters = [];
  for (const s of hierarchy?.states || []) for (const d of s.districts) {
    const b = d.bbox; districtCenters.push({ name: d.name, state: s.name, at: [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2], bbox: b });
  }
  function drawPlaces() {
    g.places.clearLayers();
    const z = map.getZoom();
    if (!on.places) return;
    if (z >= districtMinZoom && z < Z.DISTRICT_MAX) {
      for (const d of districtCenters) {
        const col = districtColor ? districtColor(d.name) : null;
        L.marker(d.at, { icon: L.divIcon({ className: "", html: `<div class="map-label district${col ? " colored" : ""}"${col ? ` style="--dc:${col}"` : ""}>${col ? "<i></i>" : ""}${esc(d.name)}</div>`, iconSize: null }), keyboard: false })
          .on("click", () => { flyToBbox(d.bbox, 11); onDistrict?.(d); }).addTo(g.places);
      }
    } else if (z >= Z.VILLAGE_MIN && z < Z.CONTEXT) {
      const seen = new Set();
      byUlpin.forEach(({ props, center }) => {
        const key = `${props.state_code}|${props.village}`;
        if (seen.has(key)) return; seen.add(key);
        L.marker(center, { icon: L.divIcon({ className: "", html: `<div class="map-label village"><i></i>${esc(props.village)}</div>`, iconSize: null }), keyboard: false })
          .on("click", () => map.flyTo(center, 15, { duration: 0.9 })).addTo(g.places);
      });
    }
  }
  function drawLabels() {
    g.labels.clearLayers();
    const z = map.getZoom(), b = map.getBounds().pad(0.15);
    if (!on.ids) return;
    if (z >= Z.PLOT_ID && on.context) {
      for (const l of plotLayers) {
        if (!b.contains(l.plot.center)) continue;
        L.marker(l.plot.center, { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="plot-label">${esc(l.plot.label)}</div>`, iconSize: null }) }).addTo(g.labels);
      }
    }
    if (z >= Z.PARCEL_ID && on.parcels) {
      byUlpin.forEach(({ props, center }) => {
        if (!b.contains(center)) return;
        const id = props.native_id.value + (props.native_id.part ? "/" + props.native_id.part : "");
        L.marker(center, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "", html: `<div class="parcel-label ${selected === props.ulpin ? "sel" : ""}">${esc(id)}</div>`, iconSize: null }) }).addTo(g.labels);
      });
    }
  }

  // ---- visibility by zoom ----
  const show = (layer, visible) => visible ? (!map.hasLayer(layer) && layer.addTo(map)) : (map.hasLayer(layer) && map.removeLayer(layer));
  function refresh() {
    const z = map.getZoom();
    show(g.parcels, on.parcels && z >= (mode === "officer" ? 6 : Z.CONTEXT));
    show(g.context, on.context && z >= Z.CONTEXT);
    show(g.villages, on.villages && z >= 12);
    for (const k of ["ghost", "encumbrance", "environment"]) show(g[k], on[k] && z >= 11);
    drawPlaces(); drawLabels();
    el.dispatchEvent(new CustomEvent("viewchange", { detail: { zoom: z, center: map.getCenter(), bounds: map.getBounds() } }));
    if (ov) ov.sync();
  }
  map.on("zoomend moveend", refresh);

  // ---- extent history (Bhuvan: previous / next extent) ----
  const hist = []; let hi = -1, navigating = false;
  map.on("moveend", () => {
    if (navigating) { navigating = false; return; }
    const v = { c: map.getCenter(), z: map.getZoom() };
    const last = hist[hi];
    if (last && last.z === v.z && last.c.distanceTo(v.c) < 1) return;
    hist.splice(hi + 1); hist.push(v); hi = hist.length - 1;
  });
  const goHist = (d) => { const n = hi + d; if (n < 0 || n >= hist.length) return; hi = n; navigating = true; map.setView(hist[n].c, hist[n].z); };

  // ---- measure tools ----
  let measuring = null, pts = [], tmp = null;
  function startMeasure(kind, onUpdate) {
    clearMeasure(); measuring = kind; el.style.cursor = "crosshair"; map.doubleClickZoom.disable();
    const draw = (final) => {
      g.measure.clearLayers();
      if (!pts.length) return;
      const ll = pts.map(p => [p.lat, p.lng]);
      if (kind === "area" && pts.length > 2) L.polygon(ll, { color: "#e07a1f", weight: 2, fillOpacity: 0.15, interactive: false }).addTo(g.measure);
      else L.polyline(ll, { color: "#e07a1f", weight: 2.5, dashArray: final ? null : "6 4", interactive: false }).addTo(g.measure);
      pts.forEach(p => L.circleMarker(p, { radius: 4, color: "#fff", weight: 2, fillColor: "#e07a1f", fillOpacity: 1, interactive: false }).addTo(g.measure));
      let text;
      if (kind === "distance") { let d = 0; for (let i = 1; i < pts.length; i++) d += pts[i - 1].distanceTo(pts[i]); text = d >= 1000 ? `${(d / 1000).toFixed(3)} km` : `${d.toFixed(1)} m`; }
      else { const a = geodesicArea(pts); text = pts.length > 2 ? `${(a / 10000).toFixed(4)} ha · ${Math.round(a).toLocaleString("en-IN")} m²` : "—"; }
      onUpdate?.(text, final);
    };
    tmp = {
      click: (e) => { pts.push(e.latlng); draw(false); },
      dbl: () => { draw(true); measuring = null; el.style.cursor = ""; map.off("click", tmp.click); map.off("dblclick", tmp.dbl); setTimeout(() => map.doubleClickZoom.enable(), 50); },
    };
    map.on("click", tmp.click); map.on("dblclick", tmp.dbl);
  }
  function clearMeasure() {
    if (tmp) { map.off("click", tmp.click); map.off("dblclick", tmp.dbl); }
    measuring = null; pts = []; tmp = null; g.measure.clearLayers(); el.style.cursor = ""; map.doubleClickZoom.enable();
  }
  function geodesicArea(latlngs) {
    const R = 6378137; let a = 0;
    for (let i = 0; i < latlngs.length; i++) {
      const p1 = latlngs[i], p2 = latlngs[(i + 1) % latlngs.length];
      a += (p2.lng - p1.lng) * Math.PI / 180 * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180));
    }
    return Math.abs(a * R * R / 2);
  }

  // ---- overview map ----
  let ov = null;
  if (overview) {
    const om = L.map(overview, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false });
    esri("World_Street_Map").addTo(om);
    const box = L.rectangle(map.getBounds(), { color: "#e07a1f", weight: 2, fillOpacity: 0.12, interactive: false }).addTo(om);
    om.on("click", (e) => map.panTo(e.latlng));
    ov = { sync() { box.setBounds(map.getBounds()); om.setView(map.getCenter(), Math.max(2, map.getZoom() - 5), { animate: false }); }, om };
  }

  // ---- API ----
  function select(u) {
    const prev = selected; selected = u;
    for (const k of [prev, u]) { const x = k && byUlpin.get(k); if (x) { x.layer.setStyle(styleFor(x.props)); if (k === u) x.layer.bringToFront(); } }
    drawLabels();
  }
  function flyToUlpin(u, maxZoom = 18) {
    const x = byUlpin.get(u); if (!x) return;
    map.flyToBounds(x.layer.getBounds().pad(1.8), { maxZoom, duration: 1.2 });
  }
  function flyToBbox(b, maxZoom = 16) { map.flyToBounds([[b[1], b[0]], [b[3], b[2]]], { maxZoom, duration: 1.0, padding: [40, 40] }); }
  function setLayer(name, v) { on[name] = v; if (name === "risk") restyle(); refresh(); }

  setBasemap(basemap);
  refresh();
  return {
    map, select, flyToUlpin, flyToBbox, setBasemap, setLayer, layerState: on,
    home: () => map.flyToBounds(INDIA, { duration: 1 }), prev: () => goHist(-1), next: () => goHist(1),
    startMeasure, clearMeasure, goTo: (lat, lon) => map.flyTo([lat, lon], 16, { duration: 1 }),
    get basemap() { return baseKey; }, props: (u) => byUlpin.get(u)?.props,
    // Stop any fly/zoom animation first: removing a canvas map mid-animation makes Leaflet redraw a
    // renderer that no longer exists ("Cannot read properties of undefined (reading 'save')").
    destroy() { map.stop(); ov?.om.stop(); ov?.om.remove(); map.remove(); },
  };
}
