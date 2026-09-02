/* ===== OTS — Rank Tracker: drawer + modale ===== */
const RTM = window.RTData;
const { useState: rSt, useMemo: rMemo } = React;

function rtSerpLink(kw, locale) {
  const dom = (locale || "").startsWith("google.com") ? "google.com" : (locale || "").startsWith("google.de") ? "google.de" : "google.ro";
  return `https://www.${dom}/search?q=${encodeURIComponent(kw)}`;
}

/* ---------- drawer cuvânt cheie ---------- */
function RTKwDrawer({ kw, project, device, onClose, onRecheck, checking }) {
  const hd = rMemo(() => RTM.rtHistory(kw, "desktop"), [kw]);
  const hm = rMemo(() => RTM.rtHistory(kw, "mobile"), [kw]);
  const h = device === "mobile" ? hm : hd;
  const now = h[h.length - 1].pos;
  const best = RTM.rtBest(h);
  const g7 = RTM.rtGain(now, RTM.rtAgo(h, 7));
  const g30 = RTM.rtGain(now, RTM.rtAgo(h, 29));
  const comps = Object.entries(kw.comps || {});
  const maxVis = Math.max(RTM.rtCtr(now), ...comps.map(([, p]) => RTM.rtCtr(p)));
  const serp = rMemo(() => {
    const rows = comps.map(([d, p]) => ({ dom: d, pos: p })).concat(now != null ? [{ dom: project.domain, pos: now, self: true }] : []);
    return rows.filter(r => r.pos <= 10).sort((a, b) => a.pos - b.pos);
  }, [kw, now]);

  return (
    <div className="psi-drawer-back" onClick={onClose}>
      <div className="psi-drawer" onClick={e => e.stopPropagation()}>
        <div className="psi-drawer-head">
          <span className="psi-fav" style={{ width: 38, height: 38, borderRadius: 10, fontSize: 13, background: window.psiTileColor(project.id) }}>{window.psiInitials(project.domain)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 8 }}>
              {kw.kw}<span className="rt-tag">{kw.tag}</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--cl-text-3)", marginTop: 3 }}>
              {project.domain} · {project.locale} · {kw.loc} · {device === "mobile" ? "mobil" : "desktop"} · volum {kw.vol.toLocaleString("ro-RO")}/lună · dificultate {kw.kd}
            </div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-drawer-body">
          <div className="rt-kpi-mini">
            <div className="rt-mini"><span>Poziție azi</span><b>{now == null ? "100+" : "#" + now}</b><em>{now == null ? "peste pagina 10" : "pagina " + Math.ceil(now / 10) + " · " + RTM.RT_TODAY.short}</em></div>
            <div className="rt-mini"><span>7 zile</span><b><window.RTGain value={g7} /></b><em>vs {RTM.RT_DAYS[RTM.RT_DAYS.length - 8].short}</em></div>
            <div className="rt-mini"><span>30 zile</span><b><window.RTGain value={g30} /></b><em>vs {RTM.RT_DAYS[0].short}</em></div>
            <div className="rt-mini"><span>Cea mai bună</span><b>{best == null ? "—" : "#" + best}</b><em>în ultimele 30 de zile</em></div>
          </div>

          <div className="cl-section">
            <div className="cl-section-head">
              <h3><Icon.TrendingUp w={15} h={15} /> Istoric poziții · 30 de zile</h3>
              <p className="cl-section-sub" style={{ marginLeft: "auto" }}>o rulare pe zi, {RTM.RT_SCHEDULE_DEFAULT.hour}</p>
            </div>
            <window.RTRankChart days={RTM.RT_DAYS} height={240}
              series={[
                { label: "Desktop", color: "#1877F2", values: hd.map(x => x.pos) },
                { label: "Mobil", color: "#8b5cf6", values: hm.map(x => x.pos), thin: true },
              ]} />
          </div>

          {kw.altUrl && (
            <div className="rt-note">
              <Icon.AlertTriangle w={16} h={16} />
              <div>
                <div className="rt-note-t">Posibilă canibalizare</div>
                <div className="rt-note-s">Google a alternat între <code>{kw.url}</code> și <code>{kw.altUrl}</code> în ultimele 30 de zile. Consolidează conținutul sau pune un canonical către pagina principală.</div>
              </div>
            </div>
          )}

          <div className="psi-two">
            <div className="cl-section">
              <div className="cl-section-head"><h3><Icon.Layers w={15} h={15} /> SERP azi</h3>
                <a className="cl-btn-mini" style={{ marginLeft: "auto" }} href={rtSerpLink(kw.kw, project.locale)} target="_blank" rel="noreferrer"><Icon.ExternalLink w={11} h={11} /> Vezi în Google</a>
              </div>
              <div className="rt-serp">
                {kw.feats.includes("ads") && <div className="rt-serp-row feature"><span className="rt-serp-n">–</span><div><div className="rt-serp-t">Anunțuri Google Ads (top)</div><div className="rt-serp-u">3 rezultate plătite deasupra organicului</div></div></div>}
                {kw.ai && <div className="rt-serp-row feature"><span className="rt-serp-n">–</span><div><div className="rt-serp-t">AI Overview {kw.ai === "cited" ? "· ne citează" : "· fără link către noi"}</div><div className="rt-serp-u">{kw.ai === "cited" ? kw.url : "surse: " + comps.slice(0, 2).map(([d]) => d).join(", ")}</div></div></div>}
                {kw.feats.includes("local") && <div className="rt-serp-row feature"><span className="rt-serp-n">–</span><div><div className="rt-serp-t">Local pack (3 fișe)</div><div className="rt-serp-u">{kw.loc}</div></div></div>}
                {serp.map(r => (
                  <div key={r.dom} className={`rt-serp-row ${r.self ? "self" : ""}`}>
                    <span className="rt-serp-n">{r.pos}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="rt-serp-t">{r.self ? project.name : r.dom}</div>
                      <div className="rt-serp-u">{r.dom}{r.self ? kw.url : ""}</div>
                    </div>
                    {r.self && <span className="psi-tag info" style={{ marginLeft: "auto" }}>noi</span>}
                  </div>
                ))}
                {kw.feats.includes("paa") && <div className="rt-serp-row feature"><span className="rt-serp-n">–</span><div><div className="rt-serp-t">People also ask</div><div className="rt-serp-u">4 întrebări extinse</div></div></div>}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {kw.feats.map(f => RTM.RT_FEATURES[f] && <span key={f} className="rt-tag" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><em style={{ width: 8, height: 8, borderRadius: 2, background: RTM.RT_FEATURES[f].color, display: "inline-block" }} />{RTM.RT_FEATURES[f].label}</span>)}
              </div>
            </div>

            <div className="cl-section">
              <div className="cl-section-head"><h3><Icon.Users w={15} h={15} /> Competitori pe acest cuvânt</h3></div>
              <window.RTCompRow domain={project.domain} self pos={now} vis={+RTM.rtCtr(now).toFixed(1)} max={maxVis} />
              {comps.sort((a, b) => a[1] - b[1]).map(([d, p]) => <window.RTCompRow key={d} domain={d} pos={p} vis={+RTM.rtCtr(p).toFixed(1)} max={maxVis} />)}
            </div>
          </div>

          <div className="cl-section" style={{ padding: 0 }}>
            <div className="cl-section-head" style={{ padding: "16px 20px 12px", marginBottom: 0 }}>
              <h3><Icon.CalDays w={15} h={15} /> Rulări zilnice</h3>
              <p className="cl-section-sub" style={{ marginLeft: "auto" }}>ultimele 12 zile</p>
              <div className="cl-section-actions">
                <button className="cl-btn-mini" disabled={checking} onClick={() => onRecheck(kw.id)}><Icon.RefreshCw w={11} h={11} /> Verifică acum</button>
              </div>
            </div>
            <table className="cl-list-table">
              <thead><tr><th>Ziua</th><th className="num">Desktop</th><th className="num">Δ</th><th className="num">Mobil</th><th className="num">Δ</th><th>URL în SERP</th></tr></thead>
              <tbody>
                {hd.slice(-12).reverse().map((row, i) => {
                  const idx = hd.length - 1 - i;
                  const prevD = idx > 0 ? hd[idx - 1].pos : null;
                  const mrow = hm[idx], prevM = idx > 0 ? hm[idx - 1].pos : null;
                  return (
                    <tr key={row.day.id} style={{ cursor: "default" }}>
                      <td>{row.day.full}</td>
                      <td className="num"><window.RTPos pos={row.pos} sm /></td>
                      <td className="num"><window.RTGain value={RTM.rtGain(row.pos, prevD)} /></td>
                      <td className="num"><window.RTPos pos={mrow.pos} sm /></td>
                      <td className="num"><window.RTGain value={RTM.rtGain(mrow.pos, prevM)} /></td>
                      <td><span className="rt-url">{kw.altUrl && i % 4 === 1 ? kw.altUrl : kw.url}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- adăugare cuvinte cheie ---------- */
function RTAddKwModal({ projects, projectId, onClose, onSave }) {
  const [pj, setPj] = rSt(projectId || projects[0].id);
  const [text, setText] = rSt("");
  const [tag, setTag] = rSt(RTM.RT_TAGS[0]);
  const [loc, setLoc] = rSt("România");
  const [devices, setDevices] = rSt(["desktop", "mobile"]);
  const project = projects.find(p => p.id === pj) || projects[0];
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const uniq = Array.from(new Set(lines.map(l => l.toLowerCase())));

  return (
    <div className="psi-modal-back" onClick={onClose}>
      <div className="psi-modal" onClick={e => e.stopPropagation()}>
        <div className="psi-modal-head">
          <span className="psi-modal-ic"><Icon.Plus w={17} h={17} /></span>
          <div>
            <div className="psi-modal-title">Adaugă cuvinte cheie</div>
            <div className="psi-modal-sub">un cuvânt cheie pe linie · se verifică zilnic începând cu următoarea rulare</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-modal-body">
          <div className="rt-add-grid">
            <div className="cl-field"><label>Proiect</label>
              <select className="cl-select" style={{ width: "100%" }} value={pj} onChange={e => { setPj(e.target.value); setLoc((projects.find(p => p.id === e.target.value) || project).locations[0]); }}>
                {projects.map(p => <option key={p.id} value={p.id}>{p.domain}</option>)}
              </select>
            </div>
            <div className="cl-field"><label>Grup / tag</label>
              <select className="cl-select" style={{ width: "100%" }} value={tag} onChange={e => setTag(e.target.value)}>
                {RTM.RT_TAGS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="cl-field"><label>Locație</label>
              <select className="cl-select" style={{ width: "100%" }} value={loc} onChange={e => setLoc(e.target.value)}>
                {project.locations.map(l => <option key={l}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="cl-field" style={{ marginTop: 14 }}>
            <div className="cl-field-head"><label>Cuvinte cheie</label><span className="cl-hint">{project.locale} · maxim 500 pe proiect</span></div>
            <textarea className="rt-ta" placeholder={"serum vitamina c\ncreme pentru ten uscat\nmagazin cosmetice bucuresti"} value={text} onChange={e => setText(e.target.value)} />
            <div className="rt-count">
              <span><b>{lines.length}</b> linii</span>
              <span><b>{uniq.length}</b> unice</span>
              <span><b>{devices.length}</b> {devices.length === 1 ? "dispozitiv" : "dispozitive"} → <b>{uniq.length * devices.length}</b> verificări/zi</span>
            </div>
          </div>
          <div className="cl-field" style={{ marginTop: 14 }}>
            <label>Dispozitive urmărite</label>
            <div className="psi-seg multi" style={{ marginTop: 4 }}>
              {["desktop", "mobile"].map(d => (
                <button key={d} className={devices.includes(d) ? "active" : ""} onClick={() => { const n = devices.includes(d) ? devices.filter(x => x !== d) : [...devices, d]; if (n.length) setDevices(n); }}>
                  <span className="psi-seg-box"><Icon.Check w={10} h={10} /></span>
                  <window.PSIStratIcon strategy={d === "mobile" ? "mobile" : "desktop"} /> {d === "mobile" ? "Mobil" : "Desktop"}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="psi-modal-foot">
          <span className="cl-hint" style={{ marginRight: "auto" }}>prima poziție apare după rularea de mâine, {RTM.RT_SCHEDULE_DEFAULT.hour}</span>
          <button className="cl-btn-secondary" onClick={onClose}>Anulează</button>
          <button className="cl-btn-primary" disabled={!uniq.length} onClick={() => onSave({ pj, tag, loc, devices, list: uniq })}><Icon.Check w={13} h={13} /> Adaugă {uniq.length || ""} cuvinte</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- proiect ---------- */
function RTProjectModal({ project, clients, onClose, onSave, onDelete }) {
  const [f, setF] = rSt(project ? { ...project } : { id: "p" + Date.now(), domain: "", name: "", client: clients[0], locale: RTM.RT_LOCALES[0], locations: ["România"], competitors: [], active: true, alert: 5, added: RTM.RT_TODAY.short + " 2026" });
  const [locIn, setLocIn] = rSt("");
  const [compIn, setCompIn] = rSt("");
  const set = (k, v) => setF({ ...f, [k]: v });
  const valid = /.+\..+/.test(f.domain) && f.name.trim();

  return (
    <div className="psi-modal-back" onClick={onClose}>
      <div className="psi-modal" style={{ width: 660 }} onClick={e => e.stopPropagation()}>
        <div className="psi-modal-head">
          <span className="psi-modal-ic"><Icon.Globe w={17} h={17} /></span>
          <div>
            <div className="psi-modal-title">{project ? "Editează proiectul" : "Proiect nou"}</div>
            <div className="psi-modal-sub">domeniul, motorul de căutare și locațiile urmărite</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-modal-body">
          <div className="rt-add-grid">
            <div className="cl-field"><label>Domeniu</label><input className="cl-input" placeholder="exemplu.ro" value={f.domain} onChange={e => set("domain", e.target.value.trim())} /></div>
            <div className="cl-field"><label>Nume proiect</label><input className="cl-input" placeholder="Exemplu Shop" value={f.name} onChange={e => set("name", e.target.value)} /></div>
            <div className="cl-field"><label>Client</label>
              <select className="cl-select" style={{ width: "100%" }} value={f.client} onChange={e => set("client", e.target.value)}>{clients.map(c => <option key={c}>{c}</option>)}</select>
            </div>
            <div className="cl-field"><label>Motor · limbă</label>
              <select className="cl-select" style={{ width: "100%" }} value={f.locale} onChange={e => set("locale", e.target.value)}>{RTM.RT_LOCALES.map(l => <option key={l}>{l}</option>)}</select>
            </div>
            <div className="cl-field"><label>Prag alertă (poziții)</label><input className="cl-input" type="number" min="1" max="50" value={f.alert} onChange={e => set("alert", +e.target.value || 1)} /></div>
            <div className="cl-field"><label>Status</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <window.PSISwitch on={f.active} onChange={v => set("active", v)} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--cl-text-2)" }}>{f.active ? "verificare zilnică activă" : "în pauză"}</span>
              </div>
            </div>
          </div>

          <div className="cl-field" style={{ marginTop: 14 }}>
            <div className="cl-field-head"><label>Locații</label><span className="cl-hint">poziții separate pe fiecare locație</span></div>
            <div className="psi-chips">
              {f.locations.map(l => <span className="psi-chip" key={l}><Icon.MapPin w={11} h={11} /> {l}<button onClick={() => set("locations", f.locations.filter(x => x !== l))}><Icon.X w={11} h={11} /></button></span>)}
            </div>
            <div className="psi-chip-add">
              <input className="cl-input" placeholder="oraș sau țară" value={locIn} onChange={e => setLocIn(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && locIn.trim()) { set("locations", [...f.locations, locIn.trim()]); setLocIn(""); } }} />
              <button className="cl-btn-secondary" disabled={!locIn.trim()} onClick={() => { set("locations", [...f.locations, locIn.trim()]); setLocIn(""); }}><Icon.Plus w={12} h={12} /> Adaugă</button>
            </div>
          </div>

          <div className="cl-field" style={{ marginTop: 14 }}>
            <div className="cl-field-head"><label>Competitori urmăriți</label><span className="cl-hint">maxim 5 domenii</span></div>
            <div className="psi-chips">
              {(f.competitors || []).map(c => <span className="psi-chip" key={c}>{c}<button onClick={() => set("competitors", f.competitors.filter(x => x !== c))}><Icon.X w={11} h={11} /></button></span>)}
              {!(f.competitors || []).length && <span className="cl-hint">niciun competitor — comparația nu apare în raport</span>}
            </div>
            <div className="psi-chip-add">
              <input className="cl-input" placeholder="competitor.ro" value={compIn} onChange={e => setCompIn(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && /.+\..+/.test(compIn)) { set("competitors", [...(f.competitors || []), compIn.trim()]); setCompIn(""); } }} />
              <button className="cl-btn-secondary" disabled={!/.+\..+/.test(compIn) || (f.competitors || []).length >= 5} onClick={() => { set("competitors", [...(f.competitors || []), compIn.trim()]); setCompIn(""); }}><Icon.Plus w={12} h={12} /> Adaugă</button>
            </div>
          </div>
        </div>
        <div className="psi-modal-foot">
          {project && <button className="cl-btn-secondary" style={{ marginRight: "auto", color: "var(--cl-danger)" }} onClick={() => onDelete(project.id)}><Icon.Trash w={13} h={13} /> Șterge proiectul</button>}
          <button className="cl-btn-secondary" onClick={onClose}>Anulează</button>
          <button className="cl-btn-primary" disabled={!valid} onClick={() => onSave(f)}><Icon.Check w={13} h={13} /> Salvează</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- programare + alerte ---------- */
function RTScheduleModal({ sched, onChange, onClose, onSave }) {
  const [recip, setRecip] = rSt("");
  const s = sched;
  return (
    <div className="psi-modal-back" onClick={onClose}>
      <div className="psi-modal" style={{ width: 640 }} onClick={e => e.stopPropagation()}>
        <div className="psi-modal-head">
          <span className="psi-modal-ic"><Icon.Clock w={17} h={17} /></span>
          <div>
            <div className="psi-modal-title">Rulare zilnică și alerte</div>
            <div className="psi-modal-sub">verificarea pozițiilor, pragul de alertă și livrarea rapoartelor</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-modal-body">
          <div className="psi-next">
            <span className="psi-next-ic"><Icon.RefreshCw w={18} h={18} /></span>
            <div>
              <div className="psi-next-l1">Zilnic, {s.hour} · {s.tz}</div>
              <div className="psi-next-l2">{s.devices.length === 2 ? "desktop + mobil" : s.devices[0] === "mobile" ? "doar mobil" : "doar desktop"} · următoarea rulare mâine</div>
            </div>
            <span className="psi-tag ok" style={{ marginLeft: "auto" }}>activ</span>
          </div>
          <div className="psi-sched-grid">
            <div className="cl-field"><label>Ora rulării</label>
              <select className="cl-select" style={{ width: "100%" }} value={s.hour} onChange={e => onChange({ ...s, hour: e.target.value })}>
                {["04:00", "05:00", "06:00", "07:00", "09:00", "12:00", "18:00"].map(h => <option key={h}>{h}</option>)}
              </select>
            </div>
            <div className="cl-field"><label>Prag alertă (poziții)</label>
              <input className="cl-input" type="number" min="1" max="50" value={s.threshold} onChange={e => onChange({ ...s, threshold: +e.target.value || 1 })} />
            </div>
            <div className="cl-field" style={{ gridColumn: "span 2" }}><label>Dispozitive</label>
              <div className="psi-seg multi" style={{ marginTop: 2 }}>
                {["desktop", "mobile"].map(d => (
                  <button key={d} className={s.devices.includes(d) ? "active" : ""} onClick={() => { const n = s.devices.includes(d) ? s.devices.filter(x => x !== d) : [...s.devices, d]; if (n.length) onChange({ ...s, devices: n }); }}>
                    <span className="psi-seg-box"><Icon.Check w={10} h={10} /></span>
                    <window.PSIStratIcon strategy={d === "mobile" ? "mobile" : "desktop"} /> {d === "mobile" ? "Mobil" : "Desktop"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="cl-field" style={{ marginTop: 14 }}>
            <div className="cl-field-head"><label>Destinatari</label><span className="cl-hint">primesc alertele și raportul săptămânal</span></div>
            <div className="psi-chips">
              {s.recipients.map(r => <span className="psi-chip" key={r}>{r}<button onClick={() => onChange({ ...s, recipients: s.recipients.filter(x => x !== r) })}><Icon.X w={11} h={11} /></button></span>)}
            </div>
            <div className="psi-chip-add">
              <input className="cl-input" placeholder="email@client.ro" value={recip} onChange={e => setRecip(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && /.+@.+\..+/.test(recip)) { onChange({ ...s, recipients: [...s.recipients, recip.trim()] }); setRecip(""); } }} />
              <button className="cl-btn-secondary" disabled={!/.+@.+\..+/.test(recip)} onClick={() => { onChange({ ...s, recipients: [...s.recipients, recip.trim()] }); setRecip(""); }}><Icon.Plus w={12} h={12} /> Adaugă</button>
            </div>
          </div>
          <div className="psi-toggles">
            {[
              ["alertOnDrop", "Alertă la scădere bruscă", `email imediat dacă un cuvânt pierde ≥ ${s.threshold} poziții`],
              ["topAlert", "Alertă la ieșirea din top 10", "pentru cuvintele care erau în primele 10 rezultate"],
              ["trackAi", "Urmărește AI Overview", "salvează dacă apare și dacă suntem citați ca sursă"],
              ["weeklyMail", "Raport săptămânal pe email", "luni dimineață, cu evoluția pozițiilor și top mișcări"],
              ["attachPdf", "Atașează PDF-ul raportului", "un fișier per proiect, arhivat în fișa clientului"],
              ["sendToClient", "Trimite și clientului", "folosește emailul de contact din fișa clientului"],
            ].map(([k, t, sub]) => (
              <div className="psi-toggle-row" key={k}>
                <div><div className="psi-toggle-txt">{t}</div><div className="psi-toggle-sub">{sub}</div></div>
                <window.PSISwitch on={s[k]} onChange={v => onChange({ ...s, [k]: v })} />
              </div>
            ))}
          </div>
        </div>
        <div className="psi-modal-foot">
          <button className="cl-btn-secondary" onClick={() => onChange({ ...RTM.RT_SCHEDULE_DEFAULT })}>Resetează</button>
          <button className="cl-btn-primary" onClick={onSave}><Icon.Check w={13} h={13} /> Salvează</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- raport client ---------- */
function RTReportPreview({ project, rows, sched, onClose, onSend }) {
  const positions = rows.map(r => r.pos);
  const vis = RTM.rtVisibility(positions);
  const b = RTM.rtBuckets(positions);
  const movers = [...rows].sort((a, b2) => (b2.g7 || 0) - (a.g7 || 0));
  const up = movers.filter(r => (r.g7 || 0) > 0).slice(0, 5);
  const down = movers.reverse().filter(r => (r.g7 || 0) < 0).slice(0, 5);
  const avg = positions.filter(p => p != null).length ? +(positions.filter(p => p != null).reduce((a, p) => a + p, 0) / positions.filter(p => p != null).length).toFixed(1) : "—";
  return (
    <div className="psi-modal-back" onClick={onClose}>
      <div className="psi-modal lg" onClick={e => e.stopPropagation()}>
        <div className="psi-modal-head">
          <span className="psi-modal-ic"><Icon.Mail w={17} h={17} /></span>
          <div>
            <div className="psi-modal-title">Raport poziții — {project ? project.domain : "toate proiectele"}</div>
            <div className="psi-modal-sub">săptămâna 26 aug. – 1 sep. 2026 · {sched.recipients.length} destinatari</div>
          </div>
          <button className="psi-drawer-close" onClick={onClose}><Icon.X w={15} h={15} /></button>
        </div>
        <div className="psi-modal-body">
          <div className="psi-mail">
            <div className="psi-mail-head">
              <h4>Poziții Google organic · {project ? project.domain : "portofoliu OTS"}</h4>
              <p>26 aug. – 1 sep. 2026 · {rows.length} cuvinte cheie · verificare zilnică {sched.hour}</p>
            </div>
            <div className="psi-mail-kpis">
              <div className="psi-mail-kpi"><span>Vizibilitate</span><b>{vis}%</b></div>
              <div className="psi-mail-kpi"><span>Poziție medie</span><b>{avg}</b></div>
              <div className="psi-mail-kpi"><span>În top 3</span><b>{b.t3}</b></div>
              <div className="psi-mail-kpi"><span>În top 10</span><b>{b.t3 + b.t10}</b></div>
            </div>
            <div className="psi-mail-body">
              <div style={{ marginBottom: 16 }}><window.RTDist buckets={b} total={rows.length} /></div>
              <table className="psi-mail-table">
                <thead><tr><th>Au urcat în ultimele 7 zile</th><th className="r">Acum</th><th className="r">Câștig</th></tr></thead>
                <tbody>
                  {up.map(r => <tr key={r.kw.id}><td>{r.kw.kw}</td><td className="r">{r.pos == null ? "100+" : "#" + r.pos}</td><td className="r" style={{ color: "#047857", fontWeight: 700 }}>+{r.g7}</td></tr>)}
                  {!up.length && <tr><td colSpan={3} style={{ color: "var(--cl-text-3)" }}>nicio urcare în această săptămână</td></tr>}
                </tbody>
              </table>
              {down.length > 0 && (
                <div className="psi-mail-alert" style={{ marginTop: 18 }}>
                  <b>Au scăzut ({down.length})</b>
                  {down.map(r => <div key={r.kw.id}>{r.kw.kw} — {r.pos == null ? "ieșit din top 100" : "poziția " + r.pos} ({r.g7})</div>)}
                </div>
              )}
            </div>
            <div className="psi-mail-foot">Generat automat de OTS Rank Tracker · date SERP {RTM.RT_TODAY.full}, {sched.hour}</div>
          </div>
        </div>
        <div className="psi-modal-foot">
          <button className="cl-btn-secondary" style={{ marginRight: "auto" }} onClick={onSend}><Icon.Download w={13} h={13} /> Descarcă PDF</button>
          <button className="cl-btn-secondary" onClick={onClose}>Închide</button>
          <button className="cl-btn-primary" onClick={onSend}><Icon.Send w={13} h={13} /> Trimite raportul</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { RTKwDrawer, RTAddKwModal, RTProjectModal, RTScheduleModal, RTReportPreview, rtSerpLink });
