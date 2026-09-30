// Land discovery form: State -> District -> Taluka/Tehsil -> Village -> Survey/Gat/Khasra no., plus number
// search. Everything comes from the registry (/admin/hierarchy, /gis/parcels, /search). Used on the home
// page (any state) and on each state's land-information page (state fixed, regional labels).
import { api } from "./api.js";
import { rememberParcel } from "./context.js";
import { t, localText } from "./i18n.js";
import { STATES } from "./states.js";
import { esc, fmtHa, fmtUlpin, icon, statusBadge, skeleton } from "./ui.js";

/** "Selected parcel" card with the next steps (profile / map / assistant). `section` deep-links the profile. */
export function parcelCardHtml(p, { section = "", note = "" } = {}) {
  rememberParcel(p);
  const st = p.state_code, sub = t(p.sub_district_type === "tehsil" ? "tehsil" : "taluka");
  return `<div class="sel-parcel">
    <div class="eyebrow">${esc(t("selectedParcel"))}</div>
    <div class="sp-head"><div><div class="ulpin">${fmtUlpin(p.ulpin)}</div><b>${esc(p.native_label)}</b></div>${statusBadge(p.risk_level)}</div>
    <dl class="kv">
      <dt>${esc(t("village"))}</dt><dd>${esc(p.village)}</dd>
      <dt>${esc(sub)}</dt><dd>${esc(p.sub_district)}</dd>
      <dt>${esc(t("district"))}</dt><dd>${esc(p.district)} · ${esc(STATES[st].name)}</dd>
      ${p.record_area_ha != null ? `<dt>${esc(t("area"))}</dt><dd>${fmtHa(p.record_area_ha)} <span class="muted">(${esc(p.record_area_source)})</span></dd>` : ""}
      ${p.land_use_label ? `<dt>${esc(t("landUse"))}</dt><dd>${esc(localText(p.land_use_label, st))}</dd>` : ""}
      ${p.findings != null ? `<dt>${esc(t("verification"))}</dt><dd>${p.findings ? `${p.findings} ${esc(t("findings"))}` : esc(t("stConsistent"))}</dd>` : ""}
    </dl>
    ${note ? `<div class="notice info">${icon.info}<span>${esc(note)}</span></div>` : ""}
    <div class="res-actions">
      <a class="btn primary" href="#/parcel/${p.ulpin}${section ? "/" + section : ""}">${icon.register} ${esc(t("openProfile"))}</a>
      <a class="btn" href="#/map/${p.ulpin}">${icon.map} ${esc(t("viewOnMap"))}</a>
      <button class="btn" data-chat="${esc(t("qExplain"))}">${icon.spark} ${esc(t("askAboutParcel"))}</button>
    </div>
  </div>`;
}

const KINDS = [["all", null], ["ULPIN", "ULPIN"], ["native", "Native identifier"], ["place", "Location"]];

export function mountDiscovery(el, { state = "", fixed = false, labels = null, onParcel = () => {}, onChange = () => {} } = {}) {
  const sel = { state, district: "", sub: "", village: "", ulpin: "" };
  let hier = null, fc = null, kind = "all", timer = null, seq = 0;
  const L = (key, i18nKey = key) => labels?.[key] || t(i18nKey);
  el.innerHTML = skeleton(5);

  api.hierarchy().then((h) => { hier = h; return state ? loadState(state) : null; })
    .then(() => draw())
    .catch(() => { el.innerHTML = `<div class="empty-state">${icon.alert}<b>${esc(t("dataUnavailable"))}</b><button class="btn sm" id="d-retry">${esc(t("retry"))}</button></div>`;
      el.querySelector("#d-retry").onclick = () => mountDiscovery(el, { state, fixed, labels, onParcel, onChange }); });

  async function loadState(code) { fc = code ? await api.parcels(code) : null; }

  const node = () => {
    const st = hier?.states.find((s) => s.code === sel.state);
    const d = st?.districts.find((x) => x.name === sel.district);
    const s = d?.sub_districts.find((x) => x.name === sel.sub);
    const v = s?.villages.find((x) => x.name === sel.village);
    return { st, d, s, v };
  };
  const props = (u) => fc?.features.find((f) => f.properties.ulpin === u)?.properties;
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(label)}</option>`;
  const none = `— ${t("select")} —`;

  function draw() {
    const { st, d, s, v } = node();
    const subKey = STATES[sel.state]?.sub === "tehsil" ? "tehsil" : "taluka";
    const parcels = v ? v.ulpins.map(props).filter(Boolean) : [];
    el.innerHTML = `
      <div class="disc-grid">
        ${fixed ? "" : `<div class="field"><label for="d-state">${esc(t("state"))}</label><select class="select" id="d-state">${opt("", none, sel.state)}
          ${hier.states.map((x) => opt(x.code, `${x.name} · ${STATES[x.code].native}`, sel.state)).join("")}</select></div>`}
        <div class="field"><label for="d-district">${esc(L("district"))}</label><select class="select" id="d-district" ${st ? "" : "disabled"}>${opt("", none, sel.district)}
          ${(st?.districts || []).map((x) => opt(x.name, x.name, sel.district)).join("")}</select></div>
        <div class="field"><label for="d-sub">${esc(L("sub", subKey))}</label><select class="select" id="d-sub" ${d ? "" : "disabled"}>${opt("", none, sel.sub)}
          ${(d?.sub_districts || []).map((x) => opt(x.name, x.name, sel.sub)).join("")}</select></div>
        <div class="field"><label for="d-village">${esc(L("village"))}</label><select class="select" id="d-village" ${s ? "" : "disabled"}>${opt("", none, sel.village)}
          ${(s?.villages || []).map((x) => opt(x.name, x.name, sel.village)).join("")}</select></div>
        <div class="field"><label for="d-parcel">${esc(L("parcel", "parcelNo"))}</label><select class="select" id="d-parcel" ${v ? "" : "disabled"}>${opt("", none, sel.ulpin)}
          ${parcels.map((p) => opt(p.ulpin, p.native_label, sel.ulpin)).join("")}</select></div>
        <div class="field disc-go"><label aria-hidden="true">&nbsp;</label>
          <button class="btn primary" id="d-go" ${sel.ulpin ? "" : "disabled"}>${icon.search} ${esc(labels?.search || t("view"))}</button></div>
      </div>
      <div class="disc-or"><span>${esc(t("orSearch"))}</span></div>
      <div class="disc-search">
        <div class="seg" role="group" aria-label="${esc(t("searchBy"))}">${KINDS.map(([k]) =>
          `<button data-kind="${k}" class="${kind === k ? "on" : ""}">${esc(t("sk_" + k))}</button>`).join("")}</div>
        <div class="disc-input">${icon.search}<input id="d-q" type="search" autocomplete="off" placeholder="${esc(t("sp_" + kind))}" aria-label="${esc(t("searchPh"))}">
          <div id="d-results" class="results" hidden></div></div>
      </div>`;
    bind();
  }

  function changed(fly = true) { onChange({ ...sel }, node(), fly); }

  function bind() {
    const $ = (s) => el.querySelector(s);
    $("#d-state")?.addEventListener("change", async (e) => {
      Object.assign(sel, { state: e.target.value, district: "", sub: "", village: "", ulpin: "" });
      await loadState(sel.state); draw(); changed();
    });
    $("#d-district").onchange = (e) => { Object.assign(sel, { district: e.target.value, sub: "", village: "", ulpin: "" }); autoPick(); draw(); changed(); };
    $("#d-sub").onchange = (e) => { Object.assign(sel, { sub: e.target.value, village: "", ulpin: "" }); autoPick(); draw(); changed(); };
    $("#d-village").onchange = (e) => { Object.assign(sel, { village: e.target.value, ulpin: "" }); draw(); changed(); };
    $("#d-parcel").onchange = (e) => { sel.ulpin = e.target.value; draw(); changed(false); };
    $("#d-go").onclick = () => { const p = props(sel.ulpin); if (p) onParcel(p); };
    el.querySelectorAll("[data-kind]").forEach((b) => b.onclick = () => { kind = b.dataset.kind; const q = $("#d-q").value; draw(); $("#d-q").value = q; $("#d-q").focus(); if (q) search(q); });
    const q = $("#d-q"), res = $("#d-results");
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => search(q.value), 220); });
    q.addEventListener("keydown", (e) => { if (e.key === "Enter") res.querySelector("[data-u]")?.click(); if (e.key === "Escape") res.hidden = true; });
  }

  function autoPick() {                          // single option -> pick it, like the state portals do
    const { d, s } = node();
    if (d && !sel.sub && d.sub_districts.length === 1) sel.sub = d.sub_districts[0].name;
    const s2 = node().s;
    if (s2 && !sel.village && s2.villages.length === 1) sel.village = s2.villages[0].name;
    return s;
  }

  async function search(text) {
    const res = el.querySelector("#d-results");
    text = text.trim();
    if (!text) { res.hidden = true; return; }
    res.hidden = false; res.innerHTML = `<div class="empty">${esc(t("searching"))}</div>`;
    const my = ++seq;
    try {
      const r = await api.search(text, fixed ? state : undefined);
      if (my !== seq) return;
      const want = KINDS.find(([k]) => k === kind)[1];
      const hits = r.results.filter((x) => !want || x.match === want);
      res.innerHTML = hits.length ? hits.map((x) => `<button data-u="${x.ulpin}" data-s="${x.state_code}">
          <span class="r-main"><b>${esc(x.native_label)}</b>${statusBadge(x.risk_level)}</span>
          <small><span class="mono">${fmtUlpin(x.ulpin)}</span> · ${esc(x.village)}, ${esc(x.sub_district)}, ${esc(x.district)} · ${esc(x.state_name)}</small></button>`).join("")
        : `<div class="empty">${esc(t("noResults"))}</div>`;
      res.querySelectorAll("[data-u]").forEach((b) => b.onclick = async () => {
        const x = hits.find((h) => h.ulpin === b.dataset.u);
        res.hidden = true;
        if (sel.state !== x.state_code) { sel.state = x.state_code; await loadState(sel.state); }
        Object.assign(sel, { district: x.district, sub: x.sub_district, village: x.village, ulpin: x.ulpin });
        draw(); changed(false);
        onParcel(props(x.ulpin) || x);
      });
    } catch { if (my === seq) res.innerHTML = `<div class="empty">${esc(t("dataUnavailable"))}</div>`; }
  }

  return {
    get selection() { return { ...sel }; },
    async setDistrict(name) {
      Object.assign(sel, { district: name, sub: "", village: "", ulpin: "" }); autoPick(); draw(); changed(false);
    },
    async selectParcel(p) {
      if (sel.state !== p.state_code) { sel.state = p.state_code; await loadState(sel.state); }
      Object.assign(sel, { district: p.district, sub: p.sub_district, village: p.village, ulpin: p.ulpin }); draw(); changed(false);
    },
  };
}
