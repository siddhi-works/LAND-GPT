import { setLang, getLang } from "./i18n.js";
import { renderLanding } from "./landing.js";
import { renderCitizen } from "./citizen.js";
import { renderCitizenPortal } from "./citizen-portal.js";
import { renderProfile } from "./profile.js";
import { renderRegion, codeFromSlug } from "./region.js";
import { renderDashboard } from "./dashboard.js";
import { renderServices } from "./services.js";
import { renderOfficerLogin, renderOfficer } from "./officer.js";
import { mountChat } from "./chat.js";
import { setContext } from "./context.js";

const root = document.getElementById("app");
let cleanup = null;

// Hash routes. Citizen side: #/, #/citizen[/<state-slug>[/<record>[/<ulpin>]]], #/state/<CODE>[/<record>[/<ulpin>]],
// #/map[/<ulpin>], #/parcel/<ulpin>[/<section>], #/dashboard[/<CODE>[/<district>]], #/services, #/explore.
// Officer side: #/officer/login[/<CODE>[/<username>]], #/officer[/<view>], #/officer/parcel/<ulpin>.
function route() {
  const [a, b, c, d] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (a === "map") return [renderCitizen, { ulpin: b }];
  if (a === "parcel" && b) return [renderProfile, { ulpin: b, section: c }];
  if (a === "state") return [renderRegion, { code: b, rec: c, ulpin: d }];
  if (a === "citizen") return b ? [renderRegion, { code: codeFromSlug(b), rec: c, ulpin: d, base: "citizen" }] : [renderCitizenPortal, {}];
  if (a === "dashboard") return [renderDashboard, { code: b, district: c }];
  if (a === "services") return [renderServices, {}];
  if (a === "explore") return [renderLanding, { section: a }];
  if (a === "officer") {
    if (b === "login") return [renderOfficerLogin, { state: c, username: d }];
    if (b === "parcel" && c) return [renderOfficer, { view: "parcel", ulpin: c }];
    return [renderOfficer, { view: b || "home" }];
  }
  return [renderLanding, {}];
}

function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const [fn, params] = route();
  document.body.dataset.view = fn.name;
  setContext({ page: fn.name.replace(/^render/, "").toLowerCase() }, { replace: true });
  cleanup = fn(root, render, params) || null;
}

setLang(getLang());
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
render();
mountChat();
