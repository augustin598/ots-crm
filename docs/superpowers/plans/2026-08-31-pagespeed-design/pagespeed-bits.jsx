/* ===== OTS — PageSpeed: elemente reutilizabile ===== */
const PSB = window.PSIData;
const PSI_LVL = { good: "#10b981", ni: "#f59e0b", poor: "#ef4444", none: "#cbd5e1" };
const PSI_TRACK = "#e8ecf2";

function psiInitials(domain) { return (domain || "?").replace(/^www\./, "").slice(0, 2).toUpperCase(); }
function psiTileColor(id) { const r = PSB.psiRng(PSB.psiHash(id || "x")); const h = Math.round(r() * 360); return `oklch(0.58 0.13 ${h})`; }

function PSIDonut({ value, size = 40, stroke = 4, pending }) {
  const lvl = PSB.psiScoreLevel(value);
  const c = PSI_LVL[lvl];
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div className={`psi-donut ${pending ? "pending" : ""}`} style={{ width: size, height: size, background: `conic-gradient(${c} 0 ${pct}%, ${PSI_TRACK} ${pct}% 100%)` }} title={value == null ? "fără scanare" : `Scor Performance ${value}/100`}>
      <i style={{ inset: stroke }} />
      <b style={{ fontSize: Math.round(size * 0.34), color: value == null ? "var(--cl-text-3)" : c === "#f59e0b" ? "#b45309" : c === "#10b981" ? "#047857" : "#b91c1c" }}>{value == null ? "–" : value}</b>
    </div>
  );
}

function PSISpark({ values, w = 78, h = 26 }) {
  if (!values || values.length < 2) return <span className="iv-muted">—</span>;
  const min = Math.min(...values) - 4, max = Math.max(...values) + 4;
  const span = Math.max(6, max - min);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)]);
  const last = pts[pts.length - 1];
  const lvl = PSB.psiScoreLevel(values[values.length - 1]);
  return (
    <svg className="psi-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke={PSI_LVL[lvl]} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" opacity=".85" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={PSI_LVL[lvl]} />
    </svg>
  );
}

function PSIDelta({ value, suffix = "", invert }) {
  if (value == null) return <span className="iv-muted">—</span>;
  const v = Math.round(value * 10) / 10;
  const good = invert ? v < 0 : v > 0;
  const cls = v === 0 ? "flat" : good ? "up" : "down";
  return <span className={`psi-delta ${cls}`}>{v === 0 ? "=" : v > 0 ? "▲" : "▼"} {v > 0 ? "+" : ""}{v}{suffix}</span>;
}

function PSIMetric({ k, v }) {
  const lvl = PSB.psiMetricLevel(k, v);
  return <span className={`psi-metric psi-${lvl}`}><span className={`sq psi-sq-${lvl}`} />{PSB.psiFmt(k, v)}</span>;
}

function PSICwv({ pass }) {
  if (pass == null) return <span className="psi-cwv na">fără date CrUX</span>;
  return pass
    ? <span className="psi-cwv pass"><Icon.Check w={11} h={11} /> trece</span>
    : <span className="psi-cwv fail"><Icon.X w={11} h={11} /> nu trece</span>;
}

/* grafic linie 0-100 cu benzile Google */
function PSILine({ series, weeks, height = 200, onPick, selected }) {
  const W = 660, padL = 30, padR = 12, padT = 12, padB = 26;
  const H = height;
  const x = (i) => padL + (i / Math.max(1, weeks.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  const band = (a, b, fill) => <rect key={fill} x={padL} y={y(b)} width={W - padL - padR} height={y(a) - y(b)} fill={fill} />;
  return (
    <div className="psi-chart-wrap">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        {band(0, 49, "rgba(239,68,68,.055)")}
        {band(50, 89, "rgba(245,158,11,.055)")}
        {band(90, 100, "rgba(16,185,129,.07)")}
        {[0, 50, 90, 100].map(v => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e8ecf2" strokeWidth="1" strokeDasharray={v === 0 || v === 100 ? "" : "3 3"} />
            <text x={padL - 7} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="#94a3b8" fontWeight="600">{v}</text>
          </g>
        ))}
        {weeks.map((wk, i) => (
          <g key={wk.id} onClick={() => onPick && onPick(i)} style={{ cursor: onPick ? "pointer" : "default" }}>
            <rect x={x(i) - 14} y={padT} width="28" height={H - padT - padB} fill={selected === i ? "rgba(24,119,242,.07)" : "transparent"} />
            <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="9.5" fill={selected === i ? "#1877F2" : "#94a3b8"} fontWeight={selected === i ? "800" : "600"}>{wk.label}</text>
          </g>
        ))}
        {series.map(s => (
          <g key={s.label}>
            <polyline points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : ""} />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === s.values.length - 1 ? 4 : 2.6} fill="#fff" stroke={s.color} strokeWidth="2" />)}
          </g>
        ))}
      </svg>
      <div className="psi-chart-legend">
        {series.map(s => <span key={s.label}><i style={{ background: s.color }} /> {s.label} <b style={{ marginLeft: 2 }}>{s.values[s.values.length - 1]}</b></span>)}
        <span style={{ marginLeft: "auto", color: "var(--cl-text-3)" }}>benzi: 0–49 slab · 50–89 mediu · 90–100 bun</span>
      </div>
    </div>
  );
}

function PSISwitch({ on, onChange }) {
  return (
    <label className="cl-switch">
      <input type="checkbox" checked={!!on} onChange={e => onChange(e.target.checked)} />
      <span className="cl-switch-slider" />
    </label>
  );
}

function PSIStratIcon({ strategy, w = 13, h = 13 }) {
  if (strategy === "mobile") return <Icon.Phone w={w} h={h} />;
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}

Object.assign(window, { PSIDonut, PSISpark, PSIDelta, PSIMetric, PSICwv, PSILine, PSISwitch, PSIStratIcon, psiInitials, psiTileColor, PSI_LVL });
