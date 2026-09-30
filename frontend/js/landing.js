import { api } from "./api.js";
import { setContext } from "./context.js";
import { mountDiscovery, parcelCardHtml } from "./discovery.js";
import { t } from "./i18n.js";
import { SLUG, mountStateMinis, stateCardsHtml } from "./region.js";
import { mountStack } from "./stack.js";
import { REGION, STATES } from "./states.js";
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
  { key: "qaUlpin", icon: "search", href: "#/map?search" },
  { key: "landMap", icon: "map", href: "#/map" },
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
   BhuSamhita LANDING PAGE
   ========================================================= */

export function renderLanding(root, rerender, params = {}) {

  setContext({ page: "home" }, { replace: true });

  root.innerHTML = `
  <div class="page landing">

    ${citizenHeader("home")}

    <main>

      <!-- =================================================
           HERO
           LEFT: Prime Minister · CENTRE: BhuSamhita · RIGHT: Minister of Rural Development
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
            <h1 id="hero-title">${esc(t("brand"))}</h1>
            <div class="hp-rule" aria-hidden="true"></div>
            <p class="hp-tagline">${esc(t("taglineA"))}<span class="hp-hl">${esc(t("taglineB"))}</span></p>
            <p class="hp-intro">${esc(t("intro"))}</p>
            <div class="hp-cta">
              <a class="btn primary lg" href="#/map?search">
                ${icon.search} ${esc(t("qaUlpin"))}
              </a>
              <a class="btn lg" href="#/services">
                ${icon.grid} ${esc(t("tryServices"))}
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



      <!-- WHAT LAND STACK CONNECTS -->
      <section class="connects-band" id="connects">
        <div class="wrap">
          <div class="sec-intro"><h2>${esc(t("connects"))}</h2><p>${esc(t("connectsD"))}</p></div>
          <div id="lstack"></div>
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
     STATE MAP THUMBNAILS + DEEP LINK (#/explore)
     ======================================================= */

  let minis = () => {};
  mountStateMinis(root).then((c) => { minis = c; });
  if (params.section) setTimeout(() => root.querySelector(`#${params.section}`)?.scrollIntoView({ block: "start" }), 50);

  return () => { minis(); };

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
