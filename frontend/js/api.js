// Thin client for the Land Stack /v1 API (same origin). All portal data comes from here.
const BASE = "/v1";
const cache = new Map();

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || body?.detail || `Request failed (${status})`);
    this.status = status; this.code = body?.error?.code; this.body = body;
  }
}

function token() { try { return sessionStorage.getItem("ls-token"); } catch { return null; } }

async function request(path, { method = "GET", body, auth = false, fresh = false } = {}) {
  const key = method === "GET" && !auth ? path : null;
  if (key && !fresh && cache.has(key)) return cache.get(key);
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (auth && token()) headers.Authorization = `Bearer ${token()}`;
  const p = fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status, data);
    return data;
  });
  if (key) { cache.set(key, p); p.catch(() => cache.delete(key)); }
  return p;
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ""));
  return s.toString() ? `?${s}` : "";
};

export const api = {
  health: () => request("/health"),
  parcels: (state) => request(`/gis/parcels${q({ state })}`),
  hierarchy: () => request("/admin/hierarchy"),
  search: (text, state) => request(`/search${q({ q: text, state })}`, { fresh: true }),
  registry: (u) => request(`/registry/ulpin/${u}`),
  summary: (u) => request(`/parcels/${u}`),
  profile: (u) => request(`/parcels/${u}/profile`),
  gis: (u) => request(`/parcels/${u}/gis`),
  verification: (u) => request(`/parcels/${u}/verification`),
  ownership: (u) => request(`/parcels/${u}/ownership`),
  findings: (state, district) => request(`/validation/findings${q({ state, district })}`),
  rules: () => request("/validation/rules"),
  reports: (state, district) => request(`/reports/summary${q({ state, district })}`),
  dataQuality: () => request("/analytics/data-quality"),
  glossary: (concept) => request(`/glossary/${concept}`),
  assistantStatus: () => request("/assistant/status", { fresh: true }),
  assistantContext: (u) => request(`/parcels/${u}/assistant-context`),
  ask: (ulpin, question) => request("/assistant/ask", { method: "POST", body: { ulpin, question } }),
  // officer (authenticated, never cached)
  accounts: () => request("/officer/accounts"),
  login: (username, password) => request("/officer/login", { method: "POST", body: { username, password } }),
  me: () => request("/officer/me", { auth: true }),
  logout: () => request("/officer/logout", { method: "POST", auth: true }),
  work: () => request("/officer/work", { auth: true }),
  act: (item_id, action, remarks, to) => request("/officer/actions", { method: "POST", auth: true, body: { item_id, action, remarks, to } }),
  officerParcel: (u) => request(`/officer/parcels/${u}`, { auth: true }),
  officerReports: () => request("/officer/reports", { auth: true }),
  audit: (ulpin) => request(`/officer/audit${q({ ulpin })}`, { auth: true }),
};

export const session = {
  get token() { return token(); },
  get officer() { try { return JSON.parse(sessionStorage.getItem("ls-officer")); } catch { return null; } },
  set(tok, officer) { sessionStorage.setItem("ls-token", tok); sessionStorage.setItem("ls-officer", JSON.stringify(officer)); },
  clear() { sessionStorage.removeItem("ls-token"); sessionStorage.removeItem("ls-officer"); },
};
