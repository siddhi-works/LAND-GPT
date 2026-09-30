// Land Information Dashboard: #/dashboard[/<CODE>[/<district>]]. All figures are computed live by
// /v1/reports/summary over the connected state records for the chosen scope; nothing is estimated.
import { api } from "./api.js";
import { bars, stack } from "./charts.js";
import { setContext } from "./context.js";
import { t } from "./i18n.js";
import { baseLayer } from "./map.js";
import { CONCEPTS } from "./stack.js";
import { REGION, STATES } from "./states.js";
import { bindLang, citizenHeader, disclaimer, emptyState, esc, fmtHa, icon, pct, riskStatus, siteFooter, skeleton, statusBadge } from "./ui.js";

const L = window.L;
const COLOR = { ok: "#15803d", warn: "#d97706", bad: "#b42318" };
const GROUP_ORDER = ["ownership", "registration_mutation_lag", "area_gis", "encumbrance_litigation", "missing_links", "planning_environment", "data_quality", "spatial", "identity"];

// ---------------------------------------------------------------------------------------------
// shared pieces (also used by the home page's dashboard section)
// ---------------------------------------------------------------------------------------------

/** Verification-status ring. `by` = {ok, warn, bad}. */
export function donut({ ok, warn, bad }, label = t("stConsistent")) {
  const total = ok + warn + bad || 1, r = 52, c = 2 * Math.PI * r;
  let off = 0;
  const seg = (v, col) => { const len = (v / total) * c; const s = `<circle r="${r}" cx="70" cy="70" fill="none" stroke="${col}" stroke-width="22" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}"><title>${v}</title></circle>`; off += len; return v ? s : ""; };
  return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="${ok} / ${warn} / ${bad}"><g transform="rotate(-90 70 70)">
    <circle r="${r}" cx="70" cy="70" fill="none" stroke="#eef1f5" stroke-width="22"/>${seg(ok, COLOR.ok)}${seg(warn, COLOR.warn)}${seg(bad, COLOR.bad)}</g>
    <text x="70" y="68" text-anchor="middle" class="d-n">${pct(ok, total)}%</text><text x="70" y="86" text-anchor="middle" class="d-l">${esc(label)}</text></svg>`;
}

/** Count numbers up from 0 when they scroll into view. The real value is already in the DOM, so nothing is lost if animation never runs. */
export function countUp(scope) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    io.unobserve(e.target);
    const el = e.target, end = Number(el.dataset.count), suffix = el.dataset.suffix || "", t0 = performance.now();
    const step = (now) => { const k = Math.min(1, (now - t0) / 700); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + suffix; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), { threshold: 0.4 });
  scope.querySelectorAll("[data-count]").forEach((el) => io.observe(el));
}
export const num = (v, suffix = "") => `<b data-count="${v}" data-suffix="${suffix}">${v}${suffix}</b>`;

const statusCounts = (risk) => { const by = { ok: 0, warn: 0, bad: 0 }; Object.entries(risk).forEach(([l, n]) => { by[riskStatus(l)] += n; }); return by; };

/** Three state cards (ring + key figures) for comparing states. `href(code)` gives each card's link. */
export async function compareHtml(active, href) {
  const reps = await Promise.all(Object.keys(STATES).map((c) => api.reports(c)));
  return `<div class="cmp">${Object.keys(STATES).map((c, i) => {
    const rep = reps[i], by = statusCounts(rep.risk_levels), R = REGION[c];
    const cov = rep.coverage.filter((x) => x.source_table !== "core.parcel_registry");
    const link = cov.length ? Math.round(cov.reduce((a, x) => a + pct(x.linked, x.parcels), 0) / cov.length) : 0;
    return `<a class="cmp-card ${active === c ? "on" : ""}" href="${href(c)}" style="--accent:${R.accent}">
      <div class="cmp-ring">${donut(by, t("dbConsistentPct"))}</div>
      <div class="cmp-b"><div class="cmp-name"><b>${esc(STATES[c].name)}</b><span lang="${R.lang}">${esc(STATES[c].native)}</span></div>
        <dl><dt>${esc(t("kpiParcels"))}</dt><dd>${num(rep.parcels)}</dd>
          <dt>${esc(t("kpiReview"))}</dt><dd>${num(by.warn + by.bad)}</dd>
          <dt>${esc(t("pendingMutations"))}</dt><dd>${num(rep.mutations.pending || 0)}</dd>
          <dt>${esc(t("dbLinkage"))}</dt><dd>${num(link, "%")}</dd></dl>
        <div class="cmp-bar" title="${by.ok} / ${by.warn} / ${by.bad}">${["ok", "warn", "bad"].map((k) => by[k] ? `<i class="${k}" style="flex:${by[k]}"></i>` : "").join("")}</div></div></a>`;
  }).join("")}</div>`;
}

// ---------------------------------------------------------------------------------------------
// #/dashboard
// ---------------------------------------------------------------------------------------------

export function renderDashboard(root, rerender, { code = "", district = "" } = {}) {
  code = STATES[(code || "").toUpperCase()] ? code.toUpperCase() : "";
  if (!code) district = "";
  setContext({ page: "dashboard", state: code, district }, { replace: true });
  let map = null, filter = { kind: "", value: "" }, text = "", show = { ok: true, warn: true, bad: true }, selected = null, gone = false, onClick = null;
  const base = `#/dashboard${code ? "/" + code : ""}`;

  root.innerHTML = `<div class="page dashboard-page" ${code ? `style="--accent:${REGION[code].accent}"` : ""}>
    ${citizenHeader("dashboard")}
    <main class="region-main">
      <div class="wrap">
        <div class="sec-intro sec-intro-row"><div><h1>${esc(t("dashTitle"))}</h1><p>${esc(t("dashD"))}</p></div></div>
        <div class="db-controls">
          <div class="seg db-states">
            <a href="#/dashboard" class="${!code ? "on" : ""}">${esc(t("allStates"))}</a>
            ${Object.entries(STATES).map(([c, s]) => `<a href="#/dashboard/${c}" class="${code === c ? "on" : ""}" style="--sc:${REGION[c].accent}">${esc(s.name)}</a>`).join("")}
          </div>
          <label class="db-district"><span>${esc(t("district"))}</span><select class="select" id="db-d" ${code ? "" : "disabled"}><option value="">${esc(t(code ? "allDistricts" : "pickStateFirst"))}</option></select></label>
        </div>
        <section class="db-compare"><div class="db-sub"><h2>${icon.chart} ${esc(t("dbCompare"))}</h2><span class="terms">${esc(t("dbCompareD"))}</span></div><div id="db-cmp">${skeleton(3)}</div></section>
        <div id="db-body">${skeleton(3)}${skeleton(6)}</div>
      </div>
    </main>
    ${siteFooter()}${disclaimer()}</div>`;
  bindLang(root, rerender);
  const $ = (s) => root.querySelector(s);

  compareHtml(code, (c) => `#/dashboard/${c}`).then((html) => { if (!gone) { $("#db-cmp").innerHTML = html; countUp($("#db-cmp")); } })
    .catch(() => { if (!gone) $("#db-cmp").innerHTML = ""; });

  Promise.all([api.reports(code || undefined, district || undefined), api.hierarchy(), api.parcels(code || undefined),
    api.findings(code || undefined, district || undefined), api.dataQuality(), api.reports()])
    .then(([rep, h, fc, fnd, dq, all]) => {
      if (gone) return;
      const states = h.states.filter((s) => !code || s.code === code);
      const st = code ? states[0] : null;
      if (st) $("#db-d").innerHTML += st.districts.map((d) => `<option ${d.name === district ? "selected" : ""}>${esc(d.name)}</option>`).join("");
      $("#db-d").onchange = (e) => { location.hash = e.target.value ? `${base}/${encodeURIComponent(e.target.value)}` : base; };

      const parcels = fc.features.map((f) => f.properties).filter((p) => !district || p.district === district);
      const dists = district ? states[0].districts.filter((d) => d.name === district) : states.flatMap((s) => s.districts);
      const villages = dists.reduce((n, d) => n + d.sub_districts.reduce((k, x) => k + x.villages.length, 0), 0);
      const by = { ok: 0, warn: 0, bad: 0 };
      parcels.forEach((p) => by[riskStatus(p.risk_level)]++);
      const checks = (rep.checks.pass || 0) + (rep.checks.fail || 0);
      const cov = rep.coverage.filter((c) => c.source_table !== "core.parcel_registry");
      const avgLink = cov.length ? Math.round(cov.reduce((a, c) => a + pct(c.linked, c.parcels), 0) / cov.length) : 0;
      const pending = parcels.filter((p) => p.pending_mutations);

      const kpi = (v, label, sub, act, cls = "", ic = "", suffix = "") => `<button class="kpi-card ${cls}" data-act="${act}">${ic ? `<span class="kpi-ic">${icon[ic]}</span>` : ""}${num(v, suffix)}<span>${esc(label)}</span>${sub ? `<small>${esc(sub)} ›</small>` : ""}</button>`;
      const groups = GROUP_ORDER.filter((g) => rep.parcels_by_discrepancy[g]);
      const gmax = Math.max(1, ...groups.map((g) => rep.parcels_by_discrepancy[g]));

      $("#db-body").innerHTML = `
        <div class="kpi-row db-kpis">
          ${kpi(parcels.length, t("kpiParcels"), t("dbToMap"), "map", "", "area")}
          ${kpi(by.ok, t("kpiConsistent"), t("dbToList"), "f:status:ok", "ok", "check")}
          ${kpi(by.warn + by.bad, t("kpiReview"), t("dbToList"), "f:status:review", "warn", "alert")}
          ${kpi(pending.length, t("dbPendingParcels"), t("dbToList"), "f:pending:1", "", "swap")}
          ${kpi(pct(rep.checks.pass || 0, checks), t("dbChecksPass"), `${rep.checks.pass || 0}/${checks}`, "s:db-status", "", "shield", "%")}
          ${kpi(avgLink, t("dbLinkage"), `${cov.length} ${t("kpiSources")}`, "s:db-matrix", "", "link", "%")}
          ${kpi(dists.length, t("kpiDistricts"), t("dbToUnits"), "s:db-units", "", "map")}
          ${kpi(villages, t("kpiVillages"), code ? REGION[code].titleEn : t("landRecords"), code ? `h:#/state/${code}` : "h:#/state", "", "pin")}
        </div>

        <div class="db-grid">
          <section class="panel" id="db-status"><header><h2>${icon.shield} ${esc(t("intelConsistency"))}</h2><span class="terms">${esc(t("intelClick"))}</span></header>
            <div class="body db-donut-wrap">${donut(by)}<ul class="legend-list db-legend">${[["ok", "stConsistent"], ["warn", "stAttention"], ["bad", "stDiscrepancy"]].map(([k, l]) =>
              `<li><button data-act="f:status:${k}"><span class="dot ${k}"></span>${esc(t(l))}<b>${by[k]}</b><small>${pct(by[k], parcels.length)}%</small></button></li>`).join("")}</ul></div></section>

          <section class="panel db-map-panel"><header><h2>${icon.map} ${esc(t("dbGeo"))}</h2>
              <div class="db-map-legend" role="group" aria-label="${esc(t("dbMapLegend"))}">${[["ok", "stConsistent"], ["warn", "stAttention"], ["bad", "stDiscrepancy"]].map(([k, l]) =>
                `<label><input type="checkbox" data-show="${k}" checked><span class="dot ${k}"></span>${esc(t(l))}</label>`).join("")}</div></header>
            <div class="db-map" id="db-map"></div><p class="fine db-map-note">${esc(t("dbGeoD"))}</p></section>

          <section class="panel"><header><h2>${icon.alert} ${esc(t("intelDiscrepancies"))}</h2><span class="terms">${esc(t("intelClick"))}</span></header>
            <div class="body">${groups.length ? `<div class="dq-bars">${groups.map((g) => `<button class="dq-bar" data-act="f:group:${g}">
              <span class="hb-l">${esc(t("dg_" + g))}</span><span class="hb-t"><i style="width:${rep.parcels_by_discrepancy[g] / gmax * 100}%"></i></span><b>${rep.parcels_by_discrepancy[g]}</b></button>`).join("")}</div>`
              : emptyState(t("stConsistent"), "", icon.check)}</div></section>

          <section class="panel"><header><h2>${icon.work} ${esc(t("dbActivity"))}</h2><span class="terms">${esc(t("dbActivityD"))}</span></header>
            <div class="body">
              <div class="sec-title">${esc(t("dbMutations"))}</div>
              ${stack([{ label: t("dbFinalized"), value: rep.mutations.finalized || 0, color: "#15803d" }, { label: t("pendingMutations"), value: rep.mutations.pending || 0, color: "#d97706" }])}
              <div class="sec-title">${esc(t("dbSeverity"))}</div>
              ${bars(["high", "medium", "low", "info"].map((s) => ({ label: t("sev_" + s), value: rep.findings_by_severity[s] || 0, color: { high: "#b42318", medium: "#d97706", low: "#1d5fa8", info: "#94a3b8" }[s] })))}
            </div></section>
        </div>

        <section class="panel db-list" id="db-list"></section>

        <section class="panel db-matrix-panel" id="db-matrix"><header><h2>${icon.link} ${esc(t("dbMatrix"))}</h2><span class="terms">${esc(t("dbMatrixD"))}</span></header>
          <div class="db-matrix-wrap">${matrixHtml(dq, all.coverage, code)}</div></section>

        <div class="db-grid two">
          <section class="panel" id="db-coverage"><header><h2>${icon.register} ${esc(t("dbCoverage"))}</h2><span class="terms">${esc(t("dbCoverageD"))}</span></header>
            <div class="body cov-list">${cov.map((c) => {
              const rec = REGION[c.state_code].records.find((r) => r.native === c.native_record_type && r.connected !== false);
              const inner = `<span class="cov-l"><b>${esc(c.native_record_type)}</b><small>${esc(STATES[c.state_code].name)} · <code>${esc(c.source_table)}</code></small></span>
                <span class="cov-t"><i style="width:${pct(c.linked, c.parcels)}%;background:${REGION[c.state_code].accent}"></i></span><b>${pct(c.linked, c.parcels)}%</b>`;
              return rec ? `<a class="cov-row" href="#/state/${c.state_code}/${rec.key}">${inner}</a>` : `<div class="cov-row">${inner}</div>`;
            }).join("")}</div></section>

          <section class="panel" id="db-units"><header><h2>${icon.grid} ${esc(t("dbUnits"))}</h2><span class="terms">${esc(t("dbUnitsD"))}</span></header>
            <table class="tbl"><thead><tr><th>${esc(t("district"))}</th><th>${esc(t("taluka"))} / ${esc(t("tehsil"))}</th><th class="num">ULPIN</th><th class="num">${esc(t("withFindings"))}</th><th class="num">${esc(t("pendingMutations"))}</th></tr></thead>
            <tbody>${rep.units.map((u) => `<tr class="click" data-href="#/dashboard/${u.state_code}/${encodeURIComponent(u.district)}"><td><b>${esc(u.district)}</b><small>${esc(STATES[u.state_code].name)}</small></td><td>${esc(u.sub_district)}</td>
              <td class="num">${u.parcels}</td><td class="num">${u.parcels_with_findings}</td><td class="num">${u.mutations_pending ? `<b class="t-warn">${u.mutations_pending}</b>` : 0}</td></tr>`).join("")}</tbody></table></section>
        </div>`;
      countUp($("#db-body"));

      // ---- parcel list (filtered by cards, status, discrepancy, map legend and text) ----
      const inFilter = (p) => {
        const f = filter;
        if (f.kind === "status" && (f.value === "review" ? riskStatus(p.risk_level) === "ok" : riskStatus(p.risk_level) !== f.value)) return false;
        if (f.kind === "pending" && !p.pending_mutations) return false;
        if (f.kind === "group" && !groupHits(f.value).has(p.ulpin)) return false;
        if (!show[riskStatus(p.risk_level)]) return false;
        if (text && !`${p.native_label} ${p.village} ${p.sub_district} ${p.district} ${p.ulpin}`.toLowerCase().includes(text)) return false;
        return true;
      };
      const hitCache = {};
      const groupHits = (g) => hitCache[g] ||= (() => { const rules = new Set(rep.discrepancy_rules[g]); return new Set(fnd.findings.filter((x) => rules.has(x.rule_id)).map((x) => x.ulpin)); })();
      const titleFor = () => filter.kind === "status" ? t({ ok: "stConsistent", warn: "stAttention", bad: "stDiscrepancy", review: "kpiReview" }[filter.value])
        : filter.kind === "pending" ? t("dbPendingParcels") : filter.kind === "group" ? t("dg_" + filter.value) : t("dbAllParcels");

      const drawList = () => {
        const rows = parcels.filter(inFilter);
        $("#db-list").innerHTML = `<header><h2>${icon.register} ${esc(titleFor())} <span class="count">${rows.length}</span></h2>
            <div class="db-list-tools"><div class="disc-input sm">${icon.search}<input id="db-q" type="search" value="${esc(text)}" placeholder="${esc(t("dbSearchPh"))}" aria-label="${esc(t("dbSearchPh"))}"></div>
            ${filter.kind || text || !show.ok || !show.warn || !show.bad ? `<button class="btn sm ghost" data-act="f::">${esc(t("clearFilter"))}</button>` : ""}</div></header>
          ${rows.length ? `<div class="db-parcels">${rows.map((p) => `<a class="db-parcel ${selected === p.ulpin ? "sel" : ""}" data-u="${p.ulpin}" href="#/parcel/${p.ulpin}">
            <span><b>${esc(p.native_label)}</b><small>${esc(p.village)}, ${esc(p.district)} · ${esc(STATES[p.state_code].name)}</small></span>
            <span class="db-p-meta">${fmtHa(p.record_area_ha)}${p.pending_mutations ? ` · <span class="badge warn">${esc(t("pendingMutations"))}</span>` : ""}</span>${statusBadge(p.risk_level)}</a>`).join("")}</div>`
            : emptyState(t("dbNoParcels"), "", icon.info)}`;
        const q = $("#db-q");
        q.oninput = () => { text = q.value.trim().toLowerCase(); const pos = q.selectionStart; drawList(); drawMarkers(); const q2 = $("#db-q"); q2.focus(); q2.setSelectionRange(pos, pos); };
        $("#db-list").querySelectorAll("[data-u]").forEach((a) => {
          a.onmouseenter = () => markers.get(a.dataset.u)?.setStyle({ radius: 11, weight: 3 });
          a.onmouseleave = () => markers.get(a.dataset.u)?.setStyle({ radius: selected === a.dataset.u ? 11 : 7, weight: 2 });
        });
      };

      // ---- map: one marker per ULPIN parcel, kept in sync with the list ----
      const markers = new Map();
      map = L.map($("#db-map"), { zoomControl: true, scrollWheelZoom: false, attributionControl: true });
      baseLayer("map").addTo(map);
      const layer = L.layerGroup().addTo(map);
      const center = (u) => { const ring = fc.features.find((x) => x.properties.ulpin === u).geometry.coordinates[0]; return [ring.reduce((a, v) => a + v[1], 0) / ring.length, ring.reduce((a, v) => a + v[0], 0) / ring.length]; };
      const drawMarkers = () => {
        layer.clearLayers(); markers.clear();
        parcels.filter(inFilter).forEach((p) => {
          const m = L.circleMarker(center(p.ulpin), { radius: selected === p.ulpin ? 11 : 7, weight: 2, color: selected === p.ulpin ? "#0b2545" : "#fff", fillColor: COLOR[riskStatus(p.risk_level)], fillOpacity: 0.95 })
            .bindTooltip(`${esc(p.native_label)} · ${esc(p.village)}`, { direction: "top", offset: [0, -6] })
            .bindPopup(`<b>${esc(p.native_label)}</b><br>${esc(p.village)}, ${esc(p.district)}<br><a href="#/parcel/${p.ulpin}">${esc(t("openProfile"))}</a> · <a href="#/map/${p.ulpin}">${esc(t("viewOnMap"))}</a>`)
            .on("click", () => { selected = p.ulpin; drawList(); drawMarkers(); $(`#db-list [data-u="${p.ulpin}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); })
            .addTo(layer);
          markers.set(p.ulpin, m);
        });
      };
      const pts = parcels.map((p) => center(p.ulpin));
      if (pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 11 }); else map.setView([22.5, 78.5], 5);
      drawList(); drawMarkers();

      $("#db-body").querySelectorAll("[data-show]").forEach((cb) => cb.onchange = () => { show[cb.dataset.show] = cb.checked; drawList(); drawMarkers(); });

      onClick = (e) => {
        const a = e.target.closest("[data-act], tr[data-href]");
        if (!a || !root.contains(a)) return;
        if (a.dataset.href) { location.hash = a.dataset.href; return; }
        const [kind, x, y] = a.dataset.act.split(":");
        if (kind === "map") { location.hash = parcels.length === 1 ? `#/map/${parcels[0].ulpin}` : "#/map"; return; }
        if (kind === "h") { location.hash = a.dataset.act.slice(2); return; }
        if (kind === "s") { $("#" + x).scrollIntoView({ behavior: "smooth", block: "start" }); return; }
        if (kind === "f") {
          filter = { kind: x, value: y };
          if (!x) { text = ""; show = { ok: true, warn: true, bad: true }; $("#db-body").querySelectorAll("[data-show]").forEach((cb) => { cb.checked = true; }); }
          root.querySelectorAll("[data-act^='f:']").forEach((b) => b.classList.toggle("on", b.dataset.act === a.dataset.act && !!x));
          drawList(); drawMarkers(); $("#db-list").scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };
      root.addEventListener("click", onClick);
    })
    .catch(() => { if (!gone) $("#db-body").innerHTML = `${emptyState(t("dataUnavailable"), "", icon.alert)}<button class="btn" id="db-retry">${esc(t("retry"))}</button>`; $("#db-retry")?.addEventListener("click", rerender); });

  return () => { gone = true; if (onClick) root.removeEventListener("click", onClick); map?.stop(); map?.remove(); };
}

// Record family x state matrix: share of the state's ULPIN parcels that have >=1 record of that family.
function matrixHtml(dq, coverage, active) {
  const cov = new Map(coverage.map((c) => [`${c.state_code}:${c.source_table}`, c]));
  const codes = Object.keys(STATES);
  const cell = (k, code) => {
    const rows = (dq.source_coverage[code] || []).filter((r) => r.concepts.includes(k) && r.source_table !== "core.parcel_registry");
    if (!rows.length) return `<td class="mx-none" title="${esc(t("hubNotConnected"))}">—</td>`;
    const best = rows.map((r) => cov.get(`${code}:${r.source_table}`)).filter(Boolean).reduce((m, c) => Math.max(m, pct(c.linked, c.parcels)), 0);
    const rec = REGION[code].records.find((r) => r.connected !== false && rows.some((x) => x.native_record_type === r.native));
    const names = [...new Set(rows.map((r) => r.native_record_type))].join(" · ");
    const style = `--v:${best / 100};--accent:${REGION[code].accent}`;
    const inner = `<span class="mx-v">${best}%</span><small>${esc(names)}</small>`;
    return `<td class="mx ${active && active !== code ? "dim" : ""}" style="${style}" title="${esc(names)} · ${best}%">${rec ? `<a href="#/state/${code}/${rec.key}">${inner}</a>` : `<a href="#/state/${code}">${inner}</a>`}</td>`;
  };
  return `<table class="mx-tbl"><thead><tr><th></th>${codes.map((c) => `<th style="--accent:${REGION[c].accent}">${esc(STATES[c].name)}</th>`).join("")}</tr></thead>
    <tbody>${CONCEPTS.map((c) => `<tr><th><span class="mx-ic">${icon[c.ic]}</span>${esc(t(c.tkey))}</th>${codes.map((code) => cell(c.k, code)).join("")}</tr>`).join("")}</tbody></table>`;
}
