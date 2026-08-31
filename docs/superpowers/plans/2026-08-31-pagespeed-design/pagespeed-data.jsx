/* ===== OTS — date monitorizare Google PageSpeed Insights ===== */

const PSI_WEEKS = [
  { id: "2026-W26", label: "S26", short: "22 iun.", full: "22 iun. 2026" },
  { id: "2026-W27", label: "S27", short: "29 iun.", full: "29 iun. 2026" },
  { id: "2026-W28", label: "S28", short: "6 iul.",  full: "6 iul. 2026" },
  { id: "2026-W29", label: "S29", short: "13 iul.", full: "13 iul. 2026" },
  { id: "2026-W30", label: "S30", short: "20 iul.", full: "20 iul. 2026" },
  { id: "2026-W31", label: "S31", short: "27 iul.", full: "27 iul. 2026" },
  { id: "2026-W32", label: "S32", short: "3 aug.",  full: "3 aug. 2026" },
  { id: "2026-W33", label: "S33", short: "10 aug.", full: "10 aug. 2026" },
  { id: "2026-W34", label: "S34", short: "17 aug.", full: "17 aug. 2026" },
  { id: "2026-W35", label: "S35", short: "24 aug.", full: "24 aug. 2026" },
];

const PSI_CLIENTS = ["Heylux SRL", "Beauty One Medical Europa SRL", "Wow Agency", "Lucky Group SRL", "Team Wash Luxury SRL", "Navitech Systems SRL", "One Top Solution SRL", "PROFI Loco"];
const PSI_CMS = ["WordPress", "WooCommerce", "PrestaShop", "Next.js", "Shopify", "Magento", "HTML static", "Altul"];

/* m/d = scor Performance la ultima scanare; trend = puncte/săptămână; jump = cât a pierdut (+) în ultima săptămână
   ch = caracterul site-ului (multiplicatori pe metrici) */
const PSI_SITES_DEFAULT = [
  { id: "heylux", domain: "heylux.com", name: "Heylux Studio", client: "Heylux SRL", cms: "WordPress", active: true, added: "12 feb. 2026", alert: 5,
    pages: [{ url: "https://heylux.com/", label: "Homepage" }, { url: "https://heylux.com/cariere", label: "Cariere" }, { url: "https://heylux.com/blog", label: "Blog" }],
    m: { perf: 58, trend: -0.9, jump: 9 }, d: { perf: 88, trend: -0.4, jump: 4 }, ch: { lcp: 1.15, tbt: 1.25, cls: 0.9, inp: 1.05 } },
  { id: "beautyoneshop", domain: "beautyoneshop.ro", name: "Beauty One Shop", client: "Beauty One Medical Europa SRL", cms: "WooCommerce", active: true, added: "3 nov. 2025", alert: 5,
    pages: [{ url: "https://beautyoneshop.ro/", label: "Homepage" }, { url: "https://beautyoneshop.ro/categorie/ingrijire-ten", label: "Categorie" }, { url: "https://beautyoneshop.ro/produs/serum-vitamina-c", label: "Produs" }, { url: "https://beautyoneshop.ro/cos", label: "Coș" }],
    m: { perf: 34, trend: 1.1, jump: -2 }, d: { perf: 71, trend: 0.9, jump: -1 }, ch: { lcp: 1.3, tbt: 1.45, cls: 1.2, inp: 1.3 } },
  { id: "beonemedical", domain: "beonemedical.ro", name: "Be One Medical", client: "Beauty One Medical Europa SRL", cms: "WordPress", active: true, added: "3 nov. 2025", alert: 5,
    pages: [{ url: "https://beonemedical.ro/", label: "Homepage" }, { url: "https://beonemedical.ro/servicii", label: "Servicii" }],
    m: { perf: 72, trend: 1.4, jump: -3 }, d: { perf: 94, trend: 0.5, jump: -1 }, ch: { lcp: 0.95, tbt: 0.9, cls: 0.7, inp: 0.9 } },
  { id: "wowagency", domain: "wow-agency.com", name: "Wow Agency", client: "Wow Agency", cms: "Next.js", active: true, added: "22 iun. 2025", alert: 5,
    pages: [{ url: "https://wow-agency.com/", label: "Homepage" }, { url: "https://wow-agency.com/portofoliu", label: "Portofoliu" }],
    m: { perf: 91, trend: 0.4, jump: 0 }, d: { perf: 99, trend: 0.1, jump: 0 }, ch: { lcp: 0.7, tbt: 0.6, cls: 0.4, inp: 0.65 } },
  { id: "luckygroup", domain: "luckygroup.ro", name: "Lucky Group", client: "Lucky Group SRL", cms: "WordPress", active: true, added: "18 ian. 2026", alert: 5,
    pages: [{ url: "https://luckygroup.ro/", label: "Homepage" }, { url: "https://luckygroup.ro/cariere", label: "Cariere" }],
    m: { perf: 47, trend: 0.1, jump: 1 }, d: { perf: 79, trend: 0.2, jump: 0 }, ch: { lcp: 1.1, tbt: 1.1, cls: 1.9, inp: 1.15 } },
  { id: "teamwash", domain: "teamwashluxury.ro", name: "Team Wash Luxury", client: "Team Wash Luxury SRL", cms: "PrestaShop", active: true, added: "9 mar. 2026", alert: 5,
    pages: [{ url: "https://teamwashluxury.ro/", label: "Homepage" }, { url: "https://teamwashluxury.ro/servicii", label: "Servicii" }],
    m: { perf: 64, trend: 0.6, jump: -2 }, d: { perf: 90, trend: 0.3, jump: 0 }, ch: { lcp: 1.0, tbt: 1.0, cls: 1.0, inp: 1.0 } },
  { id: "navitech", domain: "navitech.ro", name: "Navitech Systems", client: "Navitech Systems SRL", cms: "Magento", active: true, added: "5 mai 2026", alert: 5,
    pages: [{ url: "https://navitech.ro/", label: "Homepage" }, { url: "https://navitech.ro/produse", label: "Listare produse" }],
    m: { perf: 41, trend: -0.5, jump: 7 }, d: { perf: 74, trend: -0.3, jump: 5 }, ch: { lcp: 1.2, tbt: 1.6, cls: 1.1, inp: 1.4 } },
  { id: "ots", domain: "onetopsolution.ro", name: "One Top Solution", client: "One Top Solution SRL", cms: "Next.js", active: true, added: "1 sep. 2025", alert: 3,
    pages: [{ url: "https://onetopsolution.ro/", label: "Homepage" }, { url: "https://onetopsolution.ro/pachete-hosting", label: "Pachete hosting" }],
    m: { perf: 83, trend: 0.7, jump: -1 }, d: { perf: 97, trend: 0.2, jump: 0 }, ch: { lcp: 0.8, tbt: 0.75, cls: 0.6, inp: 0.8 } },
  { id: "profiloco", domain: "profiloco.ro", name: "PROFI Loco", client: "PROFI Loco", cms: "WordPress", active: false, added: "14 apr. 2026", alert: 5,
    pages: [{ url: "https://profiloco.ro/", label: "Homepage" }],
    m: { perf: 55, trend: 0, jump: 0 }, d: { perf: 85, trend: 0, jump: 0 }, ch: { lcp: 1.05, tbt: 1.1, cls: 1.0, inp: 1.0 }, pausedAt: "2 aug. 2026" },
];

const PSI_SCHEDULE_DEFAULT = {
  day: "Luni", hour: "07:00", tz: "Europe/Bucharest",
  strategies: ["mobile", "desktop"],
  recipients: ["andrei@onetopsolution.ro", "seo@onetopsolution.ro"],
  onlyOnDrop: false, threshold: 5, attachPdf: true, sendToClient: false, includeOpportunities: true,
};

const PSI_REPORTS = [
  { week: "S35", date: "24 aug. 2026, 07:04", sites: 8, avgM: 61, avgD: 87, dM: -3, alerts: 2, status: "sent" },
  { week: "S34", date: "17 aug. 2026, 07:03", sites: 8, avgM: 64, avgD: 88, dM: 1, alerts: 0, status: "sent" },
  { week: "S33", date: "10 aug. 2026, 07:05", sites: 8, avgM: 63, avgD: 88, dM: 2, alerts: 1, status: "sent" },
  { week: "S32", date: "3 aug. 2026, 07:02", sites: 9, avgM: 61, avgD: 87, dM: -1, alerts: 1, status: "sent" },
  { week: "S31", date: "27 iul. 2026, 07:11", sites: 9, avgM: 62, avgD: 87, dM: 0, alerts: 0, status: "partial", note: "navitech.ro — timeout API, reluat manual" },
  { week: "S30", date: "20 iul. 2026, 07:03", sites: 9, avgM: 62, avgD: 86, dM: 2, alerts: 1, status: "sent" },
];

const PSI_OPPS = [
  { id: "render-blocking", label: "Elimină resursele care blochează randarea", unit: "s", base: 1.35 },
  { id: "next-gen", label: "Servește imagini în format next-gen (WebP / AVIF)", unit: "s", base: 1.1 },
  { id: "offscreen", label: "Amână încărcarea imaginilor din afara ecranului", unit: "s", base: 0.85 },
  { id: "unused-js", label: "Reduce JavaScript-ul nefolosit", unit: "s", base: 1.5 },
  { id: "unused-css", label: "Reduce CSS-ul nefolosit", unit: "s", base: 0.6 },
  { id: "text-compression", label: "Activează compresia text (Brotli / Gzip)", unit: "s", base: 0.7 },
  { id: "cache", label: "Politici eficiente de cache pentru resurse statice", unit: "s", base: 0.45 },
  { id: "image-size", label: "Dimensionează corect imaginile", unit: "s", base: 0.9 },
  { id: "ttfb", label: "Reduce timpul de răspuns al serverului (TTFB)", unit: "s", base: 1.2 },
  { id: "lcp-preload", label: "Preîncarcă imaginea LCP", unit: "s", base: 0.55 },
  { id: "dom", label: "Evită dimensiuni DOM excesive", unit: "el", base: 2400 },
  { id: "third-party", label: "Reduce impactul codului third-party", unit: "s", base: 1.0 },
];

/* ---------- praguri Google ---------- */
const PSI_THRESHOLDS = {
  lcp: { good: 2.5, ni: 4.0, unit: "s", label: "LCP", name: "Largest Contentful Paint" },
  inp: { good: 200, ni: 500, unit: "ms", label: "INP", name: "Interaction to Next Paint" },
  cls: { good: 0.1, ni: 0.25, unit: "", label: "CLS", name: "Cumulative Layout Shift" },
  fcp: { good: 1.8, ni: 3.0, unit: "s", label: "FCP", name: "First Contentful Paint" },
  tbt: { good: 200, ni: 600, unit: "ms", label: "TBT", name: "Total Blocking Time" },
  si:  { good: 3.4, ni: 5.8, unit: "s", label: "SI",  name: "Speed Index" },
};

function psiScoreLevel(v) { return v == null ? "none" : v >= 90 ? "good" : v >= 50 ? "ni" : "poor"; }
function psiMetricLevel(key, v) {
  const t = PSI_THRESHOLDS[key]; if (!t || v == null) return "none";
  return v <= t.good ? "good" : v <= t.ni ? "ni" : "poor";
}
function psiFmt(key, v) {
  if (v == null) return "—";
  if (key === "cls") return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  if (PSI_THRESHOLDS[key].unit === "ms") return Math.round(v) + " ms";
  return v.toFixed(1).replace(".", ",") + " s";
}

/* ---------- generator determinist ---------- */
function psiHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function psiRng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const psiClamp = (v, a, b) => Math.max(a, Math.min(b, v));

function psiMetrics(site, strategy, perf) {
  const ch = site.ch || { lcp: 1, tbt: 1, cls: 1, inp: 1 };
  const gap = 100 - perf;
  const desk = strategy === "desktop";
  const k = desk ? 0.38 : 1;
  return {
    perf,
    lcp: +psiClamp((1.4 + gap * 0.058) * ch.lcp * (desk ? 0.42 : 1), 0.6, 12).toFixed(2),
    fcp: +psiClamp((0.85 + gap * 0.030) * (desk ? 0.45 : 1), 0.3, 8).toFixed(2),
    si:  +psiClamp((1.7 + gap * 0.058) * (desk ? 0.45 : 1), 0.6, 14).toFixed(2),
    tbt: Math.round(psiClamp((30 + gap * 11) * ch.tbt * (desk ? 0.22 : 1), 0, 4000)),
    inp: Math.round(psiClamp((85 + gap * 3.4) * ch.inp * (desk ? 0.55 : 1), 40, 1200)),
    cls: +psiClamp((0.008 + gap * 0.0019) * ch.cls * (desk ? 0.6 : 1), 0, 0.6).toFixed(3),
    ttfb: Math.round(psiClamp((180 + gap * 9) * k, 60, 2500)),
    bytes: Math.round(psiClamp((900 + gap * 62) * (desk ? 1.15 : 1), 300, 9000)),
    requests: Math.round(psiClamp(28 + gap * 1.5, 12, 260)),
  };
}

/* istoric 10 săptămâni pentru un site + strategie */
function psiHistory(site, strategy) {
  const cfg = strategy === "desktop" ? site.d : site.m;
  const n = PSI_WEEKS.length;
  if (!cfg || cfg.perf == null) return [];
  const rnd = psiRng(psiHash(site.id + strategy));
  const prev = psiClamp(cfg.perf + (cfg.jump || 0), 1, 100);
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const back = n - 2 - i;
    out.push(Math.round(psiClamp(prev - (cfg.trend || 0) * back + (rnd() * 4.2 - 2.1), 1, 100)));
  }
  out.push(Math.round(cfg.perf));
  return out.map((perf, i) => ({ week: PSI_WEEKS[i], ...psiMetrics(site, strategy, perf) }));
}

/* scoruri secundare (stabile pe site) */
function psiCategories(site, strategy) {
  const rnd = psiRng(psiHash(site.id + "cat" + strategy));
  const cfg = strategy === "desktop" ? site.d : site.m;
  return {
    perf: cfg ? Math.round(cfg.perf) : null,
    a11y: Math.round(psiClamp(74 + rnd() * 24, 60, 100)),
    bp: Math.round(psiClamp(70 + rnd() * 30, 58, 100)),
    seo: Math.round(psiClamp(84 + rnd() * 16, 70, 100)),
  };
}

/* date reale utilizatori (CrUX, p75 pe 28 zile) */
function psiField(site, strategy) {
  const cfg = strategy === "desktop" ? site.d : site.m;
  if (!cfg || cfg.perf == null) return null;
  const rnd = psiRng(psiHash(site.id + "crux" + strategy));
  const lab = psiMetrics(site, strategy, cfg.perf);
  const noData = site.id === "teamwash" && strategy === "desktop";
  if (noData) return { noData: true };
  return {
    lcp: +(lab.lcp * (0.78 + rnd() * 0.2)).toFixed(2),
    inp: Math.round(lab.inp * (0.7 + rnd() * 0.3)),
    cls: +(lab.cls * (0.65 + rnd() * 0.35)).toFixed(3),
    origin: Math.round(4200 + rnd() * 38000),
  };
}

/* oportunități PSI pentru un site */
function psiOpportunities(site, strategy) {
  const cfg = strategy === "desktop" ? site.d : site.m;
  if (!cfg || cfg.perf == null) return [];
  const rnd = psiRng(psiHash(site.id + "opp" + strategy));
  const pool = PSI_OPPS.slice().sort(() => rnd() - 0.5);
  const count = cfg.perf < 50 ? 6 : cfg.perf < 80 ? 5 : 3;
  const gap = (100 - cfg.perf) / 100;
  return pool.slice(0, count).map(o => ({
    ...o,
    saving: o.unit === "el" ? Math.round(o.base * (0.6 + gap)) : +(o.base * (0.35 + gap * 1.2) * (strategy === "desktop" ? 0.45 : 1)).toFixed(2),
  })).sort((a, b) => (b.unit === "el" ? 0 : b.saving) - (a.unit === "el" ? 0 : a.saving));
}

function psiCwvPass(f) {
  if (!f || f.noData) return null;
  return f.lcp <= 2.5 && f.inp <= 200 && f.cls <= 0.1;
}

window.PSIData = {
  PSI_WEEKS, PSI_SITES_DEFAULT, PSI_SCHEDULE_DEFAULT, PSI_REPORTS, PSI_THRESHOLDS, PSI_CLIENTS, PSI_CMS, PSI_OPPS,
  psiScoreLevel, psiMetricLevel, psiFmt, psiHistory, psiCategories, psiField, psiOpportunities, psiCwvPass, psiMetrics, psiHash, psiRng,
};
