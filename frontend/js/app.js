import { setLang, getLang } from "./i18n.js";
import { renderLanding } from "./landing.js";
import { renderCitizen } from "./citizen.js";
import { renderProfile } from "./profile.js";
import { renderOfficerLogin, renderOfficer } from "./officer.js";

const root = document.getElementById("app");
let cleanup = null;

function route() {
  const [a, b, c] = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (a === "map") return [renderCitizen, { ulpin: b }];
  if (a === "parcel" && b) return [renderProfile, { ulpin: b }];
  if (a === "officer") {
    if (b === "login") return [renderOfficerLogin, { state: c }];
    if (b === "parcel" && c) return [renderOfficer, { view: "parcel", ulpin: c }];
    return [renderOfficer, { view: b || "home" }];
  }
  return [renderLanding, {}];
}

function render() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const [fn, params] = route();
  document.body.dataset.view = fn.name;
  cleanup = fn(root, render, params) || null;
}

setLang(getLang());
window.addEventListener("hashchange", () => { window.scrollTo(0, 0); render(); });
render();
