// What the user is looking at right now (page, selected place, open parcel).
// Pages update it; the LandGPT Assistant reads it and sends it with each question.
// Only identifiers are kept here - the server looks up the records itself.
const ctx = { page: "home" };
const subs = new Set();

export function setContext(patch, { replace = false } = {}) {
  if (replace) for (const k of Object.keys(ctx)) delete ctx[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v == null || v === "") delete ctx[k]; else ctx[k] = v;
  }
  subs.forEach((f) => f(getContext()));
}

export const getContext = () => ({ ...ctx });

export function onContext(f) { subs.add(f); return () => subs.delete(f); }

// The last parcel the user opened (summary fields only), so parcel-based services can offer it again.
const RECENT = "ls-recent-parcel";
export function rememberParcel(p) {
  if (!p?.ulpin) return;
  const keep = ["ulpin", "native_label", "village", "sub_district", "sub_district_type", "district", "state_code"];
  try { sessionStorage.setItem(RECENT, JSON.stringify(Object.fromEntries(keep.map((k) => [k, p[k]])))); } catch {}
}
export function recentParcel() { try { return JSON.parse(sessionStorage.getItem(RECENT)); } catch { return null; } }
