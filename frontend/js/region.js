// Regional land-information pages: #/state (choose a state) and #/state/<MH|UP|GJ>[/<record>[/<ulpin>]].
// The Citizen Portal reaches the same pages as #/citizen/<maharashtra|uttar-pradesh|gujarat>.
// Each state gets its own map, terminology, record types and language, all backed by the registry.
import { api } from "./api.js";
import { setContext } from "./context.js";
import { mountDiscovery } from "./discovery.js";
import { getLang, localText, setLang, t } from "./i18n.js";
import { baseLayer, createMap } from "./map.js";
import { prov } from "./profile.js";
import { DISTRICT_COLORS, REGION, STATES } from "./states.js";
import { bindLang, citizenHeader, disclaimer, emptyState, esc, fmtHa, fmtUlpin, icon, siteFooter, skeleton, statusBadge, title, toast } from "./ui.js";

const L = window.L;

// ---------------------------------------------------------------------------------------------
// state cards (also used on the home page)
// ---------------------------------------------------------------------------------------------

export const SLUG = { MH: "maharashtra", UP: "uttar-pradesh", GJ: "gujarat" };
export const codeFromSlug = (slug) => Object.keys(SLUG).find((c) => SLUG[c] === String(slug).toLowerCase()) || String(slug).toUpperCase();

export function stateCardsHtml(href = (code) => `#/state/${code}`) {
  return `<div class="state-cards">${Object.entries(STATES).map(([code, s]) => {
    const R = REGION[code];
    return `<a class="state-card" href="${href(code)}" style="--accent:${R.accent}">
      <div class="sc-map" data-mini="${code}" aria-hidden="true"></div>
      <div class="sc-body">
        <div class="sc-name"><b>${esc(s.name.toUpperCase())}</b><span>${esc(s.native)}</span></div>
        <div class="sc-meta">${esc(s.system)} · ${esc(langName(R.lang))}</div>
        <div class="chips">${R.records.map((r) => `<span class="chip ${r.connected === false ? "off" : ""}">${esc(r.en)}</span>`).join("")}</div>
        <span class="sc-go">${esc(t("exploreState"))} ${icon.right}</span>
      </div></a>`;
  }).join("")}</div>`;
}

const langName = (l) => ({ mr: "मराठी", hi: "हिन्दी", gu: "ગુજરાતી", en: "English" }[l]);

/** Static thumbnails: base map fitted to the state's connected extent, one dot per district. */
export async function mountStateMinis(root) {
  const els = [...root.querySelectorAll("[data-mini]")];
  if (!els.length) return () => {};
  const maps = [];
  try {
    const h = await api.hierarchy();
    for (const el of els) {
      if (!el.isConnected) continue;
      const st = h.states.find((s) => s.code === el.dataset.mini);
      if (!st) continue;
      const m = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
        keyboard: false, touchZoom: false, attributionControl: false, zoomSnap: 0.25 });
      baseLayer("map").addTo(m);
      const b = st.bbox;
      m.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [18, 18] });
      st.districts.forEach((d, i) => L.circleMarker(center(d.bbox), { radius: 5, weight: 1.5, color: "#fff",
        fillColor: DISTRICT_COLORS[i % DISTRICT_COLORS.length], fillOpacity: 1, interactive: false }).addTo(m));
      maps.push(m);
    }
  } catch { /* thumbnails are decorative; the cards still navigate */ }
  return () => maps.forEach((m) => m.remove());
}

const center = (b) => [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];

// ---------------------------------------------------------------------------------------------
// #/state
// ---------------------------------------------------------------------------------------------

export function renderRegion(root, rerender, { code, rec, ulpin, base = "state" } = {}) {
  code = (code || "").toUpperCase();
  if (!STATES[code]) return renderChooser(root, rerender);
  if (rec && REGION[code].records.some((r) => r.key === rec && r.connected !== false)) view[code] = rec;
  return renderState(root, rerender, code, { ulpin, base });
}

function renderChooser(root, rerender) {
  setContext({ page: "state-list" }, { replace: true });
  root.innerHTML = `<div class="page">
    ${citizenHeader("records")}
    <main class="region-main">
      <div class="wrap">
        <div class="sec-intro"><h1>${esc(t("stateLandInfo"))}</h1><p>${esc(t("stateLandInfoD"))}</p></div>
        ${stateCardsHtml()}
      </div>
    </main>
    ${siteFooter()}${disclaimer()}</div>`;
  bindLang(root, rerender);
  let cleanup = () => {};
  mountStateMinis(root).then((c) => { cleanup = c; });
  return () => cleanup();
}

// ---------------------------------------------------------------------------------------------
// #/state/<code>
// ---------------------------------------------------------------------------------------------

const view = {};                                   // per-state remembered record type

function renderState(root, rerender, code, { ulpin: preselect, base }) {
  const S = STATES[code], R = REGION[code];
  const rt = () => R.records.find((r) => r.key === view[code]) || R.records[0];
  const bi = (k) => `${R.labels[k]}`;
  setContext({ page: "state", state: code }, { replace: true });

  root.innerHTML = `<div class="page region" style="--accent:${R.accent}">
    ${citizenHeader(base === "citizen" ? "citizen" : "records")}
    <main class="region-main">
      <section class="region-banner">
        <div class="wrap rb-inner">
          <div>
            <a class="back" href="${base === "citizen" ? "#/citizen" : "#/state"}">${icon.chevron}${esc(t(base === "citizen" ? "citizenPortal" : "allStatesInfo"))}</a>
            <h1><span lang="${R.lang}">${esc(R.title)}</span><small>${esc(R.titleEn)}</small></h1>
            <p>${esc(S.system)} · ${esc(S.department)}</p>
          </div>
          <div class="rb-side">
            ${getLang() !== R.lang ? `<button class="btn lang-suggest" id="lang-suggest" lang="${R.lang}">${icon.globe} ${esc(R.switchLang)}</button>` : ""}
            ${getLang() !== "en" ? `<button class="btn ghost sm" id="lang-en">English</button>` : ""}
          </div>
        </div>
      </section>

      <div class="wrap region-grid">
        <section class="panel rg-map">
          <header><h2>${icon.map} ${esc(bi("map"))} <span class="muted">(${esc(t("districtMap"))})</span></h2></header>
          <div class="rg-map-box"><div id="rmap" class="map"></div></div>
          <div class="district-legend" id="dlegend"></div>
          <p class="fine rg-note">${esc(t("districtNote"))}</p>
          <div id="dinfo"></div>
        </section>

        <section class="panel rg-form">
          <header><h2>${icon.register} ${esc(bi("record"))} <span class="muted">(${esc(t("recordType"))})</span></h2></header>
          <div class="body">
            <div class="rt-radios" role="radiogroup" aria-label="${esc(t("recordType"))}">${R.records.map((r) => `
              <label class="rt ${r.connected === false ? "off" : ""}"><input type="radio" name="rt" value="${r.key}" ${r.key === rt().key ? "checked" : ""}>
                <span><b lang="${R.lang}">${esc(r.label)}</b><small>${esc(r.en)}${r.connected === false ? ` · ${esc(t("notInDemo"))}` : ""}</small></span></label>`).join("")}
            </div>
            <div id="disc"></div>
          </div>
          <div id="result" class="rg-result">${emptyState(t("selectParcelHint"), t("selectParcelHintD"), icon.pin)}</div>
        </section>
      </div>

      <section class="wrap region-services">
        <h2 class="sec-h">${esc(t("stateServices"))} · <span lang="${R.lang}">${esc(S.native)}</span></h2>
        <div class="svc-grid">${stateServices(code).map(svcCard).join("")}</div>
      </section>
    </main>
    ${siteFooter()}${disclaimer()}</div>`;
  bindLang(root, rerender);
  const $ = (s) => root.querySelector(s);
  $("#lang-suggest")?.addEventListener("click", () => { setLang(R.lang); rerender(); toast(R.switchLang, "info"); });
  $("#lang-en")?.addEventListener("click", () => { setLang("en"); rerender(); });

  let ctl = null, hier = null, current = null, destroyed = false;
  const colorOf = {};

  // record type
  root.querySelectorAll("input[name=rt]").forEach((i) => i.onchange = () => {
    view[code] = i.value;
    if (rt().connected === false) toast(`${rt().en}: ${t("notInDemo")}`, "info");
    if (current) showParcel(current);
  });

  // form
  const disc = mountDiscovery($("#disc"), {
    state: code, fixed: true, labels: R.labels,
    onChange: (sel, n, fly) => {
      setContext({ page: "state", state: code, district: sel.district, sub_district: sel.sub, village: sel.village, ulpin: sel.ulpin || null }, { replace: true });
      if (sel.district) districtInfo(sel.district); else $("#dinfo").innerHTML = "";
      if (!ctl) return;
      highlightLegend(sel.district);
      if (sel.ulpin) { ctl.select(sel.ulpin); ctl.flyToUlpin(sel.ulpin, 17); }
      else if (fly && n.v) ctl.flyToBbox(n.v.bbox, 15);
      else if (fly && n.s) ctl.flyToBbox(n.s.bbox, 13);
      else if (fly && n.d) ctl.flyToBbox(n.d.bbox, 11);
      else if (fly && n.st) fitState();
    },
    onParcel: (p) => showParcel(p),
  });

  // map
  Promise.all([api.parcels(code), api.hierarchy()]).then(([fc, h]) => {
    if (destroyed) return;
    hier = h;
    const st = h.states.find((s) => s.code === code);
    st.districts.forEach((d, i) => { colorOf[d.name] = DISTRICT_COLORS[i % DISTRICT_COLORS.length]; });
    ctl = createMap($("#rmap"), {
      features: fc, hierarchy: { states: [st] }, basemap: "map",
      onSelect: (p) => { disc.selectParcel(p); showParcel(p); },
      onDistrict: (d) => { disc.setDistrict(d.name); toast(`${R.labels.district}: ${d.name}`, "info"); },
      districtColor: (name) => colorOf[name],
    });
    fitState();
    // Deep link from a parcel profile: #/state/<CODE>/<record>/<ulpin> opens that record for that parcel.
    const pre = preselect && fc.features.find((f) => f.properties.ulpin === preselect)?.properties;
    if (pre) { disc.selectParcel(pre); showParcel(pre); }
    // district markers stay clickable at every zoom below the parcel level
    const dots = L.layerGroup().addTo(ctl.map);
    st.districts.forEach((d) => L.circleMarker(center(d.bbox), { radius: 9, weight: 2, color: "#fff", fillColor: colorOf[d.name], fillOpacity: 0.95 })
      .bindTooltip(d.name, { direction: "top", offset: [0, -8] })
      .on("click", () => { ctl.flyToBbox(d.bbox, 11); disc.setDistrict(d.name); })
      .addTo(dots));
    // District names come from the legend and dot tooltips (text labels collide at state zoom);
    // village labels return once zoomed in.
    const syncZoom = () => {
      const z = ctl.map.getZoom();
      z >= 11 ? ctl.map.removeLayer(dots) : dots.addTo(ctl.map);
      if (ctl.layerState.places !== (z >= 9)) ctl.setLayer("places", z >= 9);
    };
    ctl.map.on("zoomend", syncZoom);
    syncZoom();
    $("#dlegend").innerHTML = st.districts.map((d) =>
      `<button class="dl-item" data-d="${esc(d.name)}" style="--dc:${colorOf[d.name]}"><i></i>${esc(d.name)}</button>`).join("");
    root.querySelectorAll("[data-d]").forEach((b) => b.onclick = () => { disc.setDistrict(b.dataset.d); const d = st.districts.find((x) => x.name === b.dataset.d); ctl.flyToBbox(d.bbox, 11); });
  }).catch(() => { $("#rmap").innerHTML = emptyState(t("dataUnavailable"), "", icon.alert); });

  function fitState() {
    const st = hier?.states.find((s) => s.code === code);
    if (st && ctl) ctl.map.fitBounds([[st.bbox[1], st.bbox[0]], [st.bbox[3], st.bbox[2]]], { padding: [30, 30] });
  }
  function highlightLegend(name) { root.querySelectorAll("[data-d]").forEach((b) => b.classList.toggle("on", b.dataset.d === name)); }

  async function districtInfo(name) {
    const box = $("#dinfo");
    const st = hier?.states.find((s) => s.code === code), d = st?.districts.find((x) => x.name === name);
    if (!d) return;
    box.innerHTML = `<div class="dinfo">${skeleton(2)}</div>`;
    try {
      const rep = await api.reports(code, name);
      if (!box.isConnected) return;
      const villages = d.sub_districts.flatMap((s) => s.villages.map((v) => v.name));
      box.innerHTML = `<div class="dinfo" style="--dc:${colorOf[name]}">
        <div class="dinfo-head"><i></i><div><div class="eyebrow">${esc(R.labels.district)} · ${esc(t("district"))}</div><b>${esc(name)}</b></div></div>
        <div class="mini-stats">
          <div><b>${d.sub_districts.length}</b><span>${esc(R.labels.sub)}</span></div>
          <div><b>${villages.length}</b><span>${esc(R.labels.village)}</span></div>
          <div><b>${rep.parcels}</b><span>ULPIN</span></div>
          <div class="${rep.parcels_with_findings ? "warn" : ""}"><b>${rep.parcels_with_findings}</b><span>${esc(t("withFindings"))}</span></div>
          <div><b>${rep.mutations.pending || 0}</b><span>${esc(t("pendingMutations"))}</span></div>
        </div>
        <p class="fine">${esc(R.labels.sub)}: ${d.sub_districts.map((s) => esc(s.name)).join(", ")} · ${esc(R.labels.village)}: ${villages.map(esc).join(", ")}</p>
      </div>`;
    } catch { box.innerHTML = ""; }
  }

  async function showParcel(p) {
    current = p;
    const box = $("#result");
    const r = rt();
    box.innerHTML = `<div class="rg-res">${skeleton(4)}</div>`;
    setContext({ page: "state", state: code, district: p.district, sub_district: p.sub_district, village: p.village, ulpin: p.ulpin }, { replace: true });
    try {
      const pf = await api.profile(p.ulpin);
      if (destroyed || current !== p) return;
      box.innerHTML = `<div class="rg-res">
        <div class="res-head">
          <div><div class="eyebrow" lang="${R.lang}">${esc(r.label)} · ${esc(r.en)}</div>
            <h3>${esc(p.native_label)} <span class="muted">· ${esc(p.village)}, ${esc(p.sub_district)}</span></h3>
            <div class="mono ulpin-line">ULPIN ${fmtUlpin(p.ulpin)}</div></div>
          ${statusBadge(pf.verification.risk_level)}
        </div>
        ${recordHtml(pf, r, code)}
        <div class="res-actions">
          <a class="btn primary" href="#/parcel/${p.ulpin}">${icon.register} ${esc(t("openProfile"))}</a>
          <a class="btn" href="#/map/${p.ulpin}">${icon.map} ${esc(t("viewOnMap"))}</a>
          <button class="btn" data-chat="${esc(t("qExplain"))}">${icon.spark} ${esc(t("askAboutParcel"))}</button>
          <button class="btn ghost" id="res-copy">${icon.copy} ${esc(t("copy"))}</button>
        </div>
      </div>`;
      $("#res-copy").onclick = () => { navigator.clipboard?.writeText(p.ulpin); toast(`${t("copied")}: ${fmtUlpin(p.ulpin)}`, "ok"); };
      toast(t("recordLoaded"), "ok");
    } catch (e) {
      if (destroyed) return;
      box.innerHTML = `<div class="rg-res">${emptyState(t("dataUnavailable"), e.message, icon.alert)}<button class="btn sm" id="res-retry">${esc(t("retry"))}</button></div>`;
      $("#res-retry").onclick = () => showParcel(p);
    }
  }

  return () => { destroyed = true; ctl?.destroy(); };
}

// ---------------------------------------------------------------------------------------------
// record rendering (the selected record type for one parcel)
// ---------------------------------------------------------------------------------------------

const kv = (rows) => `<dl class="kv">${rows.filter((r) => r && r[1] != null && r[1] !== "").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const ids = (xs) => xs.map((i) => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`)).join(", ");

export function recordHtml(pf, r, st) {
  if (r.connected === false) {
    return `<div class="notice info">${icon.info}<span><b>${esc(r.en)}</b> ${esc(t("notConnectedRecord"))}</span></div>`;
  }
  const b = pf.canonical;
  const land = b.land_records.filter((x) => x.native_record_type === r.native);
  const muts = b.mutations.filter((x) => x.native_record_type === r.native || x.register_name === r.native);
  const maps = b.cadastral_maps.filter((x) => x.native_record_type === r.native);
  if (!land.length && !muts.length && !maps.length) {
    return emptyState(t("noRecordOfType").replace("{rec}", r.en), t("noRecordOfTypeD"), icon.info);
  }
  const lt = (v) => esc(localText(v, st));
  return [
    ...land.map((lr) => `<div class="rec-block">${kv([
      [t("owner"), lr.holders.map((h) => `${lt(h)}${h.native && localText(h, st) !== h.native ? `<span class="sub">${esc(h.native)}</span>` : ""}`).join("") || null],
      [t("area"), lr.area ? `${fmtHa(lr.area.value_ha)} <span class="muted">(${lr.area.native_value} ${esc(lr.area.native_unit)})</span>` : null],
      [t("landUse"), lr.land_use_label ? lt(lr.land_use_label) : null],
      [t("parcelNo"), ids(lr.parcel_identifiers) || null],
      [t("account"), ids(lr.account_identifiers) || null],
      [t("recordStatus"), lr.record_status ? esc(title(lr.record_status)) : null],
    ])}${prov(lr)}</div>`),
    muts.length ? `<ul class="timeline">${muts.map((m) => `<li class="${m.status}"><div><b>${esc(m.register_name)} ${esc(m.mutation_no)}</b> — ${lt(m.kind_label)}
        <span class="badge ${m.status === "pending" ? "warn" : "ok"}">${lt(m.status_label)}</span></div>
        <small>${esc(t("applied"))} ${esc(m.application_date || "—")}${m.linked_document_no ? ` · ${esc(m.linked_document_no)}` : ""}${m.order_no ? ` · ${esc(m.order_no)}` : ""}</small>${prov(m)}</li>`).join("")}</ul>` : "",
    ...maps.map((cm) => `<div class="rec-block">${kv([
      [t("mapRef"), esc(cm.map_ref)], [t("plotNo"), esc(cm.plot_no + (cm.sub_division ? "/" + cm.sub_division : ""))],
      [t("mapArea"), fmtHa(cm.map_area?.value_ha)], [t("recordStatus"), esc(cm.map_status)],
    ])}${prov(cm)}</div>`),
  ].join("");
}

// ---------------------------------------------------------------------------------------------
// state services: every card opens something real, or says it is not connected
// ---------------------------------------------------------------------------------------------

function stateServices(code) {
  const R = REGION[code];
  return [
    ...R.records.map((r) => ({ icon: icon.register, title: r.en, native: r.label, lang: R.lang,
      desc: r.connected === false ? t("notInDemo") : t("svcRecordD"), status: r.connected === false ? "off" : "live",
      action: r.connected === false ? null : `rt:${r.key}` })),
    { icon: icon.map, title: t("svcParcelMap"), desc: t("svcParcelMapD"), status: "live", href: "#/map" },
    { icon: icon.shield, title: t("svcVerify"), desc: t("svcVerifyD"), status: "live", action: "focus" },
    { icon: icon.spark, title: t("chatTitle"), desc: t("svcAskD"), status: "live", chat: t("qFind") },
  ];
}

function svcCard(s) {
  const attrs = s.href ? `href="${s.href}"` : s.chat ? `href="#" data-chat="${esc(s.chat)}"` : s.action ? `href="#" data-svc="${s.action}"` : "";
  const tag = s.status === "off" ? `<span class="svc-tag off">${esc(t("notConnected2"))}</span>` : `<span class="svc-tag live">${esc(t("available"))}</span>`;
  return `<${s.status === "off" ? "div" : "a"} class="svc-card ${s.status}" ${s.status === "off" ? "" : attrs}>
    <span class="svc-ic">${s.icon}</span>
    <span class="svc-t"><b>${esc(s.title)}</b>${s.native ? `<small lang="${s.lang}">${esc(s.native)}</small>` : ""}</span>
    <span class="svc-d">${esc(s.desc)}</span>${tag}</${s.status === "off" ? "div" : "a"}>`;
}

// Delegated handler for service cards on the state page.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-svc]");
  if (!a) return;
  e.preventDefault();
  const [kind, key] = a.dataset.svc.split(":");
  const form = document.querySelector(".rg-form");
  if (kind === "rt") {
    const input = document.querySelector(`input[name=rt][value="${key}"]`);
    if (input) { input.checked = true; input.dispatchEvent(new Event("change")); }
  }
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => form?.querySelector("select:not([disabled]), #d-q")?.focus(), 400);
});
