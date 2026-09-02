/* ===== OTS — Rank Tracker: date monitorizare poziții Google organic ===== */

const RT_MONTHS = ["ian.", "feb.", "mar.", "apr.", "mai", "iun.", "iul.", "aug.", "sep.", "oct.", "nov.", "dec."];
const RT_WDAYS = ["dum.", "lun.", "mar.", "mie.", "joi", "vin.", "sâm."];

/* ultimele 30 de zile, ultima rulare = 1 sep. 2026 */
function rtBuildDays(n) {
  const end = new Date(2026, 8, 1);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000);
    out.push({
      id: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
      label: `${d.getDate()}`,
      short: `${d.getDate()} ${RT_MONTHS[d.getMonth()]}`,
      full: `${RT_WDAYS[d.getDay()]} ${d.getDate()} ${RT_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      wd: RT_WDAYS[d.getDay()],
    });
  }
  return out;
}
const RT_DAYS = rtBuildDays(30);
const RT_TODAY = RT_DAYS[RT_DAYS.length - 1];

const RT_FEATURES = {
  ai: { label: "AI Overview", short: "AI", color: "#8b5cf6" },
  snippet: { label: "Featured snippet", short: "FS", color: "#0ea5e9" },
  local: { label: "Local pack", short: "LP", color: "#10b981" },
  paa: { label: "People also ask", short: "PA", color: "#64748b" },
  images: { label: "Pachet imagini", short: "IM", color: "#f59e0b" },
  video: { label: "Video / YouTube", short: "VD", color: "#ef4444" },
  shopping: { label: "Google Shopping", short: "SH", color: "#0f766e" },
  ads: { label: "Anunțuri top", short: "AD", color: "#a16207" },
};

const RT_LOCALES = ["google.ro · ro", "google.com · en", "google.de · de", "google.hu · hu"];

const RT_PROJECTS_DEFAULT = [
  { id: "beautyoneshop", domain: "beautyoneshop.ro", name: "Beauty One Shop", client: "Beauty One Medical Europa SRL", locale: "google.ro · ro",
    locations: ["România", "București", "Cluj-Napoca"], active: true, added: "3 nov. 2025", alert: 5, competitors: ["notino.ro", "sephora.ro", "farmec.ro"] },
  { id: "beonemedical", domain: "beonemedical.ro", name: "Be One Medical", client: "Beauty One Medical Europa SRL", locale: "google.ro · ro",
    locations: ["România", "Cluj-Napoca"], active: true, added: "3 nov. 2025", alert: 4, competitors: ["reginamaria.ro", "medlife.ro", "dr-leventer.ro"] },
  { id: "teamwash", domain: "teamwashluxury.ro", name: "Team Wash Luxury", client: "Team Wash Luxury SRL", locale: "google.ro · ro",
    locations: ["București", "Ilfov"], active: true, added: "9 mar. 2026", alert: 5, competitors: ["autoperfect.ro", "detailingpro.ro"] },
  { id: "ots", domain: "onetopsolution.ro", name: "One Top Solution", client: "One Top Solution SRL", locale: "google.ro · ro",
    locations: ["România"], active: true, added: "1 sep. 2025", alert: 3, competitors: ["hostico.ro", "gazduire.ro", "romarg.ro"] },
  { id: "heylux", domain: "heylux.com", name: "Heylux Studio", client: "Heylux SRL", locale: "google.com · en",
    locations: ["Global", "Germania"], active: true, added: "12 feb. 2026", alert: 6, competitors: ["luxstudio.io", "brandhaus.de"] },
  { id: "profiloco", domain: "profiloco.ro", name: "PROFI Loco", client: "PROFI Loco", locale: "google.ro · ro",
    locations: ["România"], active: false, added: "14 apr. 2026", alert: 5, competitors: ["profi.ro"], pausedAt: "2 aug. 2026" },
];

/* pos = poziția azi pe desktop; p30 = poziția acum 30 zile; mob = diferență pe mobil (+ = mai jos)
   101 = în afara top 100 */
const RT_KEYWORDS_DEFAULT = [
  /* --- beautyoneshop.ro --- */
  { id: "k01", pj: "beautyoneshop", kw: "serum vitamina c", tag: "Produse", vol: 4400, kd: 42, loc: "România", pos: 4, p30: 11, mob: 1, url: "/produs/serum-vitamina-c", feats: ["ai", "shopping", "paa"], ai: "cited", comps: { "notino.ro": 2, "sephora.ro": 6, "farmec.ro": 14 } },
  { id: "k02", pj: "beautyoneshop", kw: "creme pentru ten uscat", tag: "Categorii", vol: 2900, kd: 38, loc: "România", pos: 7, p30: 9, mob: 2, url: "/categorie/ingrijire-ten", feats: ["ai", "paa"], ai: "present", comps: { "notino.ro": 1, "sephora.ro": 4, "farmec.ro": 8 } },
  { id: "k03", pj: "beautyoneshop", kw: "acid hialuronic pentru fata", tag: "Produse", vol: 3600, kd: 45, loc: "România", pos: 12, p30: 8, mob: 3, url: "/produs/acid-hialuronic", feats: ["shopping", "images"], ai: null, comps: { "notino.ro": 3, "sephora.ro": 5, "farmec.ro": 11 } },
  { id: "k04", pj: "beautyoneshop", kw: "cosmetice coreene online", tag: "Categorii", vol: 1900, kd: 34, loc: "România", pos: 2, p30: 3, mob: 0, url: "/categorie/k-beauty", feats: ["snippet", "shopping"], ai: null, comps: { "notino.ro": 4, "sephora.ro": 9, "farmec.ro": 22 } },
  { id: "k05", pj: "beautyoneshop", kw: "protectie solara spf 50", tag: "Sezonier", vol: 8100, kd: 51, loc: "România", pos: 18, p30: 14, mob: 5, url: "/categorie/protectie-solara", feats: ["ai", "shopping", "ads"], ai: "present", comps: { "notino.ro": 1, "sephora.ro": 3, "farmec.ro": 6 } },
  { id: "k06", pj: "beautyoneshop", kw: "magazin cosmetice bucuresti", tag: "Local", vol: 1300, kd: 29, loc: "București", pos: 3, p30: 6, mob: 1, url: "/", feats: ["local", "paa"], ai: null, comps: { "notino.ro": 8, "sephora.ro": 2, "farmec.ro": 12 } },
  { id: "k07", pj: "beautyoneshop", kw: "retinol pentru incepatori", tag: "Blog", vol: 2400, kd: 26, loc: "România", pos: 6, p30: 21, mob: 1, url: "/blog/retinol-ghid", altUrl: "/produs/retinol-05", feats: ["ai", "snippet", "paa"], ai: "cited", comps: { "notino.ro": 9, "sephora.ro": 15, "farmec.ro": 4 } },
  { id: "k08", pj: "beautyoneshop", kw: "set cadou cosmetice", tag: "Sezonier", vol: 5400, kd: 47, loc: "România", pos: 34, p30: 29, mob: 6, url: "/categorie/seturi-cadou", feats: ["shopping", "images", "ads"], ai: null, comps: { "notino.ro": 2, "sephora.ro": 5, "farmec.ro": 7 } },
  /* --- beonemedical.ro --- */
  { id: "k11", pj: "beonemedical", kw: "clinica dermatologie cluj", tag: "Local", vol: 1600, kd: 31, loc: "Cluj-Napoca", pos: 2, p30: 4, mob: 0, url: "/servicii/dermatologie", feats: ["local", "paa"], ai: null, comps: { "reginamaria.ro": 5, "medlife.ro": 7, "dr-leventer.ro": 3 } },
  { id: "k12", pj: "beonemedical", kw: "tratament acnee laser", tag: "Servicii", vol: 2200, kd: 44, loc: "România", pos: 9, p30: 13, mob: 2, url: "/servicii/laser-acnee", feats: ["ai", "paa", "video"], ai: "present", comps: { "reginamaria.ro": 2, "medlife.ro": 4, "dr-leventer.ro": 6 } },
  { id: "k13", pj: "beonemedical", kw: "consult dermatologic preturi", tag: "Servicii", vol: 880, kd: 22, loc: "România", pos: 5, p30: 5, mob: 1, url: "/tarife", feats: ["snippet", "paa"], ai: null, comps: { "reginamaria.ro": 1, "medlife.ro": 3, "dr-leventer.ro": 8 } },
  { id: "k14", pj: "beonemedical", kw: "botox cluj napoca", tag: "Local", vol: 1900, kd: 36, loc: "Cluj-Napoca", pos: 6, p30: 3, mob: 2, url: "/servicii/botox", feats: ["local", "ads"], ai: null, comps: { "reginamaria.ro": 4, "medlife.ro": 11, "dr-leventer.ro": 2 } },
  { id: "k15", pj: "beonemedical", kw: "cum scapi de cicatrici", tag: "Blog", vol: 3300, kd: 27, loc: "România", pos: 14, p30: 26, mob: 3, url: "/blog/cicatrici", feats: ["ai", "paa"], ai: "cited", comps: { "reginamaria.ro": 6, "medlife.ro": 9, "dr-leventer.ro": 12 } },
  { id: "k16", pj: "beonemedical", kw: "epilare definitiva pret", tag: "Servicii", vol: 4700, kd: 49, loc: "România", pos: 22, p30: 19, mob: 4, url: "/servicii/epilare-laser", feats: ["ads", "paa"], ai: null, comps: { "reginamaria.ro": 3, "medlife.ro": 5, "dr-leventer.ro": 10 } },
  /* --- teamwashluxury.ro --- */
  { id: "k21", pj: "teamwash", kw: "detailing auto bucuresti", tag: "Local", vol: 1100, kd: 28, loc: "București", pos: 1, p30: 2, mob: 0, url: "/servicii/detailing", feats: ["local", "images"], ai: null, comps: { "autoperfect.ro": 3, "detailingpro.ro": 2 } },
  { id: "k22", pj: "teamwash", kw: "polish faruri pret", tag: "Servicii", vol: 720, kd: 19, loc: "București", pos: 4, p30: 7, mob: 1, url: "/servicii/polish-faruri", feats: ["snippet", "local"], ai: null, comps: { "autoperfect.ro": 2, "detailingpro.ro": 6 } },
  { id: "k23", pj: "teamwash", kw: "ceramica auto protectie vopsea", tag: "Servicii", vol: 1400, kd: 35, loc: "România", pos: 11, p30: 16, mob: 2, url: "/servicii/ceramica", feats: ["ai", "video"], ai: "present", comps: { "autoperfect.ro": 5, "detailingpro.ro": 3 } },
  { id: "k24", pj: "teamwash", kw: "spalatorie auto premium", tag: "Local", vol: 590, kd: 24, loc: "Ilfov", pos: 8, p30: 5, mob: 3, url: "/", feats: ["local", "ads"], ai: null, comps: { "autoperfect.ro": 1, "detailingpro.ro": 4 } },
  { id: "k25", pj: "teamwash", kw: "curatare tapiterie auto", tag: "Servicii", vol: 2600, kd: 33, loc: "București", pos: 19, p30: 31, mob: 4, url: "/servicii/tapiterie", feats: ["paa", "images"], ai: null, comps: { "autoperfect.ro": 2, "detailingpro.ro": 7 } },
  { id: "k26", pj: "teamwash", kw: "cat costa un detailing complet", tag: "Blog", vol: 480, kd: 15, loc: "România", pos: 3, p30: 12, mob: 0, url: "/blog/cost-detailing", feats: ["snippet", "ai", "paa"], ai: "cited", comps: { "autoperfect.ro": 9, "detailingpro.ro": 5 } },
  /* --- onetopsolution.ro --- */
  { id: "k31", pj: "ots", kw: "gazduire web romania", tag: "Hosting", vol: 3200, kd: 46, loc: "România", pos: 5, p30: 8, mob: 1, url: "/pachete-hosting", feats: ["ai", "paa", "ads"], ai: "cited", comps: { "hostico.ro": 2, "gazduire.ro": 3, "romarg.ro": 6 } },
  { id: "k32", pj: "ots", kw: "hosting wordpress ieftin", tag: "Hosting", vol: 2100, kd: 41, loc: "România", pos: 13, p30: 10, mob: 3, url: "/hosting-wordpress", feats: ["ads", "paa"], ai: null, comps: { "hostico.ro": 1, "gazduire.ro": 4, "romarg.ro": 5 } },
  { id: "k33", pj: "ots", kw: "agentie marketing online", tag: "Servicii", vol: 1800, kd: 52, loc: "România", pos: 21, p30: 27, mob: 4, url: "/servicii", feats: ["ai", "paa"], ai: "present", comps: { "hostico.ro": 44, "gazduire.ro": 61, "romarg.ro": 39 } },
  { id: "k34", pj: "ots", kw: "certificat ssl gratuit", tag: "Blog", vol: 2700, kd: 30, loc: "România", pos: 7, p30: 18, mob: 1, url: "/blog/ssl-gratuit", feats: ["snippet", "ai"], ai: "cited", comps: { "hostico.ro": 3, "gazduire.ro": 9, "romarg.ro": 2 } },
  { id: "k35", pj: "ots", kw: "email business gazduire", tag: "Hosting", vol: 640, kd: 25, loc: "România", pos: 16, p30: 16, mob: 2, url: "/email-business", feats: ["paa"], ai: null, comps: { "hostico.ro": 4, "gazduire.ro": 7, "romarg.ro": 3 } },
  { id: "k36", pj: "ots", kw: "migrare site fara downtime", tag: "Blog", vol: 390, kd: 18, loc: "România", pos: 42, p30: 55, mob: 5, url: "/blog/migrare-site", feats: ["ai"], ai: "present", comps: { "hostico.ro": 6, "gazduire.ro": 12, "romarg.ro": 8 } },
  /* --- heylux.com --- */
  { id: "k41", pj: "heylux", kw: "luxury brand studio", tag: "Brand", vol: 1700, kd: 48, loc: "Global", pos: 9, p30: 15, mob: 2, url: "/", feats: ["ai", "paa"], ai: "present", comps: { "luxstudio.io": 4, "brandhaus.de": 6 } },
  { id: "k42", pj: "heylux", kw: "packaging design agency", tag: "Servicii", vol: 5300, kd: 57, loc: "Global", pos: 26, p30: 22, mob: 5, url: "/services/packaging", feats: ["ai", "images", "ads"], ai: null, comps: { "luxstudio.io": 7, "brandhaus.de": 3 } },
  { id: "k43", pj: "heylux", kw: "markenagentur berlin", tag: "Local", vol: 2200, kd: 43, loc: "Germania", pos: 12, p30: 20, mob: 3, url: "/de", feats: ["local", "paa"], ai: null, comps: { "luxstudio.io": 18, "brandhaus.de": 2 } },
  { id: "k44", pj: "heylux", kw: "rebranding case study", tag: "Blog", vol: 890, kd: 29, loc: "Global", pos: 4, p30: 6, mob: 0, url: "/work/rebranding", feats: ["snippet", "images"], ai: null, comps: { "luxstudio.io": 11, "brandhaus.de": 9 } },
  { id: "k45", pj: "heylux", kw: "creative direction services", tag: "Servicii", vol: 1200, kd: 39, loc: "Global", pos: 101, p30: 88, mob: 0, url: "/services/creative-direction", feats: ["ai"], ai: null, comps: { "luxstudio.io": 5, "brandhaus.de": 14 } },
];

/* rulări zilnice */
const RT_RUNS = [
  { day: "1 sep. 2026", time: "06:12", kws: 32, up: 11, down: 6, flat: 15, avg: 12.4, vis: 38.6, dVis: 1.4, alerts: 1, status: "ok" },
  { day: "31 aug. 2026", time: "06:11", kws: 32, up: 8, down: 9, flat: 15, avg: 12.9, vis: 37.2, dVis: -0.6, alerts: 2, status: "ok" },
  { day: "30 aug. 2026", time: "06:14", kws: 32, up: 13, down: 4, flat: 15, avg: 12.7, vis: 37.8, dVis: 2.1, alerts: 0, status: "ok" },
  { day: "29 aug. 2026", time: "06:12", kws: 32, up: 6, down: 11, flat: 15, avg: 13.5, vis: 35.7, dVis: -1.8, alerts: 3, status: "ok" },
  { day: "28 aug. 2026", time: "06:41", kws: 30, up: 9, down: 7, flat: 14, avg: 13.1, vis: 37.5, dVis: 0.4, alerts: 1, status: "partial", note: "2 cuvinte reluate — timeout SERP" },
  { day: "27 aug. 2026", time: "06:10", kws: 30, up: 10, down: 8, flat: 12, avg: 13.3, vis: 37.1, dVis: 0.9, alerts: 0, status: "ok" },
  { day: "26 aug. 2026", time: "06:13", kws: 30, up: 7, down: 10, flat: 13, avg: 13.8, vis: 36.2, dVis: -1.1, alerts: 2, status: "ok" },
  { day: "25 aug. 2026", time: "06:12", kws: 30, up: 12, down: 5, flat: 13, avg: 13.4, vis: 37.3, dVis: 1.6, alerts: 0, status: "ok" },
];

const RT_SCHEDULE_DEFAULT = {
  hour: "06:00", tz: "Europe/Bucharest", devices: ["desktop", "mobile"],
  recipients: ["andrei@onetopsolution.ro", "seo@onetopsolution.ro"],
  weeklyMail: true, alertOnDrop: true, threshold: 5, topAlert: true, attachPdf: true, sendToClient: false, trackAi: true,
};

const RT_TAGS = ["Produse", "Categorii", "Servicii", "Local", "Blog", "Sezonier", "Hosting", "Brand"];

/* ---------- utilitare ---------- */
function rtHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rtRng(seed) { let s = seed || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function rtClamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* istoric 30 de zile; poziția 101 = în afara top 100 (returnat ca null) */
function rtHistory(k, device) {
  const off = device === "mobile" ? (k.mob || 0) : 0;
  const end = k.pos >= 101 ? 101 : k.pos + off;
  const start = k.p30 >= 101 ? 101 : k.p30 + off;
  const rnd = rtRng(rtHash(k.id + device));
  const n = RT_DAYS.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const lin = start + (end - start) * (i / (n - 1));
    const amp = Math.max(0.6, lin * 0.075);
    let p = Math.round(rtClamp(lin + (rnd() * 2 - 1) * amp, 1, 101));
    if (i === n - 1) p = Math.round(rtClamp(end, 1, 101));
    out.push({ day: RT_DAYS[i], pos: p >= 101 ? null : p });
  }
  return out;
}

/* CTR estimat pe poziție — baza pentru vizibilitate */
const RT_CTR = [0, 31.7, 24.7, 18.7, 13.6, 9.5, 6.3, 4.3, 3.1, 2.6, 2.4];
function rtCtr(pos) {
  if (pos == null) return 0;
  if (pos <= 10) return RT_CTR[pos];
  if (pos <= 20) return 1.1;
  if (pos <= 50) return 0.35;
  if (pos <= 100) return 0.1;
  return 0;
}
function rtVisibility(positions) {
  if (!positions.length) return 0;
  const max = positions.length * RT_CTR[1];
  const got = positions.reduce((a, p) => a + rtCtr(p), 0);
  return +((got / max) * 100).toFixed(1);
}
function rtBuckets(positions) {
  const b = { t3: 0, t10: 0, t20: 0, t50: 0, t100: 0, out: 0 };
  positions.forEach(p => {
    if (p == null) b.out++;
    else if (p <= 3) b.t3++;
    else if (p <= 10) b.t10++;
    else if (p <= 20) b.t20++;
    else if (p <= 50) b.t50++;
    else b.t100++;
  });
  return b;
}
function rtPosLevel(p) {
  if (p == null) return "out";
  if (p <= 3) return "top3";
  if (p <= 10) return "top10";
  if (p <= 20) return "top20";
  return "low";
}
function rtBest(hist) {
  const v = hist.map(h => h.pos).filter(p => p != null);
  return v.length ? Math.min(...v) : null;
}
/* poziția la un anumit număr de zile în urmă */
function rtAgo(hist, days) {
  const i = hist.length - 1 - days;
  return i >= 0 ? hist[i].pos : null;
}
/* delta pe poziții: negativ = urcare (poziție mai mică) → îl întoarcem ca "câștig" */
function rtGain(now, then) {
  if (now == null && then == null) return null;
  if (now == null) return -(101 - (then || 101));
  if (then == null) return (101 - now);
  return then - now;
}

window.RTData = {
  RT_DAYS, RT_TODAY, RT_FEATURES, RT_PROJECTS_DEFAULT, RT_KEYWORDS_DEFAULT, RT_RUNS, RT_SCHEDULE_DEFAULT, RT_TAGS, RT_LOCALES,
  rtHash, rtRng, rtClamp, rtHistory, rtCtr, rtVisibility, rtBuckets, rtPosLevel, rtBest, rtAgo, rtGain,
};
