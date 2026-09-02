/* ===== OTS — Rank Tracker: elemente reutilizabile ===== */
const RTB = window.RTData;
const RT_BUCKET_COLORS = { t3: "#10b981", t10: "#1877F2", t20: "#f59e0b", t50: "#94a3b8", t100: "#cbd5e1", out: "#e2e8f0" };
const RT_BUCKET_LABELS = { t3: "1–3", t10: "4–10", t20: "11–20", t50: "21–50", t100: "51–100", out: "peste 100" };

function RTPos({ pos, sm }) {
  const lvl = RTB.rtPosLevel(pos);
  return <span className={`rt-pos ${lvl} ${sm ? "sm" : ""}`} title={pos == null ? "în afara top 100" : `poziția ${pos}`}>{pos == null ? "100+" : pos}</span>;
}

/* câștig de poziții: pozitiv = a urcat */
function RTGain({ value, suffix = "" }) {
  if (value == null) return <span className="iv-muted">—</span>;
  const v = Math.round(value * 10) / 10;
  const cls = v === 0 ? "flat" : v > 0 ? "up" : "down";
  return <span className={`psi-delta ${cls}`}>{v === 0 ? "=" : v > 0 ? "▲" : "▼"} {v > 0 ? "+" : ""}{v}{suffix}</span>;
}

function RTSpark({ hist, w = 84, h = 26 }) {
  const vals = hist.map(x => (x.pos == null ? 101 : x.pos));
  if (vals.length < 2) return <span className="iv-muted">—</span>;
  const min = Math.max(1, Math.min(...vals) - 2), max = Math.max(...vals) + 2;
  const span = Math.max(4, max - min);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * (w - 4) + 2, 3 + ((v - min) / span) * (h - 6)]);
  const last = pts[pts.length - 1];
  const first = vals[0], now = vals[vals.length - 1];
  const color = now < first ? "#10b981" : now > first ? "#ef4444" : "#94a3b8";
  return (
    <svg className="psi-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" opacity=".9" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
    </svg>
  );
}

/* ultimele 7 zile, cea mai recentă la dreapta */
function RT7({ hist }) {
  const last = hist.slice(-7);
  return (
    <span className="rt-7">
      {last.map((d, i) => {
        const prev = i > 0 ? last[i - 1].pos : null;
        const cls = d.pos == null ? "empty" : prev == null ? "" : d.pos < prev ? "up" : d.pos > prev ? "down" : "";
        return <i key={d.day.id} className={cls} title={`${d.day.full} · ${d.pos == null ? "peste 100" : "poziția " + d.pos}`}>{d.pos == null ? "–" : d.pos}</i>;
      })}
    </span>
  );
}

function RTFeats({ list, ai }) {
  const items = (list || []).filter(f => f !== "ai");
  if (!items.length && !ai) return <span className="iv-muted">—</span>;
  return (
    <span className="rt-feats">
      {items.map(f => {
        const cfg = RTB.RT_FEATURES[f];
        if (!cfg) return null;
        return <i key={f} className="rt-feat" style={{ background: cfg.color }} title={cfg.label}>{cfg.short}</i>;
      })}
    </span>
  );
}

function RTAi({ state }) {
  if (state === "cited") return <span className="rt-ai cited"><Icon.Sparkles w={11} h={11} /> citat</span>;
  if (state === "present") return <span className="rt-ai present">apare, fără noi</span>;
  return <span className="rt-ai none">—</span>;
}

function RTVis({ pct }) {
  return (
    <span className="rt-vis" title="vizibilitate estimată din CTR pe poziție">
      <span className="rt-vis-track"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>
      <span className="rt-vis-val">{pct}%</span>
    </span>
  );
}

function RTDist({ buckets, total, compact }) {
  const keys = ["t3", "t10", "t20", "t50", "t100", "out"];
  const n = total || keys.reduce((a, k) => a + buckets[k], 0) || 1;
  return (
    <div>
      <div className="rt-dist">
        {keys.map(k => buckets[k] > 0 && <i key={k} style={{ width: `${(buckets[k] / n) * 100}%`, background: RT_BUCKET_COLORS[k] }} title={`${RT_BUCKET_LABELS[k]}: ${buckets[k]}`} />)}
      </div>
      {!compact && (
        <div className="rt-dist-legend">
          {keys.map(k => <span key={k}><em style={{ background: RT_BUCKET_COLORS[k] }} /> {RT_BUCKET_LABELS[k]} <b>{buckets[k]}</b></span>)}
        </div>
      )}
    </div>
  );
}

/* grafic poziții — axă inversată, scală logaritmică 1 → 100 */
function RTRankChart({ days, series, height = 230, marks }) {
  const W = 680, padL = 30, padR = 14, padT = 12, padB = 26, H = height;
  const x = (i) => padL + (i / Math.max(1, days.length - 1)) * (W - padL - padR);
  const y = (p) => padT + (Math.log(Math.max(1, Math.min(101, p))) / Math.log(101)) * (H - padT - padB);
  const ticks = [1, 3, 10, 20, 50, 100];
  const segments = (vals) => {
    const segs = []; let cur = [];
    vals.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
    if (cur.length) segs.push(cur);
    return segs;
  };
  return (
    <div className="psi-chart-wrap">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <rect x={padL} y={y(1)} width={W - padL - padR} height={y(3) - y(1)} fill="rgba(16,185,129,.07)" />
        <rect x={padL} y={y(3)} width={W - padL - padR} height={y(10) - y(3)} fill="rgba(24,119,242,.05)" />
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="#e8ecf2" strokeWidth="1" strokeDasharray={t === 1 ? "" : "3 3"} />
            <text x={padL - 7} y={y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="#94a3b8" fontWeight="600">{t}</text>
          </g>
        ))}
        {days.map((d, i) => (i % 3 === 0 || i === days.length - 1) && (
          <text key={d.id} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#94a3b8" fontWeight="600">{d.short}</text>
        ))}
        {(marks || []).map(m => (
          <g key={m.i + m.label}>
            <line x1={x(m.i)} x2={x(m.i)} y1={padT} y2={H - padB} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 3" />
            <text x={x(m.i) + 4} y={padT + 10} fontSize="9" fill="#64748b" fontWeight="700">{m.label}</text>
          </g>
        ))}
        {series.map(s => (
          <g key={s.label}>
            {segments(s.values).map((seg, si) => (
              <polyline key={si} points={seg.map(p => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={s.thin ? "1.6" : "2.2"} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "5 4" : ""} opacity={s.thin ? .75 : 1} />
            ))}
            {!s.thin && s.values.map((v, i) => v != null && i === s.values.length - 1 && <circle key={i} cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={s.color} strokeWidth="2" />)}
          </g>
        ))}
      </svg>
      <div className="psi-chart-legend">
        {series.map(s => {
          const lastVal = [...s.values].reverse().find(v => v != null);
          return <span key={s.label}><i style={{ background: s.color }} /> {s.label} <b style={{ marginLeft: 2 }}>{lastVal == null ? "100+" : "#" + lastVal}</b></span>;
        })}
        <span style={{ marginLeft: "auto", color: "var(--cl-text-3)" }}>scală inversată · 1 = sus</span>
      </div>
    </div>
  );
}

function RTCompRow({ domain, self, pos, vis, max }) {
  return (
    <div className="rt-comp-row">
      <div className={`rt-comp-dom ${self ? "self" : ""}`}>
        <span className="psi-fav" style={{ width: 22, height: 22, borderRadius: 6, fontSize: 9.5, background: self ? "var(--cl-accent)" : window.psiTileColor(domain) }}>{window.psiInitials(domain)}</span>
        {domain}{self && <span className="psi-tag info">noi</span>}
      </div>
      <div style={{ textAlign: "right" }}>{pos !== undefined ? <RTPos pos={pos} sm /> : <span className="iv-muted">—</span>}</div>
      <div>
        <div className="rt-comp-bar"><i style={{ width: `${Math.max(3, (vis / (max || 1)) * 100)}%`, background: self ? "var(--cl-accent)" : "#cbd5e1" }} /></div>
        <div style={{ fontSize: 11, color: "var(--cl-text-3)", marginTop: 4, fontWeight: 700 }}>{vis}% vizibilitate</div>
      </div>
    </div>
  );
}

Object.assign(window, { RTPos, RTGain, RTSpark, RT7, RTFeats, RTAi, RTVis, RTDist, RTRankChart, RTCompRow, RT_BUCKET_COLORS, RT_BUCKET_LABELS });
