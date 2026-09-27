import { api } from "./api.js";
import { t } from "./i18n.js";
import { esc, icon } from "./ui.js";

const SUGGESTED = ["Why is this parcel flagged?", "What records are connected to this ULPIN?", "Why does the GIS area differ?", "Summarize this verification case."];

// Minimal, safe rendering of the assistant's plain-text answer (paragraphs, bullet lines, citations).
function renderAnswer(text) {
  return esc(text).split(/\n{2,}/).map(block => {
    const lines = block.split("\n");
    if (lines.every(l => /^\s*[-*•]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${l.replace(/^\s*[-*•]\s+/, "")}</li>`).join("")}</ul>`;
    return `<p>${lines.join("<br>")}</p>`;
  }).join("").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]/g, '<code class="cite">$1</code>');
}

export async function assistantPanel(el, ulpin) {
  el.innerHTML = `<header><h2>${icon.spark} ${esc(t("askTitle"))}</h2></header><div class="body" id="as-body"><div class="loading"><span class="spinner"></span></div></div>`;
  const body = el.querySelector("#as-body");
  let status;
  try { status = await api.assistantStatus(); } catch { status = { configured: false, required_env: "ANTHROPIC_API_KEY" }; }

  const grounding = `<details class="grounding"><summary>Grounding data for this ULPIN</summary><pre id="as-ctx">Loading…</pre></details>`;
  if (!status.configured) {
    body.innerHTML = `<div class="notice info">${icon.info}<span>${esc(t("assistantOff"))} Set <code>${esc(status.required_env)}</code> on the API server to enable answers grounded in this parcel's records and validation results.</span></div>${grounding}`;
  } else {
    body.innerHTML = `<p class="fine">Answers use only this parcel's connected records and validation findings (${esc(status.model)}).</p>
      <div class="chips">${SUGGESTED.map(s => `<button class="chip btn-chip" data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>
      <form class="ask" id="as-form"><input class="input" id="as-q" maxlength="1000" placeholder="${esc(t("askPh"))}" aria-label="${esc(t("askPh"))}"><button class="btn primary" type="submit">${esc(t("ask"))}</button></form>
      <div id="as-out" aria-live="polite"></div>${grounding}`;
    const out = body.querySelector("#as-out"), input = body.querySelector("#as-q");
    const ask = async (question) => {
      if (!question.trim()) return;
      out.insertAdjacentHTML("afterbegin", `<div class="qa pending"><div class="q">${esc(question)}</div><div class="a"><span class="spinner"></span></div></div>`);
      const node = out.firstElementChild;
      try {
        const r = await api.ask(ulpin, question);
        node.classList.remove("pending");
        node.querySelector(".a").innerHTML = `${renderAnswer(r.answer)}<p class="fine">${esc(t("groundedOn"))}: ${r.grounding.records.length} records · rules ${esc(r.grounding.rules.join(", ") || "none")} · ${esc(r.model)}</p>`;
      } catch (e) {
        node.classList.remove("pending");
        node.querySelector(".a").innerHTML = `<div class="notice bad">${icon.alert}<span>${esc(e.message)}</span></div>`;
      }
    };
    body.querySelector("#as-form").onsubmit = (e) => { e.preventDefault(); ask(input.value); input.value = ""; };
    body.querySelectorAll("[data-q]").forEach(b => b.onclick = () => ask(b.dataset.q));
  }
  body.querySelector(".grounding").addEventListener("toggle", async (e) => {
    if (!e.target.open) return;
    const pre = body.querySelector("#as-ctx");
    if (pre.dataset.loaded) return;
    try { pre.textContent = JSON.stringify(await api.assistantContext(ulpin), null, 2); pre.dataset.loaded = "1"; }
    catch (err) { pre.textContent = err.message; }
  });
}
