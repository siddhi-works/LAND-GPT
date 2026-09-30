import { setLang, getLang } from "./i18n.js";
import { renderLanding } from "./landing.js";
import { renderCitizen } from "./citizen.js";
import { renderProfile } from "./profile.js";
import { codeFromSlug, renderRegion } from "./region.js";
import { renderServices } from "./services.js";
import { renderOfficerLogin, renderOfficer } from "./officer.js";
import { mountChat } from "./chat.js";
import { setContext } from "./context.js";
import { openLogin, signedIn } from "./auth.js";
import { renderContact, renderFaq } from "./info.js";

const root = document.getElementById("app");
let cleanup = null;

// Hash routes. Citizen side: #/, #/citizen[/<state-slug>[/<record>[/<ulpin>]]], #/state/<CODE>[/<record>[/<ulpin>]],
// #/map[/<ulpin>], #/parcel/<ulpin>[/<section>], #/dashboard[/<CODE>[/<district>]], #/services, #/explore.
// Officer side: #/officer/login[/<CODE>[/<username>]], #/officer[/<view>], #/officer/parcel/<ulpin>.
function route() {
  const [a, b, c, d] = location.hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
  if (a === "map") return [renderCitizen, { ulpin: b }];
  if (a === "parcel" && b) return [renderProfile, { ulpin: b, section: c }];
  // State pages: #/citizen/<slug> or #/state/<CODE> (reached from the Land Map's state dropdown).
  // Without a state they fall back to the Land Map's state chooser.
  if (a === "state" || a === "citizen") {
    if (!b) return [renderCitizen, {}];
    return [renderRegion, { code: a === "citizen" ? codeFromSlug(b) : b, rec: c, ulpin: d, base: "citizen" }];
  }
  if (a === "services") return [renderServices, {}];
  if (a === "faq") return [renderFaq, {}];
  if (a === "contact") return [renderContact, {}];
  if (a === "explore") return [renderLanding, { section: a }];
  if (a === "officer") {
    if (b === "login") return [renderOfficerLogin, { state: c, username: d }];
    if (b === "parcel" && c) return [renderOfficer, { view: "parcel", ulpin: c }];
    return [renderOfficer, { view: b || "home" }];
  }
  return [renderLanding, {}];
}

// Land records (map, parcel profiles, state pages, services) need a signed-in citizen or officer.
const PROTECTED = new Set(["map", "parcel", "state", "citizen", "services"]);

function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const first = location.hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  if (PROTECTED.has(first) && !signedIn()) {
    const want = location.hash;
    history.replaceState(null, "", "#/");
    document.body.dataset.view = "renderLanding";
    cleanup = renderLanding(root, render, {}) || null;
    openLogin(want);
    return;
  }
  const [fn, params] = route();
  document.body.dataset.view = fn.name;
  setContext({ page: fn.name.replace(/^render/, "").toLowerCase() }, { replace: true });
  cleanup = fn(root, render, params) || null;
}

setLang(getLang());
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
render();
mountChat();
