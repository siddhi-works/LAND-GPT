// BhuSamhita Assistant - the citizen's general land-information assistant, one floating window for the
// citizen pages. It answers land-record questions (terms, offices, where to find a record) and, when the
// user has a parcel open, questions about that parcel. It is not part of the government officer portal.
// Talks only to the backend (/v1/chat); the backend picks the AI provider or its built-in answers.
import { api } from "./api.js";
import { getContext, onContext } from "./context.js";
import { getLang, t } from "./i18n.js";
import { STATES } from "./states.js";
import { renderAnswer } from "./assistant.js";
import { esc, fmtUlpin, icon } from "./ui.js";

const KEY = "ls-chat";
const SUGGEST = ["qGat", "q712", "qKhatauni", "qMutWhere", "qDept", "qUlpin", "qFind"];
const SUGGEST_PARCEL = ["qExplain", "qIsVerified", "qOwner"];
const officerRoute = () => location.hash.startsWith("#/officer");

let state = { open: false, busy: false, status: null, msgs: load() };
let el = null;

function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || []; } catch { return []; } }
function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state.msgs.slice(-40))); } catch {} }
const time = (ts) => new Date(ts).toLocaleTimeString(getLang() === "en" ? "en-IN" : `${getLang()}-IN`, { hour: "2-digit", minute: "2-digit" });

/** Open the assistant; optionally ask a question straight away. */
export function openChat(question) {
  if (!el || officerRoute()) return;
  state.open = true;
  render();
  if (question) send(question);
  else el.querySelector("#lg-input")?.focus();
}

export function mountChat() {
  if (el) return;
  el = document.createElement("div");
  el.className = "lg-chat";
  document.body.append(el);
  onContext(() => { if (state.open) renderContext(); });
  document.addEventListener("langchange", render);
  window.addEventListener("hashchange", () => { if (officerRoute()) state.open = false; render(); });
  // Any element with [data-chat] opens the assistant; a non-empty value is asked straight away.
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-chat]");
    if (!b || el.contains(b) || officerRoute()) return;
    e.preventDefault();
    openChat(b.dataset.chat || undefined);
  });
  render();
}

function contextLabel() {
  const c = getContext();
  if (c.ulpin) return `${t("chatParcel")} ${fmtUlpin(c.ulpin)}`;
  const parts = [c.state && STATES[c.state]?.name, c.district, c.sub_district, c.village].filter(Boolean);
  return parts.length ? parts.join(" › ") : t("chatNoContext");
}

function render() {
  if (!el) return;
  if (officerRoute()) { el.innerHTML = ""; return; }
  if (!state.open) {
    el.innerHTML = `<button class="lg-fab" id="lg-fab" aria-label="${esc(t("chatTitle"))}">${icon.spark}<span>${esc(t("chatAsk"))}</span></button>`;
    el.querySelector("#lg-fab").onclick = () => openChat();
    return;
  }
  const st = state.status;
  const modeBadge = st?.mode === "ai" ? `<span class="lg-mode ai" title="${esc(st.provider)} · ${esc(st.model || "")}">AI</span>` : "";
  el.innerHTML = `
    <section class="lg-panel" role="dialog" aria-label="${esc(t("chatTitle"))}">
      <header class="lg-head">
        <span class="lg-avatar">${icon.spark}</span>
        <div class="lg-title"><b>${esc(t("chatTitle"))}</b>${modeBadge}</div>
        <button class="icon-btn" id="lg-clear" title="${esc(t("chatClear"))}" aria-label="${esc(t("chatClear"))}">${icon.clear}</button>
        <button class="icon-btn" id="lg-close" title="${esc(t("close"))}" aria-label="${esc(t("close"))}">${icon.close}</button>
      </header>
      <div class="lg-ctx" id="lg-ctx"></div>
      <div class="lg-body" id="lg-body" aria-live="polite"></div>
      <form class="lg-form" id="lg-form">
        <input id="lg-input" class="input" maxlength="1000" autocomplete="off" placeholder="${esc(t("chatPh"))}" aria-label="${esc(t("chatPh"))}">
        <button class="btn primary" type="submit" aria-label="${esc(t("ask"))}">${icon.right}</button>
      </form>
    </section>
    <button class="lg-fab on" id="lg-fab" aria-label="${esc(t("close"))}">${icon.close}</button>`;
  el.querySelector("#lg-close").onclick = el.querySelector("#lg-fab").onclick = () => { state.open = false; render(); };
  el.querySelector("#lg-clear").onclick = () => { state.msgs = []; save(); renderBody(); };
  el.querySelector("#lg-form").onsubmit = (e) => { e.preventDefault(); const i = el.querySelector("#lg-input"); send(i.value); i.value = ""; };
  renderContext();
  renderBody();
  if (!state.status) api.chatStatus().then((s) => { state.status = s; if (state.open) render(); }).catch(() => { state.status = { mode: "demo" }; });
}

function renderContext() {
  const c = el.querySelector("#lg-ctx");
  if (c) c.innerHTML = `${icon.pin}<span>${esc(contextLabel())}</span>`;
}

function renderBody() {
  const body = el?.querySelector("#lg-body");
  if (!body) return;
  const welcome = `<div class="lg-msg bot"><div class="lg-bubble">${esc(t("chatWelcome"))}</div></div>
    ${state.status?.mode !== "ai" && getLang() !== "en" ? `<p class="lg-note">${esc(t("chatDemoLang"))}</p>` : ""}`;
  const msgs = state.msgs.map((m, i) => {
    if (m.role === "user") return `<div class="lg-msg me"><div class="lg-bubble">${esc(m.content)}</div><time>${time(m.ts)}</time></div>`;
    if (m.error) return `<div class="lg-msg bot err"><div class="lg-bubble">${icon.alert} ${esc(m.content)}
      <button class="btn sm" data-retry="${i}">${esc(t("chatRetry"))}</button></div><time>${time(m.ts)}</time></div>`;
    const links = (m.links || []).map((l) => `<a class="chip btn-chip" href="${esc(l.href)}">${esc(l.label)} ›</a>`).join("");
    const sugg = i === state.msgs.length - 1 ? (m.suggestions || []).map((s) => `<button class="chip btn-chip" data-q="${esc(s)}">${esc(s)}</button>`).join("") : "";
    return `<div class="lg-msg bot"><div class="lg-bubble">${fmt(m.content)}${links ? `<div class="chips">${links}</div>` : ""}</div>
      <time>${time(m.ts)}</time>${sugg ? `<div class="chips lg-sugg">${sugg}</div>` : ""}</div>`;
  }).join("");
  const keys = getContext().ulpin ? [...SUGGEST_PARCEL, ...SUGGEST.slice(0, 4)] : SUGGEST;
  const starters = state.msgs.length ? "" : `<div class="lg-starters"><div class="eyebrow">${esc(t("chatTry"))}</div><div class="chips">${
    keys.map((k) => `<button class="chip btn-chip" data-q="${esc(t(k))}">${esc(t(k))}</button>`).join("")}</div></div>`;
  const typing = state.busy ? `<div class="lg-msg bot"><div class="lg-bubble lg-typing" aria-label="${esc(t("chatThinking"))}"><i></i><i></i><i></i></div></div>` : "";
  body.innerHTML = welcome + msgs + starters + typing;
  body.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => send(b.dataset.q));
  body.querySelectorAll("[data-retry]").forEach((b) => b.onclick = () => retry(+b.dataset.retry));
  body.querySelectorAll("a.chip").forEach((a) => a.addEventListener("click", () => { if (window.matchMedia("(max-width: 640px)").matches) { state.open = false; render(); } }));
  body.scrollTop = body.scrollHeight;
}

const fmt = (text) => renderAnswer(text).replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,:]|$)/g, "$1<i>$2</i>");

async function send(text) {
  text = String(text || "").trim();
  if (!text || state.busy) return;
  state.msgs.push({ role: "user", content: text, ts: Date.now() });
  await request();
}

function retry(i) {
  if (state.busy) return;
  state.msgs.splice(i, 1);                      // drop the error; the user turn before it is resent
  request();
}

async function request() {
  state.busy = true; save(); renderBody();
  const history = state.msgs.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })).slice(-20);
  try {
    const r = await api.chat(history, getContext(), getLang());
    state.msgs.push({ role: "assistant", content: r.reply, links: r.links, suggestions: r.suggestions, mode: r.mode, model: r.model, ts: Date.now() });
    if (!state.status || state.status.mode !== r.mode) state.status = { ...(state.status || {}), mode: r.mode, provider: r.provider, model: r.model };
  } catch (e) {
    const msg = e.status === 404 ? t("chatNoParcel") : e.status >= 500 || !e.status ? t("chatUnavailable") : e.message;
    state.msgs.push({ role: "assistant", error: true, content: msg, ts: Date.now() });
  } finally {
    state.busy = false; save();
    if (state.open) render();
  }
}
