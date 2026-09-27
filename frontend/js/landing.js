import { api } from "./api.js";
import { t } from "./i18n.js";
import { STATES } from "./states.js";
import { citizenHeader, bindLang, disclaimer, esc, icon } from "./ui.js";

const DEPT = {
  land_record: "Land records", mutation: "Mutation", registration: "Registration", geometry: "Survey / GIS",
  planning: "Planning", building_permission: "Building permission", encumbrance: "Encumbrance",
  property_tax: "Property tax", utilities: "Utilities", environmental_restriction: "Environment", parcel: "ULPIN registry",
  ownership: "Ownership", land_use: "Land use", litigation: "Litigation",
};

export function renderLanding(root, rerender) {
  root.innerHTML = `
  <div class="page landing">
    ${citizenHeader("home")}
    <main>
      <section class="hero">
        <div class="hero-inner">
          <p class="kicker">Land records interoperability · ULPIN</p>
          <h1>${esc(t("brand"))}</h1>
          <p class="lede">${esc(t("tagline"))}</p>
          <p class="intro">${esc(t("intro"))}</p>
          <div class="cta">
            <a class="btn primary lg" href="#/map">${icon.map} ${esc(t("exploreMap"))}</a>
            <a class="btn lg" href="#/officer/login">${icon.shield} ${esc(t("officerLogin"))}</a>
          </div>
        </div>
      </section>

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

      <section class="wrap connects">
        <h2 class="sec-h">${esc(t("connects"))}</h2>
        <div class="state-cols" id="cols"><div class="loading"><span class="spinner"></span></div></div>
        <p class="fine" id="figures"></p>
      </section>
    </main>
    ${disclaimer()}
  </div>`;
  bindLang(root, rerender);

  api.dataQuality().then((dq) => {
    const cols = Object.entries(STATES).map(([code, s]) => {
      const rows = (dq.source_coverage[code] || []).filter(r => !["core.parcel_registry"].includes(r.source_table));
      return `<div class="state-col">
        <h3>${esc(s.name)} <span class="native">${esc(s.native)}</span></h3>
        <p class="muted">${esc(s.system)}</p>
        <ul>${rows.map(r => `<li><b>${esc(r.native_record_type)}</b><span>${esc(r.concepts.map(c => DEPT[c] || c).filter((v, i, a) => a.indexOf(v) === i).join(" · "))}</span></li>`).join("")}</ul>
      </div>`;
    }).join("");
    root.querySelector("#cols").innerHTML = cols;
    const systems = Object.values(dq.source_coverage).reduce((n, r) => n + r.length, 0);
    root.querySelector("#figures").textContent =
      `${dq.registry.ulpins} ULPIN-linked parcels · ${systems} connected state source tables · ${dq.by_rule.length} cross-source validation rules`;
  }).catch(() => { root.querySelector("#cols").innerHTML = ""; });
}
