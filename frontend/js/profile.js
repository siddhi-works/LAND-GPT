import { api } from "./api.js";
import { rememberParcel, setContext } from "./context.js";
import { createMap } from "./map.js";
import { t, localText, recType } from "./i18n.js";
import { STATES } from "./states.js";
import { citizenHeader, bindLang, disclaimer, esc, fmtHa, fmtInr, fmtUlpin, fmtDate, icon, statusBadge, sev, errorBox, title, riskStatus, siteFooter, skeleton, toast } from "./ui.js";

export function parcelSvg(ring, w = 132, h = 92, stroke = "#0b3d91", fill = "#e3ecfa") {
  const xs = ring.map(c => c[0]), ys = ring.map(c => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((w - 14) / (x1 - x0), (h - 14) / (y1 - y0));
  const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
  const d = ring.map(([x, y], i) => `${i ? "L" : "M"}${(ox + (x - x0) * k).toFixed(1)},${(oy + (y1 - y) * k).toFixed(1)}`).join("") + "Z";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Parcel boundary"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export const prov = (r) => `<div class="prov" title="${esc(`${r.provenance.source_table} · ${Object.values(r.provenance.record_key).join(" / ")}`)}">${icon.link}<span>${esc(t("source"))}: ${esc(recType(r.native_record_type || r.provenance.native_record_type || ""))}${r.provenance.source_system ? ` · ${esc(r.provenance.source_system)}` : ""}</span></div>`;
const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).filter(r => r[1] != null && r[1] !== "" && r[1] !== "—").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
const lt = (v, st) => esc(localText(v, st));
const DEPTS = [
  ["Revenue · Land records", ["land_record", "mutation"]], ["Registration & Stamps", ["registration"]], ["Survey · GIS", ["geometry"]],
  ["Planning & Building", ["planning", "building_permission"]], ["Rights & Liabilities", ["encumbrance", "litigation"]],
  ["Municipal & Utilities", ["property_tax", "utilities"]], ["Environment", ["environmental_restriction"]],
];

export function flowHtml(reg, ring, gisHa) {
  const src = reg.linked_sources.filter(s => s.source_table !== "core.parcel_registry");
  const groups = DEPTS.map(([label, concepts]) => ({ label, rows: src.filter(s => s.concepts.some(c => concepts.includes(c)) && !(label.startsWith("Survey") && s.concepts.includes("land_record"))) }))
    .map(g => ({ ...g, rows: g.rows.filter((r, i, a) => a.findIndex(x => x.source_table === r.source_table) === i) }))
    .filter(g => g.rows.length);
  return `<div class="flow">
    <div class="flow-node"><div class="eyebrow">${esc(t("storyParcel"))}</div>${ring ? parcelSvg(ring) : ""}<small>${fmtHa(gisHa)} · GIS</small></div>
    <div class="flow-arrow" aria-hidden="true"></div>
    <div class="flow-node ulpin-node"><div class="eyebrow">ULPIN</div><b class="mono">${fmtUlpin(reg.ulpin)}</b>
      <small>${reg.native_identifiers.map(i => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`)).join("<br>")}</small></div>
    <div class="flow-arrow" aria-hidden="true"></div>
    <div class="dept-grid">${groups.map(g => `<div class="dept"><h4>${esc(g.label)}</h4>${g.rows.map(r =>
      `<div class="rec ${r.record_count ? "" : "empty"}" title="${esc(r.source_system)} · ${esc(r.source_table)}"><b>${esc(recType(r.native_record_type))}</b><span>${r.record_count ? `${r.record_count} record${r.record_count > 1 ? "s" : ""}` : "none"}</span></div>`).join("")}</div>`).join("")}</div>
  </div>`;
}

function section(id, heading, terms, concept, concepts, body) {
  const supported = concepts[concept]?.supported !== false;
  return `<section class="panel psec" id="sec-${id}"><header><h2>${esc(heading)}</h2>${terms ? `<span class="terms">${esc(terms)}</span>` : ""}</header>
    <div class="body">${body || `<div class="empty">${esc(supported ? t("notRecorded") : t("notConnected"))}</div>`}</div></section>`;
}

export function renderProfile(root, rerender, { ulpin, section: jump }) {
  root.innerHTML = `<div class="page">${citizenHeader("map")}<main class="page-main" id="main"><div class="dossier-skel">${skeleton(3)}${skeleton(5)}</div></main>${siteFooter()}${disclaimer()}</div>`;
  bindLang(root, rerender);
  setContext({ page: "profile", ulpin }, { replace: true });
  let ctl = null, gone = false;
  Promise.all([api.profile(ulpin), api.gis(ulpin), api.parcels()]).then(([pf, gis, fc]) => {
    if (gone) return;                             // user navigated away while the records were loading
    const b = pf.canonical, reg = pf.registry, ver = pf.verification, st = b.identity.state_code, S = STATES[st];
    const ring = b.geometry[0]?.geometry.coordinates[0];
    const ror = b.land_records.find(l => l.record_class === "record_of_rights") || b.land_records.find(l => l.record_class === "urban_property_record");
    const terms = (concept) => [...new Set(b.sources.filter(s => s.concepts.includes(concept) && s.record_count).map(s => recType(s.native_record_type)))].join(" · ");
    const C = pf.concepts;

    const land = b.land_records.map(lr => `<div class="rec-block"><h3>${esc(recType(lr.native_record_type))} <span class="muted">${esc(t("rc_" + lr.record_class))}</span></h3>${kv([
      [t("owner"), lr.holders.map(h => `${lt(h, st)}${h.native ? `<span class="sub">${esc(h.native)}</span>` : ""}`).join("") || null],
      [t("area"), lr.area ? `${fmtHa(lr.area.value_ha)} <span class="muted">(${lr.area.native_value} ${esc(lr.area.native_unit)})</span>` : null],
      [t("landUse"), lr.land_use_label ? lt(lr.land_use_label, st) : null],
      [t("pf_parcelNo"), lr.parcel_identifiers.map(i => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`)).join(", ") || null],
      [t("account"), lr.account_identifiers.map(i => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}`)).join(", ") || null],
      [t("recordStatus"), esc(lr.record_status)],
    ])}${prov(lr)}</div>`).join("");
    const regs = b.registrations.map(r => `<div class="rec-block"><h3>${esc(r.document_no)} <span class="muted">${lt(r.document_type_label, st)}</span></h3>${kv([
      [t("pf_regOn"), fmtDate(r.registration_date)], [t("pf_sro"), esc(r.sub_registrar_office)],
      [t("pf_executant"), r.executants.map(p => lt(p, st)).join(", ")], [t("pf_claimant"), r.claimants.map(p => lt(p, st)).join(", ")],
      [t("pf_consideration"), fmtInr(r.consideration_inr)], r.stamp_duty_inr != null && [t("pf_stamp"), fmtInr(r.stamp_duty_inr)],
      r.registration_fee_inr != null && [t("pf_regfee"), fmtInr(r.registration_fee_inr)], [t("pf_status"), esc(r.status)],
    ])}${prov(r)}</div>`).join("");
    const muts = b.mutations.length ? `<ul class="timeline">${b.mutations.map(m => `<li class="${m.status}"><div><b>${esc(m.register_name)} ${esc(m.mutation_no)}</b> — ${lt(m.kind_label, st)}
      <span class="badge ${m.status === "pending" ? "warn" : "ok"}">${lt(m.status_label, st)}</span></div>
      <small>${esc(t("applied"))} ${fmtDate(m.application_date)}${m.linked_document_no ? ` · ${esc(t("pf_basis"))} ${esc(m.linked_document_no)}` : ""}${m.order_no ? ` · ${esc(t("pf_order"))} ${esc(m.order_no)}` : ""}${m.basis ? ` · ${esc(title(m.basis))}` : ""}</small>${prov(m)}</li>`).join("")}</ul>` : "";
    const ac = gis.area_comparison;
    const gisBody = `<div class="gis-grid"><div class="mini-map"><div id="mini" class="map"></div></div><div>${kv([
      [t("pf_gisArea"), fmtHa(ac.computed_gis_area?.value_ha)], [t("pf_recArea"), `${fmtHa(ac.record_area?.value_ha)} <span class="muted">(${esc(ac.record_area_source)})</span>`],
      ac.cadastral_map_area && [t("pf_mapArea"), fmtHa(ac.cadastral_map_area.value_ha)], [t("pf_declArea"), fmtHa(ac.declared_gis_area?.value_ha)],
      [t("pf_diff"), ac.relative_difference != null ? `${(ac.relative_difference * 100).toFixed(1)}% ${ac.within_tolerance ? `<span class="badge ok">${esc(t("pf_within"))}</span>` : `<span class="badge warn">${esc(t("pf_exceeds"))}</span>`}` : null],
      [t("pf_vertices"), b.geometry[0]?.vertex_count], [t("pf_centroid"), b.identity.centroid ? `${b.identity.centroid.lat}, ${b.identity.centroid.lon}` : null],
    ])}${b.cadastral_maps.map(cm => `<div class="rec-block"><h3>${esc(recType(cm.native_record_type))} ${esc(cm.map_ref)}</h3>${kv([[t("plotNo"), esc(cm.plot_no + (cm.sub_division ? "/" + cm.sub_division : ""))], [t("mapArea"), fmtHa(cm.map_area?.value_ha)], [t("pf_mapStatus"), esc(cm.map_status)], [t("layers"), esc(cm.layers.join(", "))]])}${prov(cm)}</div>`).join("")}
      ${b.geometry[0] ? prov(b.geometry[0]) : ""}</div></div>`;
    const landUse = b.land_use.map(u => `<div class="rec-block">${kv([[recType(u.native_record_type), lt(u.label, st)]])}${prov(u)}</div>`).join("");
    const plan = b.planning.map(p => `<div class="rec-block"><h3>${esc(p.plan_name)}</h3>${kv([[t("pf_authority"), esc(p.planning_authority)], [t("pf_zone"), `${esc(p.zone_code)} · ${lt(p.zone_name, st)}`], [t("pf_permitted"), esc(title(p.permitted_use))], [t("pf_restriction"), esc(p.native.restriction_status)]])}${prov(p)}</div>`).join("");
    const bld = b.building_permissions.map(p => `<div class="rec-block"><h3>${esc(p.permission_no)}</h3>${kv([[t("pf_authority"), esc(p.authority)], p.department && [t("pf_dept"), esc(p.department)], [t("pf_use"), esc(title(p.building_use))], [t("pf_builtup"), p.built_up_area_sqm ? `${p.built_up_area_sqm} m²` : null], [t("pf_approved"), fmtDate(p.approval_date)], [t("pf_status"), esc(p.status)]])}${prov(p)}</div>`).join("");
    const enc = b.encumbrances.map(e => `<div class="rec-block"><h3>${lt(e.type_label, st)} <span class="badge ${e.status === "active" ? "bad" : "ok"}">${esc(e.status)}</span></h3>${kv([[t("pf_reference"), `<code>${esc(e.reference_no)}</code>`], [t("pf_favour"), lt(e.holder, st)], e.litigation_flag && [t("pf_litigation"), `<span class="badge bad">${esc(t("pf_case"))} ${esc(e.court_case_reference)}</span>`]])}${prov(e)}</div>`).join("");
    const tax = b.property_tax.map(x => `<div class="rec-block"><h3>${esc(x.account_id)} <span class="muted">${esc(x.assessment_year)}</span></h3>${kv([x.local_body && [t("pf_localBody"), esc(x.local_body)], [t("pf_assessed"), fmtInr(x.assessed_value_inr)], [t("pf_demand"), fmtInr(x.demand_inr)], [t("pf_paid"), fmtInr(x.paid_inr)], [t("pf_outstanding"), x.outstanding_inr ? `<b class="t-bad">${fmtInr(x.outstanding_inr)}</b>` : fmtInr(0)], [t("pf_status"), esc(title(x.status))]])}${prov(x)}</div>`).join("");
    const util = b.utilities.length ? `<table class="tbl"><thead><tr><th>${esc(t("pf_service"))}</th><th>${esc(t("pf_status"))}</th><th>${esc(t("pf_provider"))}</th><th>${esc(t("account"))}</th><th>${esc(t("source"))}</th></tr></thead><tbody>${b.utilities.map(u =>
      `<tr><td>${esc(title(u.service))}</td><td>${esc(title(u.status))}</td><td>${esc([u.provider, u.distribution_company].filter(Boolean).join(" · ") || "—")}</td><td class="mono">${esc(u.account_no || "—")}</td><td><code>${esc(u.provenance.source_table)}</code></td></tr>`).join("")}</tbody></table>` : "";
    const env = b.environmental_restrictions.map(e => `<div class="rec-block"><h3>${esc(e.restriction_label)} <span class="badge ${e.is_restrictive ? (e.status === "active" ? "bad" : "warn") : "ok"}">${esc(title(e.status))}</span></h3>${kv([[t("pf_zone"), esc(e.zone_name)], e.authority && [t("pf_authority"), esc(e.authority)]])}${prov(e)}</div>`).join("");
    const lastReg = b.registrations[b.registrations.length - 1], lastTax = b.property_tax[b.property_tax.length - 1];
    const val = (lastReg?.consideration_inr || lastTax?.assessed_value_inr) ? kv([
      lastReg && [t("pf_lastCons"), `${fmtInr(lastReg.consideration_inr)} <span class="muted">${esc(lastReg.document_no)}</span>`],
      lastTax && [t("pf_taxAssessed"), `${fmtInr(lastTax.assessed_value_inr)} <span class="muted">${esc(lastTax.assessment_year)}</span>`],
      lastReg && lastTax && [t("pf_ratio"), `${(lastReg.consideration_inr / lastTax.assessed_value_inr).toFixed(2)}×`],
    ]) : "";
    const checks = ver.summary.checks;
    const findings = ver.findings.map(f => findingHtml(f)).join("");

    root.querySelector("#main").innerHTML = `
      <a class="back" href="#/map/${ulpin}">${icon.chevron}${esc(t("backToMap"))}</a>
      ${riskStatus(ver.risk_level) === "bad" ? `<div class="disc-alert" role="alert">${icon.alert}<div><b>${esc(t("discAlertT"))}</b><p>${esc(t("discAlertD"))}</p></div></div>` : ""}
      <div class="page-title">
        <div><div class="eyebrow">${esc(t("profileTitle"))}</div><h1 class="mono">${fmtUlpin(ulpin)}</h1>
          <p>${esc(reg.native_identifiers.map(i => `${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`).join(" · "))} · ${esc(b.identity.jurisdiction.village)}, ${esc(t(b.identity.jurisdiction.sub_district_type))} ${esc(b.identity.jurisdiction.sub_district)}, ${esc(b.identity.jurisdiction.district)} · ${esc(S.name)}</p></div>
        <div class="title-side">${statusBadge(ver.risk_level)}<span class="muted">${esc(S.system)}</span></div>
      </div>
      <div class="profile-actions">
        <button class="btn" id="pa-copy">${icon.copy} ${esc(t("copyUlpin"))}</button>
        <a class="btn" href="#/map/${ulpin}">${icon.map} ${esc(t("viewOnMap"))}</a>
        <button class="btn primary" data-chat="${esc(t("qExplain"))}">${icon.spark} ${esc(t("askAboutParcel"))}</button>
        <a class="btn" href="#/state/${st}">${icon.search} ${esc(t("backToSearch"))}</a>
        <button class="btn ghost" id="pa-print">${icon.register} ${esc(t("print"))}</button>
      </div>
      ${dossierHtml(b, reg, ver, ac, S, st)}
      <section class="panel" id="sec-records"><header><h2>${icon.link} ${esc(t("connectedRecords"))}</h2><span class="terms">${esc(t("hubHint"))}</span></header>
        ${hubHtml(b, ver, C, ring, terms)}</section>
      <nav class="toc" aria-label="Sections">${[["land", t("secLand")], ["registration", t("secRegistration")], ["mutation", t("secMutation")], ["gis", t("secGis")], ["landuse", t("secLandUse")], ["planning", t("secPlanning")], ["building", t("secBuilding")], ["encumbrance", t("secEncumbrance")], ["tax", t("secTax")], ["utilities", t("secUtilities")], ["environment", t("secEnvironment")]].map(([k, l]) => `<a href="#sec-${k}" data-jump="sec-${k}">${esc(l)}</a>`).join("")}</nav>
      <div class="profile-grid">
        <div class="stack">
          ${section("land", t("secLand"), terms("land_record"), "land_record", C, land)}
          ${section("registration", t("secRegistration"), terms("registration"), "registration", C, regs)}
          ${section("mutation", t("secMutation"), terms("mutation") || S.mutation, "mutation", C, muts)}
          ${section("gis", t("secGis"), terms("geometry"), "geometry", C, gisBody)}
          ${section("landuse", t("secLandUse"), terms("land_use"), "land_use", C, landUse)}
          ${section("planning", t("secPlanning"), terms("planning"), "planning", C, plan)}
          ${section("building", t("secBuilding"), terms("building_permission"), "building_permission", C, bld)}
          ${section("encumbrance", t("secEncumbrance"), terms("encumbrance"), "encumbrance", C, enc)}
          ${section("tax", t("secTax"), terms("property_tax"), "property_tax", C, tax)}
          ${section("utilities", t("secUtilities"), terms("utilities"), "utilities", C, util)}
          ${section("environment", t("secEnvironment"), terms("environmental_restriction"), "environmental_restriction", C, env)}
          ${val ? section("valuation", t("secValuation"), `${t("secRegistration")} · ${t("secTax")}`, "registration", C, val) : ""}
        </div>
        <aside class="stack sticky">
          <section class="panel ask-card" id="assist"><header><h2>${icon.spark} ${esc(t("askAboutParcel"))}</h2></header><div class="body">
            <p class="fine">${esc(t("askCardD"))}</p>
            <div class="chips">${["qIsVerified", "qConnected", "qOwner", "qAreaDiff"].map((k) => `<button class="chip btn-chip" data-chat="${esc(t(k))}">${esc(t(k))}</button>`).join("")}</div>
            <button class="btn primary" data-chat="${esc(t("qExplain"))}">${icon.spark} ${esc(t("qExplain"))}</button>
          </div></section>
        </aside>
      </div>`;
    root.querySelectorAll("[data-jump]").forEach(a => a.onclick = (e) => { e.preventDefault(); root.querySelector("#" + a.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    const props = fc.features.find((f) => f.properties.ulpin === ulpin)?.properties;
    if (props) rememberParcel(props);
    root.querySelector("#pa-copy").onclick = () => { navigator.clipboard?.writeText(ulpin); toast(`${t("copied")}: ${fmtUlpin(ulpin)}`, "ok"); };
    root.querySelector("#pa-print").onclick = () => window.print();
    root.querySelectorAll("[data-node]").forEach((n) => n.onclick = () => root.querySelector("#sec-" + n.dataset.node)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    toast(t("recordLoaded"), "ok");
    if (jump) setTimeout(() => root.querySelector("#sec-" + jump)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
    ctl = createMap(root.querySelector("#mini"), { features: fc, basemap: "sat" });
    ctl.select(ulpin);
    ctl.map.fitBounds(L.polygon(ring.map(([x, y]) => [y, x])).getBounds().pad(0.9), { animate: false });
  }).catch((e) => {
    if (gone) return;
    if (!e.status) console.error("Profile render failed:", e);
    root.querySelector("#main").innerHTML = `<a class="back" href="#/map">${icon.chevron}${esc(t("backToMap"))}</a>${errorBox(e.status === 404 || e.status === 422 ? e : { message: t("dataUnavailable") })}
      ${e.status === 404 || e.status === 422 ? "" : `<button class="btn" id="pf-retry">${esc(t("retry"))}</button>`}`;
    root.querySelector("#pf-retry")?.addEventListener("click", rerender);
  });
  return () => { gone = true; ctl?.destroy(); };
}

// ---------------------------------------------------------------------------------------------
// dossier summary, connected-records hub, record timeline (all from the loaded profile)
// ---------------------------------------------------------------------------------------------

function dossierHtml(b, reg, ver, ac, S, st) {
  const j = b.identity.jurisdiction;
  const ror = b.land_records.find((l) => l.record_class === "record_of_rights") || b.land_records.find((l) => l.record_class === "urban_property_record") || b.land_records[0];
  const rs = riskStatus(ver.risk_level);
  const tag = (kind, label) => `<span class="dz-tag ${kind}">${esc(label)}</span>`;
  const unavailable = tag("na", t("stUnavailable"));
  const areaOk = ac.relative_difference == null ? null : ac.within_tolerance;
  const card = (ic, label, body, status) => `<div class="dz-card">${status || ""}<div class="dz-l">${icon[ic]}${esc(label)}</div><div class="dz-v">${body}</div></div>`;
  return `<div class="dossier">
    ${card("register", t("dzIdentity"), `<b class="mono">${fmtUlpin(b.identity.ulpin)}</b><small>${reg.native_identifiers.map((i) => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`)).join(" · ")}</small>`)}
    ${card("pin", t("location"), `<b>${esc(j.village)}</b><small>${esc(t(j.sub_district_type))} ${esc(j.sub_district)} › ${esc(j.district)} › ${esc(S.name)}</small>`)}
    ${card("area", t("area"), ac.record_area ? `<b>${fmtHa(ac.record_area.value_ha)}</b><small>${esc(t("mapped"))}: ${fmtHa(ac.computed_gis_area?.value_ha)}</small>` : "—",
      areaOk == null ? unavailable : areaOk ? tag("ok", t("stVerified")) : tag("warn", t("stNeedsReview")))}
    ${card("layers", t("landUse"), ror?.land_use_label ? `<b>${esc(localText(ror.land_use_label, st))}</b><small>${esc(recType(ror.native_record_type))}</small>` : "—", ror?.land_use_label ? "" : unavailable)}
    ${card("home", t("owner"), ror?.holders.length ? `<b>${ror.holders.map((h) => esc(localText(h, st))).join(", ")}</b><small>${esc(recType(ror.native_record_type))}</small>` : "—", ror?.holders.length ? "" : unavailable)}
    ${card("shield", t("verification"), `<b>${ver.summary.checks.pass} ${esc(t("checksPassed"))}</b><small>${ver.findings.length} ${esc(t("findings"))} · ${esc(t("risk"))} ${esc(ver.risk_level)}</small>`,
      tag(rs, { ok: t("stVerified"), warn: t("stNeedsReview"), bad: t("stWarning") }[rs]))}
  </div>`;
}

const HUB = [
  ["land", "secLand", (b) => b.land_records.length, "land_record"],
  ["registration", "secRegistration", (b) => b.registrations.length, "registration"],
  ["mutation", "secMutation", (b) => b.mutations.length, "mutation"],
  ["gis", "secGis", (b) => b.geometry.length + b.cadastral_maps.length, "geometry"],
  ["landuse", "secLandUse", (b) => b.land_use.length, "land_use"],
  ["planning", "secPlanning", (b) => b.planning.length, "planning"],
  ["building", "secBuilding", (b) => b.building_permissions.length, "building_permission"],
  ["encumbrance", "secEncumbrance", (b) => b.encumbrances.length, "encumbrance"],
  ["tax", "secTax", (b) => b.property_tax.length, "property_tax"],
  ["utilities", "secUtilities", (b) => b.utilities.length, "utilities"],
  ["environment", "secEnvironment", (b) => b.environmental_restrictions.length, "environmental_restriction"],
];

function hubHtml(b, ver, C, ring, terms) {
  const nodes = HUB.map(([id, key, count, concept]) => {
    const n = count(b), supported = C[concept]?.supported !== false;
    return { id, label: t(key), n, sub: n ? terms(concept) : supported ? t("hubNone") : t("hubNotConnected"), cls: n ? "has" : supported ? "none" : "na" };
  });
  const N = nodes.length;
  const pos = nodes.map((_, i) => { const a = (i / N) * 2 * Math.PI - Math.PI / 2; return [50 + 40 * Math.cos(a), 50 + 38 * Math.sin(a)]; });
  return `<div class="hub">
    <svg class="hub-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${pos.map(([x, y], i) =>
      `<line x1="50" y1="50" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" class="${nodes[i].cls.split(" ")[0]}"/>`).join("")}</svg>
    <div class="hub-center">${ring ? parcelSvg(ring, 96, 66) : ""}<div class="eyebrow">ULPIN</div><b class="mono">${fmtUlpin(b.identity.ulpin)}</b></div>
    ${nodes.map((nd, i) => `<button class="hub-node ${nd.cls}" data-node="${nd.id}" style="left:${pos[i][0].toFixed(2)}%;top:${pos[i][1].toFixed(2)}%">
      <b>${esc(nd.label)}</b><small>${nd.n ? `<span class="hn-count">${nd.n}</span>` : ""}${esc(nd.sub)}</small></button>`).join("")}
  </div>`;
}

function timelineHtml(b, ver, st) {
  const lt = (v) => localText(v, st);
  const ev = [];
  for (const r of b.registrations) if (r.registration_date) ev.push({ d: r.registration_date, kind: "reg", title: `${t("tlRegistered")} · ${r.document_no}`, sub: `${lt(r.document_type_label)} · ${r.sub_registrar_office || ""}` });
  for (const m of b.mutations) if (m.application_date) ev.push({ d: m.application_date, kind: m.status === "pending" ? "warn" : "mut", title: `${m.register_name} ${m.mutation_no} · ${lt(m.kind_label)}`, sub: `${t("applied")} · ${lt(m.status_label)}` });
  for (const p of b.building_permissions) if (p.approval_date) ev.push({ d: p.approval_date, kind: "bld", title: `${t("secBuilding")} · ${p.permission_no}`, sub: p.authority || "" });
  if (!ev.length) return "";
  ev.sort((x, y) => String(x.d).localeCompare(String(y.d)));
  ev.push({ d: ver.as_of, kind: `now ${riskStatus(ver.risk_level)}`, title: t("tlVerification"), sub: `${ver.summary.checks.pass} ${t("checksPassed")} · ${ver.findings.length} ${t("findings")}` });
  return `<section class="panel" id="sec-timeline"><header><h2>${icon.work} ${esc(t("timeline"))}</h2><span class="terms">${esc(t("timelineD"))}</span></header>
    <ol class="rtl">${ev.map((e) => `<li class="${e.kind}"><time>${esc(fmtDate(e.d))}</time><b>${esc(e.title)}</b><small>${esc(e.sub)}</small></li>`).join("")}</ol></section>`;
}

export function findingHtml(f, { detailed = false } = {}) {
  const obs = f.observations || [];
  return `<details class="finding" ${detailed ? "open" : ""}><summary><span class="top">${sev(f.severity)}<span class="rule">${esc(f.rule_id)} · ${esc(title(f.rule_name))}</span>
      ${f.status === "explained" ? '<span class="badge info">explained by pending mutation</span>' : ""}</span><p>${esc(f.message)}</p></summary>
    <table class="tbl obs"><thead><tr><th>Source record</th><th>Field</th><th>Value</th></tr></thead><tbody>${obs.map(o =>
      `<tr><td><b>${esc(recType(o.native_record_type))}</b><small>${esc(o.source_system)} · <code>${esc(o.source_table)}</code></small></td><td><code>${esc(o.field)}</code></td><td>${esc(fmtVal(o.value))}</td></tr>`).join("")}</tbody></table>
    <p class="fine">Expected: ${esc(f.expectation)}</p></details>`;
}
function fmtVal(v) {
  if (v == null) return "—";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.map(fmtVal).join("; ");
  if ("value_ha" in v) return `${v.value_ha} ha`;
  if ("en" in v) return [v.en, v.native].filter(Boolean).join(" / ");
  return Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => `${k}: ${fmtVal(x)}`).join(", ");
}
