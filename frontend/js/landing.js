import { api } from "./api.js";
import { setContext } from "./context.js";
import { mountDiscovery } from "./discovery.js";
import { t, localText } from "./i18n.js";
import { mountStateMinis, stateCardsHtml } from "./region.js";
import { STATES } from "./states.js";
import {
  citizenHeader,
  bindLang,
  disclaimer,
  emptyState,
  esc,
  fmtHa,
  fmtUlpin,
  icon,
  riskStatus,
  siteFooter,
  skeleton,
  statusBadge,
  toast
} from "./ui.js";

// Quick actions and service cards: each one navigates, scrolls to a working form, or opens the assistant.
const QUICK = [
  { key: "qaUlpin", icon: "search", go: "explore:ulpin" },
  { key: "qaFind", icon: "pin", go: "explore:place" },
  { key: "landMap", icon: "map", href: "#/map" },
  { key: "qaRecords", icon: "register", href: "#/state" },
  { key: "qaVerify", icon: "shield", go: "explore:checks" },
  { key: "qaProfile", icon: "area", go: "explore:" },
  { key: "digitalServices", icon: "layers", go: "services" },
  { key: "chatAsk", icon: "spark", chat: "" },
];

const SERVICES = [
  { title: "7/12", sub: "Maharashtra · ७/१२", href: "#/state/MH/712", icon: "register" },
  { title: "8A", sub: "Maharashtra · ८अ", href: "#/state/MH/8a", icon: "register" },
  { title: "Property Card", sub: "Maharashtra · Gujarat", href: "#/state/MH/pc", icon: "register" },
  { title: "K-Prat", sub: "Maharashtra · क-प्रत", off: true, icon: "register" },
  { title: "Khatauni · Khasra", sub: "Uttar Pradesh · खतौनी", href: "#/state/UP/khatauni", icon: "register" },
  { title: "VF 7/12 · VF 8A", sub: "Gujarat · ગા.ન.નં.", href: "#/state/GJ/vf712", icon: "register" },
  { tkey: "svcMutation", sub: "Ferfar · Namantaran · VF 6", links: [["MH", "#/state/MH/ferfar"], ["UP", "#/state/UP/namantaran"], ["GJ", "#/state/GJ/vf6"]], icon: "work" },
  { tkey: "svcOwnership", section: "land", icon: "home" },
  { tkey: "svcSurveySearch", go: "explore:native", icon: "search" },
  { tkey: "svcUlpinSearch", go: "explore:ulpin", icon: "search" },
  { tkey: "svcParcelMap", href: "#/map", icon: "map" },
  { tkey: "svcVerify", section: "checks", icon: "shield" },
  { tkey: "secLandUse", section: "landuse", icon: "layers" },
  { tkey: "connectedRecords", section: "records", icon: "link" },
  { tkey: "secEncumbrance", section: "encumbrance", icon: "alert" },
  { tkey: "secRegistration", section: "registration", icon: "audit" },
];

const DISC_ORDER = ["ownership", "registration_mutation_lag", "area_gis", "encumbrance_litigation", "missing_links", "planning_environment", "data_quality", "spatial", "identity"];

const DEPT = {
  land_record: "Land records",
  mutation: "Mutation",
  registration: "Registration",
  geometry: "Survey / GIS",
  planning: "Planning",
  building_permission: "Building permission",
  encumbrance: "Encumbrance",
  property_tax: "Property tax",
  utilities: "Utilities",
  environmental_restriction: "Environment",
  parcel: "ULPIN registry",
  ownership: "Ownership",
  land_use: "Land use",
  litigation: "Litigation",
};


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
          return `<a class="qa" ${attrs}><span class="qa-ic">${icon[q.icon]}</span><span>${esc(t(q.key))}</span></a>`;
        }).join("")}</div>
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
          ${stateCardsHtml()}
        </div>
      </section>

      <!-- DIGITAL LAND SERVICES -->
      <section class="wrap services" id="services">
        <div class="sec-intro"><h2>${esc(t("digitalServices"))}</h2><p>${esc(t("digitalServicesD"))}</p></div>
        <div class="svc-grid">${SERVICES.map(serviceCard).join("")}</div>
      </section>

      <!-- DASHBOARD + LAND INTELLIGENCE -->
      <section class="band insights" id="insights">
        <div class="wrap">
          <div class="sec-intro"><h2>${esc(t("dashTitle"))}</h2><p>${esc(t("dashD"))}</p></div>
          <div class="kpi-row" id="kpis">${skeleton(2)}</div>
          <div class="intel-grid">
            <div class="panel"><header><h3>${icon.chart} ${esc(t("intelConsistency"))}</h3></header><div class="body" id="intel-risk">${skeleton(3)}</div></div>
            <div class="panel"><header><h3>${icon.alert} ${esc(t("intelDiscrepancies"))}</h3><span class="terms">${esc(t("intelClick"))}</span></header><div class="body" id="intel-disc">${skeleton(4)}</div></div>
            <div class="panel"><header><h3>${icon.shield} ${esc(t("intelFlagged"))}</h3></header><div class="body" id="intel-list">${emptyState(t("intelPick"), "", icon.info)}</div></div>
          </div>
        </div>
      </section>

      <!-- =================================================
           HOW IT WORKS
           ================================================= -->

      <section class="band">

        <div class="wrap">

          <h2 class="sec-h">
            ${esc(t("howItWorks"))}
          </h2>

          <ol class="chain-lg">

            <li>
              <b>
                ${esc(t("storyParcel"))}
              </b>

              <span>
                ${esc(t("storyParcelD"))}
              </span>
            </li>


            <li>
              <b>
                ${esc(t("storyUlpin"))}
              </b>

              <span>
                ${esc(t("storyUlpinD"))}
              </span>
            </li>


            <li>
              <b>
                ${esc(t("storyRecords"))}
              </b>

              <span>
                ${esc(t("storyRecordsD"))}
              </span>
            </li>


            <li>
              <b>
                ${esc(t("storyProfile"))}
              </b>

              <span>
                ${esc(t("storyProfileD"))}
              </span>
            </li>

          </ol>

        </div>

      </section>


      <!-- =================================================
           WHAT LAND STACK CONNECTS
           ================================================= -->

      <section class="wrap connects">

        <h2 class="sec-h">
          ${esc(t("connects"))}
        </h2>

        <div
          class="state-cols"
          id="cols"
        >
          <div class="loading">
            <span class="spinner"></span>
          </div>
        </div>

        <p
          class="fine"
          id="figures"
        ></p>

      </section>

    </main>

    ${siteFooter()}

    ${disclaimer()}

  </div>
  `;


  /* =======================================================
     LANGUAGE SWITCHING
     ======================================================= */

  bindLang(root, rerender);


  /* =======================================================
     LOAD DATA QUALITY / STATE INFORMATION
     ======================================================= */

  api.dataQuality()
    .then((dq) => {

      const cols = Object.entries(STATES)
        .map(([code, s]) => {

          const rows =
            (dq.source_coverage[code] || [])
              .filter(
                r =>
                  !["core.parcel_registry"]
                    .includes(r.source_table)
              );


          return `
            <div class="state-col">

              <h3>
                ${esc(s.name)}

                <span class="native">
                  ${esc(s.native)}
                </span>
              </h3>


              <p class="muted">
                ${esc(s.system)}
              </p>


              <ul>

                ${rows
                  .map(r => {

                    const concepts =
                      r.concepts
                        .map(
                          c => DEPT[c] || c
                        )
                        .filter(
                          (v, i, a) =>
                            a.indexOf(v) === i
                        )
                        .join(" · ");


                    return `
                      <li>

                        <b>
                          ${esc(
                            r.native_record_type
                          )}
                        </b>

                        <span>
                          ${esc(concepts)}
                        </span>

                      </li>
                    `;

                  })
                  .join("")}

              </ul>

            </div>
          `;

        })
        .join("");


      const colsEl =
        root.querySelector("#cols");

      if (colsEl) {
        colsEl.innerHTML = cols;
      }


      const systems =
        Object.values(
          dq.source_coverage
        )
        .reduce(
          (n, r) => n + r.length,
          0
        );


      const figuresEl =
        root.querySelector("#figures");


      if (figuresEl) {

        figuresEl.textContent =
          `${dq.registry.ulpins} ULPIN-linked parcels · ` +
          `${systems} connected state source tables · ` +
          `${dq.by_rule.length} cross-source validation rules`;

      }

    })

    .catch(() => {

      const colsEl =
        root.querySelector("#cols");

      if (colsEl) {
        colsEl.innerHTML = "";
      }

    });


  /* =======================================================
     EXPLORE LAND INFORMATION
     ======================================================= */

  let wantSection = "";                     // profile section a service card asked for

  const disc = mountDiscovery(root.querySelector("#disc"), {
    onChange: (sel) => setContext({ page: "home", state: sel.state, district: sel.district, sub_district: sel.sub, village: sel.village, ulpin: sel.ulpin || null }, { replace: true }),
    onParcel: (p) => showParcel(p),
  });

  function showParcel(p) {
    const box = root.querySelector("#xresult");
    const st = p.state_code, sub = t(p.sub_district_type === "tehsil" ? "tehsil" : "taluka");
    const target = wantSection ? `#/parcel/${p.ulpin}/${wantSection}` : `#/parcel/${p.ulpin}`;
    box.innerHTML = `
      <div class="sel-parcel">
        <div class="eyebrow">${esc(t("selectedParcel"))}</div>
        <div class="sp-head"><div><div class="ulpin">${fmtUlpin(p.ulpin)}</div><b>${esc(p.native_label)}</b></div>${statusBadge(p.risk_level)}</div>
        <dl class="kv">
          <dt>${esc(t("village"))}</dt><dd>${esc(p.village)}</dd>
          <dt>${esc(sub)}</dt><dd>${esc(p.sub_district)}</dd>
          <dt>${esc(t("district"))}</dt><dd>${esc(p.district)} · ${esc(STATES[st].name)}</dd>
          <dt>${esc(t("area"))}</dt><dd>${fmtHa(p.record_area_ha)} <span class="muted">(${esc(p.record_area_source)})</span></dd>
          <dt>${esc(t("landUse"))}</dt><dd>${esc(localText(p.land_use_label, st))}</dd>
          <dt>${esc(t("verification"))}</dt><dd>${p.findings ? `${p.findings} ${esc(t("findings"))}` : esc(t("stConsistent"))}</dd>
        </dl>
        ${wantSection ? `<div class="notice info">${icon.info}<span>${esc(t("svcOpensSection"))}</span></div>` : ""}
        <div class="res-actions">
          <a class="btn primary" href="${target}">${icon.register} ${esc(t("openProfile"))}</a>
          <a class="btn" href="#/map/${p.ulpin}">${icon.map} ${esc(t("viewOnMap"))}</a>
          <button class="btn" data-chat="${esc(t("qExplain"))}">${icon.spark} ${esc(t("askAboutParcel"))}</button>
        </div>
      </div>`;
    box.classList.add("filled");
    toast(t("parcelSelected"), "ok");
  }

  function goExplore(kind) {
    const sec = root.querySelector("#explore");
    sec.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (!a) return;
    e.preventDefault();
    if (a.dataset.section) {
      wantSection = a.dataset.section;
      toast(t("svcPickParcel"), "info");
      goExplore("place");
      return;
    }
    const [where, kind] = a.dataset.go.split(":");
    if (where === "services") root.querySelector("#services").scrollIntoView({ behavior: "smooth" });
    else {
      if (kind === "checks") { wantSection = "checks"; toast(t("svcPickParcel"), "info"); }
      goExplore(kind);
    }
  };
  root.addEventListener("click", onClick);


  /* =======================================================
     DASHBOARD + LAND INTELLIGENCE (live from the registry)
     ======================================================= */

  Promise.all([api.reports(), api.hierarchy(), api.dataQuality()]).then(([rep, h, dq]) => {
    const kpis = root.querySelector("#kpis");
    if (!kpis) return;
    const districts = h.states.reduce((n, s) => n + s.districts.length, 0);
    const villages = h.states.reduce((n, s) => n + s.districts.reduce((m, d) => m + d.sub_districts.reduce((k, x) => k + x.villages.length, 0), 0), 0);
    const tables = Object.values(dq.source_coverage).reduce((n, r) => n + r.length, 0);
    const byStatus = { ok: 0, warn: 0, bad: 0 };
    Object.entries(rep.risk_levels).forEach(([lvl, n]) => { byStatus[riskStatus(lvl)] += n; });
    const kpi = (v, label, cls = "", ic = "") => `<div class="kpi-card ${cls}">${ic ? `<span class="kpi-ic">${icon[ic]}</span>` : ""}<b>${v}</b><span>${esc(label)}</span></div>`;
    kpis.innerHTML = [
      kpi(rep.parcels, t("kpiParcels"), "", "area"),
      kpi(byStatus.ok, t("kpiConsistent"), "ok", "check"),
      kpi(byStatus.warn + byStatus.bad, t("kpiReview"), "warn", "alert"),
      kpi(rep.mutations.pending || 0, t("pendingMutations"), "", "work"),
      kpi(3, t("kpiStates"), "", "globe"),
      kpi(districts, t("kpiDistricts"), "", "map"),
      kpi(villages, t("kpiVillages"), "", "pin"),
      kpi(tables, t("kpiSources"), "", "link"),
    ].join("");

    const total = rep.parcels || 1;
    root.querySelector("#intel-risk").innerHTML = `
      <div class="stackbar">${["ok", "warn", "bad"].map((k) => byStatus[k] ? `<i class="${k}" style="flex:${byStatus[k]}" title="${byStatus[k]}"></i>` : "").join("")}</div>
      <ul class="legend-list">
        <li><span class="dot ok"></span>${esc(t("stConsistent"))}<b>${byStatus.ok}</b><small>${Math.round(byStatus.ok / total * 100)}%</small></li>
        <li><span class="dot warn"></span>${esc(t("stAttention"))}<b>${byStatus.warn}</b><small>${Math.round(byStatus.warn / total * 100)}%</small></li>
        <li><span class="dot bad"></span>${esc(t("stDiscrepancy"))}<b>${byStatus.bad}</b><small>${Math.round(byStatus.bad / total * 100)}%</small></li>
      </ul>
      <p class="fine">${esc(t("intelChecks"))}: ${rep.checks.pass || 0} ${esc(t("checksPassed"))} · ${rep.checks.fail || 0} ${esc(t("failed"))}</p>`;

    const groups = DISC_ORDER.filter((g) => rep.parcels_by_discrepancy[g]);
    const max = Math.max(1, ...groups.map((g) => rep.parcels_by_discrepancy[g]));
    const disc = root.querySelector("#intel-disc");
    disc.innerHTML = `<div class="hbars">${groups.map((g) => `<button class="hbar" data-g="${g}">
        <span class="hb-l">${esc(t("dg_" + g))}</span><span class="hb-t"><i style="width:${rep.parcels_by_discrepancy[g] / max * 100}%"></i></span><b>${rep.parcels_by_discrepancy[g]}</b></button>`).join("")}</div>
      <p class="fine">${esc(t("intelUnit"))}</p>`;
    disc.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => {
      disc.querySelectorAll("[data-g]").forEach((x) => x.classList.toggle("on", x === b));
      flagged(b.dataset.g, new Set(rep.discrepancy_rules[b.dataset.g]));
    });
  }).catch(() => {
    const kpis = root.querySelector("#kpis");
    if (kpis) kpis.innerHTML = emptyState(t("dataUnavailable"), "", icon.alert);
  });

  async function flagged(group, rules) {
    const box = root.querySelector("#intel-list");
    box.innerHTML = skeleton(4);
    try {
      const [f, fc] = await Promise.all([api.findings(), api.parcels()]);
      const props = new Map(fc.features.map((x) => [x.properties.ulpin, x.properties]));
      const seen = new Map();
      f.findings.filter((x) => rules.has(x.rule_id)).forEach((x) => { if (!seen.has(x.ulpin)) seen.set(x.ulpin, x); });
      box.innerHTML = `<div class="eyebrow">${esc(t("dg_" + group))}</div><ul class="flag-list">${[...seen.values()].slice(0, 8).map((x) => {
        const p = props.get(x.ulpin);
        return `<li><a href="#/parcel/${x.ulpin}"><b>${esc(p?.native_label || fmtUlpin(x.ulpin))}</b><small>${esc(p ? `${p.village}, ${p.district} · ${STATES[p.state_code].name}` : "")}</small>
          <span class="flag-msg">${esc(x.rule_id)} · ${esc(x.message)}</span></a></li>`;
      }).join("")}</ul>`;
    } catch { box.innerHTML = emptyState(t("dataUnavailable"), "", icon.alert); }
  }


  /* =======================================================
     STATE MAP THUMBNAILS + DEEP LINKS (#/services, #/explore)
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