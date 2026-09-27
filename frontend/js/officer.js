import { api, session, ApiError } from "./api.js";
import { assistantPanel } from "./assistant.js";
import { bars, stack, lines, indicative, MONTHS } from "./charts.js";
import { createMap } from "./map.js";
import { findingHtml, flowHtml, parcelSvg, prov } from "./profile.js";
import { STATES, ACTION_LABEL, STATUS_LABEL, FORWARD_TO, queueOf } from "./states.js";
import { MARK, disclaimer, esc, fmtHa, fmtUlpin, fmtDate, icon, sev, loading, errorBox, title, toast, pct, SEV_RANK, riskStatus } from "./ui.js";

const ui = { queue: "pending", tab: "work", vfilter: { sev: "", group: "" }, gisSel: null };
const statusBadge = (s) => { const [c, l] = STATUS_LABEL[s] || ["info", title(s)]; return `<span class="badge ${c}">${esc(l)}</span>`; };
const GROUPS = { ownership: "Ownership", registration_mutation_lag: "Registration ↔ mutation", area_gis: "Area / GIS", spatial: "Spatial",
  missing_links: "Missing linked records", encumbrance_litigation: "Encumbrance / litigation", planning_environment: "Planning / environment", identity: "Identifiers", data_quality: "Data quality" };
const GROUP_RULES = { ownership: ["OWN"], registration_mutation_lag: ["MUT-001", "MUT-002", "LNK-002"], area_gis: ["AREA", "GIS-001", "GIS-002"], spatial: ["GIS-003", "GIS-004", "GIS-005", "GIS-006"],
  missing_links: ["LNK-001", "COV-002", "ENC-004"], encumbrance_litigation: ["ENC-001", "ENC-002", "ENC-003", "LIT"], planning_environment: ["PLN", "ENV"], identity: ["ID-"], data_quality: ["COV-001", "DQ", "TAX-002", "MUT-003", "TAX-001", "VAL"] };
const inGroup = (rule, g) => (GROUP_RULES[g] || []).some(p => rule.startsWith(p));

// ------------------------------------------------------------------------------------------
// Login
// ------------------------------------------------------------------------------------------
function officerTop(o) {
  return `<header class="site-header officer">
    <div class="gov-strip" aria-hidden="true"></div>
    <div class="bar">
      <a class="brand" href="${o ? "#/officer" : "#/"}"><span class="brand-mark">${MARK}</span>
        <span class="brand-text"><b>State Land Stack · Officer Console</b><span>${o ? esc(`${STATES[o.state].system} · ${o.department}`) : "Revenue & land records departments · Maharashtra · Uttar Pradesh · Gujarat"}</span></span></a>
      <span class="grow"></span>
      ${o ? `<form class="top-search" id="osearch" role="search">${icon.search}<input id="oq" placeholder="ULPIN / ${esc(o.state === "UP" ? "Gata" : o.state === "MH" ? "Gat / Survey" : "Survey")} no." autocomplete="off" aria-label="Search ULPIN"><div class="results" id="ores" hidden></div></form>
        <div class="who"><b>${esc(o.name)}</b><span>${esc(o.designation_native)} · ${esc(o.office)}</span></div>
        <a class="btn sm ghost-light" href="#/officer/logout">${icon.logout} Sign out</a>` : `<nav class="topnav"><a href="#/">Citizen portal</a><a href="#/map">Land Map</a></nav>`}
    </div>
  </header>`;
}

export function renderOfficerLogin(root, rerender, params) {
  const pick = { state: params.state || "MH", username: null };
  root.innerHTML = `<div class="page">${officerTop(null)}<main class="login-main" id="lm">${loading()}</main>${disclaimer()}</div>`;
  api.accounts().then(({ accounts }) => {
    const draw = () => {
      const S = STATES[pick.state];
      const accs = accounts.filter(a => a.state === pick.state);
      if (!accs.find(a => a.username === pick.username)) pick.username = accs[0].username;
      const a = accs.find(x => x.username === pick.username);
      root.querySelector("#lm").innerHTML = `
      <div class="login-grid">
        <section class="login-left">
          <h1>Officer sign-in</h1>
          <p class="muted">Select your state and login category. Your role and jurisdiction determine the work queue, records and actions available to you.</p>
          <div class="state-pick" role="radiogroup" aria-label="State">${Object.entries(STATES).map(([k, s]) => `<button role="radio" aria-checked="${k === pick.state}" class="${k === pick.state ? "on" : ""}" data-s="${k}">
            <b>${esc(s.name)}</b><span class="native">${esc(s.native)}</span><small>${esc(s.system)}</small></button>`).join("")}</div>
          <h2 class="sub-h">${esc(S.system)} — login categories</h2>
          <div class="cat-list">${accs.map(x => `<button class="cat ${x.username === pick.username ? "on" : ""}" data-u="${x.username}">
            <b>${esc(x.login_category)}</b><span>${esc(x.designation)} <span class="native">${esc(x.designation_native)}</span></span><small>${esc(x.office)}</small></button>`).join("")}</div>
          <div class="hier"><h3>Administrative hierarchy</h3><ol>${S.hierarchy.map(h => `<li>${esc(h)}</li>`).join("")}</ol></div>
        </section>
        <form class="login-card" id="lf" autocomplete="off">
          <div class="eyebrow">${esc(a.login_category)}</div>
          <h2>${esc(a.designation)}</h2>
          <p class="muted">${esc(a.office)} · Jurisdiction: ${esc([STATES[a.state].name, a.jurisdiction.district, a.jurisdiction.sub_district, a.jurisdiction.village].filter(Boolean).join(" › "))}</p>
          <div class="field"><label for="uid">User ID</label><input class="input" id="uid" value="${esc(a.username)}" readonly></div>
          <div class="field"><label for="pw">Password</label><input class="input" id="pw" type="password" value="LandStack@2026" autocomplete="off"></div>
          <button class="btn primary lg" type="submit">Sign in</button>
          <div id="lerr"></div>
          <p class="fine">Access is logged. Actions recorded here are Land Stack workflow entries; the state system of record (${esc(S.system)}) is not modified.</p>
        </form>
      </div>`;
      root.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { pick.state = b.dataset.s; pick.username = null; draw(); });
      root.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { pick.username = b.dataset.u; draw(); });
      root.querySelector("#lf").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const r = await api.login(a.username, root.querySelector("#pw").value);
          session.set(r.token, r.officer); location.hash = "#/officer";
        } catch (err) { root.querySelector("#lerr").innerHTML = errorBox(err); }
      };
    };
    draw();
  }).catch(e => { root.querySelector("#lm").innerHTML = errorBox(e); });
}

// ------------------------------------------------------------------------------------------
// Shell + routing
// ------------------------------------------------------------------------------------------
function navFor(o) {
  const S = STATES[o.state];
  const hasWork = o.actions.mutation.length || o.actions.verification.length;
  const home = { MH: `${S.mutationRegister} (e-Ferfar)`, UP: o.level === "state" ? "Board MIS dashboard" : o.level === "district" ? "District dashboard" : "Namantaran (धारा 34)", GJ: "e-Dhara · VF 6 processing" }[o.state];
  return [
    ["Work", [["home", "#/officer", icon.register, home], hasWork ? ["validation", "#/officer/validation", icon.shield, "Discrepancy review"] : ["validation", "#/officer/validation", icon.shield, "Validation findings"]]],
    ["Land Stack", [["gis", "#/officer/gis", icon.map, o.state === "UP" ? "BhuNaksha / GIS inspection" : "GIS inspection"], ["reports", "#/officer/reports", icon.chart, o.state === "UP" ? "Reports (रिपोर्ट)" : o.state === "MH" ? "Reports (अहवाल)" : "Reports (અહેવાલ)"],
      ["interop", "#/officer/interop", icon.link, "Interoperability status"], ["audit", "#/officer/audit", icon.audit, "Audit log"]]],
  ];
}

function shell(root, o, active, body, { fill = false } = {}) {
  const jur = [STATES[o.state].name, o.jurisdiction.district, o.jurisdiction.sub_district, o.jurisdiction.village].filter(Boolean);
  root.innerHTML = `<div class="officer-app">
    ${officerTop(o)}
    <div class="officer-body">
      <nav class="sidenav" aria-label="Officer navigation">
        <div class="ctx"><span class="eyebrow">Jurisdiction</span><b>${esc(jur.join(" › "))}</b><small>${esc(o.login_category)}</small></div>
        ${navFor(o).map(([g, items]) => `<div class="grp">${esc(g)}</div>${items.map(([k, href, ic, label]) => `<a href="${href}" class="${k === active ? "on" : ""}">${ic}<span>${esc(label)}</span></a>`).join("")}`).join("")}
        <div class="statute"><span class="eyebrow">Process</span>${esc(o.process.register)}<br><small>${esc(o.process.statute)}</small></div>
      </nav>
      <main class="officer-main ${fill ? "fill" : ""}" id="om">${body}</main>
    </div>
    ${disclaimer()}
  </div>`;
  bindSearch(root, o);
}

function bindSearch(root, o) {
  const inp = root.querySelector("#oq"), res = root.querySelector("#ores");
  if (!inp) return;
  let tm;
  inp.oninput = () => {
    clearTimeout(tm);
    if (!inp.value.trim()) { res.hidden = true; return; }
    tm = setTimeout(async () => {
      const r = await api.search(inp.value, o.state).catch(() => ({ results: [] }));
      res.hidden = false;
      res.innerHTML = r.results.length ? r.results.map(x => `<button type="button" data-u="${x.ulpin}"><b class="mono">${fmtUlpin(x.ulpin)}</b><span>${esc(x.native_label)} · ${esc(x.village)}, ${esc(x.district)}</span></button>`).join("") : `<div class="empty">No parcel in ${esc(STATES[o.state].name)}</div>`;
      res.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { res.hidden = true; inp.value = ""; location.hash = `#/officer/parcel/${b.dataset.u}`; });
    }, 200);
  };
  root.querySelector("#osearch").onsubmit = (e) => { e.preventDefault(); res.querySelector("[data-u]")?.click(); };
}

export function renderOfficer(root, rerender, { view = "home", ulpin } = {}) {
  if (view === "logout") { api.logout().catch(() => {}); session.clear(); location.hash = "#/officer/login"; return; }
  if (!session.token) { location.hash = "#/officer/login"; return; }
  let cleanup = null;
  api.me().then((o) => {
    const views = { home: homeView, validation: validationView, gis: gisView, reports: reportsView, interop: interopView, audit: auditView, parcel: parcelView };
    cleanup = (views[view] || homeView)(root, rerender, o, ulpin);
  }).catch((e) => {
    if (e instanceof ApiError && e.status === 401) { session.clear(); location.hash = "#/officer/login"; return; }
    root.innerHTML = errorBox(e);
  });
  return () => { if (typeof cleanup === "function") cleanup(); };
}

// ------------------------------------------------------------------------------------------
// Home: state-specific work
// ------------------------------------------------------------------------------------------
function stageStrip(o, item) {
  const S = STATES[o.state];
  const idx = item.status === "completed" || item.status === "certified" ? 3 : queueOf(item) === "ready" ? 2 : /notice|report/i.test(item.stage) ? 1 : 0;
  return `<ol class="stages">${S.stages.map((s, i) => `<li class="${i < idx ? "done" : i === idx ? "cur" : ""}"><b>${esc(s.label)}</b><small>${esc(s.by)}</small></li>`).join("")}</ol>`;
}

function homeView(root, rerender, o) {
  shell(root, o, "home", loading());
  api.work().then(({ items }) => {
    const main = root.querySelector("#om");
    const muts = items.filter(x => x.type === "mutation"), vers = items.filter(x => x.type === "verification");
    const S = STATES[o.state];
    const count = (q) => muts.filter(x => queueOf(x) === q).length;
    const attention = [
      [count("pending") + count("ready"), `${S.mutation} pending`],
      [count("ready"), o.state === "UP" ? "Awaiting Tehsildar order" : "Ready for certification"],
      [vers.filter(v => ["pending", "returned"].includes(v.status)).length, "Discrepancies to review"],
      [vers.filter(v => SEV_RANK[v.severity] >= 4 && v.status === "pending").length, "High-severity"],
    ];
    const kpis = `<div class="kpis">${attention.map(([n, l], i) => `<div class="kpi ${i === 3 && n ? "alert" : ""}"><b>${n}</b><span>${esc(l)}</span></div>`).join("")}</div>`;
    const heading = { MH: ["फेरफार नोंदवही · Ferfar register", `Mutation entries under ${o.process.statute} in your jurisdiction. The Talathi records entries and serves notice; the Mandal Adhikari certifies after the objection period.`],
      UP: [o.level === "tehsil" ? "नामान्तरण वाद · Namantaran cases" : o.level === "district" ? "District administrative dashboard" : "Board of Revenue — MIS", o.level === "tehsil" ? `Tehsil Mutation Login — applications under ${o.process.statute}. Lekhpal / Revenue Inspector report, then Tehsildar order; Khatauni is updated on disposal.` : "Tehsil-wise status of mutation and record verification across your jurisdiction."],
      GJ: ["ઈ-ધરા · e-Dhara VF 6 processing", `Mutation entries in the VF 6 register. The e-Dhara Dy. Mamlatdar verifies and generates the 135-D notice, the Talati serves it (30 days), the competent authority certifies and approves the S-form.`] }[o.state];

    let workHtml;
    if (o.state === "GJ") workHtml = gjPipeline(o, muts);
    else if (o.state === "UP" && o.level !== "tehsil") workHtml = `<div id="unitrep">${loading()}</div>`;
    else workHtml = queueTable(o, muts);

    main.innerHTML = `<div class="om-pad">
      <div class="page-title"><div><h1>${esc(heading[0])}</h1><p>${esc(heading[1])}</p></div><div class="title-side"><span class="muted">As of 28 Sep 2026</span></div></div>
      ${kpis}
      ${workHtml}
      <section class="panel" style="margin-top:16px"><header><h2>Cross-source discrepancies needing review</h2><span class="terms">Land Stack validation engine</span></header>
        ${vers.length ? `<table class="tbl"><thead><tr><th>ULPIN</th><th>Parcel</th><th>Location</th><th>Primary finding</th><th>Severity</th><th class="num">Findings</th><th>Status</th><th></th></tr></thead><tbody>${vers.map(v => `<tr class="click" data-u="${v.ulpin}">
          <td class="mono nowrap">${fmtUlpin(v.ulpin)}</td><td>${esc(v.native_label)}</td><td>${esc(v.village)}<small>${esc(v.sub_district)}, ${esc(v.district)}</small></td>
          <td><b>${esc(v.reference)}</b> ${esc(v.title)}</td><td>${sev(v.severity)}</td><td class="num">${v.finding_count}</td><td>${statusBadge(v.status)}</td><td>${icon.right}</td></tr>`).join("")}</tbody></table>`
          : `<div class="body empty">No material discrepancies in your jurisdiction.</div>`}
      </section></div>`;
    main.querySelectorAll("[data-u]").forEach(r => r.onclick = () => { location.hash = `#/officer/parcel/${r.dataset.u}`; });
    main.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { ui.queue = b.dataset.q; ui.queueChosen = true; homeView(root, rerender, o); });
    if (o.state === "UP" && o.level !== "tehsil") api.officerReports().then(rep => { main.querySelector("#unitrep").innerHTML = unitTable(o, rep); });
  }).catch(e => { root.querySelector("#om").innerHTML = errorBox(e); });
}

function queueTable(o, muts) {
  const S = STATES[o.state];
  if (!ui.queueChosen && !muts.some(x => queueOf(x) === ui.queue)) {
    ui.queue = (S.queues.find(([k]) => muts.some(x => queueOf(x) === k)) || S.queues[0])[0];
  }
  const rows = muts.filter(x => queueOf(x) === ui.queue);
  const idLabel = o.state === "MH" ? "Ferfar No." : "Mutation No.";
  return `<section class="panel"><div class="tabs" role="tablist">${S.queues.map(([k, l]) => `<button role="tab" data-q="${k}" class="${ui.queue === k ? "on" : ""}">${esc(l)} <span class="count">${muts.filter(x => queueOf(x) === k).length}</span></button>`).join("")}</div>
    ${rows.length ? `<table class="tbl"><thead><tr><th>${idLabel}</th><th>Village</th><th>${o.state === "UP" ? "Gata / Khata" : "Gat / Survey No."}</th><th>Type</th><th>Basis document</th><th>Applied</th><th class="num">Days</th><th>Stage</th><th>Status</th></tr></thead><tbody>
    ${rows.map(x => `<tr class="click" data-u="${x.ulpin}"><td class="mono nowrap"><b>${esc(x.reference)}</b></td><td>${esc(x.village)}<small>${esc(x.sub_district)}</small></td><td>${esc(x.native_label)}</td>
      <td>${esc(x.title.split(" — ")[1] || "")}</td><td class="mono">${esc(x.document_no || "—")}<small>${x.document_registered ? `registered ${fmtDate(x.document_registered)}` : ""}</small></td>
      <td class="nowrap">${fmtDate(x.application_date)}</td><td class="num">${x.days_pending ?? "—"}</td><td>${esc(x.stage)}${x.severity ? ` ${sev(x.severity)}` : ""}</td><td>${statusBadge(x.status)}</td></tr>`).join("")}</tbody></table>`
      : `<div class="body empty">No entries in this list for your jurisdiction.</div>`}</section>`;
}

function gjPipeline(o, muts) {
  const S = STATES[o.state];
  const col = (i) => muts.filter(x => {
    if (x.status === "completed" || x.status === "certified") return i === 3;
    if (x.status === "notice_generated" || x.status === "notice_served" || (/notice/i.test(x.stage) && !["entry_verified"].includes(x.status))) return i === 1;
    if (queueOf(x) === "ready" || x.status === "s_form_approved") return i === 2;
    return i === 0;
  });
  return `<section class="panel"><header><h2>VF 6 entries by e-Dhara stage</h2><span class="terms">${esc(o.process.statute)} · 30-day notice</span></header>
    <div class="pipeline">${S.stages.map((s, i) => { const items = col(i).slice(0, i === 3 ? 8 : 50); return `<div class="pcol"><h3>${esc(s.label)} <span class="count">${col(i).length}</span></h3><small>${esc(s.by)}</small>
      ${items.map(x => `<button class="pcard" data-u="${x.ulpin}"><b class="mono">${esc(x.reference)}</b><span>${esc(x.village)} · ${esc(x.native_label)}</span>
        <small>${esc(x.title.split(" — ")[1] || "")} · ${x.days_pending != null ? `${x.days_pending} days` : fmtDate(x.application_date)}</small>${x.severity ? sev(x.severity) : ""}${x.status !== "pending" && x.status !== "completed" ? statusBadge(x.status) : ""}</button>`).join("") || `<div class="empty">—</div>`}
      ${col(i).length > items.length ? `<div class="fine">+ ${col(i).length - items.length} more</div>` : ""}</div>`; }).join("")}</div></section>`;
}

function unitTable(o, rep) {
  return `<section class="panel"><header><h2>${o.level === "state" ? "District / tehsil-wise report" : "Tehsil-wise report"}</h2><span class="terms">Namantaran & record verification</span></header>
    <table class="tbl"><thead><tr><th>District</th><th>Tehsil</th><th class="num">Parcels</th><th class="num">Namantaran pending</th><th class="num">Disposed</th><th class="num">With findings</th><th class="num">High severity</th></tr></thead><tbody>
    ${rep.units.map(u => `<tr><td>${esc(u.district)}</td><td>${esc(u.sub_district)}</td><td class="num">${u.parcels}</td><td class="num">${u.mutations_pending ? `<b class="t-warn">${u.mutations_pending}</b>` : 0}</td><td class="num">${u.mutations_finalized}</td><td class="num">${u.parcels_with_findings}</td><td class="num">${u.high ? `<b class="t-bad">${u.high}</b>` : 0}</td></tr>`).join("")}
    <tr class="total"><td colspan="2">Total</td><td class="num">${rep.parcels}</td><td class="num">${rep.mutations.pending || 0}</td><td class="num">${rep.mutations.finalized || 0}</td><td class="num">${rep.parcels_with_findings}</td><td class="num">${rep.findings_by_severity.high}</td></tr></tbody></table></section>`;
}

// ------------------------------------------------------------------------------------------
// Parcel inspection: GIS + connected records + validation + action
// ------------------------------------------------------------------------------------------
function parcelView(root, rerender, o, ulpin) {
  shell(root, o, "home", loading(), { fill: true });
  let ctl = null;
  Promise.all([api.officerParcel(ulpin), api.profile(ulpin), api.parcels(o.state), api.gis(ulpin)]).then(([op, pf, fc, gis]) => {
    const b = pf.canonical, ver = pf.verification, reg = pf.registry, S = STATES[o.state];
    const ring = b.geometry[0]?.geometry.coordinates[0];
    const ac = gis.area_comparison;
    const tabs = [["work", `Action (${op.work_items.length})`], ["validation", `Validation (${ver.findings.length})`], ["records", "Records"], ["audit", "Audit"], ["assistant", "Assistant"]];
    const main = root.querySelector("#om");
    main.innerHTML = `<div class="inspect">
      <div class="inspect-map"><div class="map" id="imap"></div>${layerBox(false)}</div>
      <div class="inspect-side">
        <div class="inspect-head">
          <a class="back" href="#/officer">${icon.chevron}Back to work</a>
          <div class="row"><div><div class="eyebrow">${esc(b.identity.jurisdiction.village)} · ${esc(b.identity.jurisdiction.sub_district)} · ${esc(b.identity.jurisdiction.district)}</div>
            <h1 class="mono">${fmtUlpin(ulpin)}</h1><p>${esc(reg.native_identifiers.map(i => `${i.scheme.replaceAll("_", " ")} ${i.value}${i.part ? "/" + i.part : ""}`).join(" · "))}</p></div>
            <div>${ring ? parcelSvg(ring, 88, 62, riskStatus(ver.risk_level) === "bad" ? "#b42318" : "#0b3d91", "#f3f6fb") : ""}</div></div>
          <div class="facts"><span><small>Recorded (${esc(ac.record_area_source)})</small><b>${fmtHa(ac.record_area?.value_ha)}</b></span><span class="${ac.within_tolerance === false ? "off" : ""}"><small>GIS polygon</small><b>${fmtHa(ac.computed_gis_area?.value_ha)}</b></span>
            <span><small>Risk</small><b>${sev(ver.risk_level === "none" ? "" : ver.risk_level) || "None"}</b></span><span><small>Checks</small><b>${ver.summary.checks.pass}/${ver.summary.checks.pass + ver.summary.checks.fail}</b></span></div>
          <a class="btn sm" href="#/parcel/${ulpin}" target="_blank" rel="noopener">Unified Land Profile ↗</a>
        </div>
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-t="${k}" class="${ui.tab === k ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
        <div class="inspect-body" id="ib"></div>
      </div></div>`;

    const body = main.querySelector("#ib");
    const draw = () => {
      main.querySelectorAll("[data-t]").forEach(x => x.classList.toggle("on", x.dataset.t === ui.tab));
      if (ui.tab === "work") body.innerHTML = workTab(o, op.work_items, ver);
      if (ui.tab === "validation") body.innerHTML = `<p class="fine">Deterministic cross-source rules run on the canonical records of this ULPIN. Each finding lists the source records and values compared.</p>${ver.findings.map(f => findingHtml(f, { detailed: SEV_RANK[f.severity] >= 3 })).join("") || `<div class="notice ok">${icon.check}<span>All checks passed.</span></div>`}
        <details class="checks"><summary>All ${ver.checks.length} checks</summary><table class="tbl"><tbody>${ver.checks.map(c => `<tr><td class="mono">${esc(c.rule_id)}</td><td>${esc(title(c.rule_name))}</td><td><span class="badge ${c.outcome === "pass" ? "ok" : c.outcome === "fail" ? "bad" : "plain"}">${esc(c.outcome.replace("_", " "))}</span></td><td class="muted">${esc(c.detail)}</td></tr>`).join("")}</tbody></table></details>`;
      if (ui.tab === "records") body.innerHTML = `${flowHtml(reg, ring, ac.computed_gis_area?.value_ha)}${recordsTable(b)}`;
      if (ui.tab === "audit") { body.innerHTML = loading(); api.audit(ulpin).then(r => { body.innerHTML = auditTable(r.entries, true); }); }
      if (ui.tab === "assistant") { body.innerHTML = `<section class="panel" id="asp"></section>`; assistantPanel(body.querySelector("#asp"), ulpin); }
      bindWork();
    };
    const bindWork = () => {
      body.querySelectorAll("[data-act]").forEach(btn => btn.onclick = async () => {
        const box = btn.closest(".witem");
        const remarks = box.querySelector("textarea").value, to = box.querySelector("select")?.value;
        try {
          await api.act(box.dataset.item, btn.dataset.act, remarks, btn.dataset.act === "forward" ? to : null);
          toast(`${ACTION_LABEL[btn.dataset.act]} — recorded`, "ok");
          op.work_items = (await api.officerParcel(ulpin)).work_items; draw();
        } catch (e) { toast(e.message, "bad"); }
      });
    };
    main.querySelectorAll("[data-t]").forEach(x => x.onclick = () => { ui.tab = x.dataset.t; draw(); });
    draw();

    ctl = createMap(main.querySelector("#imap"), { features: fc, mode: "officer", basemap: "hybrid", onSelect: (p) => { if (p.ulpin !== ulpin) location.hash = `#/officer/parcel/${p.ulpin}`; } });
    ctl.select(ulpin);
    ctl.setLayer("ghost", true); ctl.setLayer("encumbrance", true); ctl.setLayer("environment", true);
    ctl.map.fitBounds(L.polygon(ring.map(([x, y]) => [y, x])).getBounds().pad(1.2), { animate: false });
    bindLayerBox(main, ctl);
  }).catch(e => {
    const msg = e.code === "OUT_OF_JURISDICTION" ? `${e.message}. You can view it on the public Land Map.` : e.message;
    root.querySelector("#om").innerHTML = `<div class="om-pad"><a class="back" href="#/officer">${icon.chevron}Back to work</a>${errorBox({ message: msg })}</div>`;
  });
  return () => ctl?.destroy();
}

function workTab(o, items, ver) {
  if (!items.length) return `<div class="notice ok">${icon.check}<span>No open work for this parcel in your jurisdiction.</span></div>`;
  const byId = Object.fromEntries(ver.findings.map(f => [f.finding_id, f]));
  return items.map(it => {
    const acts = it.allowed_actions || [];
    const needsTo = acts.includes("forward");
    return `<div class="witem panel" data-item="${esc(it.item_id)}">
      <header><h3>${it.type === "mutation" ? esc(it.title) : `Discrepancy review — ${esc(it.title)}`}</h3>${statusBadge(it.status)}</header>
      <div class="body">
        ${it.type === "mutation" ? `${stageStrip(o, it)}<dl class="kv">
          <dt>Source status</dt><dd>${esc(typeof it.source_status === "object" ? [it.source_status.en, it.source_status.native].filter(Boolean).join(" / ") : it.source_status)}</dd>
          <dt>Applied</dt><dd>${fmtDate(it.application_date)}${it.days_pending != null ? ` · ${it.days_pending} days` : ""}</dd>
          <dt>Basis document</dt><dd>${esc(it.document_no || "—")}${it.document_registered ? ` · registered ${fmtDate(it.document_registered)}` : ""}</dd>
          <dt>Stage</dt><dd>${esc(it.stage)}</dd></dl>` : ""}
        ${it.finding_ids.length ? `<div class="sec-title">What the connected systems say</div>${it.finding_ids.map(id => byId[id]).filter(Boolean).map(f => findingHtml(f, { detailed: true })).join("")}` : ""}
        ${it.history.length ? `<div class="sec-title">History</div><ul class="timeline">${it.history.map(h => `<li><div><b>${esc(h.action_label)}</b>${h.to ? ` → ${esc(h.to)}` : ""}</div><small>${esc(h.officer_name)}, ${esc(h.designation)} · ${fmtDate(h.at)}${h.remarks ? ` · ${esc(h.remarks)}` : ""}</small></li>`).join("")}</ul>` : ""}
        ${acts.length ? `<div class="sec-title">Action required</div>
          <div class="field"><label>Remarks</label><textarea class="input" rows="2" placeholder="Remarks (required to return, reject or register an objection)"></textarea></div>
          ${needsTo ? `<div class="field"><label>Forward to</label><select class="select">${FORWARD_TO[o.state].map(x => `<option>${esc(x)}</option>`).join("")}</select></div>` : ""}
          <div class="actions">${acts.map((a, i) => `<button class="btn ${i === 0 ? "primary" : ["return", "reject", "register_objection"].includes(a) ? "danger" : ""}" data-act="${a}">${esc(ACTION_LABEL[a] || title(a))}</button>`).join("")}</div>`
          : `<p class="fine">Your role (${esc(o.designation)}) has view access for this item.</p>`}
      </div></div>`;
  }).join("");
}

function recordsTable(b) {
  const recs = [...b.land_records, ...b.registrations, ...b.mutations, ...b.encumbrances, ...b.planning, ...b.building_permissions, ...b.property_tax, ...b.utilities, ...b.environmental_restrictions, ...b.geometry, ...b.cadastral_maps];
  const seen = new Set();
  return `<table class="tbl"><thead><tr><th>Record</th><th>Concept</th><th>Source system · table · key</th><th>Locator</th></tr></thead><tbody>${recs.filter(r => { const k = r.provenance.locator; if (seen.has(k)) return false; seen.add(k); return true; }).map(r =>
    `<tr><td><b>${esc(r.native_record_type)}</b></td><td>${esc(title(r.concept))}</td><td>${esc(r.provenance.source_system)}<small><code>${esc(r.provenance.source_table)}</code> · ${esc(Object.values(r.provenance.record_key).join(" / "))}</small></td><td><code class="loc">${esc(r.provenance.locator)}</code></td></tr>`).join("")}</tbody></table>`;
}

function layerBox(open = true) {
  const row = (k, label, cls, checked) => `<label><input type="checkbox" data-l="${k}" ${checked ? "checked" : ""}><span class="sw ${cls}"></span>${esc(label)}</label>`;
  return `<details class="float layerbox" ${open ? "open" : ""}><summary>${icon.layers} Layers & base map</summary>
    ${row("parcels", "ULPIN parcels", "sw-parcel", true)}${row("risk", "Verification status", "sw-risk", true)}${row("ghost", "Recorded-area extent", "sw-ghost", true)}
    ${row("encumbrance", "Active encumbrance", "sw-enc", true)}${row("environment", "Environmental control", "sw-env", true)}${row("context", "Village cadastral plots", "sw-plot", true)}${row("ids", "Parcel identifiers", "sw-id", true)}
    <h3>Base map</h3><select class="select sm" id="bm"><option value="hybrid">Hybrid</option><option value="sat">Satellite</option><option value="map">Map</option><option value="terrain">Terrain</option></select>
    <div class="legend v"><span><i style="background:#b42318"></i>High severity</span><span><i style="background:#b86e00"></i>Medium</span><span><i style="background:#15803d"></i>Consistent / minor</span></div></details>`;
}
function bindLayerBox(scope, ctl) {
  scope.querySelectorAll("[data-l]").forEach(cb => cb.onchange = () => ctl.setLayer(cb.dataset.l, cb.checked));
  const bm = scope.querySelector("#bm"); bm.value = ctl.basemap; bm.onchange = () => ctl.setBasemap(bm.value);
}

// ------------------------------------------------------------------------------------------
// Validation, GIS, Reports, Interoperability, Audit (common Land Stack functions)
// ------------------------------------------------------------------------------------------
function validationView(root, rerender, o) {
  shell(root, o, "validation", loading());
  api.findings(o.state, o.jurisdiction.district).then(({ findings }) => {
    const scoped = findings.filter(f => (!o.jurisdiction.sub_district || f.sub_district === o.jurisdiction.sub_district) && (!o.jurisdiction.village || f.village === o.jurisdiction.village));
    const f = ui.vfilter;
    const rows = scoped.filter(x => (!f.sev || x.severity === f.sev) && (!f.group || inGroup(x.rule_id, f.group)));
    const counts = Object.keys(GROUPS).map(g => [g, scoped.filter(x => inGroup(x.rule_id, g)).length]).filter(([, n]) => n);
    root.querySelector("#om").innerHTML = `<div class="om-pad">
      <div class="page-title"><div><h1>Cross-source validation</h1><p>Findings from the Land Stack validation engine for parcels in your jurisdiction, with the source records and values compared.</p></div></div>
      <div class="group-chips"><button class="gchip ${!f.group ? "on" : ""}" data-g="">All <b>${scoped.length}</b></button>${counts.map(([g, n]) => `<button class="gchip ${f.group === g ? "on" : ""}" data-g="${g}">${esc(GROUPS[g])} <b>${n}</b></button>`).join("")}
        <select class="select sm" id="fsev"><option value="">All severities</option>${["high", "medium", "low", "info"].map(s => `<option ${f.sev === s ? "selected" : ""}>${s}</option>`).join("")}</select></div>
      <section class="panel"><table class="tbl"><thead><tr><th>Severity</th><th>Rule</th><th>ULPIN</th><th>Location</th><th>Finding</th><th>Sources compared</th><th>Status</th></tr></thead><tbody>
      ${rows.map(x => `<tr class="click" data-u="${x.ulpin}"><td>${sev(x.severity)}</td><td class="mono nowrap">${esc(x.rule_id)}</td><td class="mono nowrap">${fmtUlpin(x.ulpin)}</td>
        <td>${esc(x.village)}<small>${esc(x.sub_district)}, ${esc(x.district)}</small></td><td class="wide">${esc(x.message)}</td>
        <td>${[...new Set(x.observations.map(ob => ob.native_record_type))].map(s => `<span class="chip">${esc(s)}</span>`).join(" ")}</td>
        <td>${x.status === "explained" ? '<span class="badge info">explained</span>' : '<span class="badge warn">open</span>'}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No findings.</td></tr>`}</tbody></table></section></div>`;
    const om = root.querySelector("#om");
    om.querySelectorAll("[data-g]").forEach(b => b.onclick = () => { f.group = b.dataset.g; validationView(root, rerender, o); });
    om.querySelector("#fsev").onchange = (e) => { f.sev = e.target.value; validationView(root, rerender, o); };
    om.querySelectorAll("tr[data-u]").forEach(r => r.onclick = () => { ui.tab = "validation"; location.hash = `#/officer/parcel/${r.dataset.u}`; });
  }).catch(e => { root.querySelector("#om").innerHTML = errorBox(e); });
}

function gisView(root, rerender, o) {
  shell(root, o, "gis", `<div class="map" id="gmap"></div>${layerBox()}<aside class="float parcel-panel" id="gp"></aside>`, { fill: true });
  let ctl = null;
  api.parcels(o.state).then(fc => {
    const om = root.querySelector("#om");
    ctl = createMap(om.querySelector("#gmap"), { features: fc, mode: "officer", basemap: "hybrid", onSelect: (p) => {
      const gp = om.querySelector("#gp"); const d = p.record_area_ha ? (p.gis_area_ha - p.record_area_ha) / p.record_area_ha : 0;
      const inJ = (!o.jurisdiction.district || p.district === o.jurisdiction.district) && (!o.jurisdiction.sub_district || p.sub_district === o.jurisdiction.sub_district) && (!o.jurisdiction.village || p.village === o.jurisdiction.village);
      gp.innerHTML = `<div class="pp-head"><div class="row"><div><div class="eyebrow">ULPIN</div><div class="ulpin">${fmtUlpin(p.ulpin)}</div></div><button class="icon-btn" id="gx" aria-label="Close">${icon.close}</button></div>
        <div class="row-inline">${sev(p.risk_level === "none" ? "" : p.risk_level)}<span class="muted">${p.findings} findings · ${p.pending_mutations} pending mutation</span></div></div>
        <div class="pp-body"><dl class="kv"><dt>Parcel</dt><dd>${esc(p.native_label)}</dd><dt>Location</dt><dd>${esc(p.village)}<span class="sub">${esc(p.sub_district)} · ${esc(p.district)}</span></dd>
        <dt>Record / GIS</dt><dd>${fmtHa(p.record_area_ha)} / ${fmtHa(p.gis_area_ha)} <span class="${Math.abs(d) > 0.05 ? "badge warn" : "muted"}">${(d * 100).toFixed(1)}%</span></dd>
        <dt>Encumbrance</dt><dd>${p.active_encumbrance ? '<span class="badge bad">Active</span>' : "None active"}${p.litigation ? ' <span class="badge bad">Litigation</span>' : ""}</dd>
        <dt>Environment</dt><dd>${p.environmental_restriction ? '<span class="badge warn">Restriction</span>' : "—"}</dd></dl>
        ${inJ ? "" : `<div class="notice info">${icon.info}<span>Outside your jurisdiction — view only.</span></div>`}</div>
        <div class="pp-foot">${inJ ? `<a class="btn primary" href="#/officer/parcel/${p.ulpin}">Inspect parcel</a>` : ""}<a class="btn" href="#/parcel/${p.ulpin}" target="_blank" rel="noopener">Unified profile ↗</a></div>`;
      gp.classList.add("open"); gp.querySelector("#gx").onclick = () => gp.classList.remove("open");
    } });
    ["ghost", "encumbrance", "environment"].forEach(k => ctl.setLayer(k, true));
    bindLayerBox(om, ctl);
    api.hierarchy().then(h => {
      const s = h.states.find(x => x.code === o.state);
      let bb = s.bbox;
      if (o.jurisdiction.district) bb = s.districts.find(d => d.name === o.jurisdiction.district)?.bbox || bb;
      ctl.map.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]], { padding: [60, 60], maxZoom: 15, animate: false });
    });
  });
  return () => ctl?.destroy();
}

function reportsView(root, rerender, o) {
  shell(root, o, "reports", loading());
  api.officerReports().then(rep => {
    const S = STATES[o.state];
    const w = rep.work, sevC = { high: "#b42318", medium: "#b86e00", low: "#1d5fa8", info: "#94a3b8" };
    const cov = rep.coverage.filter(c => c.source_table !== "core.parcel_registry");
    const mutEnd = (rep.mutations.pending || 0);
    const trendMut = indicative(`${o.username}-disposed`, rep.mutations.finalized || 1, 12, 0.5);
    const trendPend = indicative(`${o.username}-pending`, mutEnd, 12, 1.5);
    const trendFind = indicative(`${o.username}-findings`, rep.parcels_with_findings, 12, 0.6);
    const jur = [S.name, o.jurisdiction.district, o.jurisdiction.sub_district].filter(Boolean).join(" › ");
    root.querySelector("#om").innerHTML = `<div class="om-pad">
      <div class="page-title"><div><h1>Reports & analytics</h1><p>${esc(jur)} · derived from the connected state records and validation results as of ${fmtDate(rep.as_of)}</p></div>
        <div class="title-side"><button class="btn sm" onclick="window.print()">Print report</button></div></div>
      <div class="kpis six">
        <div class="kpi"><b>${rep.parcels}</b><span>ULPIN parcels</span></div>
        <div class="kpi"><b>${w.mutation_pending}</b><span>${esc(S.mutation)} pending</span></div>
        <div class="kpi"><b>${w.mutation_completed}</b><span>Disposed / certified</span></div>
        <div class="kpi alert"><b>${w.verification_open}</b><span>Discrepancy cases open</span></div>
        <div class="kpi"><b>${rep.parcels_with_findings}</b><span>Parcels with findings</span></div>
        <div class="kpi"><b>${pct(rep.checks.pass || 0, (rep.checks.pass || 0) + (rep.checks.fail || 0))}%</b><span>Checks passing</span></div>
      </div>
      <div class="grid-2">
        <section class="panel"><header><h2>Work status</h2></header><div class="body">${stack([
          { label: `${S.mutation} pending`, value: w.mutation_pending, color: "#b86e00" }, { label: "Disposed / certified", value: w.mutation_completed, color: "#15803d" },
          { label: "Discrepancy open", value: w.verification_open, color: "#b42318" }, { label: "Discrepancy reviewed", value: w.verification_reviewed, color: "#1d5fa8" }])}</div></section>
        <section class="panel"><header><h2>Findings by severity</h2></header><div class="body">${bars(["high", "medium", "low", "info"].map(s => ({ label: title(s), value: rep.findings_by_severity[s] || 0, color: sevC[s] })))}</div></section>
        <section class="panel"><header><h2>Discrepancies by type</h2><span class="terms">parcels affected</span></header><div class="body">${bars(Object.entries(GROUPS).map(([k, l]) => ({ label: l, value: rep.parcels_by_discrepancy[k] || 0, color: "#0f766e" })).filter(x => x.value))}</div></section>
        <section class="panel"><header><h2>Record-linkage coverage</h2><span class="terms">share of ULPINs linked per source</span></header><div class="body">${bars(cov.map(c => ({ label: c.native_record_type, sub: c.source_table, value: pct(c.linked, c.parcels), color: "#1d5fa8" })), { max: 100, unit: "%" })}</div></section>
        <section class="panel"><header><h2>Mutation disposal trend</h2><span class="terms">Indicative trend</span></header><div class="body">${lines([{ name: "Disposed / certified", color: "#15803d", values: trendMut }, { name: "Pending at month end", color: "#b86e00", values: trendPend }], MONTHS)}</div></section>
        <section class="panel"><header><h2>Data-quality trend</h2><span class="terms">Indicative trend</span></header><div class="body">${lines([{ name: "Parcels with findings", color: "#b42318", values: trendFind }], MONTHS)}</div></section>
      </div>
      ${unitTable(o, rep)}
      <section class="panel" style="margin-top:16px"><header><h2>Rules triggered</h2></header><table class="tbl"><thead><tr><th>Rule</th><th class="num">Findings</th></tr></thead><tbody>
        ${Object.entries(rep.findings_by_rule).map(([k, n]) => `<tr><td class="mono">${esc(k)}</td><td class="num">${n}</td></tr>`).join("")}</tbody></table></section>
      <p class="fine">Current figures are computed from the connected records. Monthly trend charts are indicative and are not official statistics.</p></div>`;
  }).catch(e => { root.querySelector("#om").innerHTML = errorBox(e); });
}

function interopView(root, rerender, o) {
  shell(root, o, "interop", loading());
  Promise.all([api.health(), api.reports(o.state)]).then(([h, rep]) => {
    const st = h.states[o.state];
    const files = h.store.files.filter(f => f.path.startsWith({ MH: "maharashtra", UP: "uttar_pradesh", GJ: "gujarat" }[o.state]));
    root.querySelector("#om").innerHTML = `<div class="om-pad">
      <div class="page-title"><div><h1>Interoperability status</h1><p>State systems federated through the Land Stack canonical layer. Each system remains the system of record; Land Stack reads and links by ULPIN.</p></div>
        <div class="title-side"><span class="badge ok">API ${esc(h.api_version)} · operational</span></div></div>
      <div class="kpis"><div class="kpi"><b>${st.parcels}</b><span>ULPINs in ${esc(st.name)} registry</span></div><div class="kpi"><b>${st.native_tables.length}</b><span>Native source tables</span></div>
        <div class="kpi"><b>${esc(h.engine_version)}</b><span>Validation engine</span></div><div class="kpi"><b>${esc(h.glossary_version)}</b><span>Semantic glossary</span></div></div>
      <section class="panel"><header><h2>Connected source systems — ${esc(st.name)}</h2></header><table class="tbl"><thead><tr><th>Record type</th><th>Native table</th><th>Canonical concepts</th><th class="num">Linked ULPINs</th><th>Linkage</th></tr></thead><tbody>
        ${rep.coverage.map(c => `<tr><td><b>${esc(c.native_record_type)}</b></td><td><code>${esc(c.source_table)}</code></td><td>${esc(c.concepts.join(", "))}</td><td class="num">${c.linked} / ${c.parcels}</td><td><div class="mini-bar"><i style="width:${pct(c.linked, c.parcels)}%"></i></div></td></tr>`).join("")}</tbody></table></section>
      <section class="panel" style="margin-top:16px"><header><h2>Source snapshots</h2><span class="terms">read-only · fingerprinted at load</span></header><table class="tbl"><thead><tr><th>File</th><th>Tables</th><th class="num">Rows</th><th>SHA-256</th></tr></thead><tbody>
        ${files.map(f => `<tr><td><code>${esc(f.path)}</code></td><td>${esc(f.tables.join(", "))}</td><td class="num">${f.rows}</td><td><code class="loc">${esc(f.sha256.slice(0, 16))}…</code></td></tr>`).join("")}</tbody></table></section>
      <section class="panel" style="margin-top:16px"><header><h2>Common API</h2></header><div class="body"><p>Every state is exposed through the same versioned contracts: <code>/v1/registry/ulpin/{ulpin}</code>, <code>/v1/parcels/{ulpin}/profile</code>, <code>…/ownership</code>, <code>…/mutation</code>, <code>…/gis</code>, <code>…/verification</code>, <code>/v1/glossary/{concept}</code>. <a href="/docs" target="_blank" rel="noopener">OpenAPI documentation ↗</a></p></div></section>
    </div>`;
  }).catch(e => { root.querySelector("#om").innerHTML = errorBox(e); });
}

function auditTable(entries, compact = false) {
  if (!entries.length) return `<div class="empty">No entries yet in this session.</div>`;
  return `<table class="tbl"><thead><tr><th>#</th><th>Time (UTC)</th><th>Officer</th><th>Action</th>${compact ? "" : "<th>ULPIN</th>"}<th>Item</th><th>Remarks</th></tr></thead><tbody>
    ${entries.map(e => `<tr><td class="num">${e.seq}</td><td class="nowrap">${esc(e.at.replace("T", " ").replace("+00:00", ""))}</td><td>${esc(e.officer_name)}<small>${esc(e.designation)}</small></td>
      <td><b>${esc(e.action_label)}</b>${e.to ? `<small>→ ${esc(e.to)}</small>` : ""}</td>${compact ? "" : `<td class="mono nowrap">${e.ulpin ? `<a href="#/officer/parcel/${e.ulpin}">${fmtUlpin(e.ulpin)}</a>` : "—"}</td>`}
      <td class="mono">${esc(e.item_id || "—")}</td><td>${esc(e.remarks || "")}</td></tr>`).join("")}</tbody></table>`;
}
function auditView(root, rerender, o) {
  shell(root, o, "audit", loading());
  api.audit().then(r => {
    root.querySelector("#om").innerHTML = `<div class="om-pad"><div class="page-title"><div><h1>Audit log</h1><p>Sign-ins and workflow actions in ${esc(STATES[o.state].name)}. Entries are held by the Land Stack workflow service; source records are never modified.</p></div></div>
      <section class="panel">${auditTable(r.entries)}</section></div>`;
  }).catch(e => { root.querySelector("#om").innerHTML = errorBox(e); });
}
