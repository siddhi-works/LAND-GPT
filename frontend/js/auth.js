// Sign-in for the portal: one modal with a Citizen column (Regular / OTP / Aadhaar login) and an Officer
// column (state -> department / role -> officer ID + password). Fields are pre-filled with the sample
// accounts so users can sign in directly.
// Citizen sign-in is held in this browser (there is no citizen account service on the backend); officer
// sign-in uses the existing /v1/officer/login and opens the officer workspace.
import { api, session } from "./api.js";
import { t } from "./i18n.js";
import { STATES } from "./states.js";
import { esc, icon, toast } from "./ui.js";

const KEY = "ls-citizen";
const OFFICER_PW = "LandStack@2026";
export const SAMPLE_CITIZEN = {
  username: "citizen.ramesh", password: "Citizen@2026", name: "Ramesh Kulkarni",
  mobile: "9876543210", aadhaar: "9999 0000 1234", otp: "246810",
};

export const citizen = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(u) { try { localStorage.setItem(KEY, JSON.stringify(u)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

/** Signed in as a citizen or as an officer. */
export const signedIn = () => !!(citizen.get() || session.token);

/** Top-right account area for the citizen header. */
export function accountHtml() {
  const c = citizen.get(), o = session.officer;
  if (c) return `<div class="acct"><span class="acct-ic">${icon.user}</span><span class="acct-t"><b>${esc(c.name)}</b><small>${esc(c.username)} · ${esc(c.mode ? t("m_" + c.mode) : c.method)}</small></span>
    <button class="btn sm" data-logout>${icon.logout} ${esc(t("signOut"))}</button></div>`;
  if (o && session.token) return `<div class="acct"><span class="acct-ic">${icon.shield}</span><span class="acct-t"><b>${esc(o.name)}</b><small>${esc(o.username || o.designation || "")}</small></span>
    <a class="btn sm" href="#/officer">${esc(t("workspace"))}</a></div>`;
  return `<button class="btn primary sm acct-login" data-login>${icon.lock} ${esc(t("login"))}</button>`;
}

const captcha = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

let dlg = null, next = null, state = { side: "citizen", mode: "regular", cap: captcha(), accounts: null, st: "", user: "" };

/** Open the sign-in dialog; `after` is the page to open once signed in. */
export function openLogin(after = null, side = "citizen") {
  next = after; state.side = side; state.cap = captcha();
  if (!dlg) { dlg = document.createElement("dialog"); dlg.className = "login-dlg"; document.body.append(dlg); }
  draw();
  if (!dlg.open) dlg.showModal();
  if (!state.accounts) api.accounts().then((r) => { state.accounts = r.accounts; if (state.side === "officer") draw(); }).catch(() => {});
}

function field(label, id, value, type = "text", ic = "user", extra = "") {
  return `<div class="lg-f"><label for="${id}">${esc(label)}</label><div class="lg-in">${icon[ic]}<input id="${id}" type="${type}" value="${esc(value)}" ${extra}></div></div>`;
}
const capHtml = () => `<div class="lg-f"><label>${esc(t("lgCaptcha"))}</label><div class="lg-cap"><span class="cap-img">${esc(state.cap)}</span>
  <button type="button" class="icon-btn" id="cap-new" aria-label="New captcha">${icon.fwd}</button></div>
  <div class="lg-in">${icon.check}<input id="cap" value="${esc(state.cap)}" aria-label="Captcha code"></div></div>`;

function draw() {
  const C = SAMPLE_CITIZEN;
  const citizenBody = {
    regular: `${field(t("lgUser"), "c-user", C.username)}${field(t("opPassword"), "c-pw", C.password, "password", "lock")}${capHtml()}
      <button class="btn lg-go" type="submit">${esc(t("login"))} ${icon.right}</button>`,
    otp: `<div class="lg-row">${field(t("lgMobile"), "c-mob", C.mobile, "tel", "pin")}<button type="button" class="btn lg-otp" id="send-otp">${esc(t("lgSendOtp"))}</button></div>
      ${field("OTP", "c-otp", C.otp, "text", "lock", 'inputmode="numeric" maxlength="6"')}${capHtml()}
      <button class="btn lg-go" type="submit">${esc(t("lgVerify"))} ${icon.right}</button>`,
    aadhaar: `${field(t("lgAadhaar"), "c-aad", C.aadhaar, "text", "shield", 'inputmode="numeric"')}
      ${field(t("lgAadhaarOtp"), "c-aotp", C.otp, "text", "lock", 'inputmode="numeric" maxlength="6"')}
      <button class="btn lg-go green" type="submit">${esc(t("lgVerify"))} ${icon.right}</button>
      <p class="fine lg-note">${esc(t("lgAadhaarNote"))}</p>`,
  }[state.mode];

  const accs = (state.accounts || []).filter((a) => a.state === state.st);
  const acct = accs.find((a) => a.username === state.user) || accs[0];
  if (acct) state.user = acct.username;
  const officerBody = `
    <div class="lg-f"><label for="o-st">${esc(t("state"))}</label><select class="select" id="o-st"><option value="">${esc(t("lgPickState"))}</option>${Object.entries(STATES).map(([c, s]) =>
      `<option value="${c}" ${c === state.st ? "selected" : ""}>${esc(s.name)} · ${esc(s.native)}</option>`).join("")}</select></div>
    <div class="lg-f"><label for="o-role">${esc(t("lgDept"))}</label><select class="select" id="o-role" ${accs.length ? "" : "disabled"}>${accs.length ? accs.map((a) =>
      `<option value="${esc(a.username)}" ${a.username === state.user ? "selected" : ""}>${esc(a.designation)} — ${esc(a.office)}</option>`).join("") : `<option>${esc(t("lgStateFirst"))}</option>`}</select></div>
    ${acct ? `<p class="fine lg-dept">${esc(acct.department)} · ${esc(acct.login_category)}</p>` : ""}
    ${field(t("opOfficerId"), "o-user", acct?.username || "", "text", "user", acct ? "" : "disabled")}
    ${field(t("opPassword"), "o-pw", acct ? OFFICER_PW : "", "password", "lock", acct ? "" : "disabled")}
    <button class="btn lg-go" type="submit" ${acct ? "" : "disabled"}>${esc(t("opSignIn"))} ${icon.right}</button>`;

  dlg.innerHTML = `<form class="lg-card" id="lg-form-in" novalidate>
    <div class="lg-top"></div>
    <header class="lg-brand"><span class="lg-mark">${icon.map}</span><div><b>BhuSamhita</b><small>${esc(t("tagline"))}</small></div>
      <button type="button" class="icon-btn lg-x" aria-label="${esc(t("close"))}">${icon.close}</button></header>
    <div class="lg-notice"><span>${esc(t("lgNotice"))}</span></div>
    <div class="lg-side seg">${[["citizen", t("lgCitizen")], ["officer", t("lgOfficer")]].map(([k, l]) => `<button type="button" data-side="${k}" class="${state.side === k ? "on" : ""}">${l}</button>`).join("")}</div>
    ${state.side === "citizen" ? `<div class="lg-modes">${["regular", "otp", "aadhaar"].map((k) => [k, t("m_" + k)]).map(([k, l]) =>
      `<button type="button" data-mode="${k}" class="${state.mode === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="lg-body">${state.side === "citizen" ? citizenBody : officerBody}</div>
    <div id="lg-err" aria-live="polite"></div>
  </form>`;

  const f = dlg.querySelector("form"), $ = (s) => dlg.querySelector(s);
  $(".lg-x").onclick = () => dlg.close();
  dlg.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => { state.side = b.dataset.side; draw(); });
  dlg.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { state.mode = b.dataset.mode; state.cap = captcha(); draw(); });
  $("#cap-new")?.addEventListener("click", () => { state.cap = captcha(); draw(); });
  $("#send-otp")?.addEventListener("click", () => toast(`${t("lgOtpSent")} ${$("#c-mob").value}`, "ok"));
  $("#o-st")?.addEventListener("change", (e) => { state.st = e.target.value; state.user = ""; draw(); });
  $("#o-role")?.addEventListener("change", (e) => { state.user = e.target.value; draw(); });
  f.onsubmit = (e) => { e.preventDefault(); state.side === "citizen" ? citizenIn() : officerIn(); };
}

const err = (m) => { dlg.querySelector("#lg-err").innerHTML = `<div class="notice bad">${icon.alert}<span>${esc(m)}</span></div>`; };

function citizenIn() {
  const $ = (s) => dlg.querySelector(s), C = SAMPLE_CITIZEN;
  if ($("#cap") && $("#cap").value.trim().toUpperCase() !== state.cap) return err(t("lgErrCaptcha"));
  let ok = false, method = "";
  if (state.mode === "regular") { ok = $("#c-user").value.trim() === C.username && $("#c-pw").value === C.password; method = "Regular login"; }
  if (state.mode === "otp") { ok = $("#c-mob").value.trim() === C.mobile && $("#c-otp").value.trim() === C.otp; method = "OTP login"; }
  if (state.mode === "aadhaar") { ok = $("#c-aad").value.replace(/\s/g, "") === C.aadhaar.replace(/\s/g, "") && $("#c-aotp").value.trim() === C.otp; method = "Aadhaar login"; }
  if (!ok) return err(t("lgErrDetails"));
  session.clear();
  citizen.set({ name: C.name, username: C.username, method, mode: state.mode });
  dlg.close();
  toast(`${t("opSignedOk")} · ${C.name}`, "ok");
  finish(next);
}

async function officerIn() {
  const $ = (s) => dlg.querySelector(s);
  try {
    const r = await api.login($("#o-user").value.trim(), $("#o-pw").value);
    citizen.clear();
    session.set(r.token, { ...r.officer, username: $("#o-user").value.trim() });
    dlg.close();
    toast(`${t("opSignedOk")} · ${r.officer.name}`, "ok");
    finish("#/officer");
  } catch (e) { err(e.status === 401 ? t("opErrAuth") : e.message); }
}

function finish(hash) {
  if (hash && hash !== location.hash) location.hash = hash;
  else window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function signOut() {
  citizen.clear();
  api.logout?.().catch?.(() => {});
  session.clear();
  toast(t("lgSignedOut"), "info");
  location.hash = "#/";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

// Header buttons anywhere in the app.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-login], [data-logout]");
  if (!a) return;
  e.preventDefault();
  if (a.hasAttribute("data-logout")) signOut(); else openLogin(null, a.dataset.login || "citizen");
});
