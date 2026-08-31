/* ===== OTS — PageSpeed Insights: monitorizare + raport săptămânal ===== */
const PS = window.PSIData;
const { useState: aSt, useMemo: aMemo, useEffect: aEff } = React;
const PSI_LS = "ots_psi_v1";
const PSI_DAYS = ["Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];
const PSI_HOURS = ["06:00", "07:00", "08:00", "09:00", "12:00", "18:00", "21:00"];
const nfro = new Intl.NumberFormat("ro-RO");

function psiFreshScore(id, strategy) {
  const r = PS.psiRng(PS.psiHash(id + strategy + "first"));
  return strategy === "desktop" ? Math.round(70 + r() * 27) : Math.round(36 + r() * 42);
}

function PSIApp() {
  const persisted = aMemo(() => { try { return JSON.parse(localStorage.getItem(PSI_LS)) || {}; } catch (e) { return {}; } }, []);
  const [sites, setSites] = aSt(persisted.sites && persisted.sites.length ? persisted.sites : PS.PSI_SITES_DEFAULT.map(s => ({ ...s })));
  const [sched, setSched] = aSt({ ...PS.PSI_SCHEDULE_DEFAULT, ...(persisted.sched || {}) });
  const [strategy, setStrategy] = aSt("mobile");
  const [tab, setTab] = aSt("all");
  const [q, setQ] = aSt("");
  const [clientF, setClientF] = aSt("all");
  const [sort, setSort] = aSt("worst");
  const [openId, setOpenId] = aSt(null);
  const [editing, setEditing] = aSt(null);
  const [preview, setPreview] = aSt(false);
  const [showSched, setShowSched] = aSt(false);
  const [scan, setScan] = aSt(null);
  const [scanIds, setScanIds] = aSt({});
  const [toast, setToast] = aSt(null);
  const [lastScan, setLastScan] = aSt("24 aug. 2026, 07:04");
  const [recipient, setRecipient] = aSt("");
  const [dirty, setDirty] = aSt(false);

  aEff(() => { try { localStorage.setItem(PSI_LS, JSON.stringify({ sites, sched })); } catch (e) {} }, [sites, sched]);
  aEff(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  const rows = aMemo(() => sites.map(s => {
    const cut = (h) => (s.fresh ? h.slice(-1) : h);
    const hm = cut(PS.psiHistory(s, "mobile"));
    const hd = cut(PS.psiHistory(s, "desktop"));
    const h = strategy === "mobile" ? hm : hd;
    const last = h[h.length - 1] || null, prev = h.length > 1 ? h[h.length - 2] : null;
    const lastM = hm[hm.length - 1] || null, prevM = hm.length > 1 ? hm[hm.length - 2] : null;
    const lastD = hd[hd.length - 1] || null;
    return {
      site: s, hist: h, last, prev,
      perf: last ? last.perf : null,
      delta: last && prev ? last.perf - prev.perf : null,
      perfM: lastM ? lastM.perf : null,
      perfD: lastD ? lastD.perf : null,
      deltaM: lastM && prevM ? lastM.perf - prevM.perf : null,
      prevPerf: prev ? prev.perf : null,
      cwv: PS.psiCwvPass(PS.psiField(s, "mobile")),
      spark: h.map(x => x.perf),
    };
  }), [sites, strategy]);

  const withData = rows.filter(r => r.site.active && r.last);
  const alerts = withData.filter(r => r.deltaM != null && r.deltaM <= -(r.site.alert || 5));
  const avg = (get) => { const v = withData.map(get).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const avgM = avg(r => r.perfM), avgD = avg(r => r.perfD);
  const avgMPrev = (() => { const v = rows.filter(r => r.site.active).map(r => { const hm = r.site.fresh ? [] : PS.psiHistory(r.site, "mobile"); return hm.length > 1 ? hm[hm.length - 2].perf : null; }).filter(x => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();
  const cwvPass = withData.filter(r => r.cwv === true).length;
  const cwvKnown = withData.filter(r => r.cwv != null).length;

  const filtered = aMemo(() => {
    let out = rows.filter(r => {
      const s = r.site;
      if (tab === "attention" && !(r.delta != null && r.delta <= -(s.alert || 5) || (r.perf != null && r.perf < 50) || r.cwv === false)) return false;
      if (tab === "cwv" && r.cwv !== true) return false;
      if (tab === "paused" && s.active) return false;
      if (tab !== "paused" && !s.active) return false;
      if (clientF !== "all" && s.client !== clientF) return false;
      if (q) { const t = (s.domain + " " + s.name + " " + s.client).toLowerCase(); if (!t.includes(q.toLowerCase())) return false; }
      return true;
    });
    const c = { worst: (a, b) => (a.perf ?? 999) - (b.perf ?? 999), best: (a, b) => (b.perf ?? -1) - (a.perf ?? -1), delta: (a, b) => (a.delta ?? 99) - (b.delta ?? 99), domain: (a, b) => a.site.domain.localeCompare(b.site.domain), client: (a, b) => a.site.client.localeCompare(b.site.client) };
    return out.sort(c[sort] || c.worst);
  }, [rows, tab, clientF, q, sort]);

  const trendSeries = aMemo(() => {
    const mk = (st, color, label) => ({
      label, color,
      values: PS.PSI_WEEKS.map((_, i) => {
        const v = sites.filter(s => s.active && !s.fresh).map(s => { const h = PS.psiHistory(s, st); return h[i] ? h[i].perf : null; }).filter(x => x != null);
        return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
      }),
    });
    return [mk("mobile", "#1877F2", "Medie mobil"), mk("desktop", "#8b5cf6", "Medie desktop")];
  }, [sites]);

  /* ---- scanare simulată ---- */
  const runScan = (ids) => {
    const list = (ids && ids.length ? ids : rows.filter(r => r.site.active).map(r => r.site.id));
    if (!list.length || scan) return;
    const nameOf = (id) => (sites.find(s => s.id === id) || {}).domain || "";
    setScan({ total: list.length, done: 0, current: nameOf(list[0]) });
    let i = 0;
    const step = () => {
      const id = list[i];
      setScanIds(p => ({ ...p, [id]: "running" }));
      setTimeout(() => {
        setScanIds(p => ({ ...p, [id]: "done" }));
        setSites(cur => cur.map(s => s.id === id && s.pending
          ? { ...s, pending: false, fresh: true, m: { perf: psiFreshScore(s.id, "mobile"), trend: 0, jump: 0 }, d: { perf: psiFreshScore(s.id, "desktop"), trend: 0, jump: 0 } }
          : s));
        i++;
        setScan(sc => sc && { ...sc, done: i, current: i < list.length ? nameOf(list[i]) : sc.current });
        if (i < list.length) step();
        else setTimeout(() => { setScan(null); setScanIds({}); setLastScan("27 aug. 2026, " + new Date().toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })); setToast(`Scanare finalizată · ${list.length} ${list.length === 1 ? "site măsurat" : "site-uri măsurate"}`); }, 500);
      }, 600);
    };
    step();
  };

  const saveSite = (s) => {
    setSites(cur => cur.some(x => x.id === s.id) ? cur.map(x => x.id === s.id ? s : x) : [...cur, s]);
    setEditing(null);
    setToast(cur => `${s.domain} ${sites.some(x => x.id === s.id) ? "actualizat" : "adăugat în monitorizare"}`);
  };
  const delSite = (id) => { const s = sites.find(x => x.id === id); setSites(cur => cur.filter(x => x.id !== id)); setEditing(null); setOpenId(null); setToast(`${s ? s.domain : "Site"} scos din monitorizare`); };
  const openSite = sites.find(s => s.id === openId);

  const nextRun = `${sched.day} 31 aug. 2026, ${sched.hour}`;
  const clients = ["all", ...Array.from(new Set(sites.map(s => s.client)))];

  return (
    <div className="cl-wrap" data-screen-label="PageSpeed Insights">
      <div className="cl-crumbs">
        <a href="Dashboard OTS.html"><Icon.Folder w={12} h={12} /></a>
        <span className="sep">/</span><a href="#">Marketing &amp; Ads</a>
        <span className="sep">/</span><a href="#">Linkuri SEO</a>
        <span className="sep">/</span><strong>PageSpeed Insights</strong>
      </div>

      <div className="cl-hero">
        <div>
          <h1>PageSpeed Insights</h1>
          <p>
            <strong>{sites.filter(s => s.active).length}</strong> site-uri monitorizate · scanare automată <strong>{sched.day.toLowerCase()}, {sched.hour}</strong> ·
            ultima rulare <strong>{lastScan}</strong>{alerts.length > 0 && <> · <strong className="danger">{alerts.length} {alerts.length === 1 ? "alertă" : "alerte"}</strong> în S35</>}
          </p>
        </div>
        <div className="cl-hero-actions">
          <div className="cl-search">
            <Icon.Search w={14} h={14} />
            <input placeholder="Caută domeniu sau client..." value={q} onChange={e => setQ(e.target.value)} />
            {q && <button className="cl-search-clear" onClick={() => setQ("")}><Icon.X w={12} h={12} /></button>}
          </div>
          <button className="cl-btn-secondary" onClick={() => setShowSched(true)}><Icon.Settings w={13} h={13} /> Setări raport</button>
          <button className="cl-btn-secondary" onClick={() => setPreview(true)}><Icon.Mail w={13} h={13} /> Previzualizează raportul</button>
          <button className="cl-btn-secondary" onClick={() => runScan()} disabled={!!scan}><Icon.RefreshCw w={13} h={13} /> {scan ? "Se scanează…" : "Rulează scanare acum"}</button>
          <button className="cl-btn-primary" onClick={() => setEditing("new")}><Icon.Plus w={13} h={13} /> Adaugă site</button>
        </div>
      </div>

      <div className="cl-hero" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <div className="cl-kpis" style={{ width: "100%", gridTemplateColumns: "repeat(6, 1fr)" }}>
          <div className="cl-kpi">
            <div className="cl-kpi-ic" style={{ background: "var(--cl-accent-50)", color: "var(--cl-accent)" }}><Icon.Phone w={16} h={16} /></div>
            <div>
              <div className="cl-kpi-lbl">Scor mediu mobil</div>
              <div className={`cl-kpi-val psi-${PS.psiScoreLevel(avgM)}`}>{avgM ?? "—"}</div>
              <div className="cl-kpi-sub">{avgMPrev != null && avgM != null ? <window.PSIDelta value={avgM - avgMPrev} suffix=" pct" /> : "—"} vs S34</div>
            </div>
          </div>
          <div className="cl-kpi">
            <div className="cl-kpi-ic" style={{ background: "rgba(139,92,246,.08)", color: "#8b5cf6" }}><window.PSIStratIcon strategy="desktop" w={16} h={16} /></div>
            <div>
              <div className="cl-kpi-lbl">Scor mediu desktop</div>
              <div className={`cl-kpi-val psi-${PS.psiScoreLevel(avgD)}`}>{avgD ?? "—"}</div>
              <div className="cl-kpi-sub">pe {withData.length} site-uri active</div>
            </div>
          </div>
          <div className="cl-kpi">
            <div className="cl-kpi-ic" style={{ background: "rgba(16,185,129,.08)", color: "#10b981" }}><Icon.Check2 w={16} h={16} /></div>
            <div>
              <div className="cl-kpi-lbl">Trec Core Web Vitals</div>
              <div className="cl-kpi-val">{cwvPass}<span style={{ fontSize: 15, color: "var(--cl-text-3)", fontWeight: 700 }}> / {cwvKnown}</span></div>
              <div className="cl-kpi-sub">date reale CrUX, p75 mobil</div>
            </div>
          </div>
          <div className="cl-kpi">
            <div className="cl-kpi-ic" style={{ background: "rgba(239,68,68,.08)", color: "#ef4444" }}><Icon.AlertTriangle w={16} h={16} /></div>
            <div>
              <div className="cl-kpi-lbl">Scăderi peste prag</div>
              <div className={`cl-kpi-val ${alerts.length ? "cl-text-danger" : ""}`}>{alerts.length}</div>
              <div className="cl-kpi-sub">{alerts.length ? alerts.map(a => a.site.domain).join(", ") : "nicio scădere în S35"}</div>
            </div>
          </div>
          <div className="cl-kpi">
            <div className="cl-kpi-ic" style={{ background: "rgba(100,116,139,.1)", color: "#64748b" }}><Icon.Globe w={16} h={16} /></div>
            <div>
              <div className="cl-kpi-lbl">Site-uri în monitorizare</div>
              <div className="cl-kpi-val">{sites.filter(s => s.active).length}</div>
              <div className="cl-kpi-sub">{sites.reduce((n, s) => n + (s.pages || []).length, 0)} URL-uri · {sites.filter(s => !s.active).length} în pauză</div>
            </div>
          </div>
          <div className="cl-kpi">
            <div className="cl-kpi-ic" style={{ background: "rgba(245,158,11,.08)", color: "#f59e0b" }}><Icon.Calendar w={16} h={16} /></div>
            <div>
              <div className="cl-kpi-lbl">Următorul raport</div>
              <div className="cl-kpi-val" style={{ fontSize: 19 }}>{sched.day}, {sched.hour}</div>
              <div className="cl-kpi-sub">31 aug. 2026 · în 4 zile</div>
            </div>
          </div>
        </div>
      </div>

      {scan && (
        <div className="psi-pad" style={{ paddingTop: 16 }}>
          <div className="psi-banner">
            <span className="psi-spin" />
            <span className="psi-banner-txt">Se interoghează PageSpeed Insights API · {scan.done}/{scan.total} · {scan.current}</span>
            <span className="psi-banner-track"><i style={{ width: `${(scan.done / scan.total) * 100}%` }} /></span>
          </div>
        </div>
      )}

      <div className="cl-toolbar">
        <div className="cl-tabs">
          {[["all", "Toate", rows.filter(r => r.site.active).length], ["attention", "Necesită atenție", rows.filter(r => r.site.active && (r.delta != null && r.delta <= -(r.site.alert || 5) || (r.perf != null && r.perf < 50) || r.cwv === false)).length], ["cwv", "Trec CWV", rows.filter(r => r.site.active && r.cwv === true).length], ["paused", "În pauză", rows.filter(r => !r.site.active).length]].map(([id, lbl, n]) => (
            <button key={id} className={`cl-tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>
              {lbl}<span className={`cl-tab-count ${id === "attention" && n ? "cl-tab-count-danger" : ""}`}>{n}</span>
            </button>
          ))}
        </div>
        <div className="cl-toolbar-spacer" />
        <div className="psi-seg">
          {["mobile", "desktop"].map(s => (
            <button key={s} className={strategy === s ? "active" : ""} onClick={() => setStrategy(s)}>
              <window.PSIStratIcon strategy={s} /> {s === "mobile" ? "Mobil" : "Desktop"}
            </button>
          ))}
        </div>
        <div className="cl-select-wrap">
          <span className="cl-select-lbl">Client</span>
          <select className="cl-select" value={clientF} onChange={e => setClientF(e.target.value)}>
            {clients.map(c => <option key={c} value={c}>{c === "all" ? "Toți clienții" : c}</option>)}
          </select>
        </div>
        <div className="cl-select-wrap">
          <span className="cl-select-lbl">Sortare</span>
          <select className="cl-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="worst">Cele mai slabe scoruri</option>
            <option value="best">Cele mai bune scoruri</option>
            <option value="delta">Cea mai mare scădere</option>
            <option value="domain">Domeniu A–Z</option>
            <option value="client">Client A–Z</option>
          </select>
        </div>
      </div>

      <div className="psi-pad">
        <div className="cl-section" style={{ padding: 0 }}>
          <div className="cl-section-head" style={{ padding: "16px 20px 12px", marginBottom: 0 }}>
            <h3><Icon.Activity w={15} h={15} /> Măsurători {strategy === "mobile" ? "mobil" : "desktop"} · săptămâna S35 ({PS.PSI_WEEKS[PS.PSI_WEEKS.length - 1].full})</h3>
            <p className="cl-section-sub" style={{ marginLeft: "auto" }}>click pe un rând pentru raportul complet Lighthouse</p>
          </div>
          <div className="psi-table-scroll">
            <table className="cl-list-table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th className="num">Scor</th>
                  <th className="num">Δ 7 zile</th>
                  <th className="num">10 săptămâni</th>
                  <th className="num">LCP</th>
                  <th className="num">INP</th>
                  <th className="num">CLS</th>
                  <th className="num">TBT</th>
                  <th>Core Web Vitals</th>
                  <th className="num">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const st = scanIds[r.site.id];
                  return (
                    <tr key={r.site.id} onClick={() => setOpenId(r.site.id)}>
                      <td>
                        <div className="psi-site">
                          <span className="psi-fav" style={{ background: window.psiTileColor(r.site.id) }}>{window.psiInitials(r.site.domain)}</span>
                          <div style={{ minWidth: 0 }}>
                            <div className="psi-site-l1">
                              {r.site.domain}
                              {r.site.fresh && <span className="psi-tag info">nou</span>}
                              {!r.site.active && <span className="psi-tag">pauză</span>}
                            </div>
                            <div className="psi-site-l2">{r.site.client} · {r.site.cms} · {(r.site.pages || []).length} URL</div>
                          </div>
                        </div>
                      </td>
                      <td className="num">
                        {st === "running"
                          ? <span className="psi-row-scan"><span className="psi-spin" /> rulează</span>
                          : <div style={{ display: "flex", justifyContent: "flex-end" }}><window.PSIDonut value={r.perf} size={38} /></div>}
                      </td>
                      <td className="num">{r.site.pending ? <span className="iv-muted">prima scanare</span> : <window.PSIDelta value={r.delta} suffix=" pct" />}</td>
                      <td className="num"><div style={{ display: "flex", justifyContent: "flex-end" }}><window.PSISpark values={r.spark} /></div></td>
                      <td className="num">{r.last ? <window.PSIMetric k="lcp" v={r.last.lcp} /> : <span className="iv-muted">—</span>}</td>
                      <td className="num">{r.last ? <window.PSIMetric k="inp" v={r.last.inp} /> : <span className="iv-muted">—</span>}</td>
                      <td className="num">{r.last ? <window.PSIMetric k="cls" v={r.last.cls} /> : <span className="iv-muted">—</span>}</td>
                      <td className="num">{r.last ? <window.PSIMetric k="tbt" v={r.last.tbt} /> : <span className="iv-muted">—</span>}</td>
                      <td><window.PSICwv pass={r.cwv} /></td>
                      <td className="num" onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                          <button className="cl-icon-btn" title="Rescanează acum" disabled={!!scan} onClick={() => runScan([r.site.id])}><Icon.RefreshCw w={13} h={13} /></button>
                          <button className="cl-icon-btn" title="Editează site-ul" onClick={() => setEditing(r.site)}><Icon.Edit w={13} h={13} /></button>
                          <a className="cl-icon-btn" title="Deschide în PageSpeed Insights" href={window.psiPsiLink(r.site.pages[0].url, strategy)} target="_blank" rel="noreferrer"><Icon.ExternalLink w={13} h={13} /></a>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={10}><div className="cl-empty" style={{ padding: "40px 0" }}><Icon.Search w={20} h={20} /><h3>Niciun site</h3><p>Schimbă filtrele sau adaugă un site nou în monitorizare.</p></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="psi-pad" style={{ paddingTop: 14 }}>
        <div className="cl-section">
          <div className="cl-section-head">
            <h3><Icon.TrendingUp w={15} h={15} /> Evoluția scorului mediu</h3>
            <p className="cl-section-sub" style={{ marginLeft: "auto" }}>medie pe site-urile active, o măsurătoare pe săptămână</p>
            <div className="cl-section-actions">
              <div className="psi-next" style={{ padding: "8px 12px", gap: 10 }}>
                <span className="psi-next-ic" style={{ width: 30, height: 30, borderRadius: 9 }}><Icon.Send w={14} h={14} /></span>
                <div>
                  <div className="psi-next-l1" style={{ fontSize: 12.5 }}>{nextRun}</div>
                  <div className="psi-next-l2">{sched.recipients.length} destinatari · {sched.strategies.length === 2 ? "mobil + desktop" : sched.strategies[0] === "mobile" ? "doar mobil" : "doar desktop"}</div>
                </div>
                <button className="cl-btn-mini" style={{ marginLeft: 4 }} onClick={() => setShowSched(true)}><Icon.Settings w={11} h={11} /> Setări</button>
              </div>
            </div>
          </div>
          <window.PSILine weeks={PS.PSI_WEEKS} series={trendSeries} height={210} />
        </div>
      </div>
      <div className="psi-pad" style={{ padding: "14px 28px 60px" }}>
        <div className="cl-section" style={{ padding: 0 }}>
          <div className="cl-section-head" style={{ padding: "16px 20px 12px", marginBottom: 0 }}>
            <h3><Icon.FileText w={15} h={15} /> Rapoarte trimise</h3>
            <p className="cl-section-sub" style={{ marginLeft: "auto" }}>istoricul rulărilor automate</p>
          </div>
          <table className="cl-list-table">
            <thead>
              <tr>
                <th>Săptămâna</th><th>Trimis</th><th className="num">Site-uri</th><th className="num">Scor mediu mobil</th>
                <th className="num">Δ</th><th className="num">Scor mediu desktop</th><th className="num">Alerte</th><th>Status</th><th className="num">Acțiuni</th>
              </tr>
            </thead>
            <tbody>
              {PS.PSI_REPORTS.map(rp => (
                <tr key={rp.week} style={{ cursor: "default" }}>
                  <td style={{ fontWeight: 700 }}>{rp.week}</td>
                  <td>{rp.date}{rp.note && <div className="psi-site-l2">{rp.note}</div>}</td>
                  <td className="num">{rp.sites}</td>
                  <td className={`num psi-${PS.psiScoreLevel(rp.avgM)}`} style={{ fontWeight: 800 }}>{rp.avgM}</td>
                  <td className="num"><window.PSIDelta value={rp.dM} /></td>
                  <td className={`num psi-${PS.psiScoreLevel(rp.avgD)}`} style={{ fontWeight: 700 }}>{rp.avgD}</td>
                  <td className="num">{rp.alerts ? <span className="psi-tag danger">{rp.alerts}</span> : <span className="iv-muted">0</span>}</td>
                  <td>{rp.status === "sent" ? <span className="psi-tag ok">trimis</span> : <span className="psi-tag warn">parțial</span>}</td>
                  <td className="num">
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button className="cl-icon-btn" title="Vezi raportul" onClick={() => setPreview(true)}><Icon.Eye w={13} h={13} /></button>
                      <button className="cl-icon-btn" title="Descarcă PDF" onClick={() => setToast(`Raport ${rp.week}.pdf pregătit pentru descărcare`)}><Icon.Download w={13} h={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showSched && (
        <div className="psi-modal-back" onClick={() => setShowSched(false)}>
          <div className="psi-modal" style={{ width: 640 }} onClick={e => e.stopPropagation()}>
            <div className="psi-modal-head">
              <span className="psi-modal-ic"><Icon.Calendar w={17} h={17} /></span>
              <div>
                <div className="psi-modal-title">Raport săptămânal</div>
                <div className="psi-modal-sub">programarea scanării automate și livrarea raportului</div>
              </div>
              <button className="psi-drawer-close" onClick={() => setShowSched(false)}><Icon.X w={15} h={15} /></button>
            </div>
            <div className="psi-modal-body">
              <div className="psi-next">
              <span className="psi-next-ic"><Icon.Send w={18} h={18} /></span>
              <div>
                <div className="psi-next-l1">{nextRun}</div>
                <div className="psi-next-l2">{sched.tz} · {sched.recipients.length} destinatari · {sched.strategies.length === 2 ? "mobil + desktop" : sched.strategies[0] === "mobile" ? "doar mobil" : "doar desktop"}</div>
              </div>
              <span className="psi-tag ok" style={{ marginLeft: "auto" }}>activ</span>
            </div>

            <div className="psi-sched-grid">
              <div className="cl-field"><label>Ziua</label>
                <select className="cl-select" style={{ width: "100%" }} value={sched.day} onChange={e => { setSched({ ...sched, day: e.target.value }); setDirty(true); }}>
                  {PSI_DAYS.map(d => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div className="cl-field"><label>Ora</label>
                <select className="cl-select" style={{ width: "100%" }} value={sched.hour} onChange={e => { setSched({ ...sched, hour: e.target.value }); setDirty(true); }}>
                  {PSI_HOURS.map(h => <option key={h}>{h}</option>)}
                </select>
              </div>
              <div className="cl-field"><label>Strategii</label>
                <div className="psi-seg multi" style={{ marginTop: 2 }}>
                  {["mobile", "desktop"].map(s => (
                    <button key={s} className={sched.strategies.includes(s) ? "active" : ""}
                            title={sched.strategies.includes(s) ? "Inclus în raport" : "Adaugă în raport"}
                            onClick={() => { const next = sched.strategies.includes(s) ? sched.strategies.filter(x => x !== s) : [...sched.strategies, s]; if (next.length) { setSched({ ...sched, strategies: next }); setDirty(true); } }}>
                      <span className="psi-seg-box"><Icon.Check w={10} h={10} /></span>
                      <window.PSIStratIcon strategy={s} /> {s === "mobile" ? "Mobil" : "Desktop"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="cl-field"><label>Prag alertă</label>
                <input className="cl-input" type="number" min="1" max="50" value={sched.threshold} onChange={e => { setSched({ ...sched, threshold: +e.target.value || 1 }); setDirty(true); }} />
              </div>
            </div>

            <div className="cl-field" style={{ marginTop: 14 }}>
              <div className="cl-field-head"><label>Destinatari</label><span className="cl-hint">primesc raportul și alertele</span></div>
              <div className="psi-chips">
                {sched.recipients.map(r => (
                  <span className="psi-chip" key={r}>{r}
                    <button title="Elimină" onClick={() => { setSched({ ...sched, recipients: sched.recipients.filter(x => x !== r) }); setDirty(true); }}><Icon.X w={11} h={11} /></button>
                  </span>
                ))}
                {sched.recipients.length === 0 && <span className="cl-hint">niciun destinatar — raportul nu se trimite</span>}
              </div>
              <div className="psi-chip-add">
                <input className="cl-input" placeholder="email@client.ro" value={recipient} onChange={e => setRecipient(e.target.value)}
                       onKeyDown={e => { if (e.key === "Enter" && /.+@.+\..+/.test(recipient)) { setSched({ ...sched, recipients: [...sched.recipients, recipient.trim()] }); setRecipient(""); setDirty(true); } }} />
                <button className="cl-btn-secondary" disabled={!/.+@.+\..+/.test(recipient)} onClick={() => { setSched({ ...sched, recipients: [...sched.recipients, recipient.trim()] }); setRecipient(""); setDirty(true); }}><Icon.Plus w={12} h={12} /> Adaugă</button>
              </div>
            </div>

            <div className="psi-toggles">
              <div className="psi-toggle-row">
                <div><div className="psi-toggle-txt">Trimite doar când scad scorurile</div><div className="psi-toggle-sub">raportul pleacă doar dacă un site pierde ≥ {sched.threshold} puncte</div></div>
                <window.PSISwitch on={sched.onlyOnDrop} onChange={v => { setSched({ ...sched, onlyOnDrop: v }); setDirty(true); }} />
              </div>
              <div className="psi-toggle-row">
                <div><div className="psi-toggle-txt">Include oportunitățile PageSpeed</div><div className="psi-toggle-sub">primele 3 recomandări pentru site-urile sub 90</div></div>
                <window.PSISwitch on={sched.includeOpportunities} onChange={v => { setSched({ ...sched, includeOpportunities: v }); setDirty(true); }} />
              </div>
              <div className="psi-toggle-row">
                <div><div className="psi-toggle-txt">Atașează PDF-ul raportului</div><div className="psi-toggle-sub">un fișier per săptămână, arhivat în client</div></div>
                <window.PSISwitch on={sched.attachPdf} onChange={v => { setSched({ ...sched, attachPdf: v }); setDirty(true); }} />
              </div>
              <div className="psi-toggle-row">
                <div><div className="psi-toggle-txt">Trimite și clientului</div><div className="psi-toggle-sub">folosește emailul de contact din fișa clientului</div></div>
                <window.PSISwitch on={sched.sendToClient} onChange={v => { setSched({ ...sched, sendToClient: v }); setDirty(true); }} />
              </div>
            </div>
            </div>
            <div className="psi-modal-foot">
              <span className="cl-hint" style={{ marginRight: "auto" }}>{dirty ? "Modificări nesalvate" : "Programare salvată"}</span>
              <button className="cl-btn-secondary" onClick={() => { setSched({ ...PS.PSI_SCHEDULE_DEFAULT }); setDirty(false); setToast("Programare resetată la valorile implicite"); }}>Resetează</button>
              <button className="cl-btn-primary" onClick={() => { setDirty(false); setShowSched(false); setToast("Programarea raportului a fost salvată"); }}><Icon.Check w={13} h={13} /> Salvează programarea</button>
            </div>
          </div>
        </div>
      )}

      {openSite && <window.PSIDrawer site={openSite} strategy={strategy} scanning={!!scan} onClose={() => setOpenId(null)} onRescan={(id) => runScan([id])} />}
      {editing && <window.PSISiteModal site={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSave={saveSite} onDelete={delSite} />}
      {preview && <window.PSIMailPreview rows={rows} sched={sched} onClose={() => setPreview(false)} onSend={() => { setPreview(false); setToast(`Raport S35 trimis către ${sched.recipients.length} destinatari`); }} />}
      {toast && <div className="psi-toast"><Icon.Check w={14} h={14} /> {toast}</div>}
    </div>
  );
}

window.PSIApp = PSIApp;
