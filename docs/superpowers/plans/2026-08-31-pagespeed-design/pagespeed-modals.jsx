/* ===== OTS — PageSpeed: drawer detaliu, modal site nou, previzualizare raport ===== */
const PSM = window.PSIData;
const { useState: mSt, useMemo: mMemo } = React;

function psiPsiLink(url, strategy) {
  return `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;
}

/* ---------- drawer detaliu site ---------- */
function PSIDrawer({ site, strategy: initStrategy, onClose, onRescan, scanning }) {
  const [strategy, setStrategy] = mSt(initStrategy);
  const hist = mMemo(() => PSM.psiHistory(site, strategy), [site, strategy]);
  const last = hist[hist.length - 1];
  const prev = hist[hist.length - 2];
  const cats = PSM.psiCategories(site, strategy);
  const field = PSM.psiField(site, strategy);
  const opps = PSM.psiOpportunities(site, strategy);
  const cwv = PSM.psiCwvPass(field);
  const pageScores = mMemo(() => {
    const rnd = PSM.psiRng(PSM.psiHash(site.id + strategy + "pages"));
    return (site.pages || []).map((p, i) => ({ ...p, score: last ? Math.max(4, Math.min(100, Math.round(last.perf + (i === 0 ? 0 : rnd() * 22 - 14)))) : null }));
  }, [site, strategy, last]);

  const labRows = [
    { k: "lcp", v: last && last.lcp, max: 6 },
    { k: "fcp", v: last && last.fcp, max: 5 },
    { k: "tbt", v: last && last.tbt, max: 1200 },
    { k: "si", v: last && last.si, max: 9 },
    { k: "cls", v: last && last.cls, max: 0.5 },
  ];

  return (
    <div className="psi-drawer-back" onClick={onClose}>
      <div className="psi-drawer" onClick={e => e.stopPropagation()}>
        <div className="psi-drawer-head">
          <span className="psi-fav" style={{ background: window.psiTileColor(site.id), width: 40, height: 40, borderRadius: 11, fontSize: 14 }}>{window.psiInitials(site.domain)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: "-.02em" }}>{site.domain}</h3>
              {!site.active && <span className="psi-tag">în pauză</span>}
              <span className="psi-tag info">{site.cms}</span>
            </div>
            <div className="psi-site-l2" style={{ maxWidth: 420 }}>{site.client} · {(site.pages || []).length} {(site.pages || []).length === 1 ? "pagină" : "pagini"} testate · adăugat {site.added}</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>

        <div className="psi-drawer-body">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="psi-seg">
              {["mobile", "desktop"].map(s => (
                <button key={s} className={strategy === s ? "active" : ""} onClick={() => setStrategy(s)}>
                  <window.PSIStratIcon strategy={s} /> {s === "mobile" ? "Mobil" : "Desktop"}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <button className="cl-btn-secondary cl-btn-sm" onClick={() => onRescan(site.id)} disabled={scanning}><Icon.RefreshCw w={12} h={12} /> Rescanează</button>
              <a className="cl-btn-secondary cl-btn-sm" href={psiPsiLink(site.pages[0].url, strategy)} target="_blank" rel="noreferrer"><Icon.ExternalLink w={12} h={12} /> PageSpeed Insights</a>
            </div>
          </div>

          {!last ? (
            <div className="cl-section"><div className="cl-budget-empty" style={{ padding: "26px 0" }}>Site adăugat, fără scanare încă. Prima măsurătoare rulează la următorul raport săptămânal.</div></div>
          ) : (
            <>
              <div className="cl-section">
                <div className="cl-section-head"><h3><Icon.Activity w={15} h={15} /> Scoruri Lighthouse</h3><p className="cl-section-sub" style={{ marginLeft: "auto" }}>scanat {PSM.PSI_WEEKS[PSM.PSI_WEEKS.length - 1].full}, 07:0{site.id.length % 6}</p></div>
                <div className="psi-scores">
                  {[{ lbl: "Performance", v: cats.perf }, { lbl: "Accesibilitate", v: cats.a11y }, { lbl: "Bune practici", v: cats.bp }, { lbl: "SEO", v: cats.seo }].map(c => (
                    <div className="psi-score-card" key={c.lbl}>
                      <window.PSIDonut value={c.v} size={62} stroke={6} />
                      <div className="psi-score-lbl">{c.lbl}</div>
                      {c.lbl === "Performance" && prev && <window.PSIDelta value={cats.perf - prev.perf} suffix=" pct" />}
                    </div>
                  ))}
                </div>
              </div>

              <div className="cl-section">
                <div className="cl-section-head">
                  <h3><Icon.Clock w={15} h={15} /> Metrici de laborator</h3>
                  <p className="cl-section-sub" style={{ marginLeft: "auto" }}>{strategy === "mobile" ? "emulare Moto G Power · 4G lent" : "desktop · conexiune cablu"}</p>
                </div>
                <div className="psi-mrows">
                  {labRows.map(r => {
                    const t = PSM.PSI_THRESHOLDS[r.k];
                    const lvl = PSM.psiMetricLevel(r.k, r.v);
                    const pct = Math.max(4, Math.min(100, (r.v / r.max) * 100));
                    const dv = prev ? r.v - prev[r.k] : null;
                    return (
                      <div className="psi-mrow" key={r.k}>
                        <span className={`sq psi-sq-${lvl}`} style={{ width: 10, height: 10, borderRadius: 3 }} />
                        <div>
                          <div className="psi-mrow-name">{t.label} — {t.name}</div>
                          <div className="psi-mrow-sub">bun ≤ {PSM.psiFmt(r.k, t.good)} · de îmbunătățit ≤ {PSM.psiFmt(r.k, t.ni)}</div>
                        </div>
                        <div className={`psi-mrow-val psi-${lvl}`}>{PSM.psiFmt(r.k, r.v)}</div>
                        <div>
                          <div className="psi-mrow-scale"><i style={{ width: `${pct}%`, background: window.PSI_LVL[lvl] }} /></div>
                          <div className="psi-mrow-sub" style={{ textAlign: "right" }}>{dv == null || Math.abs(dv) < 0.001 ? "" : `${dv > 0 ? "+" : "−"}${PSM.psiFmt(r.k, Math.abs(dv))} vs S34`}</div>
                        </div>
                      </div>
                    );
                  })}
                  <div className="psi-mrow">
                    <span className="sq psi-sq-none" style={{ width: 10, height: 10, borderRadius: 3 }} />
                    <div><div className="psi-mrow-name">TTFB · greutate pagină</div><div className="psi-mrow-sub">{last.requests} cereri de rețea</div></div>
                    <div className="psi-mrow-val">{last.ttfb} ms</div>
                    <div className="psi-mrow-sub" style={{ textAlign: "right" }}>{(last.bytes / 1000).toFixed(1).replace(".", ",")} MB transferați</div>
                  </div>
                </div>
              </div>

              <div className="cl-section">
                <div className="cl-section-head">
                  <h3><Icon.Users w={15} h={15} /> Date reale de la utilizatori (CrUX, p75 / 28 zile)</h3>
                  <div className="cl-section-actions"><window.PSICwv pass={cwv} /></div>
                </div>
                {field && field.noData ? (
                  <div className="cl-budget-empty" style={{ padding: "16px 0" }}>Volum insuficient de trafic pentru raportul Chrome UX pe {strategy === "mobile" ? "mobil" : "desktop"}. Rămân valabile doar metricile de laborator.</div>
                ) : (
                  <>
                    <div className="psi-mrows">
                      {["lcp", "inp", "cls"].map(k => {
                        const lvl = PSM.psiMetricLevel(k, field[k]);
                        const t = PSM.PSI_THRESHOLDS[k];
                        return (
                          <div className="psi-mrow" key={k} style={{ gridTemplateColumns: "12px 1fr 92px 120px" }}>
                            <span className={`sq psi-sq-${lvl}`} style={{ width: 10, height: 10, borderRadius: 3 }} />
                            <div><div className="psi-mrow-name">{t.label} — {t.name}</div><div className="psi-mrow-sub">prag Core Web Vitals: ≤ {PSM.psiFmt(k, t.good)}</div></div>
                            <div className={`psi-mrow-val psi-${lvl}`}>{PSM.psiFmt(k, field[k])}</div>
                            <div className="psi-mrow-sub" style={{ textAlign: "right" }}>{lvl === "good" ? "trece pragul" : lvl === "ni" ? "de îmbunătățit" : "sub prag"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="cl-hint" style={{ marginTop: 10 }}>Eșantion origine: {new Intl.NumberFormat("ro-RO").format(field.origin)} sesiuni Chrome.</p>
                  </>
                )}
              </div>

              {opps.length > 0 && (
                <div className="cl-section">
                  <div className="cl-section-head"><h3><Icon.Zap w={15} h={15} /> Oportunități de optimizare</h3><p className="cl-section-sub" style={{ marginLeft: "auto" }}>economie estimată de PageSpeed</p></div>
                  {opps.map(o => (
                    <div className="psi-opp" key={o.id}>
                      <span>{o.label}</span>
                      <span className="psi-opp-save psi-ni">{o.unit === "el" ? `${new Intl.NumberFormat("ro-RO").format(o.saving)} el.` : `−${o.saving.toFixed(2).replace(".", ",")} s`}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="cl-section">
                <div className="cl-section-head"><h3><Icon.TrendingUp w={15} h={15} /> Evoluție 10 săptămâni</h3></div>
                <window.PSILine weeks={PSM.PSI_WEEKS} height={180} series={[{ label: strategy === "mobile" ? "Performance mobil" : "Performance desktop", color: "#1877F2", values: hist.map(h => h.perf) }]} />
              </div>

              <div className="cl-section">
                <div className="cl-section-head"><h3><Icon.Link w={15} h={15} /> Pagini incluse în scanare</h3><p className="cl-section-sub" style={{ marginLeft: "auto" }}>scorul se raportează pe fiecare URL</p></div>
                {pageScores.map(p => (
                  <div className="psi-page-row" key={p.url}>
                    <window.PSIDonut value={p.score} size={30} stroke={3} />
                    <span className="psi-page-lbl">{p.label}</span>
                    <span className="psi-page-url">{p.url}</span>
                    <a className="cl-btn-mini" style={{ marginLeft: "auto" }} href={psiPsiLink(p.url, strategy)} target="_blank" rel="noreferrer"><Icon.ExternalLink w={11} h={11} /> testează</a>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- modal adăugare / editare site ---------- */
function PSISiteModal({ site, onClose, onSave, onDelete }) {
  const editing = !!site;
  const [f, setF] = mSt(() => site ? {
    domain: site.domain, name: site.name, client: site.client, cms: site.cms, alert: site.alert, active: site.active,
    pages: site.pages.map(p => ({ ...p })), strategies: ["mobile", "desktop"],
  } : {
    domain: "", name: "", client: PSM.PSI_CLIENTS[0], cms: "WordPress", alert: 5, active: true,
    pages: [{ url: "", label: "Homepage" }], strategies: ["mobile", "desktop"],
  });
  const [err, setErr] = mSt("");
  const set = (k, v) => setF({ ...f, [k]: v });
  const setPage = (i, k, v) => set("pages", f.pages.map((p, j) => j === i ? { ...p, [k]: v } : p));
  const norm = (u) => { let v = (u || "").trim(); if (!v) return ""; if (!/^https?:\/\//i.test(v)) v = "https://" + v; return v; };

  const save = () => {
    const first = norm(f.pages[0] && f.pages[0].url);
    if (!first) return setErr("Adaugă cel puțin URL-ul paginii principale.");
    let host = "";
    try { host = new URL(first).hostname.replace(/^www\./, ""); } catch (e) { return setErr("URL invalid. Exemplu: https://exemplu.ro/"); }
    if (!f.strategies.length) return setErr("Selectează cel puțin o strategie (mobil sau desktop).");
    onSave({
      ...(site || {}),
      id: site ? site.id : "s" + Date.now(),
      domain: f.domain.trim() || host,
      name: f.name.trim() || host,
      client: f.client, cms: f.cms, alert: +f.alert || 5, active: f.active,
      pages: f.pages.filter(p => norm(p.url)).map(p => ({ url: norm(p.url), label: p.label || "Pagină" })),
      strategies: f.strategies,
      added: site ? site.added : "27 aug. 2026",
      m: site ? site.m : { perf: null }, d: site ? site.d : { perf: null },
      ch: site ? site.ch : { lcp: 1, tbt: 1, cls: 1, inp: 1 },
      pending: site ? site.pending : true,
    });
  };

  return (
    <div className="psi-modal-back" onClick={onClose}>
      <div className="psi-modal" onClick={e => e.stopPropagation()}>
        <div className="psi-modal-head">
          <span className="psi-modal-ic"><Icon.Globe w={17} h={17} /></span>
          <div>
            <div className="psi-modal-title">{editing ? "Editează site-ul monitorizat" : "Adaugă site în monitorizare"}</div>
            <div className="psi-modal-sub">{editing ? site.domain : "site-ul intră automat în raportul săptămânal PageSpeed"}</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-modal-body">
          <div className="cl-form-row two">
            <div className="cl-field"><label>Nume site</label><input className="cl-input" placeholder="ex: Heylux Studio" value={f.name} onChange={e => set("name", e.target.value)} /></div>
            <div className="cl-field"><label>Client</label>
              <select className="cl-select" style={{ width: "100%" }} value={f.client} onChange={e => set("client", e.target.value)}>
                {PSM.PSI_CLIENTS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="cl-field" style={{ marginTop: 12 }}>
            <div className="cl-field-head"><label>Pagini testate <span className="cl-req">*</span></label><span className="cl-hint">prima pagină este cea raportată în tabel</span></div>
            {f.pages.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "150px 1fr 32px", gap: 8, marginTop: 8 }}>
                <input className="cl-input" placeholder="Etichetă" value={p.label} onChange={e => setPage(i, "label", e.target.value)} />
                <input className="cl-input" placeholder="https://exemplu.ro/" value={p.url} onChange={e => setPage(i, "url", e.target.value)} />
                <button className="cl-icon-btn" title="Șterge pagina" disabled={f.pages.length === 1} onClick={() => set("pages", f.pages.filter((_, j) => j !== i))}><Icon.Trash w={13} h={13} /></button>
              </div>
            ))}
            <button className="cl-btn-mini" style={{ marginTop: 9 }} onClick={() => set("pages", [...f.pages, { url: "", label: "Pagină" }])}><Icon.Plus w={11} h={11} /> Adaugă pagină</button>
          </div>
          <div className="cl-form-row three" style={{ marginTop: 14 }}>
            <div className="cl-field"><label>Platformă</label>
              <select className="cl-select" style={{ width: "100%" }} value={f.cms} onChange={e => set("cms", e.target.value)}>{PSM.PSI_CMS.map(c => <option key={c}>{c}</option>)}</select>
            </div>
            <div className="cl-field"><label>Strategii testate</label>
              <div className="psi-seg multi" style={{ marginTop: 2 }}>
                {["mobile", "desktop"].map(s => (
                  <button key={s} className={f.strategies.includes(s) ? "active" : ""}
                          title={f.strategies.includes(s) ? "Se testează" : "Adaugă strategia"}
                          onClick={() => set("strategies", f.strategies.includes(s) ? f.strategies.filter(x => x !== s) : [...f.strategies, s])}>
                    <span className="psi-seg-box"><Icon.Check w={10} h={10} /></span>
                    <window.PSIStratIcon strategy={s} /> {s === "mobile" ? "Mobil" : "Desktop"}
                  </button>
                ))}
              </div>
            </div>
            <div className="cl-field"><label>Prag alertă (puncte)</label><input className="cl-input" type="number" min="1" max="50" value={f.alert} onChange={e => set("alert", e.target.value)} />
              <span className="cl-hint">alertă în raport dacă scorul scade cu cel puțin atât</span>
            </div>
          </div>
          <div className="psi-toggle-row" style={{ marginTop: 10, borderTop: "1px solid var(--cl-border)" }}>
            <div><div className="psi-toggle-txt">Monitorizare activă</div><div className="psi-toggle-sub">site-urile inactive rămân în listă, dar nu se scanează</div></div>
            <window.PSISwitch on={f.active} onChange={v => set("active", v)} />
          </div>
          {err && <div className="psi-mail-alert" style={{ marginTop: 12 }}>{err}</div>}
        </div>
        <div className="psi-modal-foot">
          {editing && <button className="cl-btn-secondary" style={{ marginRight: "auto", color: "var(--cl-danger)" }} onClick={() => onDelete(site.id)}><Icon.Trash w={13} h={13} /> Scoate din monitorizare</button>}
          <button className="cl-btn-secondary" onClick={onClose}>Anulează</button>
          <button className="cl-btn-primary" onClick={save}><Icon.Check w={13} h={13} /> {editing ? "Salvează" : "Adaugă site"}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- previzualizare raport săptămânal ---------- */
function PSIMailPreview({ rows, sched, onClose, onSend }) {
  const wk = PSM.PSI_WEEKS[PSM.PSI_WEEKS.length - 1];
  const act = rows.filter(r => r.site.active && r.last);
  const avg = (k) => act.length ? Math.round(act.reduce((s, r) => s + r[k], 0) / act.length) : 0;
  const avgM = avg("perfM"), avgD = avg("perfD");
  const dM = act.length ? Math.round(act.reduce((s, r) => s + (r.deltaM || 0), 0) / act.length) : 0;
  const alerts = act.filter(r => r.deltaM <= -r.site.alert);
  const cwvPass = act.filter(r => r.cwv === true).length;

  return (
    <div className="psi-modal-back" onClick={onClose}>
      <div className="psi-modal lg" onClick={e => e.stopPropagation()}>
        <div className="psi-modal-head">
          <span className="psi-modal-ic"><Icon.Mail w={17} h={17} /></span>
          <div>
            <div className="psi-modal-title">Previzualizare raport săptămânal</div>
            <div className="psi-modal-sub">către {sched.recipients.join(", ")} · {sched.day} {sched.hour} ({sched.tz})</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-modal-body">
          <div className="psi-mail">
            <div className="psi-mail-head">
              <h4>Raport PageSpeed Insights — {wk.label}</h4>
              <p>Săptămâna {wk.full} · {act.length} site-uri scanate · One Top Solution</p>
            </div>
            <div className="psi-mail-kpis">
              <div className="psi-mail-kpi"><span>Scor mediu mobil</span><b className={`psi-${PSM.psiScoreLevel(avgM)}`}>{avgM}</b></div>
              <div className="psi-mail-kpi"><span>Scor mediu desktop</span><b className={`psi-${PSM.psiScoreLevel(avgD)}`}>{avgD}</b></div>
              <div className="psi-mail-kpi"><span>Δ vs săpt. trecută</span><b>{dM > 0 ? "+" : ""}{dM}</b></div>
              <div className="psi-mail-kpi"><span>Trec Core Web Vitals</span><b>{cwvPass}/{act.length}</b></div>
            </div>
            <div className="psi-mail-body">
              <table className="psi-mail-table">
                <thead><tr><th>Site</th><th className="r">Mobil</th><th className="r">Δ</th><th className="r">Desktop</th><th className="r">LCP</th><th className="r">CLS</th><th className="r">CWV</th></tr></thead>
                <tbody>
                  {act.map(r => (
                    <tr key={r.site.id}>
                      <td><b>{r.site.domain}</b><div style={{ fontSize: 11, color: "var(--cl-text-3)" }}>{r.site.client}</div></td>
                      <td className={`r psi-${PSM.psiScoreLevel(r.perfM)}`} style={{ fontWeight: 800 }}>{r.perfM}</td>
                      <td className="r">{r.deltaM > 0 ? "+" : ""}{r.deltaM}</td>
                      <td className={`r psi-${PSM.psiScoreLevel(r.perfD)}`} style={{ fontWeight: 700 }}>{r.perfD}</td>
                      <td className="r">{PSM.psiFmt("lcp", r.last.lcp)}</td>
                      <td className="r">{PSM.psiFmt("cls", r.last.cls)}</td>
                      <td className="r">{r.cwv == null ? "—" : r.cwv ? "trece" : "nu trece"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {alerts.length > 0 && (
                <div className="psi-mail-alert">
                  <b>{alerts.length} {alerts.length === 1 ? "site a scăzut" : "site-uri au scăzut"} peste pragul de alertă</b>
                  {alerts.map(a => <div key={a.site.id}>{a.site.domain}: {a.perfM} pe mobil ({a.deltaM} puncte vs S34) — {PSM.psiOpportunities(a.site, "mobile")[0].label.toLowerCase()}</div>)}
                </div>
              )}
              {sched.includeOpportunities && (
                <p className="cl-hint" style={{ marginTop: 14 }}>Raportul include primele 3 oportunități PageSpeed pentru fiecare site sub 90 puncte{sched.attachPdf ? " și PDF-ul complet atașat" : ""}.</p>
              )}
            </div>
            <div className="psi-mail-foot">Trimis automat de OTS CRM · sursa datelor: Google PageSpeed Insights API v5 (Lighthouse + CrUX) · dezabonare din Setări &gt; Rapoarte</div>
          </div>
        </div>
        <div className="psi-modal-foot">
          <button className="cl-btn-secondary" onClick={onClose}>Închide</button>
          <button className="cl-btn-primary" onClick={onSend}><Icon.Send w={13} h={13} /> Trimite acum</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PSIDrawer, PSISiteModal, PSIMailPreview, psiPsiLink });
