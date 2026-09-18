import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// Photocopier paper register. Kept apart from the general inventory because
// paper is held in two quantities at once -- full cartons and loose reams --
// and the day-end sheet is the same Opening / In / Issue / Closing register
// that used to be kept by hand.

const API = '/api/paper';
const SIZES = ['A4', 'A3', 'A5', 'FS', 'LEGAL', 'LETTER'];
const REPORT_PER_PAGE = 22;   // rows per WhatsApp image

// The papers on the printed register, in its order -- offered once, when the
// list is still empty, so nobody has to type sixteen rows.
const REGISTER_PAPERS = [
  ['JK RED', 'A4', 75], ['JK EASY', 'A4', 70], ['ORIENT', 'A4', 65], ['ORIENT', 'A4', 70],
  ['ORIENT', 'A4', 75], ['ORIENT', 'A3', 70], ['ORIENT', 'A5', 70], ['JK EASY', 'FS', 0],
  ['JK RED', 'A3', 0], ['MAPLE', 'A4', 0], ['MAPLE', 'A3', 0], ['ELENZA', 'A3', 0],
  ['PINK', 'A4', 0], ['YELLOW', 'A4', 0], ['GREEN', 'A4', 0], ['BLUE', 'A4', 0],
].map(([brand, size, gsm]) => ({ brand, size, gsm, reams_per_carton: 10 }));

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const parseYmd = (s) => { const [y, m, d] = s.split('-'); return new Date(+y, +m - 1, +d); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prettyDay = (s) => parseYmd(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const shiftYmd = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };

const n = (v) => +(+v || 0).toFixed(3);
const blankZero = (v) => (n(v) ? n(v) : '');
const cr = (c, r) => {
  const parts = [];
  if (n(c)) parts.push(`${n(c)} C`);
  if (n(r)) parts.push(`${n(r)} R`);
  return parts.join(' + ') || '0';
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Register columns: all carton figures together, then all loose-ream figures.
// Movement columns (In / Issue) are left blank at zero, as on the paper sheet.
const STAGES = [
  { key: 'open', label: 'Opening', cls: '', color: '#334155', blank: false },
  { key: 'in', label: 'In', cls: 'c-in', color: '#15803d', blank: true },
  { key: 'out', label: 'Issue', cls: 'c-out', color: '#c2410c', blank: true },
  { key: 'close', label: 'Closing', cls: 'c-close', color: '#4338ca', blank: false },
];
const UNITS_ = [{ suffix: '_c', label: 'Cartons', grp: 'g-ctn' }, { suffix: '_r', label: 'Loose Reams', grp: 'g-ream' }];
const REG_COLS = UNITS_.flatMap(u => STAGES.map(st => ({ ...st, field: st.key + u.suffix, unit: u })));
const regVal = (r, col) => (col.blank ? blankZero(r[col.field]) : n(r[col.field]));

const TYPE_LABEL = { OPENING: 'Opening', IN: 'In', OUT: 'Issue', OPEN_CARTON: 'Carton opened' };
const TYPE_SKIN = {
  OPENING: { bg: '#fef3c7', fg: '#92400e' },
  IN: { bg: '#dcfce7', fg: '#166534' },
  OUT: { bg: '#ffedd5', fg: '#c2410c' },
  OPEN_CARTON: { bg: '#f1f5f9', fg: '#475569' },
};

const PaperStock = ({ token, notify, currentUser, isAdmin, onUnauthorized }) => {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem('paper_tab') || 'stock'; } catch { return 'stock'; }
  });
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Held in a ref so a new callback from the parent on every render does not
  // rebuild `call` and re-trigger every load effect below.
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const call = useCallback(async (path, opts = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: token, ...(opts.headers || {}) },
    });
    if (res.status === 401) { unauthorized.current(); return { ok: false, data: {} }; }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }, [token]);

  const loadItems = useCallback(async () => {
    const { ok, data } = await call('/items');
    if (ok) setItems(Array.isArray(data) ? data : []);
    setLoaded(true);
  }, [call]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { try { localStorage.setItem('paper_tab', tab); } catch { /* private mode */ } }, [tab]);

  const active = items.filter(i => i.active);
  const totals = active.reduce((s, i) => ({ c: s.c + n(i.cartons), r: s.r + n(i.reams) }), { c: 0, r: 0 });

  return (
    <>
      <div className="stat-row">
        <div className="stat">
          <div className="stat-ic i-indigo">📄</div>
          <div><div className="stat-num">{active.length}</div><div className="stat-lbl">Paper Types</div></div>
        </div>
        <div className="stat">
          <div className="stat-ic i-green">📦</div>
          <div><div className="stat-num">{n(totals.c).toLocaleString()}</div><div className="stat-lbl">Cartons in stock</div></div>
        </div>
        <div className="stat">
          <div className="stat-ic i-amber">🗂️</div>
          <div><div className="stat-num">{n(totals.r).toLocaleString()}</div><div className="stat-lbl">Loose reams</div></div>
        </div>
      </div>

      <div className="mode-tabs paper-tabs">
        {[['stock', '📋 Stock'], ['in', '📥 Inward'], ['out', '📤 Sale / Issue'], ['report', '📅 Daily Report']].map(([k, label]) => (
          <button key={k} className={`mode-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'stock' && (
        <StockTab items={items} loaded={loaded} call={call} notify={notify} isAdmin={isAdmin}
          reload={loadItems} currentUser={currentUser} />
      )}
      {(tab === 'in' || tab === 'out') && (
        <EntryTab key={tab} kind={tab} items={active} call={call} notify={notify} isAdmin={isAdmin}
          currentUser={currentUser} reload={loadItems} />
      )}
      {tab === 'report' && <ReportTab call={call} notify={notify} currentUser={currentUser} />}
    </>
  );
};

// ---- Stock ------------------------------------------------------------------
const StockTab = ({ items, loaded, call, notify, isAdmin, reload, currentUser }) => {
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ brand: '', size: 'A4', gsm: '', reams_per_carton: '10' });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);   // {id, brand, size, gsm, reams_per_carton, active}
  const [showInactive, setShowInactive] = useState(false);

  const q = search.trim().toLowerCase();
  const rows = items.filter(i => (showInactive || i.active) && (!q || i.label.toLowerCase().includes(q)));

  const addPaper = async (e) => {
    e.preventDefault();
    if (!form.brand.trim()) { notify('Enter the brand', 'error'); return; }
    setBusy(true);
    const { ok, data } = await call('/items', { method: 'POST', body: JSON.stringify(form) });
    setBusy(false);
    if (!ok) { notify(data.error || 'Could not add the paper', 'error'); return; }
    setForm({ ...form, brand: '', gsm: '' });
    await reload();
    notify('Paper added. Enter its opening stock from the Inward tab.', 'success');
  };

  const addRegister = async () => {
    setBusy(true);
    const { ok, data } = await call('/items', { method: 'POST', body: JSON.stringify({ items: REGISTER_PAPERS }) });
    setBusy(false);
    if (!ok) { notify(data.error || 'Could not add the papers', 'error'); return; }
    await reload();
    notify(`${data.created} papers added. Now enter opening stock from the Inward tab.`, 'success');
  };

  const saveEdit = async () => {
    setBusy(true);
    const { ok, data } = await call(`/items/${editing.id}`, { method: 'PUT', body: JSON.stringify(editing) });
    setBusy(false);
    if (!ok) { notify(data.error || 'Could not save', 'error'); return; }
    setEditing(null);
    await reload();
    notify('Paper updated.', 'success');
  };

  const printStock = () => {
    const list = items.filter(i => i.active);
    const t = list.reduce((s, i) => ({ c: s.c + n(i.cartons), r: s.r + n(i.reams) }), { c: 0, r: 0 });
    const now = new Date();
    openPrint(`Paper Stock — ${prettyDay(istToday())}`, `
      <div class="meta"><span>Date: ${prettyDay(istToday())} &nbsp; Time: ${now.toLocaleTimeString()}</span><span>Printed by: ${esc(currentUser)}</span></div>
      <table>
        <thead><tr><th>Sl.</th><th>Brand / Paper</th><th class="num">Reams / Carton</th><th class="num">Cartons</th><th class="num">Loose Reams</th></tr></thead>
        <tbody>${list.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.label)}</td><td class="num">${i.reams_per_carton || '-'}</td>
          <td class="num">${n(i.cartons)}</td><td class="num">${n(i.reams)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3">Total: ${list.length} papers</td><td class="num">${n(t.c)}</td><td class="num">${n(t.r)}</td></tr></tfoot>
      </table>`);
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <input className="input" style={{ marginBottom: 0, flex: '1 1 200px' }} placeholder="🔍 Search brand, size or GSM"
          value={search} onChange={e => setSearch(e.target.value)} />
        <button className="btn btn-blue" onClick={() => setShowAdd(!showAdd)}>{showAdd ? 'Close' : '➕ Add Paper'}</button>
        <button className="btn btn-light" onClick={printStock}>🖨 Print</button>
      </div>

      {showAdd && (
        <form onSubmit={addPaper} style={{ padding: '16px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
          <div className="paper-add-row">
            <div>
              <label className="field-label">Brand *</label>
              <input className="input" style={{ marginBottom: 0 }} placeholder="e.g. JK Easy" autoFocus
                value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Size *</label>
              <input className="input" style={{ marginBottom: 0 }} list="paper-sizes" value={form.size}
                onChange={e => setForm({ ...form, size: e.target.value })} />
              <datalist id="paper-sizes">{SIZES.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="field-label">GSM</label>
              <input className="input" style={{ marginBottom: 0 }} type="number" min="0" placeholder="optional"
                value={form.gsm} onChange={e => setForm({ ...form, gsm: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Reams / Carton</label>
              <input className="input" style={{ marginBottom: 0 }} type="number" min="0"
                value={form.reams_per_carton} onChange={e => setForm({ ...form, reams_per_carton: e.target.value })} />
            </div>
            <button className="btn btn-green" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
            Reams per carton lets an issue of loose reams open a full carton automatically when the loose reams run out.
          </div>
        </form>
      )}

      {loaded && items.length === 0 && (
        <div style={{ margin: 20, padding: 20, textAlign: 'center', borderRadius: 10, border: '1.5px dashed #cbd5e1', background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>No papers yet</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 12 }}>
            Start with the 16 papers from your printed register (JK Red A4 75 GSM … Blue A4), or add them one at a time.
          </div>
          <button className="btn btn-blue" disabled={busy} onClick={addRegister}>
            {busy ? 'Adding…' : '➕ Add the 16 register papers'}
          </button>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="paper-table">
            <thead><tr>
              <th>Sl.</th><th>Brand / Paper</th><th className="num">Reams/Ctn</th>
              <th className="num">Cartons</th><th className="num">Loose Reams</th>
              {isAdmin && <th></th>}
            </tr></thead>
            <tbody>
              {rows.map((i, k) => editing && editing.id === i.id ? (
                <tr key={i.id}>
                  <td>{k + 1}</td>
                  <td colSpan={2}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <input className="input" style={{ marginBottom: 0, width: 130, padding: '5px 8px' }} value={editing.brand}
                        onChange={e => setEditing({ ...editing, brand: e.target.value })} />
                      <input className="input" style={{ marginBottom: 0, width: 70, padding: '5px 8px' }} list="paper-sizes" value={editing.size}
                        onChange={e => setEditing({ ...editing, size: e.target.value })} />
                      <input className="input" style={{ marginBottom: 0, width: 70, padding: '5px 8px' }} type="number" placeholder="GSM" value={editing.gsm || ''}
                        onChange={e => setEditing({ ...editing, gsm: e.target.value })} />
                      <input className="input" style={{ marginBottom: 0, width: 70, padding: '5px 8px' }} type="number" title="Reams per carton" value={editing.reams_per_carton}
                        onChange={e => setEditing({ ...editing, reams_per_carton: e.target.value })} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                        <input type="checkbox" checked={editing.active} onChange={e => setEditing({ ...editing, active: e.target.checked })} /> In use
                      </label>
                    </div>
                  </td>
                  <td className="num">{n(i.cartons)}</td>
                  <td className="num">{n(i.reams)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn btn-green btn-sm" disabled={busy} onClick={saveEdit}>Save</button>{' '}
                    <button className="btn btn-light btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </tr>
              ) : (
                <tr key={i.id} style={i.active ? undefined : { opacity: .5 }}>
                  <td style={{ color: 'var(--text-3)' }}>{k + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text)' }}>{i.label}{!i.active && ' (not in use)'}</td>
                  <td className="num" style={{ color: 'var(--text-3)' }}>{i.reams_per_carton || '-'}</td>
                  <td className="num"><span className="badge">{n(i.cartons)}</span></td>
                  <td className="num" style={{ fontWeight: 700 }}>{n(i.reams)}</td>
                  {isAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-light btn-sm" title="Edit" onClick={() => setEditing({
                        id: i.id, brand: i.brand, size: i.size, gsm: i.gsm, reams_per_carton: i.reams_per_carton, active: i.active,
                      })}>&#9998;</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && items.some(i => !i.active) && (
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--text-3)', padding: '10px 20px' }}>
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show papers no longer in use
        </label>
      )}
    </div>
  );
};

// ---- Inward / Sale-Issue entry ----------------------------------------------
// Laid out like the paper register: every paper is a row, type cartons and
// reams against the ones that moved, save once.
const EntryTab = ({ kind, items, call, notify, isAdmin, currentUser, reload }) => {
  const isOut = kind === 'out';
  const [opening, setOpening] = useState(false);
  const [date, setDate] = useState(istToday());
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qty, setQty] = useState({});          // item_id -> {c, r}
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState([]);
  const [voiding, setVoiding] = useState(null); // {id, reason}
  // Sales happen one at a time through the day, so issues default to a
  // one-paper form; a delivery challan is easier on the full grid.
  const [mode, setMode] = useState(isOut ? 'quick' : 'grid');
  const [qItem, setQItem] = useState('');
  const [qC, setQC] = useState('');
  const [qR, setQR] = useState('');
  const paperSelect = useRef(null);

  const loadEntries = useCallback(async () => {
    const { ok, data } = await call(`/movements?date=${date}`);
    if (ok) setEntries(Array.isArray(data) ? data : []);
  }, [call, date]);
  useEffect(() => { loadEntries(); }, [loadEntries]);

  const setQ = (id, field, v) => setQty(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: v } }));
  const gridLines = Object.entries(qty)
    .map(([id, v]) => ({ item_id: +id, cartons: n(v.c), reams: n(v.r) }))
    .filter(l => l.cartons || l.reams);
  const lineTotal = gridLines.reduce((s, l) => ({ c: s.c + l.cartons, r: s.r + l.reams }), { c: 0, r: 0 });

  const needsOpen = (i, v = qty[i.id] || {}) => {
    const r = n(v.r), c = n(v.c);
    const open = r > n(i.reams) && i.reams_per_carton ? Math.ceil((r - n(i.reams)) / i.reams_per_carton) : 0;
    const short = c + open > n(i.cartons) || (r > n(i.reams) && !i.reams_per_carton);
    return { open, short };
  };

  const quickPaper = items.find(i => String(i.id) === qItem);
  const quickLines = quickPaper && (n(qC) || n(qR)) ? [{ item_id: quickPaper.id, cartons: n(qC), reams: n(qR) }] : [];
  const quickChk = isOut && quickPaper ? needsOpen(quickPaper, { c: qC, r: qR }) : { open: 0, short: false };
  const quick = mode === 'quick';

  const save = async () => {
    const lines = quick ? quickLines : gridLines;
    if (quick && !quickPaper) { notify('Choose the paper.', 'error'); return; }
    if (!lines.length) { notify(quick ? 'Type the cartons or reams.' : 'Type a carton or ream figure against at least one paper.', 'error'); return; }
    if (isOut && lines.some(l => needsOpen(items.find(i => i.id === l.item_id) || {}, quick ? { c: qC, r: qR } : undefined).short)) {
      notify(quick ? 'Not enough stock of this paper.' : 'Some papers do not have that much stock. Check the rows marked in red.', 'error'); return;
    }
    setBusy(true);
    const kindCode = isOut ? 'OUT' : opening ? 'OPENING' : 'IN';
    const { ok, data } = await call('/movements', {
      method: 'POST',
      body: JSON.stringify({ kind: kindCode, entry_date: date, party, reference, remarks, lines }),
    });
    setBusy(false);
    if (!ok) { notify(data.error || 'Could not save', 'error'); return; }
    const soldLabel = quick ? `${quickPaper.label}: ${cr(qC, qR)}` : null;
    setQty({}); setParty(''); setReference(''); setRemarks('');
    setQItem(''); setQC(''); setQR('');
    await reload(); await loadEntries();
    if (quick) paperSelect.current?.focus();
    notify(`${soldLabel || `${data.saved} paper(s)`} saved${date !== istToday() ? ` on ${prettyDay(date)}` : ''}.`
      + (data.opened?.length ? `\nOpened ${data.opened.join(', ')}.` : ''), 'success');
  };

  const confirmVoid = async () => {
    setBusy(true);
    const { ok, data } = await call(`/movements/${voiding.id}/void`, { method: 'POST', body: JSON.stringify({ reason: voiding.reason }) });
    setBusy(false);
    if (!ok) { notify(data.error || 'Could not void', 'error'); return; }
    setVoiding(null);
    await reload(); await loadEntries();
    notify('Entry voided and stock put back.', 'success');
  };

  const q = search.trim().toLowerCase();
  const shown = items.filter(i => !q || i.label.toLowerCase().includes(q));
  const types = isOut ? ['OUT', 'OPEN_CARTON'] : ['IN', 'OPENING'];
  const dayEntries = entries.filter(e => types.includes(e.movement_type));
  const today = date === istToday();

  return (
    <>
      <div className="card paper-entry-card" style={{ border: `2px solid ${isOut ? '#ea580c' : '#16a34a'}` }}>
        <div className="card-title" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>{isOut ? '📤 Sale / Issue' : opening ? '📥 Opening Stock' : '📥 Stock Received'}</span>
          {isOut && (
            <div className="mode-tabs" style={{ marginBottom: 0 }}>
              <button className={`mode-tab ${quick ? 'active' : ''}`} onClick={() => setMode('quick')}>One sale</button>
              <button className={`mode-tab ${!quick ? 'active' : ''}`} onClick={() => setMode('grid')}>Many papers</button>
            </div>
          )}
          {!isOut && (
            <div className="mode-tabs" style={{ marginBottom: 0 }}>
              <button className={`mode-tab ${!opening ? 'active' : ''}`} onClick={() => setOpening(false)}>Received</button>
              <button className={`mode-tab ${opening ? 'active' : ''}`} onClick={() => setOpening(true)}>Opening stock</button>
            </div>
          )}
        </div>

        {opening && !isOut && (
          <div className="paper-note amber">
            Enter what was on the shelf when you start using this page — once per paper. Later arrivals go under “Received”.
          </div>
        )}
        {!today && (
          <div className="paper-note amber">Recording against {prettyDay(date)}, not today.</div>
        )}

        {quick && items.length > 0 && (
          <form className="paper-quick" onSubmit={e => { e.preventDefault(); save(); }}>
            <div className="pq-paper">
              <label className="field-label">Paper *</label>
              <select ref={paperSelect} className="input" style={{ marginBottom: 0 }} value={qItem} onChange={e => setQItem(e.target.value)}>
                <option value="">Choose paper…</option>
                {items.map(i => <option key={i.id} value={i.id}>{i.label}  ({cr(i.cartons, i.reams)})</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Carton</label>
              <input className="input" style={{ marginBottom: 0 }} type="number" inputMode="numeric" min="0" step="any" placeholder="0"
                value={qC} onChange={e => setQC(e.target.value)} />
            </div>
            <div>
              <label className="field-label">Ream</label>
              <input className="input" style={{ marginBottom: 0 }} type="number" inputMode="numeric" min="0" step="any" placeholder="0"
                value={qR} onChange={e => setQR(e.target.value)} />
            </div>
            <button className="btn btn-orange pq-save" type="submit" disabled={busy || !quickLines.length || quickChk.short}>
              {busy ? 'Saving…' : '💾 Save sale'}
            </button>
            {quickPaper && (
              <div className="pq-info">
                In stock: <strong>{cr(quickPaper.cartons, quickPaper.reams)}</strong>
                {quickChk.short && <span style={{ color: 'var(--red)' }}> — not enough stock</span>}
                {!quickChk.short && quickChk.open > 0 && <span style={{ color: '#b45309' }}> — opens {quickChk.open} carton{quickChk.open > 1 ? 's' : ''}</span>}
              </div>
            )}
          </form>
        )}

        <div className="paper-head-row">
          <div>
            <label className="field-label">Date</label>
            <input className="input" style={{ marginBottom: 0 }} type="date" value={date} max={istToday()}
              onChange={e => setDate(e.target.value || istToday())} />
          </div>
          <div>
            <label className="field-label">{isOut ? 'Customer / Issued to' : 'Supplier'}</label>
            <input className="input" style={{ marginBottom: 0 }} placeholder="Optional" value={party} onChange={e => setParty(e.target.value)} />
          </div>
          <div>
            <label className="field-label">{isOut ? 'Bill / Slip No.' : 'Bill / Challan No.'}</label>
            <input className="input" style={{ marginBottom: 0 }} placeholder="Optional" value={reference} onChange={e => setReference(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Remarks</label>
            <input className="input" style={{ marginBottom: 0 }} placeholder="Optional" value={remarks} onChange={e => setRemarks(e.target.value)} />
          </div>
        </div>

        {items.length === 0 ? (
          <div className="paper-empty">Add your papers in the Stock tab first.</div>
        ) : quick ? null : (
          <>
            {items.length > 8 && (
              <input className="input" style={{ marginTop: 14, marginBottom: 0 }} placeholder="🔍 Filter papers"
                value={search} onChange={e => setSearch(e.target.value)} />
            )}
            <div className="table-wrap" style={{ marginTop: 14 }}>
              <table className="paper-table">
                <thead><tr>
                  <th>Brand / Paper</th>
                  <th className="num">Stock</th>
                  <th className="num">Carton</th>
                  <th className="num">Ream</th>
                </tr></thead>
                <tbody>
                  {shown.map(i => {
                    const v = qty[i.id] || {};
                    const chk = isOut ? needsOpen(i) : { open: 0, short: false };
                    const hasQty = n(v.c) || n(v.r);
                    return (
                      <tr key={i.id} className={hasQty ? (chk.short ? 'row-short' : 'row-filled') : ''}>
                        <td style={{ fontWeight: 600, color: 'var(--text)' }}>
                          {i.label}
                          {chk.short && <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>Not enough stock</div>}
                          {!chk.short && chk.open > 0 && (
                            <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700 }}>
                              Opens {chk.open} carton{chk.open > 1 ? 's' : ''}
                            </div>
                          )}
                        </td>
                        <td className="num" style={{ color: 'var(--text-3)', whiteSpace: 'nowrap', fontSize: 13 }}>{cr(i.cartons, i.reams)}</td>
                        <td className="num">
                          <input className="input qty-in" type="number" inputMode="numeric" min="0" step="any" placeholder="—"
                            value={v.c ?? ''} onChange={e => setQ(i.id, 'c', e.target.value)} />
                        </td>
                        <td className="num">
                          <input className="input qty-in" type="number" inputMode="numeric" min="0" step="any" placeholder="—"
                            value={v.r ?? ''} onChange={e => setQ(i.id, 'r', e.target.value)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className={`btn ${isOut ? 'btn-orange' : 'btn-green'}`} disabled={busy || !gridLines.length} onClick={save}>
                {busy ? 'Saving…' : `💾 Save ${gridLines.length ? `${gridLines.length} paper${gridLines.length > 1 ? 's' : ''}` : ''}`}
              </button>
              {gridLines.length > 0 && (
                <>
                  <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>Total {cr(lineTotal.c, lineTotal.r)}</span>
                  <button className="btn btn-light btn-sm" onClick={() => setQty({})}>Clear</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {isOut ? 'Issued' : 'Received'} on {prettyDay(date)}
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>({dayEntries.filter(e => !e.voided && !e.parent_id).length})</span>
        </div>
        {dayEntries.length === 0 ? (
          <div className="paper-empty">Nothing recorded yet.</div>
        ) : (
          <div className="table-wrap">
            <table className="paper-table">
              <thead><tr><th>Paper</th><th>Type</th><th className="num">Qty</th><th>{isOut ? 'Issued to' : 'Supplier'}</th><th>Ref / Remarks</th><th>By</th><th></th></tr></thead>
              <tbody>
                {dayEntries.map(e => {
                  const canVoid = !e.voided && !e.parent_id && (isAdmin || (e.action_by === currentUser && today));
                  const skin = TYPE_SKIN[e.movement_type] || TYPE_SKIN.OPEN_CARTON;
                  return (
                    <React.Fragment key={e.id}>
                      <tr style={e.voided ? { opacity: .45, textDecoration: 'line-through' } : undefined}>
                        <td style={{ fontWeight: 600, color: 'var(--text)' }}>{e.label}</td>
                        <td><span className="pill" style={{ background: skin.bg, color: skin.fg }}>{TYPE_LABEL[e.movement_type]}</span></td>
                        <td className="num" style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {e.movement_type === 'OPEN_CARTON' ? `${-e.cartons} C → ${e.reams} R` : cr(Math.abs(e.cartons), Math.abs(e.reams))}
                        </td>
                        <td>{e.party || '-'}</td>
                        <td style={{ fontSize: 12 }}>{[e.reference, e.remarks].filter(Boolean).join(' · ') || '-'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-3)' }}>{String(e.action_by).split('@')[0]}</td>
                        <td style={{ textAlign: 'right' }}>
                          {canVoid && <button className="btn btn-red btn-sm" title="Void this entry" onClick={() => setVoiding({ id: e.id, reason: '' })}>&#128465;</button>}
                          {e.voided && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700 }}>voided</span>}
                        </td>
                      </tr>
                      {voiding && voiding.id === e.id && (
                        <tr><td colSpan={7} style={{ background: '#fef2f2' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: '#991b1b', fontWeight: 700, fontSize: 13 }}>
                              Void {cr(Math.abs(e.cartons), Math.abs(e.reams))} of {e.label}?
                            </span>
                            <input className="input" style={{ marginBottom: 0, flex: '1 1 160px', padding: '5px 9px' }} autoFocus
                              placeholder="Reason (optional)" value={voiding.reason}
                              onChange={ev => setVoiding({ ...voiding, reason: ev.target.value })}
                              onKeyDown={ev => { if (ev.key === 'Enter') confirmVoid(); if (ev.key === 'Escape') setVoiding(null); }} />
                            <button className="btn btn-red btn-sm" disabled={busy} onClick={confirmVoid}>{busy ? 'Voiding…' : 'Void it'}</button>
                            <button className="btn btn-light btn-sm" onClick={() => setVoiding(null)}>Cancel</button>
                          </div>
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};

// ---- Daily report -----------------------------------------------------------
const ReportTab = ({ call, notify, currentUser }) => {
  const [date, setDate] = useState(istToday());
  const [rows, setRows] = useState([]);
  const [entries, setEntries] = useState([]);
  const [onlyMoved, setOnlyMoved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.all([call(`/report?date=${date}`), call(`/movements?date=${date}`)]).then(([rep, mv]) => {
      if (!live) return;
      setRows(rep.ok ? rep.data.items || [] : []);
      setEntries(mv.ok && Array.isArray(mv.data) ? mv.data.filter(e => !e.voided) : []);
      setLoading(false);
    });
    return () => { live = false; };
  }, [call, date]);

  const moved = (r) => +r.moves_today > 0;
  const shown = onlyMoved ? rows.filter(moved) : rows;
  const tot = useMemo(() => shown.reduce((s, r) => {
    ['open_c', 'open_r', 'in_c', 'in_r', 'out_c', 'out_r', 'close_c', 'close_r'].forEach(k => { s[k] = (s[k] || 0) + n(r[k]); });
    return s;
  }, {}), [shown]);
  const T = (k) => n(tot[k] || 0);

  const printReport = () => {
    openPrint(`Daily Photocopy Paper Stock Register — ${prettyDay(date)}`, `
      <div class="meta"><span>Date: ${prettyDay(date)}</span><span>Printed by: ${esc(currentUser)}</span></div>
      <table class="reg">
        <thead>
          <tr><th rowspan="2">Sl.</th><th rowspan="2">Brand / Paper</th>${UNITS_.map(u => `<th colspan="4" class="grp">${u.label}</th>`).join('')}</tr>
          <tr>${REG_COLS.map((c, i) => `<th class="${i === 4 ? 'split' : ''}">${c.label}</th>`).join('')}</tr>
        </thead>
        <tbody>${shown.map((r, k) => `<tr>
          <td>${k + 1}</td><td class="name">${esc(r.label)}${n(r.opened_c) ? `<small> (${n(r.opened_c)} ctn opened)</small>` : ''}</td>
          ${REG_COLS.map((c, i) => `<td class="${c.key === 'close' ? 'b' : ''} ${i === 4 ? 'split' : ''}">${regVal(r, c)}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total</td>${REG_COLS.map((c, i) => `<td class="${i === 4 ? 'split' : ''}">${T(c.field)}</td>`).join('')}</tr></tfoot>
      </table>
      ${entries.filter(e => e.movement_type !== 'OPEN_CARTON').length ? `
      <h3>Entries</h3>
      <table><thead><tr><th>Type</th><th>Paper</th><th class="num">Qty</th><th>Party</th><th>Ref / Remarks</th></tr></thead>
      <tbody>${entries.filter(e => e.movement_type !== 'OPEN_CARTON').map(e => `<tr><td>${TYPE_LABEL[e.movement_type]}</td><td>${esc(e.label)}</td>
        <td class="num">${cr(Math.abs(e.cartons), Math.abs(e.reams))}</td><td>${esc(e.party || '-')}</td>
        <td>${esc([e.reference, e.remarks].filter(Boolean).join(' · ') || '-')}</td></tr>`).join('')}</tbody></table>` : ''}`);
  };

  const share = async () => {
    const list = shown;
    if (!list.length) { notify('Nothing to share for this day.', 'error'); return; }
    const pages = [];
    for (let i = 0; i < list.length; i += REPORT_PER_PAGE) pages.push(list.slice(i, i + REPORT_PER_PAGE));
    const files = [];
    for (let p = 0; p < pages.length; p++) files.push(await drawReportPage(pages[p], p, pages.length, date, p * REPORT_PER_PAGE));
    // The message text carries only the closing balance; the full register is in the image.
    const text = `*Paper Stock Closing — ${prettyDay(date)}*\n` + list.map((r, k) =>
      `${k + 1}. ${r.label}: ${n(r.close_c)} Ctn + ${n(r.close_r)} Ream`
    ).join('\n');
    if (navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, text }); } catch { /* cancelled */ }
    } else {
      files.forEach(f => { const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); });
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  };

  return (
    <div className="card" style={{ border: '2px solid #4338ca' }}>
      <div className="card-title" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>📅 Daily Paper Stock Register</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-light btn-sm" title="Previous day" onClick={() => setDate(shiftYmd(date, -1))}>◀</button>
          <input className="input" type="date" style={{ marginBottom: 0, width: 'auto', padding: '6px 10px' }}
            value={date} max={istToday()} onChange={e => setDate(e.target.value || istToday())} />
          <button className="btn btn-light btn-sm" title="Next day" disabled={date >= istToday()} onClick={() => setDate(shiftYmd(date, 1))}>▶</button>
          <button className="btn btn-light btn-sm" disabled={date === istToday()} onClick={() => setDate(istToday())}>Today</button>
          <button className="btn btn-light btn-sm" onClick={printReport}>🖨 Print</button>
          <button className="btn btn-green btn-sm" onClick={share}>📲 WhatsApp</button>
        </div>
      </div>

      <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
        <input type="checkbox" checked={onlyMoved} onChange={e => setOnlyMoved(e.target.checked)} /> Only papers that moved on this day
      </label>

      {loading ? <div className="paper-empty">Loading…</div> : shown.length === 0 ? (
        <div className="paper-empty">{onlyMoved ? `Nothing moved on ${prettyDay(date)}.` : 'No papers yet.'}</div>
      ) : (
        <div className="table-wrap">
          <table className="paper-table register">
            <thead>
              <tr>
                <th rowSpan={2}>Sl.</th><th rowSpan={2}>Brand / Paper</th>
                {UNITS_.map(u => <th key={u.suffix} colSpan={4} className={`grp ${u.grp}`}>{u.label}</th>)}
              </tr>
              <tr>{REG_COLS.map((c, i) => <th key={c.field} className={`num ${i === 4 ? 'split' : ''}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {shown.map((r, k) => (
                <tr key={r.id} className={moved(r) ? 'row-moved' : ''}>
                  <td style={{ color: 'var(--text-3)' }}>{k + 1}</td>
                  <td style={{ fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                    {r.label}
                    {n(r.opened_c) > 0 && <div style={{ fontSize: 11, color: '#b45309' }}>{n(r.opened_c)} carton opened</div>}
                  </td>
                  {REG_COLS.map((c, i) => <td key={c.field} className={`num ${c.cls} ${i === 4 ? 'split' : ''}`}>{regVal(r, c)}</td>)}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                {REG_COLS.map((c, i) => <td key={c.field} className={`num ${i === 4 ? 'split' : ''}`}>{T(c.field)}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

// ---- Print + share helpers --------------------------------------------------
const openPrint = (title, body) => {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #111; }
    .head { text-align: center; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 12px; }
    .head h1 { margin: 0; font-size: 19px; } .head h2 { margin: 4px 0 0; font-size: 14px; font-weight: normal; }
    .meta { display: flex; justify-content: space-between; font-size: 12px; color: #444; margin-bottom: 10px; }
    h3 { font-size: 14px; margin: 18px 0 6px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #888; padding: 5px 7px; text-align: left; }
    th { background: #eaf2f8; font-size: 11px; }
    td.num, th.num, table.reg td { text-align: right; }
    table.reg th { text-align: center; } table.reg td.name, table.reg td:first-child { text-align: left; }
    td.b { font-weight: bold; } small { color: #666; }
    table.reg .split { border-left: 2.5px solid #333; }
    tfoot td { font-weight: bold; background: #f5f5f5; }
    .sign { margin-top: 44px; display: flex; justify-content: space-between; font-size: 12px; }
    .sign div { border-top: 1px solid #333; padding-top: 4px; width: 170px; text-align: center; }
    @media print { body { margin: 8mm; } }
  </style></head><body>
    <div class="head"><h1>Goyal Printing &amp; Converting Industries</h1><h2>${esc(title)}</h2></div>
    ${body}
    <div class="sign"><div>Prepared By</div><div>Checked By</div><div>Authorised Signatory</div></div>
    <script>window.onload = () => { window.print(); }</script>
  </body></html>`);
  w.document.close();
};

// One register page as a PNG, sized to stay legible on a phone.
const drawReportPage = (rows, pageIdx, pageCount, date, startIdx) => new Promise((resolve) => {
  const W = 1080, pad = 30, headH = 150, colH = 70, rowH = 54, scale = 2;
  const H = headH + colH + rows.length * rowH + 60;
  const c = document.createElement('canvas');
  c.width = W * scale; c.height = H * scale;
  const x = c.getContext('2d');
  x.scale(scale, scale);
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#4338ca'; x.fillRect(0, 0, W, headH);
  x.fillStyle = '#fff'; x.textAlign = 'left';
  x.font = 'bold 38px Arial'; x.fillText('Paper Stock Register', pad, 62);
  x.font = '24px Arial'; x.fillStyle = 'rgba(255,255,255,.9)';
  x.fillText('Goyal Printing & Converting Industries', pad, 100);
  x.textAlign = 'right'; x.fillStyle = '#fff'; x.font = 'bold 34px Arial';
  x.fillText(prettyDay(date), W - pad, 62);
  if (pageCount > 1) { x.font = 'bold 22px Arial'; x.fillText(`Page ${pageIdx + 1} of ${pageCount}`, W - pad, 100); }

  // columns: name, then the four carton figures, then the four ream figures
  const nameW = 330, blockW = (W - pad * 2 - nameW) / 2, cellW = blockW / 4;
  const colX = (i) => pad + nameW + (i >= 4 ? blockW : 0) + (i % 4) * cellW + cellW / 2;
  let y = headH;
  x.fillStyle = '#eef2ff'; x.fillRect(0, y, W, colH);
  x.textAlign = 'left'; x.fillStyle = '#334155'; x.font = 'bold 22px Arial';
  x.fillText('Paper', pad, y + 44);
  UNITS_.forEach((u, k) => {
    x.textAlign = 'center'; x.fillStyle = '#1e293b'; x.font = 'bold 22px Arial';
    x.fillText(u.label, pad + nameW + k * blockW + blockW / 2, y + 28);
  });
  REG_COLS.forEach((c, i) => {
    x.textAlign = 'center'; x.fillStyle = c.color; x.font = 'bold 17px Arial';
    x.fillText(c.label, colX(i), y + 58);
  });
  const splitX = pad + nameW + blockW - 4;
  y += colH;
  rows.forEach((r, k) => {
    const hot = +r.moves_today > 0;
    if (hot) { x.fillStyle = '#fffbeb'; x.fillRect(0, y, W, rowH); }
    x.textAlign = 'left'; x.fillStyle = '#0f172a'; x.font = `${hot ? 'bold ' : ''}23px Arial`;
    x.fillText(`${startIdx + k + 1}. ${r.label}`.substring(0, 25), pad, y + 35);
    REG_COLS.forEach((c, i) => {
      x.textAlign = 'center'; x.fillStyle = c.color; x.font = `${c.key === 'close' ? 'bold ' : ''}25px Arial`;
      x.fillText(String(regVal(r, c)), colX(i), y + 36);
    });
    x.strokeStyle = '#e2e8f0'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(pad, y + rowH); x.lineTo(W - pad, y + rowH); x.stroke();
    y += rowH;
  });
  x.strokeStyle = '#94a3b8'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(splitX, headH); x.lineTo(splitX, y); x.stroke();
  x.textAlign = 'left'; x.fillStyle = '#94a3b8'; x.font = '20px Arial';
  x.fillText('Generated by Inventory Hub • stock.gpci.in', pad, H - 22);
  c.toBlob(b => resolve(new File([b], `paper-stock-${date}-p${pageIdx + 1}.png`, { type: 'image/png' })), 'image/png');
});

export default PaperStock;
