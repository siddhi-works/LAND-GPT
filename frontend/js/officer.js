import { api, session, ApiError } from "./api.js";
import { bars, stack, lines, indicative, MONTHS } from "./charts.js";
import { createMap } from "./map.js";
import { findingHtml, flowHtml, parcelSvg, prov } from "./profile.js";
import { STATES, REGION, ACTION_LABEL, STATUS_LABEL, FORWARD_TO, queueOf } from "./states.js";
import { MARK, govIdentity, disclaimer, esc, fmtHa, fmtUlpin, fmtDate, icon, sev, loading, errorBox, title, toast, pct, SEV_RANK, riskStatus, bindLang, langSelect, siteFooter, skeleton } from "./ui.js";
import { t } from "./i18n.js";
import { mountStateMinis } from "./region.js";

const ui = { queue: "pending", tab: "work", vfilter: { sev: "", group: "" }, gisSel: null };
const statusBadge = (s) => { const [c, l] = STATUS_LABEL[s] || ["info", title(s)]; return `<span class="badge ${c}">${esc(l)}</span>`; };
const GROUPS = { ownership: "Ownership", registration_mutation_lag: "Registration ↔ mutation", area_gis: "Area / GIS", spatial: "Spatial",
  missing_links: "Missing linked records", encumbrance_litigation: "Encumbrance / litigation", planning_environment: "Planning / environment", identity: "Identifiers", data_quality: "Data quality" };
const GROUP_RULES = { ownership: ["OWN"], registration_mutation_lag: ["MUT-001", "MUT-002", "LNK-002"], area_gis: ["AREA", "GIS-001", "GIS-002"], spatial: ["GIS-003", "GIS-004", "GIS-005", "GIS-006"],
  missing_links: ["LNK-001", "COV-002", "ENC-004"], encumbrance_litigation: ["ENC-001", "ENC-002", "ENC-003", "LIT"], planning_environment: ["PLN", "ENV"], identity: ["ID-"], data_quality: ["COV-001", "DQ", "TAX-002", "MUT-003", "TAX-001", "VAL"] };
const inGroup = (rule, g) => (GROUP_RULES[g] || []).some(p => rule.startsWith(p));

// ------------------------------------------------------------------------------------------
// Officer Portal: state -> office/role (from /v1/officer/accounts) -> sign-in -> workspace.
// Sign-in is the BhuSamhita workflow service (/v1/officer/login). Each account carries its state, department,
// role and jurisdiction; the backend scopes work, reports and parcel access to that jurisdiction.
// The officer portal has no chat assistant.
// ------------------------------------------------------------------------------------------
function officerTop(o) {
  return `<div class="portal-header">${govIdentity()}</div><header class="site-header officer">
    <div class="bar">
      <a class="brand" href="${o ? "#/officer" : "#/officer/login"}"><span class="brand-mark">${MARK}</span>
        <span class="brand-text"><b>BhuSamhita · ${esc(t("officerPortal"))}</b><span>${o ? esc(`${STATES[o.state].system} · ${o.department}`) : "Revenue & land records departments"}</span></span></a>
      <span class="grow"></span>
      ${o ? `<form class="top-search" id="osearch" role="search">${icon.search}<input id="oq" placeholder="ULPIN / ${esc(o.state === "UP" ? "Gata" : o.state === "MH" ? "Gat / Survey" : "Survey")} no." autocomplete="off" aria-label="Search ULPIN"><div class="results" id="ores" hidden></div></form>
        <div class="who"><b>${esc(o.name)}</b><span>${esc(o.designation_native)} · ${esc(o.office)}</span></div>
        <a class="btn sm ghost-light" href="#/officer/logout">${icon.logout} Sign out</a>` : `<nav class="topnav"><a href="#/">${esc(t("home"))}</a><a href="#/map">${esc(t("landMap"))}</a></nav>${langSelect()}`}
    </div>
  </header>`;
}

// Parcels (or search hits) inside the officer's jurisdiction; state-level roles see the whole state.
const inJur = (o, x) => x.state_code === o.state && (!o.jurisdiction.district || x.district === o.jurisdiction.district)
  && (!o.jurisdiction.sub_district || x.sub_district === o.jurisdiction.sub_district) && (!o.jurisdiction.village || x.village === o.jurisdiction.village);
const jurLabel = (o) => [o.jurisdiction.village, o.jurisdiction.sub_district, o.jurisdiction.district, STATES[o.state].name].filter(Boolean)[0];

const levelOf = (a) => a.jurisdiction.village ? t("lvVillage") : a.jurisdiction.sub_district ? t(STATES[a.state].sub === "tehsil" ? "tehsil" : "taluka")
  : a.jurisdiction.district ? t("district") : t("lvState");
const jurOf = (a) => [STATES[a.state].name, a.jurisdiction.district, a.jurisdiction.sub_district, a.jurisdiction.village].filter(Boolean).join(" › ");
const REMEMBER = "ls-officer-id";
// Sign-in form is pre-filled with the selected officer's ID and the officers' shared password (officers.json).
const OFFICER_PW = "LandStack@2026";

export function renderOfficerLogin(root, rerender, { state, username } = {}) {
  const code = STATES[(state || "").toUpperCase()] ? state.toUpperCase() : "";
  root.innerHTML = `<div class="page officer-portal">${officerTop(null)}<main class="op-main" id="lm"><div class="wrap">${skeleton(4)}</div></main>${siteFooter()}${disclaimer()}</div>`;
  bindLang(root, rerender);
  let minis = () => {}, gone = false;
  api.accounts().then(({ accounts }) => {
    const main = root.querySelector("#lm");
    if (gone || !main) return;
    const signed = session.officer;
    const banner = signed ? `<div class="notice info op-signed">${icon.info}<span>${esc(t("opSignedIn"))} <b>${esc(signed.name)}</b> (${esc(signed.designation)}).</span>
      <a class="btn sm primary" href="#/officer">${esc(t("opGoWorkspace"))}</a><a class="btn sm" href="#/officer/logout">Sign out</a></div>` : "";
    const accs = accounts.filter((a) => a.state === code);
    const acct = accs.find((a) => a.username === username);

    if (!code) {                                            // A. state selection
      main.innerHTML = `<div class="wrap">${banner}
        <div class="op-head"><div><div class="eyebrow">${esc(t("brand"))}</div><h1>${esc(t("officerPortal"))}</h1><p>${esc(t("opIntro"))}</p></div></div>
        <form class="panel op-pick" id="op-pick"><div class="body">
          <div class="field"><label for="op-state">${esc(t("state"))}</label>
            <select class="select" id="op-state" required><option value="">— ${esc(t("select"))} —</option>${Object.entries(STATES).map(([c, s]) =>
              `<option value="${c}">${esc(s.name)} · ${esc(s.native)} — ${esc(s.system)}</option>`).join("")}</select></div>
          <button class="btn primary" type="submit">${esc(t("opContinue"))} ${icon.right}</button>
        </div></form>
</div>`;
      main.querySelector("#op-pick").onsubmit = (e) => { e.preventDefault(); const v = main.querySelector("#op-state").value; if (v) location.hash = `#/officer/login/${v}`; };
      return;
    }

    const S = STATES[code], R = REGION[code];
    const crumbs = (extra) => `<nav class="op-crumbs" aria-label="Breadcrumb"><a href="#/officer/login">${esc(t("officerPortal"))}</a><i>›</i>${extra ? `<a href="#/officer/login/${code}">${esc(S.name)}</a><i>›</i><span>${esc(extra)}</span>` : `<span>${esc(S.name)}</span>`}</nav>`;

    if (!acct) {                                            // B. role / office selection
      main.innerHTML = `<div class="wrap op-state-page" style="--accent:${R.accent}">${banner}${crumbs()}
        <div class="op-head accent"><div><div class="eyebrow">${esc(S.system)}</div>
          <h1><span lang="${R.lang}">${esc(R.officerTitle)}</span><small>${esc(t("opAccessFor").replace("{state}", S.name))}</small></h1>
          <p>${esc(S.department)}</p></div></div>
        <div class="op-role-layout single">
          <div><h2 class="sec-h">${esc(t("opChooseRole"))}</h2>
            <div class="op-roles">${accs.map((a) => `<a class="op-role" href="#/officer/login/${code}/${encodeURIComponent(a.username)}">
              <span class="op-role-ic">${icon.user}</span>
              <span class="op-role-t"><b>${esc(a.designation)}</b><span lang="${R.lang}">${esc(a.designation_native)}</span></span>
              <span class="op-role-cat">${esc(a.login_category)}</span>
              <span class="op-role-meta"><span>${icon.building}${esc(a.office)}</span><span>${icon.pin}${esc(jurOf(a))}</span></span>
              <span class="op-level">${esc(levelOf(a))}</span>
              <span class="op-go">${esc(t("opContinue"))} ${icon.right}</span></a>`).join("")}</div></div>
        </div></div>`;
      return;
    }

    // C. sign-in
    let remembered = null; try { remembered = localStorage.getItem(REMEMBER); } catch {}
    main.innerHTML = `<div class="wrap op-state-page" style="--accent:${R.accent}">${banner}${crumbs(acct.designation)}
      <div class="op-signin">
        <section class="op-who">
          <div class="eyebrow">${esc(t("opSignInTitle"))}</div>
          <h1>${esc(acct.designation)} <span lang="${R.lang}">${esc(acct.designation_native)}</span></h1>
          <dl class="kv">
            <dt>${esc(t("state"))}</dt><dd>${esc(S.name)} · <span lang="${R.lang}">${esc(S.native)}</span></dd>
            <dt>${esc(t("opOffice"))}</dt><dd>${esc(acct.office)}</dd>
            <dt>${esc(t("opCategory"))}</dt><dd>${esc(acct.login_category)}</dd>
            <dt>${esc(t("opJurisdiction"))}</dt><dd>${esc(jurOf(acct))}</dd>
            <dt>${esc(t("opSystem"))}</dt><dd>${esc(S.system)}</dd>
          </dl>
          <div class="op-back"><a href="#/officer/login/${code}">${icon.chevron}${esc(t("opBackRoles"))}</a><a href="#/officer/login">${icon.chevron}${esc(t("opBackStates"))}</a></div>
        </section>
        <form class="login-card op-form" id="lf" novalidate>
          <div class="op-form-h">${icon.lock}<div><b>${esc(t("opSignInTitle"))}</b><small>${esc(S.name)} · ${esc(acct.login_category)}</small></div></div>
          <div class="field"><label for="uid">${esc(t("opOfficerId"))}</label><input class="input" id="uid" autocomplete="username" value="${esc(acct.username)}" aria-describedby="uid-err"><small class="f-err" id="uid-err"></small></div>
          <div class="field"><label for="pw">${esc(t("opPassword"))}</label>
            <div class="pw-wrap"><input class="input" id="pw" type="password" autocomplete="off" data-lpignore="true" aria-describedby="pw-err" value="${esc(OFFICER_PW)}">
              <button type="button" class="icon-btn" id="pw-show" aria-label="${esc(t("opShowPw"))}" title="${esc(t("opShowPw"))}">${icon.eye}</button></div>
            <small class="f-err" id="pw-err"></small></div>
          <label class="op-remember"><input type="checkbox" id="rem" ${remembered === acct.username ? "checked" : ""}> ${esc(t("opRemember"))}</label>
          <button class="btn primary lg" type="submit" id="lbtn">${esc(t("opSignIn"))}</button>
          <div id="lerr" aria-live="polite"></div>
        </form>
      </div></div>`;
    const f = main.querySelector("#lf"), uid = f.querySelector("#uid"), pw = f.querySelector("#pw"), btn = f.querySelector("#lbtn");
    f.querySelector("#pw-show").onclick = () => { pw.type = pw.type === "password" ? "text" : "password"; };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const errs = { uid: uid.value.trim() ? "" : t("opErrId"), pw: pw.value ? "" : t("opErrPw") };
      f.querySelector("#uid-err").textContent = errs.uid; f.querySelector("#pw-err").textContent = errs.pw;
      uid.classList.toggle("bad", !!errs.uid); pw.classList.toggle("bad", !!errs.pw);
      if (errs.uid || errs.pw) return;
      btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${esc(t("opSigningIn"))}`; f.querySelector("#lerr").innerHTML = "";
      try {
        const r = await api.login(uid.value.trim(), pw.value);
        const remember = f.querySelector("#rem").checked;
        try { remember ? localStorage.setItem(REMEMBER, uid.value.trim()) : localStorage.removeItem(REMEMBER); } catch {}
        session.set(r.token, r.officer, remember);
        btn.innerHTML = `${icon.check} ${esc(t("opSignedOk"))}`; btn.classList.add("ok");
        toast(`${t("opSignedOk")} · ${r.officer.name}`, "ok");
        let next = null; try { next = sessionStorage.getItem("ls-after-login"); sessionStorage.removeItem("ls-after-login"); } catch {}
        setTimeout(() => { if (!gone) location.hash = next && next.startsWith("#/officer/") && !next.includes("login") ? next : "#/officer"; }, 500);
      } catch (err) {
        btn.disabled = false; btn.textContent = t("opSignIn");
        f.querySelector("#lerr").innerHTML = errorBox({ message: err.status === 401 ? t("opErrAuth") : err.message || t("dataUnavailable") });
      }
    };
    btn.focus();
  }).catch((e) => { const m = root.querySelector("#lm"); if (m && !gone) m.innerHTML = `<div class="wrap">${errorBox(e)}</div>`; });
  return () => { gone = true; minis(); };
}

// ------------------------------------------------------------------------------------------
// Shell + routing
// ------------------------------------------------------------------------------------------
function navFor(o) {
  const S = STATES[o.state];
  const hasWork = o.actions.mutation.length || o.actions.verification.length;
  const home = { MH: "Ferfar register", UP: o.level === "state" ? "Board MIS" : o.level === "district" ? "District dashboard" : "Namantaran cases", GJ: "VF 6 entries" }[o.state];
  return [
    ["Work", [["home", "#/officer", icon.register, home], ["validation", "#/officer/validation", icon.shield, hasWork ? "Discrepancy review" : "Record checks"]]],
    ["Records & reports", [["gis", "#/officer/gis", icon.map, o.state === "UP" ? "BhuNaksha map" : "Parcel map"], ["reports", "#/officer/reports", icon.chart, o.state === "UP" ? "Reports (रिपोर्ट)" : o.state === "MH" ? "Reports (अहवाल)" : "Reports (અહેવાલ)"]]],
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
      const hits = r.results.filter((x) => inJur(o, x));
      res.hidden = false;
      res.innerHTML = hits.length ? hits.map(x => `<button type="button" data-u="${x.ulpin}"><b class="mono">${fmtUlpin(x.ulpin)}</b><span>${esc(x.native_label)} · ${esc(x.village)}, ${esc(x.district)}</span></button>`).join("") : `<div class="empty">No parcel in ${esc(jurLabel(o))}</div>`;
      res.querySelectorAll("[data-u]").forEach(b => b.onclick = () => { res.hidden = true; inp.value = ""; location.hash = `#/officer/parcel/${b.dataset.u}`; });
    }, 200);
  };
  root.querySelector("#osearch").onsubmit = (e) => { e.preventDefault(); res.querySelector("[data-u]")?.click(); };
}

export function renderOfficer(root, rerender, { view = "home", ulpin } = {}) {
  if (view === "logout") { api.logout().catch(() => {}); session.clear(); location.hash = "#/"; return; }
  if (!session.token) {                       // remember where the officer was going; the sign-in returns there
    try { sessionStorage.setItem("ls-after-login", location.hash); } catch {}
    location.hash = "#/"; return;
  }
  let cleanup = null;
  api.me().then((o) => {
    const views = { home: homeView, validation: validationView, gis: gisView, reports: reportsView, parcel: parcelView };
    cleanup = (views[view] || homeView)(root, rerender, o, ulpin);
  }).catch((e) => {
    if (e instanceof ApiError && e.status === 401) { session.clear(); location.hash = "#/"; return; }
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

// Workspace header: profile, KPIs, parcel search, quick actions, notifications, recent activity.
// Every number comes from /officer/work, /officer/reports and /officer/audit for this officer's jurisdiction.

// Recent activity: the officer's own recorded actions plus sample desk activity typical of the role
// (sign-in / sign-out entries are left out). Sample rows reuse real work items for their references.
const ROLE_ACTIVITY = {
  "mh.talathi.umbraj": [["Ferfar entry recorded", (x) => `${x.reference} · ${x.native_label}, ${x.village}`], ["Notice served to interested parties", (x) => `${x.reference} · objection period started`],
    ["7/12 extract issued", (x) => `${x.native_label}, ${x.village}`], ["Crop inspection (ई-पीक पाहणी) entry updated", (x) => `${x.native_label}, ${x.village}`], ["Objection entered in disputed-case register", (x) => x.reference]],
  "mh.mandal.nagpur": [["Ferfar certified", (x) => `${x.reference} · ${x.village}`], ["Hearing scheduled on objection", (x) => `${x.reference} · next week`],
    ["Returned Ferfar to Talathi for correction", (x) => x.reference], ["Circle field inspection", (x) => `${x.native_label}, ${x.village}`]],
  "mh.sc.dlr": [["District-wise Ferfar pendency reviewed", () => "Maharashtra · all districts"], ["Map–record area mismatch sent for re-survey", (x) => `${x.native_label}, ${x.village}, ${x.district}`],
    ["Discrepancy case forwarded to Collector", (x) => `${x.district} · ${x.reference}`], ["Monthly land-records progress report signed", () => "State report"]],
  "up.tehsil.behat": [["Namantaran order passed (धारा 34)", (x) => `${x.reference} · ${x.village}`], ["Lekhpal report called", (x) => `${x.reference} · ${x.native_label}`],
    ["Hearing date fixed", (x) => `${x.reference} · RCCMS`], ["Khatauni updated after disposal", (x) => `${x.native_label}, ${x.village}`]],
  "up.district.lucknow": [["Tehsil-wise Namantaran pendency reviewed", () => "District Lucknow"], ["Discrepancy returned to Tehsil for report", (x) => `${x.sub_district} · ${x.reference}`],
    ["Revenue court case list reviewed", () => "ADM (F/R) court"], ["Field verification ordered", (x) => `${x.native_label}, ${x.village}`]],
  "up.board": [["State MIS report generated", () => "All districts · Namantaran & record verification"], ["District performance review", (x) => `${x.district}`],
    ["Circular issued on pending Namantaran", () => "All Tehsildars"], ["High-severity discrepancies reviewed", (x) => `${x.district} · ${x.reference}`]],
  "gj.edhara.bhuj": [["VF 6 entry verified (biometric)", (x) => `${x.reference} · ${x.village}`], ["135-D notice generated", (x) => `${x.reference}`],
    ["S-form approved", (x) => `${x.reference} · ${x.native_label}`], ["e-Dhara counter application received", (x) => `${x.native_label}, ${x.village}`]],
  "gj.talati.vavdi": [["135-D notice served", (x) => `${x.reference} · ${x.village}`], ["Acknowledgement recorded", (x) => x.reference],
    ["VF 7/12 copy issued", (x) => `${x.native_label}, ${x.village}`], ["Village register (VF 6) updated", (x) => x.reference]],
  "gj.mamlatdar.choryasi": [["VF 6 entry certified", (x) => `${x.reference} · ${x.village}`], ["Entry rejected – objection upheld", (x) => x.reference],
    ["RTS appeal heard", (x) => `${x.native_label}, ${x.village}`], ["Discrepancy reviewed with Circle Officer", (x) => x.reference]],
  "gj.revenue.state": [["State e-Dhara pendency report reviewed", () => "Gujarat · all talukas"], ["iORA application backlog reviewed", (x) => x.district],
    ["Discrepancy escalated to Collector", (x) => `${x.district} · ${x.reference}`], ["Jantri rate query answered", () => "Revenue Department"]],
};
function activityRows(o, items, audit) {
  const own = audit.filter((e) => !/^log(in|out)$/i.test(e.action || "") && !/^(login|logout)$/i.test(e.action_label || ""))
    .map((e) => ({ label: e.action_label + (e.to ? ` → ${e.to}` : ""), sub: `${e.officer_name} · ${e.at.replace("T", " ").slice(0, 16)}`, u: e.ulpin }));
  const tpl = ROLE_ACTIVITY[o.username] || [];
  const muts = items.filter((x) => x.type === "mutation");
  const refs = muts.length ? muts : items.length ? items.map((x) => ({ ...x, reference: x.native_label })) : [{ reference: "—", native_label: "—", village: "—", district: o.jurisdiction.district || "", sub_district: "" }];
  const now = Date.now();
  const sample = tpl.map(([label, sub], i) => {
    const x = refs[(i * 3) % refs.length];
    const at = new Date(now - (i + 1) * (3 + i) * 3600e3).toISOString().replace("T", " ").slice(0, 16);
    return { label, sub: `${sub(x)} · ${at}`, u: x.ulpin };
  });
  return [...own.reverse(), ...sample].slice(0, 6);
}

function workspaceHtml(o, items, rep, audit, attention) {
  const S = STATES[o.state], R = REGION[o.state];
  const initials = o.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const checks = (rep.checks.pass || 0) + (rep.checks.fail || 0);
  const kpi = (n, label, act, cls = "", ic = "") => `<button class="ws-kpi ${cls}" data-ws="${act}">${ic ? `<span class="kpi-ic">${icon[ic]}</span>` : ""}<b>${n}</b><span>${esc(label)}</span></button>`;
  const notes = [
    ...items.filter((x) => x.type === "mutation" && x.days_pending > 30 && !["completed", "certified", "rejected"].includes(x.status))
      .map((x) => ({ u: x.ulpin, cls: "warn", ic: "swap", t: `${x.reference} — ${t("wsPendingDays").replace("{n}", x.days_pending)}`, s: `${x.native_label} · ${x.village}` })),
    ...items.filter((x) => x.type === "verification" && SEV_RANK[x.severity] >= 4 && x.status === "pending")
      .map((x) => ({ u: x.ulpin, cls: "bad", ic: "alert", t: `${t("wsHighFinding")}: ${x.reference}`, s: `${x.title} · ${x.village}` })),
    ...items.filter((x) => x.status === "returned").map((x) => ({ u: x.ulpin, cls: "", ic: "back", t: `${t("wsReturned")}: ${x.reference}`, s: x.village })),
  ].slice(0, 6);
  const quick = [
    ["map", o.state === "UP" ? "BhuNaksha map" : "Parcel map", "#/officer/gis"], ["shield", o.actions.mutation.length || o.actions.verification.length ? "Discrepancy review" : "Record checks", "#/officer/validation"],
    ["chart", "Reports", "#/officer/reports"],
  ];
  return `<section class="ws-head" style="--accent:${R.accent}">
      <div class="ws-profile"><span class="ws-avatar">${esc(initials)}</span><div><b>${esc(o.name)}</b><span>${esc(o.designation)} · <span lang="${R.lang}">${esc(o.designation_native)}</span></span><small>${esc(o.office)} · ${esc(o.department)}</small></div></div>
      <div class="ws-jur"><span class="eyebrow">Jurisdiction</span><b>${esc([S.name, o.jurisdiction.district, o.jurisdiction.sub_district, o.jurisdiction.village].filter(Boolean).join(" › "))}</b><small>${esc(o.login_category)} · ${esc(S.system)}</small></div>
      <div class="ws-state"><span class="badge ok">Signed in</span></div>
    </section>
    <div class="ws-kpis">
      ${kpi(rep.parcels, t("wsParcels"), "h:#/officer/gis", "", "area")}
      ${kpi(attention[0][0], attention[0][1], "s:ws-work", "warn", "swap")}
      ${kpi(attention[1][0], attention[1][1], "s:ws-work", "", "check")}
      ${kpi(attention[2][0], attention[2][1], "h:#/officer/validation", "", "shield")}
      ${kpi(attention[3][0], attention[3][1], "v:high", attention[3][0] ? "bad" : "", "alert")}
      ${kpi(`${pct(rep.checks.pass || 0, checks)}%`, t("dbChecksPass"), "h:#/officer/reports", "ok", "chart")}
    </div>
    <div class="ws-grid">
      <section class="panel ws-search"><header><h2>${icon.search} ${esc(t("wsSearch"))}</h2><span class="terms">${esc(S.name)}</span></header>
        <div class="body"><div class="disc-input">${icon.search}<input id="ws-q" type="search" autocomplete="off" placeholder="ULPIN / ${esc(o.state === "UP" ? "Khasra / Gata" : o.state === "MH" ? "Gat / Survey / CTS" : "Survey")} no. / village" aria-label="${esc(t("wsSearch"))}"><div class="results" id="ws-res" hidden></div></div>
        <p class="fine">ULPIN, parcel number or village in ${esc(jurLabel(o))}; opens the parcel inspection.</p></div></section>
      <section class="panel ws-actions"><header><h2>${icon.grid} ${esc(t("quickActions"))}</h2></header>
        <div class="body ws-quick">${quick.map(([ic, l, h]) => `<a class="ws-q" href="${h}">${icon[ic]}<span>${esc(l)}</span></a>`).join("")}</div></section>
      <section class="panel ws-notes"><header><h2>${icon.bell} ${esc(t("wsNotifications"))} <span class="count">${notes.length}</span></h2><span class="terms">${esc(t("wsNotificationsD"))}</span></header>
        <div class="body">${notes.length ? `<ul class="ws-list">${notes.map((n) => `<li><a href="#/officer/parcel/${n.u}" class="${n.cls}">${icon[n.ic]}<span><b>${esc(n.t)}</b><small>${esc(n.s)}</small></span></a></li>`).join("")}</ul>`
          : `<div class="empty-state">${icon.check}<b>${esc(t("wsNoNotifications"))}</b></div>`}</div></section>
      <section class="panel ws-activity"><header><h2>${icon.audit} ${esc(t("wsActivity"))}</h2></header>
        <div class="body">${(() => { const rows = activityRows(o, items, audit); return rows.length ? `<ul class="ws-list">${rows.map((e) => `<li><div class="ws-act"><span class="ws-dot"></span><span><b>${esc(e.label)}</b>
          <small>${esc(e.sub)}${e.u ? ` · <a href="#/officer/parcel/${e.u}">${fmtUlpin(e.u)}</a>` : ""}</small></span></div></li>`).join("")}</ul>`
          : `<div class="empty-state">${icon.info}<b>${esc(t("wsNoActivity"))}</b></div>`; })()}</div></section>
    </div>`;
}

function bindWorkspace(main, o, rerender, root) {
  main.querySelectorAll("[data-ws]").forEach((b) => b.onclick = () => {
    const [k, v] = [b.dataset.ws.slice(0, 1), b.dataset.ws.slice(2)];
    if (k === "h") location.hash = v;
    if (k === "s") main.querySelector("#" + v)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (k === "v") { ui.vfilter = { sev: v, group: "" }; location.hash = "#/officer/validation"; }
  });
  const q = main.querySelector("#ws-q"), res = main.querySelector("#ws-res");
  let tm;
  q.oninput = () => {
    clearTimeout(tm);
    if (!q.value.trim()) { res.hidden = true; return; }
    tm = setTimeout(async () => {
      const r = await api.search(q.value, o.state).catch(() => ({ results: [] }));
      const hits = r.results.filter((x) => inJur(o, x));
      res.hidden = false;
      res.innerHTML = hits.length ? hits.map((x) => `<button type="button" data-u="${x.ulpin}"><span class="r-main"><b>${esc(x.native_label)}</b><span class="mono">${fmtUlpin(x.ulpin)}</span></span><small>${esc(x.village)}, ${esc(x.sub_district)}, ${esc(x.district)}</small></button>`).join("")
        : `<div class="empty">No parcel in ${esc(jurLabel(o))}</div>`;
      res.querySelectorAll("[data-u]").forEach((b) => b.onclick = () => { location.hash = `#/officer/parcel/${b.dataset.u}`; });
    }, 200);
  };
  q.onkeydown = (e) => { if (e.key === "Enter") res.querySelector("[data-u]")?.click(); if (e.key === "Escape") res.hidden = true; };
}

function homeView(root, rerender, o) {
  shell(root, o, "home", `<div class="om-pad">${skeleton(3)}${skeleton(6)}</div>`);
  Promise.all([api.work(), api.officerReports(), api.audit().catch(() => ({ entries: [] }))]).then(([{ items }, rep, aud]) => {
    const main = root.querySelector("#om");
    if (!main) return;
    const muts = items.filter(x => x.type === "mutation"), vers = items.filter(x => x.type === "verification");
    const S = STATES[o.state];
    const count = (q) => muts.filter(x => queueOf(x) === q).length;
    const attention = [
      [count("pending") + count("ready"), `${S.mutation} pending`],
      [count("ready"), o.state === "UP" ? "Awaiting Tehsildar order" : "Ready for certification"],
      [vers.filter(v => ["pending", "returned"].includes(v.status)).length, "Discrepancies to review"],
      [vers.filter(v => SEV_RANK[v.severity] >= 4 && v.status === "pending").length, "High-severity"],
    ];
    const heading = { MH: ["फेरफार नोंदवही · Ferfar register", `Mutation entries under ${o.process.statute} in your jurisdiction. The Talathi records entries and serves notice; the Mandal Adhikari certifies after the objection period.`],
      UP: [o.level === "tehsil" ? "नामान्तरण वाद · Namantaran cases" : o.level === "district" ? "District administrative dashboard" : "Board of Revenue — MIS", o.level === "tehsil" ? `Tehsil Mutation Login — applications under ${o.process.statute}. Lekhpal / Revenue Inspector report, then Tehsildar order; Khatauni is updated on disposal.` : "Tehsil-wise status of mutation and record verification across your jurisdiction."],
      GJ: ["ઈ-ધરા · e-Dhara VF 6 processing", `Mutation entries in the VF 6 register. The e-Dhara Dy. Mamlatdar verifies and generates the 135-D notice, the Talati serves it (30 days), the competent authority certifies and approves the S-form.`] }[o.state];

    let workHtml;
    if (o.state === "GJ") workHtml = gjPipeline(o, muts);
    else if (o.state === "UP" && o.level !== "tehsil") workHtml = `<div id="unitrep">${loading()}</div>`;
    else workHtml = queueTable(o, muts);

    main.innerHTML = `<div class="om-pad">
      ${workspaceHtml(o, items, rep, aud.entries, attention)}
      <div class="page-title" id="ws-work"><div><h1>${esc(heading[0])}</h1><p>${esc(heading[1])}</p></div><div class="title-side"><span class="muted">As of ${fmtDate(rep.as_of)}</span></div></div>
      ${workHtml}
      <section class="panel" style="margin-top:16px"><header><h2>Record discrepancies to review</h2><span class="terms">Where connected records disagree</span></header>
        ${vers.length ? `<table class="tbl"><thead><tr><th>ULPIN</th><th>Parcel</th><th>Location</th><th>Primary finding</th><th>Severity</th><th class="num">Findings</th><th>Status</th><th></th></tr></thead><tbody>${vers.map(v => `<tr class="click" data-u="${v.ulpin}">
          <td class="mono nowrap">${fmtUlpin(v.ulpin)}</td><td>${esc(v.native_label)}</td><td>${esc(v.village)}<small>${esc(v.sub_district)}, ${esc(v.district)}</small></td>
          <td><b>${esc(v.reference)}</b> ${esc(v.title)}</td><td>${sev(v.severity)}</td><td class="num">${v.finding_count}</td><td>${statusBadge(v.status)}</td><td>${icon.right}</td></tr>`).join("")}</tbody></table>`
          : `<div class="body empty">No material discrepancies in your jurisdiction.</div>`}
      </section></div>`;
    main.querySelectorAll("tr[data-u], .pcard[data-u]").forEach(r => r.onclick = () => { location.hash = `#/officer/parcel/${r.dataset.u}`; });
    main.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { ui.queue = b.dataset.q; ui.queueChosen = true; homeView(root, rerender, o); });
    bindWorkspace(main, o, rerender, root);
    if (o.state === "UP" && o.level !== "tehsil") main.querySelector("#unitrep").innerHTML = unitTable(o, rep);
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
    if (ui.tab === "assistant") ui.tab = "work";
    const tabs = [["work", `Action (${op.work_items.length})`], ["validation", `Checks (${ver.findings.length})`], ["records", "Records"]];
    if (ui.tab === "audit") ui.tab = "work";
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
      if (ui.tab === "validation") body.innerHTML = `<p class="fine">Checks compare this parcel's connected records. Each finding lists the records and values compared.</p>${ver.findings.map(f => findingHtml(f, { detailed: SEV_RANK[f.severity] >= 3 })).join("") || `<div class="notice ok">${icon.check}<span>All checks passed.</span></div>`}
        <details class="checks"><summary>All ${ver.checks.length} checks</summary><table class="tbl"><tbody>${ver.checks.map(c => `<tr><td class="mono">${esc(c.rule_id)}</td><td>${esc(title(c.rule_name))}</td><td><span class="badge ${c.outcome === "pass" ? "ok" : c.outcome === "fail" ? "bad" : "plain"}">${esc(c.outcome.replace("_", " "))}</span></td><td class="muted">${esc(c.detail)}</td></tr>`).join("")}</tbody></table></details>`;
      if (ui.tab === "records") body.innerHTML = `${flowHtml(reg, ring, ac.computed_gis_area?.value_ha)}${recordsTable(b)}`;
      if (ui.tab === "audit") { body.innerHTML = loading(); api.audit(ulpin).then(r => { body.innerHTML = auditTable(r.entries, true); }); }
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

    const scoped = { ...fc, features: fc.features.filter((f) => f.properties.ulpin === ulpin || inJur(o, f.properties)) };
    ctl = createMap(main.querySelector("#imap"), { features: scoped, mode: "officer", basemap: "hybrid", onSelect: (p) => { if (p.ulpin !== ulpin) location.hash = `#/officer/parcel/${p.ulpin}`; } });
    ctl.select(ulpin);
    ctl.setLayer("ghost", true); ctl.setLayer("encumbrance", true); ctl.setLayer("environment", true);
    ctl.map.fitBounds(L.polygon(ring.map(([x, y]) => [y, x])).getBounds().pad(1.2), { animate: false });
    bindLayerBox(main, ctl);
  }).catch(e => {
    const msg = e.code === "OUT_OF_JURISDICTION" ? `${e.message}. This parcel is outside ${jurLabel(o)}.` : e.message;
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
      <div class="page-title"><div><h1>Record checks</h1><p>Where the connected records of parcels in ${esc(jurLabel(o))} disagree, with the records and values compared.</p></div></div>
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
  api.parcels(o.state).then(all => {
    const om = root.querySelector("#om");
    const fc = { ...all, features: all.features.filter((f) => inJur(o, f.properties)) };
    ctl = createMap(om.querySelector("#gmap"), { features: fc, mode: "officer", basemap: "hybrid", onSelect: (p) => {
      const gp = om.querySelector("#gp"); const d = p.record_area_ha ? (p.gis_area_ha - p.record_area_ha) / p.record_area_ha : 0;
      const inJ = inJur(o, p);
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
      const d = o.jurisdiction.district && s.districts.find(x => x.name === o.jurisdiction.district);
      const sd = o.jurisdiction.sub_district && d?.sub_districts.find(x => x.name === o.jurisdiction.sub_district);
      const v = o.jurisdiction.village && sd?.villages.find(x => x.name === o.jurisdiction.village);
      const bb = (v || sd || d || s).bbox;
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
      <div class="page-title"><div><h1>Connected systems</h1><p>State systems linked to BhuSamhita by ULPIN. Each system remains the system of record; BhuSamhita only reads and links it.</p></div>
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
    root.querySelector("#om").innerHTML = `<div class="om-pad"><div class="page-title"><div><h1>Audit log</h1><p>Sign-ins and workflow actions in ${esc(STATES[o.state].name)}. Entries are kept in the BhuSamhita work register; source records are never modified.</p></div></div>
      <section class="panel">${auditTable(r.entries)}</section></div>`;
  }).catch(e => { root.querySelector("#om").innerHTML = errorBox(e); });
}

// ------------------------------------------------------------------------------------------
// Employee services: a small, secondary area. Profile and service details come from the signed-in
// account; leave, tour and reimbursement forms keep drafts on this device only (no HR system is connected).
// ------------------------------------------------------------------------------------------
const EMP_TABS = [["profile", "Profile"], ["leave", "Leave"], ["tour", "Tour"], ["service", "Service record"], ["training", "Training"], ["claims", "Reimbursements"]];
const EMP_FORMS = {
  leave: [["type", "Leave type", ["Casual leave", "Earned leave", "Half pay leave", "Commuted leave", "Special casual leave"]], ["from", "From", "date"], ["to", "To", "date"], ["reason", "Reason", "text"]],
  tour: [["from", "From", "date"], ["to", "To", "date"], ["places", "Places / villages", "text"], ["purpose", "Purpose", ["Field inspection", "Mutation hearing", "Crop inspection", "Boundary / survey verification", "Office meeting"]]],
  claims: [["type", "Claim type", ["Travelling allowance", "Daily allowance", "Medical reimbursement", "Other"]], ["date", "Date", "date"], ["amount", "Amount (₹)", "number"], ["details", "Details", "text"]],
};
const draftKey = (o, kind) => `ls-emp-${o.username}-${kind}`;
const readDrafts = (o, kind) => { try { return JSON.parse(localStorage.getItem(draftKey(o, kind))) || []; } catch { return []; } };
const writeDrafts = (o, kind, rows) => { try { localStorage.setItem(draftKey(o, kind), JSON.stringify(rows)); } catch {} };

function employeeView(root, rerender, o) {
  const tab = EMP_TABS.some(([k]) => k === ui.emp) ? ui.emp : "profile";
  const S = STATES[o.state], R = REGION[o.state];
  const jur = [S.name, o.jurisdiction.district, o.jurisdiction.sub_district, o.jurisdiction.village].filter(Boolean).join(" › ");
  const kv = (rows) => `<dl class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const hrNote = `<p class="fine">Applications are processed through your department's establishment section. Drafts saved here stay on this device.</p>`;
  const form = (kind) => {
    const drafts = readDrafts(o, kind);
    const field = ([k, label, type]) => `<div class="field"><label for="ef-${k}">${esc(label)}</label>${Array.isArray(type)
      ? `<select class="select" id="ef-${k}" name="${k}">${type.map((x) => `<option>${esc(x)}</option>`).join("")}</select>`
      : `<input class="input" id="ef-${k}" name="${k}" type="${type}" ${type === "number" ? 'min="0" step="1"' : ""}>`}</div>`;
    return `<form class="emp-form" id="ef" novalidate><div class="emp-grid">${EMP_FORMS[kind].map(field).join("")}</div>
        <div class="actions"><button class="btn primary" type="submit">${icon.check} Save draft</button></div></form>${hrNote}
      <h3 class="sec-title">Saved drafts <span class="count">${drafts.length}</span></h3>
      ${drafts.length ? `<table class="tbl"><thead><tr>${EMP_FORMS[kind].map(([, label]) => `<th>${esc(label)}</th>`).join("")}<th>Saved</th><th></th></tr></thead><tbody>
        ${drafts.map((d, i) => `<tr>${EMP_FORMS[kind].map(([k]) => `<td>${esc(d[k] || "—")}</td>`).join("")}<td class="nowrap">${esc(fmtDate(d.saved))}</td>
          <td><button class="btn sm ghost" data-del="${i}">Remove</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty-state">${icon.info}<b>No drafts yet</b></div>`}`;
  };
  const body = {
    profile: kv([["Name", esc(o.name)], ["Designation", `${esc(o.designation)} · <span lang="${R.lang}">${esc(o.designation_native)}</span>`],
      ["Officer ID", `<span class="mono">${esc(o.username)}</span>`], ["Office", esc(o.office)], ["Department", esc(o.department)],
      ["Login category", esc(o.login_category)], ["Jurisdiction", esc(jur)], ["State system", esc(S.system)]]),
    leave: form("leave"), tour: form("tour"), claims: form("claims"),
    service: `${kv([["Present post", esc(o.designation)], ["Office", esc(o.office)], ["Department", esc(o.department)], ["Jurisdiction", esc(jur)]])}
      <div class="empty-state">${icon.register}<b>Service book entries are maintained by the establishment section</b><span>Postings, increments and confirmations are not shown here.</span></div>`,
    training: `<div class="empty-state">${icon.audit}<b>No training nominations</b><span>Nominations from the state training institute appear here once issued.</span></div>`,
  }[tab];
  shell(root, o, "employee", `<div class="om-pad">
    <div class="page-title"><div><h1>Employee services</h1><p>${esc(o.name)} · ${esc(o.designation)} · ${esc(o.office)}</p></div></div>
    <section class="panel emp"><div class="tabs" role="tablist">${EMP_TABS.map(([k, l]) => `<button role="tab" data-emp="${k}" class="${k === tab ? "on" : ""}">${esc(l)}</button>`).join("")}</div>
      <div class="body">${body}</div></section></div>`);
  const om = root.querySelector("#om");
  om.querySelectorAll("[data-emp]").forEach((b) => b.onclick = () => { ui.emp = b.dataset.emp; employeeView(root, rerender, o); });
  const f = om.querySelector("#ef");
  if (f) f.onsubmit = (e) => {
    e.preventDefault();
    const row = Object.fromEntries(EMP_FORMS[tab].map(([k]) => [k, f.elements[k].value.trim()]));
    if (EMP_FORMS[tab].some(([k, , type]) => type === "date" && !row[k])) { toast("Enter the dates", "bad"); return; }
    writeDrafts(o, tab, [...readDrafts(o, tab), { ...row, saved: new Date().toISOString() }]);
    toast("Draft saved on this device", "ok");
    employeeView(root, rerender, o);
  };
  om.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
    const rows = readDrafts(o, tab); rows.splice(+b.dataset.del, 1); writeDrafts(o, tab, rows); employeeView(root, rerender, o);
  });
}
