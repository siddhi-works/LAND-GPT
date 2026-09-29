import { api } from "./api.js";
import { setContext } from "./context.js";
import { mountDiscovery, parcelCardHtml } from "./discovery.js";
import { t } from "./i18n.js";
import { SLUG, mountStateMinis, stateCardsHtml } from "./region.js";
import { mountStack } from "./stack.js";
import { REGION, STATES } from "./states.js";
import { compareHtml, countUp, donut, num } from "./dashboard.js";
import {
  citizenHeader,
  bindLang,
  disclaimer,
  emptyState,
  esc,
  fmtUlpin,
  icon,
  pct,
  riskStatus,
  siteFooter,
  skeleton,
  toast
} from "./ui.js";

// Quick actions and service cards: each one navigates, scrolls to a working form, or opens the assistant.
const QUICK = [
  { key: "qaUlpin", icon: "search", go: "explore:ulpin" },
  { key: "qaFind", icon: "pin", go: "explore:place" },
  { key: "landMap", icon: "map", href: "#/map" },
  { key: "qaRecords", icon: "register", href: "#/state" },
  { key: "qaVerify", icon: "shield", go: "explore:checks" },
  { key: "navDashboard", icon: "chart", href: "#/dashboard" },
  { key: "digitalServices", icon: "grid", href: "#/services" },
  { key: "chatAsk", icon: "spark", chat: "" },
];

const SERVICES = [
  { title: "7/12", sub: "Maharashtra · ७/१२", href: "#/state/MH/712", icon: "register" },
  { title: "8A", sub: "Maharashtra · ८अ", href: "#/state/MH/8a", icon: "register" },
  { title: "Property Card", sub: "Maharashtra · Gujarat", href: "#/state/MH/pc", icon: "register" },
  { title: "K-Prat", sub: "Maharashtra · क-प्रत", off: true, icon: "register" },
  { title: "Khatauni · Khasra", sub: "Uttar Pradesh · खतौनी", href: "#/state/UP/khatauni", icon: "register" },
  { title: "VF 7/12 · VF 8A", sub: "Gujarat · ગા.ન.નં.", href: "#/state/GJ/vf712", icon: "register" },
  { tkey: "svcMutation", sub: "Ferfar · Namantaran · VF 6", links: [["MH", "#/state/MH/ferfar"], ["UP", "#/state/UP/namantaran"], ["GJ", "#/state/GJ/vf6"]], icon: "swap" },
  { tkey: "svcOwnership", section: "land", icon: "user" },
  { tkey: "svcSurveySearch", go: "explore:native", icon: "search" },
  { tkey: "svcUlpinSearch", go: "explore:ulpin", icon: "search" },
  { tkey: "svcParcelMap", href: "#/map", icon: "map" },
  { tkey: "svcVerify", section: "checks", icon: "shield" },
];

const DISC_ORDER = ["ownership", "registration_mutation_lag", "area_gis", "encumbrance_litigation", "missing_links", "planning_environment", "data_quality", "spatial", "identity"];


/* =========================================================
   LAND-GPT LANDING PAGE
   ========================================================= */

export function renderLanding(root, rerender, params = {}) {

  setContext({ page: "home" }, { replace: true });

  root.innerHTML = `
  <div class="page landing">

    ${citizenHeader("home")}

    <main>

      <!-- =================================================
           HERO
           LEFT: Prime Minister · CENTRE: LAND-GPT · RIGHT: Minister of Rural Development
           ================================================= -->

      <section class="hero-portal" aria-labelledby="hero-title">
        <div class="hp-grid">

          <figure class="hp-person hp-left">
            <img
              src="./assets/pm-modi.jpg"
              width="1288"
              height="1289"
              alt="${esc(t("pmName"))}, ${esc(t("pmRole"))}"
            />
            <figcaption>
              <b>${esc(t("pmName"))}</b>
              <span>${esc(t("pmRole"))}</span>
            </figcaption>
          </figure>

          <div class="hp-center">
            <h1 id="hero-title">LAND-GPT</h1>
            <p class="hp-sub">${esc(t("brand"))}</p>
            <div class="hp-rule" aria-hidden="true"></div>
            <p class="hp-tagline">${esc(t("tagline"))}</p>
            <p class="hp-intro">${esc(t("intro"))}</p>
            <div class="hp-cta">
              <a class="btn primary lg" href="#/map">
                ${icon.map} ${esc(t("exploreMap"))}
              </a>
              <a class="btn lg" href="#/officer/login">
                ${icon.shield} ${esc(t("officerLogin"))}
              </a>
            </div>
          </div>

          <figure class="hp-person hp-right">
            <img
              src="./assets/rd-minister-cutout.png"
              width="1143"
              height="1338"
              alt="${esc(t("mordName"))}, ${esc(t("mordRole"))}"
            />
            <figcaption>
              <b>${esc(t("mordName"))}</b>
              <span>${esc(t("mordRole"))}</span>
            </figcaption>
          </figure>

        </div>
      </section>


      <!-- QUICK ACTIONS -->
      <section class="quick-wrap" aria-label="${esc(t("quickActions"))}">
        <div class="wrap quick">${QUICK.map((q) => {
          const attrs = q.href ? `href="${q.href}"` : q.chat != null ? `href="#" data-chat="${esc(q.chat)}"` : `href="#" data-go="${q.go}"`;
          return `<a class="qact" ${attrs}><span class="qact-ic">${icon[q.icon]}</span><span>${esc(t(q.key))}</span></a>`;
        }).join("")}</div>
      </section>

      <!-- TWO PORTALS -->
      <section class="wrap portals">
        <a class="portal-card citizen" href="#/citizen">
          <span class="pc-ic">${icon.user}</span>
          <span class="pc-t"><b>${esc(t("citizenPortal"))}</b><small>${esc(t("citizenPortalD"))}</small></span>
          <span class="pc-go">${esc(t("enterPortal"))} ${icon.right}</span>
        </a>
        <a class="portal-card officer" href="#/officer/login">
          <span class="pc-ic">${icon.shield}</span>
          <span class="pc-t"><b>${esc(t("officerPortal"))}</b><small>${esc(t("officerPortalD"))}</small></span>
          <span class="pc-go">${esc(t("enterPortal"))} ${icon.right}</span>
        </a>
      </section>

      <!-- EXPLORE LAND INFORMATION -->
      <section class="explore" id="explore">
        <div class="wrap">
          <div class="sec-intro"><h2>${esc(t("exploreLandInfo"))}</h2><p>${esc(t("exploreLandInfoD"))}</p></div>
          <div class="explore-grid">
            <div class="panel explore-form"><div class="body"><div class="flow-steps">${["state", "district", "taluka", "village", "parcelNo"].map((k, i) =>
              `<span><i>${i + 1}</i>${esc(t(k))}</span>`).join("")}</div><div id="disc"></div></div></div>
            <div class="panel explore-result" id="xresult">${emptyState(t("selectParcelHint"), t("selectParcelHintD"), icon.pin)}</div>
          </div>
        </div>
      </section>

      <!-- STATE CARDS -->
      <section class="band states-band" id="states">
        <div class="wrap">
          <div class="sec-intro"><h2>${esc(t("exploreStateInfo"))}</h2><p>${esc(t("exploreStateInfoD"))}</p></div>
          ${stateCardsHtml((code) => `#/citizen/${{ MH: "maharashtra", UP: "uttar-pradesh", GJ: "gujarat" }[code]}`)}
        </div>
      </section>

      <!-- WHAT LAND STACK CONNECTS -->
      <section class="connects-band" id="connects">
        <div class="wrap">
          <div class="sec-intro"><h2>${esc(t("connects"))}</h2><p>${esc(t("connectsD"))}</p></div>
          <div id="lstack"></div>
        </div>
      </section>

      <!-- DIGITAL LAND SERVICES (preview of the services hub) -->
      <section class="wrap services" id="services">
        <div class="sec-intro sec-intro-row"><div><h2>${esc(t("digitalServices"))}</h2><p>${esc(t("digitalServicesD"))}</p></div>
          <a class="btn primary" href="#/services">${icon.grid} ${esc(t("openServicesHub"))}</a></div>
        <div class="svc-grid">${SERVICES.map(serviceCard).join("")}</div>
      </section>

      <!-- DASHBOARD + LAND INTELLIGENCE -->
      <section class="band insights" id="insights">
        <div class="wrap">
          <div class="sec-intro sec-intro-row"><div><h2>${esc(t("dashTitle"))}</h2><p>${esc(t("dashD"))}</p></div>
            <a class="btn primary" id="ins-open" href="#/dashboard">${icon.chart} ${esc(t("openDashboard"))}</a></div>
          <div class="ins-bar"><div class="seg ins-tabs" role="tablist" aria-label="${esc(t("state"))}">
            <button data-ins="" class="on">${esc(t("allStates"))}</button>
            ${Object.entries(STATES).map(([c, s]) => `<button data-ins="${c}" style="--sc:${REGION[c].accent}">${esc(s.name)}</button>`).join("")}
          </div><span class="demo-pill">${icon.info} ${esc(t("demoDataset"))}</span></div>
          <div class="kpi-row" id="kpis">${skeleton(2)}</div>
          <div class="intel-grid">
            <div class="panel"><header><h3>${icon.chart} ${esc(t("intelConsistency"))}</h3></header><div class="body" id="intel-risk">${skeleton(3)}</div></div>
            <div class="panel"><header><h3>${icon.alert} ${esc(t("intelDiscrepancies"))}</h3><span class="terms">${esc(t("intelClick"))}</span></header><div class="body" id="intel-disc">${skeleton(4)}</div></div>
            <div class="panel"><header><h3>${icon.shield} ${esc(t("intelFlagged"))}</h3></header><div class="body" id="intel-list">${emptyState(t("intelPick"), "", icon.info)}</div></div>
          </div>
          <div class="db-sub ins-cmp-h"><h3>${icon.chart} ${esc(t("dbCompare"))}</h3><span class="terms">${esc(t("dbCompareD"))}</span></div>
          <div id="ins-cmp">${skeleton(3)}</div>
        </div>
      </section>

      <!-- HOW IT WORKS -->
      <section class="band">
        <div class="wrap">
          <h2 class="sec-h">${esc(t("howItWorks"))}</h2>
          <ol class="chain-lg">
            <li><b>${esc(t("storyParcel"))}</b><span>${esc(t("storyParcelD"))}</span></li>
            <li><b>${esc(t("storyUlpin"))}</b><span>${esc(t("storyUlpinD"))}</span></li>
            <li><b>${esc(t("storyRecords"))}</b><span>${esc(t("storyRecordsD"))}</span></li>
            <li><b>${esc(t("storyProfile"))}</b><span>${esc(t("storyProfileD"))}</span></li>
          </ol>
        </div>
      </section>

    </main>

    ${siteFooter()}

    ${disclaimer()}

  </div>
  `;

  bindLang(root, rerender);
  mountStack(root.querySelector("#lstack"));


  /* =======================================================
     EXPLORE LAND INFORMATION
     ======================================================= */

  let wantSection = "";                     // profile section a service card asked for

  mountDiscovery(root.querySelector("#disc"), {
    onChange: (sel) => setContext({ page: "home", state: sel.state, district: sel.district, sub_district: sel.sub, village: sel.village, ulpin: sel.ulpin || null }, { replace: true }),
    onParcel: (p) => {
      const box = root.querySelector("#xresult");
      box.innerHTML = parcelCardHtml(p, { section: wantSection, note: wantSection ? t("svcOpensSection") : "" });
      box.classList.add("filled");
      toast(t("parcelSelected"), "ok");
    },
  });

  function goExplore(kind) {
    root.querySelector("#explore").scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => {
      if (kind === "place") root.querySelector("#d-state")?.focus();
      else {
        const seg = kind && root.querySelector(`[data-kind="${kind === "native" ? "native" : kind === "ulpin" ? "ULPIN" : "all"}"]`);
        seg?.click();
        root.querySelector("#d-q")?.focus();
      }
    }, 450);
  }

  const onClick = (e) => {
    const a = e.target.closest("[data-go], [data-section]");
    if (!a || !root.contains(a)) return;
    e.preventDefault();
    if (a.dataset.section) {
      wantSection = a.dataset.section;
      toast(t("svcPickParcel"), "info");
      goExplore("place");
      return;
    }
    const [, kind] = a.dataset.go.split(":");
    if (kind === "checks") { wantSection = "checks"; toast(t("svcPickParcel"), "info"); }
    goExplore(kind);
  };
  root.addEventListener("click", onClick);


  /* =======================================================
     DASHBOARD PREVIEW + LAND INTELLIGENCE (live from the registry; state tabs re-compute everything)
     ======================================================= */

  let insState = "", insGroup = null;

  function drawInsights(code) {
    insState = code; insGroup = null;
    root.querySelectorAll("[data-ins]").forEach((b) => b.classList.toggle("on", b.dataset.ins === code));
    const dash = code ? `#/dashboard/${code}` : "#/dashboard";
    root.querySelector("#ins-open").setAttribute("href", dash);
    root.querySelector("#intel-list").innerHTML = emptyState(t("intelPick"), "", icon.info);
    Promise.all([api.reports(code || undefined), api.hierarchy(), api.dataQuality()]).then(([rep, h, dq]) => {
      const kpis = root.querySelector("#kpis");
      if (!kpis || insState !== code) return;
      const sts = h.states.filter((s) => !code || s.code === code);
      const districts = sts.reduce((n, s) => n + s.districts.length, 0);
      const villages = sts.reduce((n, s) => n + s.districts.reduce((m, d) => m + d.sub_districts.reduce((k, x) => k + x.villages.length, 0), 0), 0);
      const tables = Object.entries(dq.source_coverage).filter(([c]) => !code || c === code).reduce((n, [, r]) => n + r.length, 0);
      const by = { ok: 0, warn: 0, bad: 0 };
      Object.entries(rep.risk_levels).forEach(([lvl, n]) => { by[riskStatus(lvl)] += n; });
      const kpi = (v, label, href, cls = "", ic = "") => `<a class="kpi-card ${cls}" href="${href}">${ic ? `<span class="kpi-ic">${icon[ic]}</span>` : ""}${num(v)}<span>${esc(label)}</span></a>`;
      kpis.innerHTML = [
        kpi(rep.parcels, t("kpiParcels"), "#/map", "", "area"),
        kpi(by.ok, t("kpiConsistent"), dash, "ok", "check"),
        kpi(by.warn + by.bad, t("kpiReview"), dash, "warn", "alert"),
        kpi(rep.mutations.pending || 0, t("pendingMutations"), dash, "", "swap"),
        kpi(sts.length, t("kpiStates"), code ? `#/citizen/${SLUG[code]}` : "#/citizen", "", "globe"),
        kpi(districts, t("kpiDistricts"), code ? `#/state/${code}` : "#/state", "", "map"),
        kpi(villages, t("kpiVillages"), code ? `#/state/${code}` : "#/state", "", "pin"),
        kpi(tables, t("kpiSources"), dash, "", "link"),
      ].join("");

      const total = rep.parcels || 1;
      root.querySelector("#intel-risk").innerHTML = `<div class="ins-donut">${donut(by)}
        <ul class="legend-list">
          <li><span class="dot ok"></span>${esc(t("stConsistent"))}<b>${by.ok}</b><small>${pct(by.ok, total)}%</small></li>
          <li><span class="dot warn"></span>${esc(t("stAttention"))}<b>${by.warn}</b><small>${pct(by.warn, total)}%</small></li>
          <li><span class="dot bad"></span>${esc(t("stDiscrepancy"))}<b>${by.bad}</b><small>${pct(by.bad, total)}%</small></li>
        </ul></div>
        <p class="fine">${esc(t("intelChecks"))}: ${rep.checks.pass || 0} ${esc(t("checksPassed"))} · ${rep.checks.fail || 0} ${esc(t("failed"))}</p>`;

      const groups = DISC_ORDER.filter((g) => rep.parcels_by_discrepancy[g]);
      const max = Math.max(1, ...groups.map((g) => rep.parcels_by_discrepancy[g]));
      const disc = root.querySelector("#intel-disc");
      disc.innerHTML = groups.length ? `<div class="dq-bars">${groups.map((g) => `<button class="dq-bar" data-g="${g}">
          <span class="hb-l">${esc(t("dg_" + g))}</span><span class="hb-t"><i style="width:${rep.parcels_by_discrepancy[g] / max * 100}%"></i></span><b>${rep.parcels_by_discrepancy[g]}</b></button>`).join("")}</div>
        <p class="fine">${esc(t("intelUnit"))}</p>` : emptyState(t("stConsistent"), "", icon.check);
      disc.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => {
        disc.querySelectorAll("[data-g]").forEach((x) => x.classList.toggle("on", x === b));
        insGroup = b.dataset.g;
        flagged(b.dataset.g, new Set(rep.discrepancy_rules[b.dataset.g]), code);
      });
      countUp(kpis);
    }).catch(() => {
      const kpis = root.querySelector("#kpis");
      if (kpis) kpis.innerHTML = emptyState(t("dataUnavailable"), "", icon.alert);
    });
    compareHtml(code, (c) => `#/dashboard/${c}`).then((html) => {
      const box = root.querySelector("#ins-cmp");
      if (box && insState === code) { box.innerHTML = html; countUp(box); }
    }).catch(() => {});
  }
  root.querySelectorAll("[data-ins]").forEach((b) => b.onclick = () => drawInsights(b.dataset.ins));
  drawInsights("");

  async function flagged(group, rules, code) {
    const box = root.querySelector("#intel-list");
    box.innerHTML = skeleton(4);
    try {
      const [f, fc] = await Promise.all([api.findings(code || undefined), api.parcels()]);
      if (insGroup !== group || insState !== code) return;
      const props = new Map(fc.features.map((x) => [x.properties.ulpin, x.properties]));
      const seen = new Map();
      f.findings.filter((x) => rules.has(x.rule_id)).forEach((x) => { if (!seen.has(x.ulpin)) seen.set(x.ulpin, x); });
      box.innerHTML = `<div class="eyebrow">${esc(t("dg_" + group))} · ${seen.size}</div><ul class="flag-list">${[...seen.values()].slice(0, 8).map((x) => {
        const p = props.get(x.ulpin);
        return `<li><a href="#/parcel/${x.ulpin}/checks"><b>${esc(p?.native_label || fmtUlpin(x.ulpin))}</b><small>${esc(p ? `${p.village}, ${p.district} · ${STATES[p.state_code].name}` : "")}</small>
          <span class="flag-msg">${esc(x.rule_id)} · ${esc(x.message)}</span></a></li>`;
      }).join("")}</ul><a class="btn sm" href="${code ? `#/dashboard/${code}` : "#/dashboard"}">${esc(t("openDashboard"))} ${icon.right}</a>`;
    } catch { box.innerHTML = emptyState(t("dataUnavailable"), "", icon.alert); }
  }


  /* =======================================================
     STATE MAP THUMBNAILS + DEEP LINK (#/explore)
     ======================================================= */

  let minis = () => {};
  mountStateMinis(root).then((c) => { minis = c; });
  if (params.section) setTimeout(() => root.querySelector(`#${params.section}`)?.scrollIntoView({ block: "start" }), 50);

  return () => { minis(); root.removeEventListener("click", onClick); };

}


function serviceCard(s) {
  const name = s.tkey ? t(s.tkey) : s.title;
  const attrs = s.href ? `href="${s.href}"` : s.section ? `href="#" data-section="${s.section}"` : s.go ? `href="#" data-go="${s.go}"` : "";
  const tag = s.off ? `<span class="svc-tag off">${esc(t("notConnected2"))}</span>`
    : s.section ? `<span class="svc-tag">${esc(t("svcNeedsParcel"))}</span>` : `<span class="svc-tag live">${esc(t("available"))}</span>`;
  const links = s.links ? `<span class="svc-links">${s.links.map(([c, h]) => `<a href="${h}">${esc(STATES[c].name)}</a>`).join("")}</span>` : "";
  if (s.off || s.links) {
    return `<div class="svc-card ${s.off ? "off" : ""}"><span class="svc-ic">${icon[s.icon]}</span>
      <span class="svc-t"><b>${esc(name)}</b><small>${esc(s.sub || "")}</small></span>${links}${tag}</div>`;
  }
  return `<a class="svc-card" ${attrs}><span class="svc-ic">${icon[s.icon]}</span>
    <span class="svc-t"><b>${esc(name)}</b>${s.sub ? `<small>${esc(s.sub)}</small>` : ""}</span>${tag}</a>`;
}
