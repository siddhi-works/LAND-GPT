import { api } from "./api.js";
import { createMap, Z } from "./map.js";
import { t, localText } from "./i18n.js";
import { STATES } from "./states.js";
import { citizenHeader, bindLang, disclaimer, esc, fmtHa, fmtUlpin, icon, statusBadge, toast, loading, sev } from "./ui.js";

// Persist the view across language re-renders and back-navigation from the profile.
const view = { tab: "nav", state: "", district: "", sub: "", village: "", selected: null, basemap: "map", center: null, zoom: null, panel: true };

export function renderCitizen(root, rerender, params = {}) {
  root.innerHTML = `
  <div class="map-app">
    ${citizenHeader("map")}
    <div class="map-stage">
      <div id="map" class="map"></div>

      <div class="float searchbox" role="search">
        ${icon.search}<input id="q" type="search" autocomplete="off" placeholder="${esc(t("searchPh"))}" aria-label="${esc(t("searchPh"))}">
        <div id="results" class="results" hidden></div>
      </div>
      <div class="float hint" id="hint" hidden></div>

      <aside class="float side ${view.panel ? "" : "collapsed"}" id="side">
        <div class="side-tabs" role="tablist">
          <button data-tab="nav" role="tab">${icon.nav}<span>${esc(t("navigate"))}</span></button>
          <button data-tab="layers" role="tab">${icon.layers}<span>${esc(t("layers"))}</span></button>
          <button data-tab="tools" role="tab">${icon.tools}<span>${esc(t("tools"))}</span></button>
          <button class="collapse" id="collapse" aria-label="Collapse panel">${icon.chevron}</button>
        </div>
        <div class="side-body" id="sidebody">${loading()}</div>
      </aside>
      <button class="float side-open" id="sideopen" aria-label="Open panel" ${view.panel ? "hidden" : ""}>${icon.nav}</button>

      <div class="float toolbar" aria-label="Map tools">
        <button id="zin" title="${esc(t("zoomIn"))}">${icon.plus}</button>
        <button id="zout" title="${esc(t("zoomOut"))}">${icon.minus}</button>
        <button id="full" title="${esc(t("fullExtent"))}">${icon.globe}</button>
        <button id="prev" title="${esc(t("prevExtent"))}">${icon.back}</button>
        <button id="next" title="${esc(t("nextExtent"))}">${icon.fwd}</button>
        <button id="mdist" title="${esc(t("toolDistance"))}">${icon.ruler}</button>
        <button id="marea" title="${esc(t("toolArea"))}">${icon.area}</button>
      </div>

      <div class="float basemaps" role="group" aria-label="Base map">
        ${[["map", t("bmMap")], ["sat", t("bmSat")], ["hybrid", t("bmHybrid")], ["terrain", t("bmTerrain")]].map(([k, l]) =>
          `<button data-bm="${k}"><i class="thumb t-${k}"></i><span>${esc(l)}</span></button>`).join("")}
      </div>
      <div class="float overview" id="overview" aria-hidden="true"></div>
      <div class="float measure-out" id="mout" hidden></div>
      <aside class="float parcel-panel" id="pp" aria-live="polite"></aside>

      <div class="statusbar"><span id="crumb" class="crumb"></span><span class="grow"></span><span id="coord">—</span><span id="zl"></span></div>
    </div>
    ${disclaimer()}
  </div>`;
  bindLang(root, rerender);
  const $ = (s) => root.querySelector(s);
  let ctl = null, hier = null, destroyed = false;

  Promise.all([api.parcels(), api.hierarchy()]).then(([fc, h]) => {
    if (destroyed) return;
    hier = h;
    ctl = createMap($("#map"), { features: fc, hierarchy: h, basemap: view.basemap, overview: $("#overview"), onSelect: (p) => openParcel(p.ulpin, false) });
    if (view.center) ctl.map.setView(view.center, view.zoom, { animate: false });
    ctl.map.on("moveend", () => { view.center = ctl.map.getCenter(); view.zoom = ctl.map.getZoom(); });
    ctl.map.on("mousemove", (e) => { $("#coord").textContent = `${e.latlng.lat.toFixed(6)}° N  ${e.latlng.lng.toFixed(6)}° E`; });
    $("#map").addEventListener("viewchange", (e) => {
      const z = e.detail.zoom; $("#zl").textContent = `Zoom ${z}`;
      const msg = z < Z.PARCELS ? t("hintBoundaries") : z < Z.PLOT_ID ? t("hintIds") : "";
      $("#hint").hidden = !msg || z < 5; $("#hint").textContent = msg;
    });
    ctl.map.fire("zoomend");
    bindTools();
    renderSide();
    const initial = params.ulpin || view.selected;
    if (initial) openParcel(initial, !!params.ulpin || !view.center);
  }).catch((e) => { $("#sidebody").innerHTML = `<div class="notice bad">${esc(e.message)}</div>`; });

  // ---------- side panel ----------
  function renderSide() {
    root.querySelectorAll("[data-tab]").forEach(b => { b.classList.toggle("on", b.dataset.tab === view.tab); b.onclick = () => { view.tab = b.dataset.tab; renderSide(); }; });
    const body = $("#sidebody");
    if (view.tab === "nav") body.innerHTML = navHtml();
    if (view.tab === "layers") body.innerHTML = layersHtml();
    if (view.tab === "tools") body.innerHTML = toolsHtml();
    bindSide();
  }
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(label)}</option>`;
  const node = () => {
    const st = hier.states.find(s => s.code === view.state);
    const d = st?.districts.find(x => x.name === view.district);
    const s = d?.sub_districts.find(x => x.name === view.sub);
    const v = s?.villages.find(x => x.name === view.village);
    return { st, d, s, v };
  };
  function navHtml() {
    const { st, d, s, v } = node();
    const subLabel = t(STATES[view.state]?.sub === "tehsil" ? "tehsil" : "taluka");
    const parcels = v ? v.ulpins.map(u => ctl.props(u)).filter(Boolean) : [];
    return `
      <div class="field"><label for="n-state">${esc(t("state"))}</label><select class="select" id="n-state">${opt("", `— ${t("select")} —`, view.state)}
        ${hier.states.map(x => opt(x.code, `${x.name} · ${STATES[x.code].native}`, view.state)).join("")}</select></div>
      <div class="field"><label for="n-district">${esc(t("district"))}</label><select class="select" id="n-district" ${st ? "" : "disabled"}>${opt("", `— ${t("select")} —`, view.district)}
        ${(st?.districts || []).map(x => opt(x.name, x.name, view.district)).join("")}</select></div>
      <div class="field"><label for="n-sub">${esc(subLabel)}</label><select class="select" id="n-sub" ${d ? "" : "disabled"}>${opt("", `— ${t("select")} —`, view.sub)}
        ${(d?.sub_districts || []).map(x => opt(x.name, x.name, view.sub)).join("")}</select></div>
      <div class="field"><label for="n-village">${esc(t("village"))}</label><select class="select" id="n-village" ${s ? "" : "disabled"}>${opt("", `— ${t("select")} —`, view.village)}
        ${(s?.villages || []).map(x => opt(x.name, x.name, view.village)).join("")}</select></div>
      ${parcels.length ? `<div class="field"><label>${esc(t("parcelsInVillage"))}</label><div class="plot-list">${parcels.map(p =>
        `<button data-u="${p.ulpin}" class="${view.selected === p.ulpin ? "on" : ""}"><span><b>${esc(p.native_label)}</b><small class="mono">${fmtUlpin(p.ulpin)}</small></span>${statusBadge(p.risk_level)}</button>`).join("")}</div></div>` : ""}`;
  }
  function layersHtml() {
    const ls = ctl.layerState;
    const row = (k, label, sw) => `<label class="layer-row"><input type="checkbox" data-layer="${k}" ${ls[k] ? "checked" : ""}><span class="sw ${sw}"></span>${esc(label)}</label>`;
    return `<div class="layer-group"><h4>Cadastral</h4>
        ${row("parcels", t("lyParcels"), "sw-parcel")}${row("context", t("lyContext"), "sw-plot")}${row("ids", t("lyIds"), "sw-id")}</div>
      <div class="layer-group"><h4>Administrative</h4>${row("villages", t("lyVillages"), "sw-village")}${row("places", t("lyPlaces"), "sw-place")}</div>
      <p class="fine">State, district and taluka/tehsil boundaries are shown by the base map. Parcel boundaries appear from zoom ${Z.PARCELS}; plot numbers from zoom ${Z.PLOT_ID}.</p>`;
  }
  function toolsHtml() {
    return `<div class="tool-grid">
        <button class="btn" id="t-dist">${icon.ruler} ${esc(t("toolDistance"))}</button>
        <button class="btn" id="t-area">${icon.area} ${esc(t("toolArea"))}</button></div>
      <p class="fine">${esc(t("toolHint"))}</p>
      <div class="field" style="margin-top:12px"><label>${esc(t("toolCoord"))}</label>
        <div class="coord-row"><input class="input" id="c-lat" placeholder="Lat e.g. 21.1558" inputmode="decimal"><input class="input" id="c-lon" placeholder="Lon e.g. 79.0922" inputmode="decimal"><button class="btn" id="c-go">${esc(t("go"))}</button></div></div>
      <button class="btn ghost" id="t-clear" style="margin-top:10px">${icon.clear} ${esc(t("toolClear"))}</button>`;
  }
  function bindSide() {
    const b = $("#sidebody");
    b.querySelector("#n-state")?.addEventListener("change", (e) => { Object.assign(view, { state: e.target.value, district: "", sub: "", village: "" }); renderSide(); const { st } = node(); if (st) ctl.flyToBbox(st.bbox, 8); });
    b.querySelector("#n-district")?.addEventListener("change", (e) => { Object.assign(view, { district: e.target.value, sub: "", village: "" }); const { d } = node(); if (d?.sub_districts.length === 1) view.sub = d.sub_districts[0].name; renderSide(); if (d) ctl.flyToBbox(d.bbox, 11); });
    b.querySelector("#n-sub")?.addEventListener("change", (e) => { Object.assign(view, { sub: e.target.value, village: "" }); const { s } = node(); if (s?.villages.length === 1) view.village = s.villages[0].name; renderSide(); const n = node(); if (n.v) ctl.flyToBbox(n.v.bbox, 15); else if (s) ctl.flyToBbox(s.bbox, 13); });
    b.querySelector("#n-village")?.addEventListener("change", (e) => { view.village = e.target.value; renderSide(); const { v } = node(); if (v) ctl.flyToBbox(v.bbox, 15); });
    b.querySelectorAll(".plot-list [data-u]").forEach(x => x.onclick = () => openParcel(x.dataset.u, true));
    b.querySelectorAll("[data-layer]").forEach(x => x.onchange = () => ctl.setLayer(x.dataset.layer, x.checked));
    b.querySelector("#t-dist")?.addEventListener("click", () => measure("distance"));
    b.querySelector("#t-area")?.addEventListener("click", () => measure("area"));
    b.querySelector("#t-clear")?.addEventListener("click", () => { ctl.clearMeasure(); $("#mout").hidden = true; });
    b.querySelector("#c-go")?.addEventListener("click", () => {
      const lat = parseFloat(b.querySelector("#c-lat").value), lon = parseFloat(b.querySelector("#c-lon").value);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ctl.goTo(lat, lon); else toast("Enter a valid latitude and longitude");
    });
  }
  function measure(kind) {
    const out = $("#mout");
    out.hidden = false; out.innerHTML = `<b>${esc(t(kind === "distance" ? "toolDistance" : "toolArea"))}</b><span>${esc(t("toolHint"))}</span>`;
    ctl.startMeasure(kind, (text, final) => {
      out.innerHTML = `<b>${esc(t(kind === "distance" ? "toolDistance" : "toolArea"))}</b><span class="mono">${esc(text)}</span>${final ? `<button class="icon-btn" id="mclose" aria-label="Close">${icon.close}</button>` : ""}`;
      out.querySelector("#mclose")?.addEventListener("click", () => { ctl.clearMeasure(); out.hidden = true; });
    });
  }
  function bindTools() {
    $("#zin").onclick = () => ctl.map.zoomIn(); $("#zout").onclick = () => ctl.map.zoomOut();
    $("#full").onclick = () => ctl.home(); $("#prev").onclick = () => ctl.prev(); $("#next").onclick = () => ctl.next();
    $("#mdist").onclick = () => measure("distance"); $("#marea").onclick = () => measure("area");
    const bms = root.querySelectorAll("[data-bm]");
    const mark = () => bms.forEach(b => b.classList.toggle("on", b.dataset.bm === view.basemap));
    bms.forEach(b => b.onclick = () => { view.basemap = b.dataset.bm; ctl.setBasemap(view.basemap); mark(); }); mark();
    $("#collapse").onclick = () => { view.panel = false; $("#side").classList.add("collapsed"); $("#sideopen").hidden = false; };
    $("#sideopen").onclick = () => { view.panel = true; $("#side").classList.remove("collapsed"); $("#sideopen").hidden = true; };
  }

  // ---------- search ----------
  let timer = null, seq = 0;
  const results = $("#results");
  $("#q").addEventListener("input", (e) => {
    clearTimeout(timer);
    const qv = e.target.value.trim();
    if (!qv) { results.hidden = true; return; }
    results.hidden = false; results.innerHTML = `<div class="empty">${esc(t("searching"))}</div>`;
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const r = await api.search(qv);
        if (my !== seq) return;
        results.innerHTML = r.results.length ? r.results.map(x => `<button data-u="${x.ulpin}">
            <span class="r-main"><b class="mono">${fmtUlpin(x.ulpin)}</b><span>${esc(x.native_label)}</span></span>
            <small>${esc(x.village)}, ${esc(x.sub_district)}, ${esc(x.district)} · ${esc(x.state_name)} <em>${esc(x.match)}</em></small></button>`).join("")
          : `<div class="empty">${esc(t("noResults"))}</div>`;
        results.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { results.hidden = true; $("#q").value = ""; openParcel(b.dataset.u, true); });
      } catch (err) { results.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    }, 220);
  });
  $("#q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") results.querySelector("[data-u]")?.click();
    if (e.key === "Escape") results.hidden = true;
  });

  // ---------- parcel panel ----------
  function openParcel(u, fly) {
    const p = ctl?.props(u);
    if (!p) return;
    Object.assign(view, { selected: u, state: p.state_code, district: p.district, sub: p.sub_district, village: p.village });
    if (view.tab === "nav") renderSide();
    $("#crumb").innerHTML = [STATES[p.state_code].name, p.district, `${t(p.sub_district_type)} ${p.sub_district}`, p.village, p.native_label].map(esc).join('<i>›</i>');
    ctl.select(u);
    if (fly) ctl.flyToUlpin(u);
    history.replaceState(null, "", `#/map/${u}`);
    const pp = $("#pp");
    pp.innerHTML = panelHtml(p, null, null);
    pp.classList.add("open");
    bindPanel(p);
    Promise.all([api.verification(u), api.registry(u)]).then(([ver, reg]) => {
      if (view.selected !== u) return;
      pp.innerHTML = panelHtml(p, ver, reg); bindPanel(p);
    }).catch(() => {});
  }
  function bindPanel(p) {
    $("#pp-close").onclick = () => { $("#pp").classList.remove("open"); view.selected = null; ctl.select(null); history.replaceState(null, "", "#/map"); };
    $("#pp-zoom").onclick = () => ctl.flyToUlpin(p.ulpin);
    $("#pp-copy").onclick = () => { navigator.clipboard?.writeText(p.ulpin); toast(`${t("copied")}: ${fmtUlpin(p.ulpin)}`); };
  }

  return () => { destroyed = true; ctl?.destroy(); };
}

function panelHtml(p, ver, reg) {
  const d = p.record_area_ha && p.gis_area_ha ? (p.gis_area_ha - p.record_area_ha) / p.record_area_ha : 0;
  const linked = reg ? reg.linked_sources.filter(s => s.record_count && !["core.parcel_registry"].includes(s.source_table)) : [];
  const top = ver ? ver.findings.filter(f => ["high", "medium", "critical"].includes(f.severity)).slice(0, 3) : [];
  return `
  <div class="pp-head">
    <div class="row"><div><div class="eyebrow">${esc(t("ulpin"))}</div><div class="ulpin">${fmtUlpin(p.ulpin)}</div></div>
      <button class="icon-btn" id="pp-close" aria-label="Close">${icon.close}</button></div>
    <div class="row-inline">${statusBadge(p.risk_level)}<button class="btn sm ghost" id="pp-copy">${icon.copy} ${esc(t("copy"))}</button></div>
    <div class="chain"><span>${esc(t("storyParcel"))}</span><i>→</i><span class="hl">ULPIN</span><i>→</i><span>${reg ? linked.length : p.records} ${esc(t("records"))}</span><i>→</i><span>${esc(t("storyProfile"))}</span></div>
  </div>
  <div class="pp-body">
    <dl class="kv">
      <dt>${esc(t("nativeId"))}</dt><dd>${esc(p.native_label)}</dd>
      <dt>${esc(t("location"))}</dt><dd>${esc(p.village)}<span class="sub">${esc(t(p.sub_district_type))} ${esc(p.sub_district)} · ${esc(p.district)} · ${esc(STATES[p.state_code].name)}</span></dd>
      <dt>${esc(t("owner"))}</dt><dd>${p.holders.length ? p.holders.map(h => `${esc(localText(h, p.state_code))}${h.native && localText(h, p.state_code) !== h.native ? `<span class="sub">${esc(h.native)}</span>` : ""}`).join("") : "—"}</dd>
      <dt>${esc(t("landUse"))}</dt><dd>${esc(localText(p.land_use_label, p.state_code))}</dd>
    </dl>
    <div class="sec-title">${esc(t("area"))}</div>
    <div class="area-compare">
      <div><small>${esc(t("recorded"))} · ${esc(p.record_area_source)}</small><b>${fmtHa(p.record_area_ha)}</b></div>
      <div class="${Math.abs(d) > 0.05 ? "off" : ""}"><small>${esc(t("mapped"))}</small><b>${fmtHa(p.gis_area_ha)}</b></div>
    </div>
    ${Math.abs(d) > 0.05 ? `<div class="notice warn">${icon.alert}<span>${esc(t("areaDiffer"))} <b>${(d * 100).toFixed(1)}%</b></span></div>` : `<div class="notice ok">${icon.check}<span>${esc(t("areaAgree"))}</span></div>`}
    <div class="sec-title">${esc(t("verification"))}</div>
    ${ver ? (top.length ? top.map(f => `<div class="finding compact"><div class="top">${sev(f.severity)}<span class="rule">${esc(f.rule_id)}</span></div><p>${esc(f.message)}</p></div>`).join("")
        : `<div class="notice ok">${icon.check}<span>${ver.summary.checks.pass} ${esc(t("checksPassed"))} · ${ver.findings.length} ${esc(t("findings"))}</span></div>`) : loading()}
    ${reg ? `<div class="sec-title">${esc(t("connectedRecords"))}</div><div class="chips">${linked.map(s => `<span class="chip" title="${esc(s.source_system)} · ${esc(s.source_table)}">${esc(s.native_record_type)}</span>`).join("")}</div>` : ""}
  </div>
  <div class="pp-foot"><a class="btn primary" href="#/parcel/${p.ulpin}">${esc(t("openProfile"))}</a><button class="btn" id="pp-zoom">${esc(t("zoomTo"))}</button></div>`;
}
