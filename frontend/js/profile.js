import { api } from "./api.js";
import { assistantPanel } from "./assistant.js";
import { createMap } from "./map.js";
import { t, localText } from "./i18n.js";
import { STATES } from "./states.js";
import { citizenHeader, bindLang, disclaimer, esc, fmtHa, fmtInr, fmtUlpin, fmtDate, icon, statusBadge, sev, loading, errorBox, title } from "./ui.js";

export function parcelSvg(ring, w = 132, h = 92, stroke = "#0b3d91", fill = "#e3ecfa") {
  const xs = ring.map(c => c[0]), ys = ring.map(c => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((w - 14) / (x1 - x0), (h - 14) / (y1 - y0));
  const ox = (w - (x1 - x0) * k) / 2, oy = (h - (y1 - y0) * k) / 2;
  const d = ring.map(([x, y], i) => `${i ? "L" : "M"}${(ox + (x - x0) * k).toFixed(1)},${(oy + (y1 - y) * k).toFixed(1)}`).join("") + "Z";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Parcel boundary"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

export const prov = (r) => `<div class="prov">${icon.link}<span>${esc(r.provenance.source_system)}</span><code>${esc(r.provenance.source_table)}</code><code>${esc(Object.values(r.provenance.record_key).join(" / "))}</code></div>`;
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
      `<div class="rec ${r.record_count ? "" : "empty"}" title="${esc(r.source_system)} · ${esc(r.source_table)}"><b>${esc(r.native_record_type)}</b><span>${r.record_count ? `${r.record_count} record${r.record_count > 1 ? "s" : ""}` : "none"}</span></div>`).join("")}</div>`).join("")}</div>
  </div>`;
}

function section(id, heading, terms, concept, concepts, body) {
  const supported = concepts[concept]?.supported !== false;
  return `<section class="panel psec" id="sec-${id}"><header><h2>${esc(heading)}</h2>${terms ? `<span class="terms">${esc(terms)}</span>` : ""}</header>
    <div class="body">${body || `<div class="empty">${esc(supported ? t("notRecorded") : t("notConnected"))}</div>`}</div></section>`;
}

export function renderProfile(root, rerender, { ulpin }) {
  root.innerHTML = `<div class="page">${citizenHeader("map")}<main class="page-main" id="main">${loading()}</main>${disclaimer()}</div>`;
  bindLang(root, rerender);
  let ctl = null;
  Promise.all([api.profile(ulpin), api.gis(ulpin), api.parcels()]).then(([pf, gis, fc]) => {
    const b = pf.canonical, reg = pf.registry, ver = pf.verification, st = b.identity.state_code, S = STATES[st];
    const ring = b.geometry[0]?.geometry.coordinates[0];
    const ror = b.land_records.find(l => l.record_class === "record_of_rights") || b.land_records.find(l => l.record_class === "urban_property_record");
    const terms = (concept) => [...new Set(b.sources.filter(s => s.concepts.includes(concept) && s.record_count).map(s => s.native_record_type))].join(" · ");
    const C = pf.concepts;

    const land = b.land_records.map(lr => `<div class="rec-block"><h3>${esc(lr.native_record_type)} <span class="muted">${esc(title(lr.record_class))}</span></h3>${kv([
      [t("owner"), lr.holders.map(h => `${lt(h, st)}${h.native ? `<span class="sub">${esc(h.native)}</span>` : ""}`).join("") || null],
      [t("area"), lr.area ? `${fmtHa(lr.area.value_ha)} <span class="muted">(${lr.area.native_value} ${esc(lr.area.native_unit)})</span>` : null],
      [t("landUse"), lr.land_use_label ? lt(lr.land_use_label, st) : null],
      ["Parcel no.", lr.parcel_identifiers.map(i => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`)).join(", ") || null],
      ["Account", lr.account_identifiers.map(i => esc(`${i.scheme.replaceAll("_", " ")} ${i.value}`)).join(", ") || null],
      ["Record status", esc(lr.record_status)],
    ])}${prov(lr)}</div>`).join("");
    const regs = b.registrations.map(r => `<div class="rec-block"><h3>${esc(r.document_no)} <span class="muted">${lt(r.document_type_label, st)}</span></h3>${kv([
      ["Registered on", fmtDate(r.registration_date)], ["Sub-Registrar", esc(r.sub_registrar_office)],
      ["Executant", r.executants.map(p => lt(p, st)).join(", ")], ["Claimant", r.claimants.map(p => lt(p, st)).join(", ")],
      ["Consideration", fmtInr(r.consideration_inr)], r.stamp_duty_inr != null && ["Stamp duty", fmtInr(r.stamp_duty_inr)],
      r.registration_fee_inr != null && ["Registration fee", fmtInr(r.registration_fee_inr)], ["Status", esc(r.status)],
    ])}${prov(r)}</div>`).join("");
    const muts = b.mutations.length ? `<ul class="timeline">${b.mutations.map(m => `<li class="${m.status}"><div><b>${esc(m.register_name)} ${esc(m.mutation_no)}</b> — ${lt(m.kind_label, st)}
      <span class="badge ${m.status === "pending" ? "warn" : "ok"}">${lt(m.status_label, st)}</span></div>
      <small>Applied ${fmtDate(m.application_date)}${m.linked_document_no ? ` · basis ${esc(m.linked_document_no)}` : ""}${m.order_no ? ` · order ${esc(m.order_no)}` : ""}${m.basis ? ` · ${esc(title(m.basis))}` : ""}</small>${prov(m)}</li>`).join("")}</ul>` : "";
    const ac = gis.area_comparison;
    const gisBody = `<div class="gis-grid"><div class="mini-map"><div id="mini" class="map"></div></div><div>${kv([
      ["Computed polygon area", fmtHa(ac.computed_gis_area?.value_ha)], ["Recorded area", `${fmtHa(ac.record_area?.value_ha)} <span class="muted">(${esc(ac.record_area_source)})</span>`],
      ac.cadastral_map_area && ["Cadastral map area", fmtHa(ac.cadastral_map_area.value_ha)], ["Registry declared GIS area", fmtHa(ac.declared_gis_area?.value_ha)],
      ["Difference", ac.relative_difference != null ? `${(ac.relative_difference * 100).toFixed(1)}% ${ac.within_tolerance ? '<span class="badge ok">within 5%</span>' : '<span class="badge warn">exceeds 5%</span>'}` : null],
      ["Boundary vertices", b.geometry[0]?.vertex_count], ["Centroid", b.identity.centroid ? `${b.identity.centroid.lat}, ${b.identity.centroid.lon}` : null],
    ])}${b.cadastral_maps.map(cm => `<div class="rec-block"><h3>${esc(cm.native_record_type)} ${esc(cm.map_ref)}</h3>${kv([["Plot no.", esc(cm.plot_no + (cm.sub_division ? "/" + cm.sub_division : ""))], ["Map area", fmtHa(cm.map_area?.value_ha)], ["Map status", esc(cm.map_status)], ["Layers", esc(cm.layers.join(", "))]])}${prov(cm)}</div>`).join("")}
      ${b.geometry[0] ? prov(b.geometry[0]) : ""}</div></div>`;
    const landUse = b.land_use.map(u => `<div class="rec-block">${kv([[u.native_record_type, lt(u.label, st)], ["Canonical class", esc(u.use)]])}${prov(u)}</div>`).join("");
    const plan = b.planning.map(p => `<div class="rec-block"><h3>${esc(p.plan_name)}</h3>${kv([["Authority", esc(p.planning_authority)], ["Zone", `${esc(p.zone_code)} · ${lt(p.zone_name, st)}`], ["Permitted use", esc(title(p.permitted_use))], ["Restriction", esc(p.native.restriction_status)]])}${prov(p)}</div>`).join("");
    const bld = b.building_permissions.map(p => `<div class="rec-block"><h3>${esc(p.permission_no)}</h3>${kv([["Authority", esc(p.authority)], p.department && ["Department", esc(p.department)], ["Use", esc(title(p.building_use))], ["Built-up area", p.built_up_area_sqm ? `${p.built_up_area_sqm} m²` : null], ["Approved on", fmtDate(p.approval_date)], ["Status", esc(p.status)]])}${prov(p)}</div>`).join("");
    const enc = b.encumbrances.map(e => `<div class="rec-block"><h3>${lt(e.type_label, st)} <span class="badge ${e.status === "active" ? "bad" : "ok"}">${esc(e.status)}</span></h3>${kv([["Reference", `<code>${esc(e.reference_no)}</code>`], ["In favour of", lt(e.holder, st)], e.litigation_flag && ["Litigation", `<span class="badge bad">Case ${esc(e.court_case_reference)}</span>`]])}${prov(e)}</div>`).join("");
    const tax = b.property_tax.map(x => `<div class="rec-block"><h3>${esc(x.account_id)} <span class="muted">${esc(x.assessment_year)}</span></h3>${kv([x.local_body && ["Local body", esc(x.local_body)], ["Assessed value", fmtInr(x.assessed_value_inr)], ["Demand", fmtInr(x.demand_inr)], ["Paid", fmtInr(x.paid_inr)], ["Outstanding", x.outstanding_inr ? `<b class="t-bad">${fmtInr(x.outstanding_inr)}</b>` : fmtInr(0)], ["Status", esc(title(x.status))]])}${prov(x)}</div>`).join("");
    const util = b.utilities.length ? `<table class="tbl"><thead><tr><th>Service</th><th>Status</th><th>Provider</th><th>Account</th><th>${esc(t("source"))}</th></tr></thead><tbody>${b.utilities.map(u =>
      `<tr><td>${esc(title(u.service))}</td><td>${esc(title(u.status))}</td><td>${esc([u.provider, u.distribution_company].filter(Boolean).join(" · ") || "—")}</td><td class="mono">${esc(u.account_no || "—")}</td><td><code>${esc(u.provenance.source_table)}</code></td></tr>`).join("")}</tbody></table>` : "";
    const env = b.environmental_restrictions.map(e => `<div class="rec-block"><h3>${esc(e.restriction_label)} <span class="badge ${e.is_restrictive ? (e.status === "active" ? "bad" : "warn") : "ok"}">${esc(title(e.status))}</span></h3>${kv([["Zone", esc(e.zone_name)], e.authority && ["Authority", esc(e.authority)]])}${prov(e)}</div>`).join("");
    const lastReg = b.registrations[b.registrations.length - 1], lastTax = b.property_tax[b.property_tax.length - 1];
    const val = (lastReg?.consideration_inr || lastTax?.assessed_value_inr) ? kv([
      lastReg && ["Consideration (last registration)", `${fmtInr(lastReg.consideration_inr)} <span class="muted">${esc(lastReg.document_no)}</span>`],
      lastTax && ["Assessed value (property tax)", `${fmtInr(lastTax.assessed_value_inr)} <span class="muted">${esc(lastTax.assessment_year)}</span>`],
      lastReg && lastTax && ["Ratio", `${(lastReg.consideration_inr / lastTax.assessed_value_inr).toFixed(2)}×`],
    ]) : "";
    const checks = ver.summary.checks;
    const findings = ver.findings.map(f => findingHtml(f)).join("");

    root.querySelector("#main").innerHTML = `
      <a class="back" href="#/map/${ulpin}">${icon.chevron}${esc(t("backToMap"))}</a>
      <div class="page-title">
        <div><div class="eyebrow">${esc(t("profileTitle"))}</div><h1 class="mono">${fmtUlpin(ulpin)}</h1>
          <p>${esc(reg.native_identifiers.map(i => `${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`).join(" · "))} · ${esc(b.identity.jurisdiction.village)}, ${esc(t(b.identity.jurisdiction.sub_district_type))} ${esc(b.identity.jurisdiction.sub_district)}, ${esc(b.identity.jurisdiction.district)} · ${esc(S.name)}</p></div>
        <div class="title-side">${statusBadge(ver.risk_level)}<span class="muted">${esc(S.system)}</span></div>
      </div>
      <section class="panel"><header><h2>${esc(t("connectedRecords"))}</h2><span class="terms">${esc(t("storyParcel"))} → ULPIN → ${esc(t("storyRecords"))} → ${esc(t("storyProfile"))}</span></header>${flowHtml(reg, ring, ac.computed_gis_area?.value_ha)}</section>
      <nav class="toc" aria-label="Sections">${[["land", t("secLand")], ["registration", t("secRegistration")], ["mutation", t("secMutation")], ["gis", t("secGis")], ["landuse", t("secLandUse")], ["planning", t("secPlanning")], ["building", t("secBuilding")], ["encumbrance", t("secEncumbrance")], ["tax", t("secTax")], ["utilities", t("secUtilities")], ["environment", t("secEnvironment")], ["checks", t("secChecks")]].map(([k, l]) => `<a href="#sec-${k}" data-jump="sec-${k}">${esc(l)}</a>`).join("")}</nav>
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
          ${val ? section("valuation", t("secValuation"), "Registration · Property tax", "registration", C, val) : ""}
        </div>
        <aside class="stack sticky">
          <section class="panel" id="sec-checks"><header><h2>${esc(t("secChecks"))}</h2></header><div class="body">
            <div class="check-sum"><span><b>${checks.pass}</b> ${esc(t("checksPassed"))}</span><span><b>${checks.fail}</b> failed</span><span><b>${checks.not_applicable}</b> n/a</span></div>
            ${findings || `<div class="notice ok">${icon.check}<span>All cross-record checks passed.</span></div>`}
            <p class="fine">Validation engine ${esc(ver.engine_version)} · glossary ${esc(ver.glossary_version)} · as of ${fmtDate(ver.as_of)}</p>
          </div></section>
          <section class="panel" id="assist"></section>
        </aside>
      </div>`;
    root.querySelectorAll("[data-jump]").forEach(a => a.onclick = (e) => { e.preventDefault(); root.querySelector("#" + a.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); });
    assistantPanel(root.querySelector("#assist"), ulpin);
    ctl = createMap(root.querySelector("#mini"), { features: fc, basemap: "sat" });
    ctl.select(ulpin);
    ctl.map.fitBounds(L.polygon(ring.map(([x, y]) => [y, x])).getBounds().pad(0.9), { animate: false });
  }).catch((e) => { root.querySelector("#main").innerHTML = `<a class="back" href="#/map">${icon.chevron}${esc(t("backToMap"))}</a>${errorBox(e)}`; });
  return () => ctl?.destroy();
}

export function findingHtml(f, { detailed = false } = {}) {
  const obs = f.observations || [];
  return `<details class="finding" ${detailed ? "open" : ""}><summary><span class="top">${sev(f.severity)}<span class="rule">${esc(f.rule_id)} · ${esc(title(f.rule_name))}</span>
      ${f.status === "explained" ? '<span class="badge info">explained by pending mutation</span>' : ""}</span><p>${esc(f.message)}</p></summary>
    <table class="tbl obs"><thead><tr><th>Source record</th><th>Field</th><th>Value</th></tr></thead><tbody>${obs.map(o =>
      `<tr><td><b>${esc(o.native_record_type)}</b><small>${esc(o.source_system)} · <code>${esc(o.source_table)}</code></small></td><td><code>${esc(o.field)}</code></td><td>${esc(fmtVal(o.value))}</td></tr>`).join("")}</tbody></table>
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
