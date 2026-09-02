/* ===== OTS — Rank Tracker: poziții Google organic ===== */
const RT = window.RTData;
const { useState: kSt, useMemo: kMemo, useEffect: kEff } = React;
const RT_LS = "ots_rank_v1";
const rtNum = (n) => n.toLocaleString("ro-RO");

function RTApp() {
  const persisted = kMemo(() => { try { return JSON.parse(localStorage.getItem(RT_LS)) || {}; } catch (e) { return {}; } }, []);
  const [projects, setProjects] = kSt(persisted.projects && persisted.projects.length ? persisted.projects : RT.RT_PROJECTS_DEFAULT.map(p => ({ ...p })));
  const [kws, setKws] = kSt(persisted.kws && persisted.kws.length ? persisted.kws : RT.RT_KEYWORDS_DEFAULT.map(k => ({ ...k })));
  const [sched, setSched] = kSt({ ...RT.RT_SCHEDULE_DEFAULT, ...(persisted.sched || {}) });
  const [view, setView] = kSt(persisted.view || "hub");
  const [device, setDevice] = kSt("desktop");
  const [tab, setTab] = kSt("all");
  const [q, setQ] = kSt("");
  const [locF, setLocF] = kSt("all");
  const [tagF, setTagF] = kSt([]);
  const [sort, setSort] = kSt("pos");
  const [sel, setSel] = kSt([]);
  const [openKw, setOpenKw] = kSt(null);
  const [editProj, setEditProj] = kSt(null);
  const [adding, setAdding] = kSt(false);
  const [showSched, setShowSched] = kSt(false);
  const [preview, setPreview] = kSt(false);
  const [run, setRun] = kSt(null);
  const [toast, setToast] = kSt(null);
  const [lastRun, setLastRun] = kSt("1 sep. 2026, 06:12");

  kEff(() => { try { localStorage.setItem(RT_LS, JSON.stringify({ projects, kws, sched, view })); } catch (e) {} }, [projects, kws, sched, view]);
  kEff(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  const project = projects.find(p => p.id === view) || null;

  /* rânduri calculate pentru un set de cuvinte */
  const rowsFor = (list) => list.map(k => {
    const hist = k.pending ? [] : RT.rtHistory(k, device);
    const pos = hist.length ? hist[hist.length - 1].pos : null;
    return {
      kw: k, hist, pos,
      g1: hist.length ? RT.rtGain(pos, RT.rtAgo(hist, 1)) : null,
      g7: hist.length ? RT.rtGain(pos, RT.rtAgo(hist, 7)) : null,
      g30: hist.length ? RT.rtGain(pos, RT.rtAgo(hist, 29)) : null,
      best: hist.length ? RT.rtBest(hist) : null,
    };
  });

  const allRows = kMemo(() => rowsFor(kws), [kws, device]);
  const rowsByProject = kMemo(() => {
    const m = {};
    allRows.forEach(r => { (m[r.kw.pj] = m[r.kw.pj] || []).push(r); });
    return m;
  }, [allRows]);

  const projStats = (p) => {
    const rows = rowsByProject[p.id] || [];
    const positions = rows.map(r => r.pos);
    const b = RT.rtBuckets(positions);
    const inTop = positions.filter(x => x != null);
    return {
      rows, buckets: b, kws: rows.length,
      vis: RT.rtVisibility(positions),
      avg: inTop.length ? +(inTop.reduce((a, x) => a + x, 0) / inTop.length).toFixed(1) : null,
      up: rows.filter(r => (r.g1 || 0) > 0).length,
      down: rows.filter(r => (r.g1 || 0) < 0).length,
      alerts: rows.filter(r => r.g1 != null && r.g1 <= -(p.alert || 5)).length,
      g7: rows.length ? +(rows.reduce((a, r) => a + (r.g7 || 0), 0) / rows.length).toFixed(1) : 0,
    };
  };

  const activeProjects = projects.filter(p => p.active);
  const portfolio = kMemo(() => {
    const rows = allRows.filter(r => activeProjects.some(p => p.id === r.kw.pj));
    const positions = rows.map(r => r.pos);
    const inTop = positions.filter(x => x != null);
    const b = RT.rtBuckets(positions);
    return {
      rows, buckets: b, vis: RT.rtVisibility(positions),
      avg: inTop.length ? +(inTop.reduce((a, x) => a + x, 0) / inTop.length).toFixed(1) : null,
      up: rows.filter(r => (r.g1 || 0) > 0).length,
      down: rows.filter(r => (r.g1 || 0) < 0).length,
      alerts: rows.filter(r => { const p = projects.find(x => x.id === r.kw.pj); return r.g1 != null && r.g1 <= -((p && p.alert) || 5); }),
    };
  }, [allRows, projects, device]);

  /* poziția medie a portofoliului pe 30 de zile */
  const avgSeries = kMemo(() => {
    const rows = portfolio.rows.filter(r => r.hist.length);
    return RT.RT_DAYS.map((_, i) => {
      const v = rows.map(r => r.hist[i].pos).filter(p => p != null);
      return v.length ? +(v.reduce((a, p) => a + p, 0) / v.length).toFixed(1) : null;
    });
  }, [portfolio]);

  /* filtre în pagina de proiect */
  const detailRows = kMemo(() => {
    if (!project) return [];
    let out = (rowsByProject[project.id] || []).filter(r => {
      const k = r.kw;
      if (locF !== "all" && k.loc !== locF) return false;
      if (tagF.length && !tagF.includes(k.tag)) return false;
      if (q && !(k.kw + " " + k.url).toLowerCase().includes(q.toLowerCase())) return false;
      if (tab === "top10" && !(r.pos != null && r.pos <= 10)) return false;
      if (tab === "up" && !((r.g7 || 0) > 0)) return false;
      if (tab === "down" && !((r.g7 || 0) < 0)) return false;
      if (tab === "ai" && !r.kw.ai) return false;
      if (tab === "canib" && !r.kw.altUrl) return false;
      return true;
    });
    const c = {
      pos: (a, b) => (a.pos ?? 999) - (b.pos ?? 999),
      gain: (a, b) => (b.g7 ?? -999) - (a.g7 ?? -999),
      loss: (a, b) => (a.g7 ?? 999) - (b.g7 ?? 999),
      vol: (a, b) => b.kw.vol - a.kw.vol,
      kw: (a, b) => a.kw.kw.localeCompare(b.kw.kw),
    };
    return out.sort(c[sort] || c.pos);
  }, [project, rowsByProject, locF, tagF, q, tab, sort]);

  /* rulare simulată */
  const runCheck = (ids) => {
    const list = ids && ids.length ? ids : (project ? (rowsByProject[project.id] || []).map(r => r.kw.id) : allRows.map(r => r.kw.id));
    if (!list.length || run) return;
    setRun({ total: list.length, done: 0 });
    let i = 0;
    const step = () => {
      const id = list[i];
      setTimeout(() => {
        setKws(cur => cur.map(k => k.id === id && k.pending ? { ...k, pending: false } : k));
        i++;
        setRun(r => r && { ...r, done: i, current: (kws.find(k => k.id === list[i]) || {}).kw });
        if (i < list.length) step();
        else setTimeout(() => { setRun(null); setLastRun("1 sep. 2026, " + new Date().toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })); setToast(`Rulare finalizată · ${list.length} ${list.length === 1 ? "cuvânt verificat" : "cuvinte verificate"}`); }, 450);
      }, Math.max(90, 520 / Math.sqrt(list.length)));
    };
    step();
  };

  const addKws = ({ pj, tag, loc, list }) => {
    const now = Date.now();
    setKws(cur => [
      ...cur,
      ...list.map((kw, i) => ({ id: "n" + (now + i), pj, kw, tag, vol: 0, kd: 0, loc, pos: 101, p30: 101, mob: 0, url: "—", feats: [], ai: null, comps: {}, pending: true })),
    ]);
    setAdding(false);
    setToast(`${list.length} ${list.length === 1 ? "cuvânt cheie adăugat" : "cuvinte cheie adăugate"} · prima verificare mâine la ${sched.hour}`);
  };

  const saveProject = (p) => {
    setProjects(cur => cur.some(x => x.id === p.id) ? cur.map(x => x.id === p.id ? p : x) : [...cur, p]);
    setEditProj(null);
    setToast(`${p.domain} salvat`);
  };
  const delProject = (id) => {
    const p = projects.find(x => x.id === id);
    setProjects(cur => cur.filter(x => x.id !== id));
    setKws(cur => cur.filter(k => k.pj !== id));
    setEditProj(null); setView("hub");
    setToast(`${p ? p.domain : "Proiect"} scos din monitorizare`);
  };
  const delKws = (ids) => { setKws(cur => cur.filter(k => !ids.includes(k.id))); setSel([]); setToast(`${ids.length} ${ids.length === 1 ? "cuvânt șters" : "cuvinte șterse"}`); };

  const clients = Array.from(new Set(projects.map(p => p.client)));
  const openRow = openKw ? allRows.find(r => r.kw.id === openKw) : null;

  /* ---------- header ---------- */
  const header = (
    <>
      <div className="cl-crumbs">
        <a href="Dashboard OTS.html"><Icon.Folder w={12} h={12} /></a>
        <span className="sep">/</span><a href="#">Marketing &amp; Ads</a>
        <span className="sep">/</span><a href="SEO GEO AEO.html">SEO &amp; GEO &amp; AEO</a>
        <span className="sep">/</span>{project ? <a href="#" onClick={e => { e.preventDefault(); setView("hub"); }}>Rank Tracker</a> : <strong>Rank Tracker</strong>}
        {project && <><span className="sep">/</span><strong>{project.domain}</strong></>}
      </div>
      <div className="cl-hero">
        <div>
          <h1>{project ? project.domain : "Rank Tracker"}</h1>
          <p>
            {project
              ? <><strong>{(rowsByProject[project.id] || []).length}</strong> cuvinte cheie · {project.locale} · {project.locations.join(", ")} · client <strong>{project.client}</strong></>
              : <><strong>{kws.length}</strong> cuvinte cheie pe <strong>{activeProjects.length}</strong> proiecte · rulare zilnică <strong>{sched.hour}</strong> · ultima rulare <strong>{lastRun}</strong></>}
            {!project && portfolio.alerts.length > 0 && <> · <strong className="danger">{portfolio.alerts.length} {portfolio.alerts.length === 1 ? "alertă" : "alerte"}</strong> azi</>}
          </p>
        </div>
        <div className="cl-hero-actions">
          <div className="cl-search">
            <Icon.Search w={14} h={14} />
            <input placeholder={project ? "Caută cuvânt cheie sau URL..." : "Caută domeniu sau client..."} value={q} onChange={e => setQ(e.target.value)} />
            {q && <button className="cl-search-clear" onClick={() => setQ("")}><Icon.X w={12} h={12} /></button>}
          </div>
          <button className="cl-btn-secondary" onClick={() => setShowSched(true)}><Icon.Clock w={13} h={13} /> Rulare și alerte</button>
          <button className="cl-btn-secondary" onClick={() => setPreview(true)}><Icon.Mail w={13} h={13} /> Raport</button>
          <button className="cl-btn-secondary" onClick={() => runCheck()} disabled={!!run}><Icon.RefreshCw w={13} h={13} /> {run ? "Se verifică…" : "Verifică acum"}</button>
          {project
            ? <button className="cl-btn-primary" onClick={() => setAdding(true)}><Icon.Plus w={13} h={13} /> Adaugă cuvinte cheie</button>
            : <button className="cl-btn-primary" onClick={() => setEditProj("new")}><Icon.Plus w={13} h={13} /> Proiect nou</button>}
        </div>
      </div>
    </>
  );

  const kpis = (st, p) => (
    <div className="cl-hero" style={{ paddingTop: 0, paddingBottom: 0 }}>
      <div className="cl-kpis" style={{ width: "100%", gridTemplateColumns: "repeat(6, 1fr)" }}>
        <div className="cl-kpi">
          <div className="cl-kpi-ic" style={{ background: "var(--cl-accent-50)", color: "var(--cl-accent)" }}><Icon.Eye w={16} h={16} /></div>
          <div>
            <div className="cl-kpi-lbl">Vizibilitate</div>
            <div className="cl-kpi-val">{st.vis}%</div>
            <div className="cl-kpi-sub">estimare din CTR pe poziție</div>
          </div>
        </div>
        <div className="cl-kpi">
          <div className="cl-kpi-ic" style={{ background: "rgba(139,92,246,.08)", color: "#8b5cf6" }}><Icon.Target w={16} h={16} /></div>
          <div>
            <div className="cl-kpi-lbl">Poziție medie</div>
            <div className="cl-kpi-val">{st.avg ?? "—"}</div>
            <div className="cl-kpi-sub">{device === "mobile" ? "mobil" : "desktop"} · {st.rows.length} cuvinte</div>
          </div>
        </div>
        <div className="cl-kpi">
          <div className="cl-kpi-ic" style={{ background: "rgba(16,185,129,.08)", color: "#10b981" }}><Icon.Star w={16} h={16} /></div>
          <div>
            <div className="cl-kpi-lbl">În top 3</div>
            <div className="cl-kpi-val">{st.buckets.t3}<span style={{ fontSize: 15, color: "var(--cl-text-3)", fontWeight: 700 }}> / {st.rows.length}</span></div>
            <div className="cl-kpi-sub">{st.buckets.t3 + st.buckets.t10} în primele 10</div>
          </div>
        </div>
        <div className="cl-kpi">
          <div className="cl-kpi-ic" style={{ background: "rgba(16,185,129,.08)", color: "#10b981" }}><Icon.TrendingUp w={16} h={16} /></div>
          <div>
            <div className="cl-kpi-lbl">Mișcări azi</div>
            <div className="cl-kpi-val">{st.up}<span style={{ fontSize: 15, color: "var(--cl-text-3)", fontWeight: 700 }}> ↑ / {st.down} ↓</span></div>
            <div className="cl-kpi-sub">față de rularea de ieri</div>
          </div>
        </div>
        <div className="cl-kpi">
          <div className="cl-kpi-ic" style={{ background: "rgba(239,68,68,.08)", color: "#ef4444" }}><Icon.AlertTriangle w={16} h={16} /></div>
          <div>
            <div className="cl-kpi-lbl">Scăderi peste prag</div>
            <div className={`cl-kpi-val ${(p ? st.alerts : st.alerts.length) ? "cl-text-danger" : ""}`}>{p ? st.alerts : st.alerts.length}</div>
            <div className="cl-kpi-sub">prag {p ? p.alert : sched.threshold} poziții</div>
          </div>
        </div>
        <div className="cl-kpi">
          <div className="cl-kpi-ic" style={{ background: "rgba(245,158,11,.08)", color: "#f59e0b" }}><Icon.Clock w={16} h={16} /></div>
          <div>
            <div className="cl-kpi-lbl">Următoarea rulare</div>
            <div className="cl-kpi-val" style={{ fontSize: 19 }}>mâine, {sched.hour}</div>
            <div className="cl-kpi-sub">{sched.devices.length === 2 ? "desktop + mobil" : sched.devices[0] === "mobile" ? "doar mobil" : "doar desktop"}</div>
          </div>
        </div>
      </div>
    </div>
  );

  const runsTable = (
    <div className="rt-pad" style={{ padding: "14px 28px 60px" }}>
      <div className="cl-section" style={{ padding: 0 }}>
        <div className="cl-section-head" style={{ padding: "16px 20px 12px", marginBottom: 0 }}>
          <h3><Icon.CalDays w={15} h={15} /> Istoric rulări zilnice</h3>
          <p className="cl-section-sub" style={{ marginLeft: "auto" }}>fiecare rulare salvează poziția fiecărui cuvânt cheie</p>
        </div>
        <table className="cl-list-table">
          <thead>
            <tr><th>Ziua</th><th>Ora</th><th className="num">Cuvinte</th><th className="num">Urcări</th><th className="num">Scăderi</th><th className="num">Neschimbate</th><th className="num">Poziție medie</th><th className="num">Vizibilitate</th><th className="num">Alerte</th><th>Status</th></tr>
          </thead>
          <tbody>
            {RT.RT_RUNS.map(r => (
              <tr key={r.day} style={{ cursor: "default" }}>
                <td style={{ fontWeight: 700 }}>{r.day}</td>
                <td>{r.time}{r.note && <div className="psi-site-l2">{r.note}</div>}</td>
                <td className="num">{r.kws}</td>
                <td className="num"><span className="psi-delta up">▲ {r.up}</span></td>
                <td className="num"><span className="psi-delta down">▼ {r.down}</span></td>
                <td className="num"><span className="iv-muted">{r.flat}</span></td>
                <td className="num" style={{ fontWeight: 800 }}>{r.avg}</td>
                <td className="num"><window.RTVis pct={r.vis} /></td>
                <td className="num">{r.alerts ? <span className="psi-tag danger">{r.alerts}</span> : <span className="iv-muted">0</span>}</td>
                <td>{r.status === "ok" ? <span className="psi-tag ok">complet</span> : <span className="psi-tag warn">parțial</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  /* ---------- HUB ---------- */
  if (!project) {
    const list = projects.filter(p => !q || (p.domain + p.name + p.client).toLowerCase().includes(q.toLowerCase()));
    return (
      <div className="cl-wrap" data-screen-label="Rank Tracker">
        {header}
        {kpis(portfolio, null)}
        {run && (
          <div className="rt-pad" style={{ paddingTop: 16 }}>
            <div className="psi-banner">
              <span className="psi-spin" />
              <span className="psi-banner-txt">Se interoghează SERP-urile Google · {run.done}/{run.total} cuvinte</span>
              <span className="psi-banner-track"><i style={{ width: `${(run.done / run.total) * 100}%` }} /></span>
            </div>
          </div>
        )}
        <div className="cl-toolbar">
          <div className="cl-tabs"><button className="cl-tab active">Proiecte<span className="cl-tab-count">{projects.length}</span></button></div>
          <div className="cl-toolbar-spacer" />
          <div className="psi-seg">
            {["desktop", "mobile"].map(d => (
              <button key={d} className={device === d ? "active" : ""} onClick={() => setDevice(d)}>
                <window.PSIStratIcon strategy={d === "mobile" ? "mobile" : "desktop"} /> {d === "mobile" ? "Mobil" : "Desktop"}
              </button>
            ))}
          </div>
        </div>
        <div className="rt-pad" style={{ paddingTop: 4 }}>
          <div className="rt-projects">
            {list.map(p => {
              const st = projStats(p);
              return (
                <div key={p.id} className={`rt-proj ${p.active ? "" : "paused"}`} onClick={() => { setView(p.id); setTab("all"); setQ(""); setTagF([]); setLocF("all"); }}>
                  <div className="rt-proj-head">
                    <span className="psi-fav" style={{ background: window.psiTileColor(p.id) }}>{window.psiInitials(p.domain)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="rt-proj-l1">{p.domain}{!p.active && <span className="psi-tag">pauză</span>}{st.alerts > 0 && <span className="psi-tag danger">{st.alerts}</span>}</div>
                      <div className="rt-proj-l2">{p.client} · {p.locale}</div>
                    </div>
                    <button className="cl-icon-btn" style={{ marginLeft: "auto" }} title="Editează proiectul" onClick={e => { e.stopPropagation(); setEditProj(p); }}><Icon.Edit w={13} h={13} /></button>
                  </div>
                  <div className="rt-proj-nums">
                    <div className="rt-proj-num"><b>{st.vis}%</b><span>vizibilitate</span></div>
                    <div className="rt-proj-num"><b>{st.avg ?? "—"}</b><span>poziție medie</span></div>
                    <div className="rt-proj-num"><b>{st.buckets.t3 + st.buckets.t10}</b><span>în top 10</span></div>
                    <div className="rt-proj-num"><b>{st.kws}</b><span>cuvinte</span></div>
                  </div>
                  <div style={{ marginTop: 14 }}><window.RTDist buckets={st.buckets} total={st.kws} compact /></div>
                  <div className="rt-proj-foot">
                    <window.RTGain value={st.g7} suffix=" poz." />
                    <span>7 zile</span>
                    <span style={{ marginLeft: "auto" }}>{st.up} ↑ · {st.down} ↓ azi</span>
                    <Icon.ChevronRight w={13} h={13} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rt-pad" style={{ paddingTop: 14 }}>
          <div className="psi-two">
            <div className="cl-section">
              <div className="cl-section-head">
                <h3><Icon.TrendingUp w={15} h={15} /> Poziția medie a portofoliului · 30 de zile</h3>
                <p className="cl-section-sub" style={{ marginLeft: "auto" }}>{portfolio.rows.length} cuvinte pe proiectele active</p>
              </div>
              <window.RTRankChart days={RT.RT_DAYS} height={220} series={[{ label: device === "mobile" ? "Poziție medie mobil" : "Poziție medie desktop", color: "#1877F2", values: avgSeries }]} />
            </div>
            <div className="cl-section">
              <div className="cl-section-head"><h3><Icon.BarChart w={15} h={15} /> Distribuția pozițiilor</h3></div>
              <window.RTDist buckets={portfolio.buckets} total={portfolio.rows.length} />
              <div style={{ marginTop: 18 }}>
                <div className="cl-section-head" style={{ marginBottom: 8 }}><h3 style={{ fontSize: 13 }}><Icon.AlertTriangle w={14} h={14} /> Scăderi de urmărit azi</h3></div>
                {portfolio.alerts.length === 0 && <p className="cl-section-sub">nicio scădere peste prag în rularea de azi</p>}
                {portfolio.alerts.slice(0, 5).map(r => (
                  <div className="rt-comp-row" key={r.kw.id} style={{ gridTemplateColumns: "1fr 60px 74px", cursor: "pointer" }} onClick={() => setOpenKw(r.kw.id)}>
                    <div className="rt-comp-dom">{r.kw.kw}<span className="rt-tag">{(projects.find(p => p.id === r.kw.pj) || {}).domain}</span></div>
                    <div style={{ textAlign: "right" }}><window.RTPos pos={r.pos} sm /></div>
                    <div style={{ textAlign: "right" }}><window.RTGain value={r.g1} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {runsTable}
        {openRow && <window.RTKwDrawer kw={openRow.kw} project={projects.find(p => p.id === openRow.kw.pj)} device={device} checking={!!run} onClose={() => setOpenKw(null)} onRecheck={(id) => runCheck([id])} />}
        {editProj && <window.RTProjectModal project={editProj === "new" ? null : editProj} clients={clients} onClose={() => setEditProj(null)} onSave={saveProject} onDelete={delProject} />}
        {showSched && <window.RTScheduleModal sched={sched} onChange={setSched} onClose={() => setShowSched(false)} onSave={() => { setShowSched(false); setToast("Programarea și alertele au fost salvate"); }} />}
        {preview && <window.RTReportPreview project={null} rows={portfolio.rows} sched={sched} onClose={() => setPreview(false)} onSend={() => { setPreview(false); setToast(`Raport trimis către ${sched.recipients.length} destinatari`); }} />}
        {toast && <div className="psi-toast"><Icon.Check w={14} h={14} /> {toast}</div>}
      </div>
    );
  }

  /* ---------- DETALIU PROIECT ---------- */
  const st = projStats(project);
  const pRows = st.rows;
  const compVis = (project.competitors || []).map(dom => {
    const positions = pRows.map(r => (r.kw.comps || {})[dom]).filter(p => p != null);
    return { dom, vis: RT.rtVisibility(positions.length ? positions : [null]) };
  });
  const maxVis = Math.max(st.vis, ...compVis.map(c => c.vis), 1);
  const topSeries = [...pRows].sort((a, b) => b.kw.vol - a.kw.vol).slice(0, 4)
    .map((r, i) => ({ label: r.kw.kw, color: ["#1877F2", "#8b5cf6", "#10b981", "#f59e0b"][i], values: r.hist.map(h => h.pos) }));
  const tabs = [
    ["all", "Toate", pRows.length],
    ["top10", "Top 10", pRows.filter(r => r.pos != null && r.pos <= 10).length],
    ["up", "Au urcat", pRows.filter(r => (r.g7 || 0) > 0).length],
    ["down", "Au scăzut", pRows.filter(r => (r.g7 || 0) < 0).length],
    ["ai", "AI Overview", pRows.filter(r => r.kw.ai).length],
    ["canib", "Canibalizare", pRows.filter(r => r.kw.altUrl).length],
  ];
  const allSelected = detailRows.length > 0 && detailRows.every(r => sel.includes(r.kw.id));

  return (
    <div className="cl-wrap" data-screen-label={"Rank Tracker · " + project.domain}>
      {header}
      {kpis(st, project)}
      {run && (
        <div className="rt-pad" style={{ paddingTop: 16 }}>
          <div className="psi-banner">
            <span className="psi-spin" />
            <span className="psi-banner-txt">Se interoghează SERP-urile Google · {run.done}/{run.total} cuvinte{run.current ? " · " + run.current : ""}</span>
            <span className="psi-banner-track"><i style={{ width: `${(run.done / run.total) * 100}%` }} /></span>
          </div>
        </div>
      )}
      <div className="cl-toolbar">
        <div className="cl-tabs">
          {tabs.map(([id, lbl, n]) => (
            <button key={id} className={`cl-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {lbl}<span className={`cl-tab-count ${id === "down" && n ? "cl-tab-count-danger" : ""}`}>{n}</span>
            </button>
          ))}
        </div>
        <div className="cl-toolbar-spacer" />
        <div className="psi-seg">
          {["desktop", "mobile"].map(d => (
            <button key={d} className={device === d ? "active" : ""} onClick={() => setDevice(d)}>
              <window.PSIStratIcon strategy={d === "mobile" ? "mobile" : "desktop"} /> {d === "mobile" ? "Mobil" : "Desktop"}
            </button>
          ))}
        </div>
        <div className="cl-select-wrap">
          <span className="cl-select-lbl">Locație</span>
          <select className="cl-select" value={locF} onChange={e => setLocF(e.target.value)}>
            <option value="all">Toate locațiile</option>
            {Array.from(new Set(pRows.map(r => r.kw.loc))).map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="cl-select-wrap">
          <span className="cl-select-lbl">Sortare</span>
          <select className="cl-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="pos">Poziție (cele mai bune)</option>
            <option value="gain">Cea mai mare urcare</option>
            <option value="loss">Cea mai mare scădere</option>
            <option value="vol">Volum căutări</option>
            <option value="kw">Alfabetic</option>
          </select>
        </div>
      </div>

      <div className="rt-pad" style={{ paddingBottom: 12 }}>
        <div className="rt-tagbar">
          <span style={{ fontSize: 11.5, color: "var(--cl-text-3)", fontWeight: 700, marginRight: 2 }}>GRUPURI</span>
          {Array.from(new Set(pRows.map(r => r.kw.tag))).map(t => (
            <button key={t} className={`rt-tag ${tagF.includes(t) ? "on" : ""}`} onClick={() => setTagF(tagF.includes(t) ? tagF.filter(x => x !== t) : [...tagF, t])}>
              {t} <b>{pRows.filter(r => r.kw.tag === t).length}</b>
            </button>
          ))}
          {tagF.length > 0 && <button className="rt-tag" onClick={() => setTagF([])}>× resetează</button>}
        </div>
      </div>

      {sel.length > 0 && (
        <div className="rt-pad" style={{ paddingBottom: 12 }}>
          <div className="rt-bulk">
            <Icon.CheckSquare w={15} h={15} /> {sel.length} {sel.length === 1 ? "cuvânt selectat" : "cuvinte selectate"}
            <div className="rt-bulk-actions">
              <button className="cl-btn-mini" onClick={() => { runCheck(sel); setSel([]); }}><Icon.RefreshCw w={11} h={11} /> Verifică</button>
              <button className="cl-btn-mini" onClick={() => setSel([])}>Anulează</button>
              <button className="cl-btn-mini" onClick={() => delKws(sel)}><Icon.Trash w={11} h={11} /> Șterge</button>
            </div>
          </div>
        </div>
      )}

      <div className="rt-pad">
        <div className="cl-section" style={{ padding: 0 }}>
          <div className="cl-section-head" style={{ padding: "16px 20px 12px", marginBottom: 0 }}>
            <h3><Icon.Target w={15} h={15} /> Cuvinte cheie · {device === "mobile" ? "mobil" : "desktop"} · {RT.RT_TODAY.full}</h3>
            <p className="cl-section-sub" style={{ marginLeft: "auto" }}>click pe un rând pentru istoricul complet</p>
          </div>
          <div className="rt-table-scroll">
            <table className="cl-list-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" className="rt-check" checked={allSelected} onChange={e => setSel(e.target.checked ? detailRows.map(r => r.kw.id) : [])} /></th>
                  <th>Cuvânt cheie</th>
                  <th className="num">Volum</th>
                  <th className="num">KD</th>
                  <th className="num">Poziție</th>
                  <th className="num">Pagina</th>
                  <th className="num">Δ 1 zi</th>
                  <th className="num">Δ 7 zile</th>
                  <th className="num">Best</th>
                  <th className="num">Ultimele 7 zile</th>
                  <th className="num">30 zile</th>
                  <th>SERP</th>
                  <th>AI Overview</th>
                  <th className="num">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {detailRows.map(r => (
                  <tr key={r.kw.id} onClick={() => setOpenKw(r.kw.id)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" className="rt-check" checked={sel.includes(r.kw.id)} onChange={e => setSel(e.target.checked ? [...sel, r.kw.id] : sel.filter(x => x !== r.kw.id))} />
                    </td>
                    <td>
                      <div className="rt-kw">
                        <div className="rt-kw-l1">{r.kw.kw}{r.kw.altUrl && <span className="psi-tag warn">canibalizare</span>}{r.kw.pending && <span className="psi-tag info">nou</span>}</div>
                        <div className="rt-kw-l2">
                          <span className="rt-tag">{r.kw.tag}</span>
                          <span><Icon.MapPin w={10} h={10} /> {r.kw.loc}</span>
                          <span className="rt-url">{r.kw.url}</span>
                        </div>
                      </div>
                    </td>
                    <td className="num">{r.kw.vol ? rtNum(r.kw.vol) : <span className="iv-muted">—</span>}</td>
                    <td className="num">{r.kw.kd ? r.kw.kd : <span className="iv-muted">—</span>}</td>
                    <td className="num">{r.kw.pending ? <span className="iv-muted">prima rulare</span> : <window.RTPos pos={r.pos} />}</td>
                    <td className="num">{r.pos == null ? <span className="iv-muted">—</span> : <span style={{ fontWeight: 700, color: r.pos <= 10 ? "var(--cl-text)" : "var(--cl-text-3)" }}>{Math.ceil(r.pos / 10)}</span>}</td>
                    <td className="num"><window.RTGain value={r.g1} /></td>
                    <td className="num"><window.RTGain value={r.g7} /></td>
                    <td className="num" style={{ fontWeight: 700 }}>{r.best == null ? <span className="iv-muted">—</span> : "#" + r.best}</td>
                    <td className="num">{r.hist.length ? <div style={{ display: "flex", justifyContent: "flex-end" }}><window.RT7 hist={r.hist} /></div> : <span className="iv-muted">—</span>}</td>
                    <td className="num">{r.hist.length ? <div style={{ display: "flex", justifyContent: "flex-end" }}><window.RTSpark hist={r.hist} /></div> : <span className="iv-muted">—</span>}</td>
                    <td><window.RTFeats list={r.kw.feats} ai={r.kw.ai} /></td>
                    <td><window.RTAi state={r.kw.ai} /></td>
                    <td className="num" onClick={e => e.stopPropagation()}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button className="cl-icon-btn" title="Verifică acum" disabled={!!run} onClick={() => runCheck([r.kw.id])}><Icon.RefreshCw w={13} h={13} /></button>
                        <a className="cl-icon-btn" title="Vezi SERP în Google" href={window.rtSerpLink(r.kw.kw, project.locale)} target="_blank" rel="noreferrer"><Icon.ExternalLink w={13} h={13} /></a>
                        <button className="cl-icon-btn" title="Șterge cuvântul" onClick={() => delKws([r.kw.id])}><Icon.Trash w={13} h={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {detailRows.length === 0 && (
                  <tr><td colSpan={14}><div className="cl-empty" style={{ padding: "40px 0" }}><Icon.Search w={20} h={20} /><h3>Niciun cuvânt cheie</h3><p>Schimbă filtrele sau adaugă cuvinte cheie noi în proiect.</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rt-pad" style={{ paddingTop: 14 }}>
        <div className="psi-two">
          <div className="cl-section">
            <div className="cl-section-head">
              <h3><Icon.TrendingUp w={15} h={15} /> Cele mai importante cuvinte · 30 de zile</h3>
              <p className="cl-section-sub" style={{ marginLeft: "auto" }}>după volum de căutare</p>
            </div>
            <window.RTRankChart days={RT.RT_DAYS} height={230} series={topSeries} />
          </div>
          <div className="cl-section">
            <div className="cl-section-head">
              <h3><Icon.Users w={15} h={15} /> Share of voice</h3>
              <p className="cl-section-sub" style={{ marginLeft: "auto" }}>pe cele {pRows.length} cuvinte urmărite</p>
            </div>
            <window.RTCompRow domain={project.domain} self vis={st.vis} max={maxVis} />
            {compVis.sort((a, b) => b.vis - a.vis).map(c => <window.RTCompRow key={c.dom} domain={c.dom} vis={c.vis} max={maxVis} />)}
            <div style={{ marginTop: 16 }}>
              <window.RTDist buckets={st.buckets} total={pRows.length} />
            </div>
          </div>
        </div>
      </div>

      {runsTable}

      {openRow && <window.RTKwDrawer kw={openRow.kw} project={projects.find(p => p.id === openRow.kw.pj)} device={device} checking={!!run} onClose={() => setOpenKw(null)} onRecheck={(id) => runCheck([id])} />}
      {adding && <window.RTAddKwModal projects={projects} projectId={project.id} onClose={() => setAdding(false)} onSave={addKws} />}
      {editProj && <window.RTProjectModal project={editProj === "new" ? null : editProj} clients={clients} onClose={() => setEditProj(null)} onSave={saveProject} onDelete={delProject} />}
      {showSched && <window.RTScheduleModal sched={sched} onChange={setSched} onClose={() => setShowSched(false)} onSave={() => { setShowSched(false); setToast("Programarea și alertele au fost salvate"); }} />}
      {preview && <window.RTReportPreview project={project} rows={pRows} sched={sched} onClose={() => setPreview(false)} onSend={() => { setPreview(false); setToast(`Raport ${project.domain} trimis către ${sched.recipients.length} destinatari`); }} />}
      {toast && <div className="psi-toast"><Icon.Check w={14} h={14} /> {toast}</div>}
    </div>
  );
}

window.RTApp = RTApp;
