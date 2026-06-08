import React, { useState, useEffect, useCallback } from 'react';

const API = '/api';
const UNITS = ['pcs','kg','g','ton','ltr','ml','box','bundle','ream','roll','sheet','packet','bag','bottle','pair','set','nos','mtr','ft','inch'];

const InventoryApp = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');

  const [inventory, setInventory] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('all');
  const [selectedGodown, setSelectedGodown] = useState('');

  // Add form
  const [newItem, setNewItem] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newUnit, setNewUnit] = useState('pcs');
  const [newSecQty, setNewSecQty] = useState('');
  const [newSecUnit, setNewSecUnit] = useState('');
  const [newGodown, setNewGodown] = useState('');
  const [newBuilty, setNewBuilty] = useState('');
  const [newTransporter, setNewTransporter] = useState('');
  const [newRemarks, setNewRemarks] = useState('');
  const [newStockType, setNewStockType] = useState('regular');
  const [showAddForm, setShowAddForm] = useState(true);

  // Godown management
  const [editingGodowns, setEditingGodowns] = useState(false);
  const [newGodownName, setNewGodownName] = useState('');
  const [renamingGodown, setRenamingGodown] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Upload
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMode, setUploadMode] = useState('csv');
  const [extractedData, setExtractedData] = useState([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState('');

  // Issue Slip
  const [showIssueSlip, setShowIssueSlip] = useState(false);
  const [slipItems, setSlipItems] = useState([]);
  const [slipSearch, setSlipSearch] = useState('');
  const [slipIssuedTo, setSlipIssuedTo] = useState('');
  const [slipRemarks, setSlipRemarks] = useState('');
  const [issueSuccess, setIssueSuccess] = useState('');

  // CSV Import
  const [showImport, setShowImport] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importPreview, setImportPreview] = useState([]);
  const [importError, setImportError] = useState('');
  const [importGodown, setImportGodown] = useState('');
  const [importDate, setImportDate] = useState(new Date().toISOString().split('T')[0]);

  const authHeaders = useCallback(() => ({ 'Content-Type': 'application/json', 'Authorization': token }), [token]);

  const loadInventory = useCallback(async (tok) => {
    const t = tok || token;
    const res = await fetch(`${API}/inventory`, { headers: { Authorization: t } });
    const data = await res.json();
    setInventory(Array.isArray(data) ? data : []);
  }, [token]);

  const loadGodowns = useCallback(async (tok) => {
    const t = tok || token;
    const res = await fetch(`${API}/godowns`, { headers: { Authorization: t } });
    const data = await res.json();
    setGodowns(Array.isArray(data) ? data : []);
    if (data.length > 0) { setNewGodown(data[0]); setSelectedGodown(data[0]); setImportGodown(data[0]); }
  }, [token]);

  useEffect(() => {
    const savedToken = localStorage.getItem('inv_token');
    const savedUser = localStorage.getItem('inv_user');
    if (savedToken && savedUser) {
      setToken(savedToken); setCurrentUser(savedUser);
      loadInventory(savedToken); loadGodowns(savedToken);
    }
  }, [loadInventory, loadGodowns]);

  const loadPdfJs = async () => {
    if (!window.pdfjsLib) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; resolve(); };
        document.head.appendChild(script);
      });
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setAuthError('');
    const res = await fetch(`${API}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error); return; }
    setToken(data.token); setCurrentUser(data.email);
    localStorage.setItem('inv_token', data.token); localStorage.setItem('inv_user', data.email);
    await loadInventory(data.token); await loadGodowns(data.token);
    setEmail(''); setPassword('');
  };

  const handleSignUp = async (e) => {
    e.preventDefault(); setAuthError('');
    const res = await fetch(`${API}/signup`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error); return; }
    alert('Account created! Now sign in.'); setIsLogin(true); setEmail(''); setPassword('');
  };

  const handleLogout = async () => {
    await fetch(`${API}/logout`, { method:'POST', headers: authHeaders() });
    localStorage.removeItem('inv_token'); localStorage.removeItem('inv_user');
    setCurrentUser(null); setToken(null); setInventory([]); setGodowns([]);
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!newItem || !newQty || !newGodown) return;
    await fetch(`${API}/inventory`, {
      method:'POST', headers: authHeaders(),
      body: JSON.stringify({ name:newItem, quantity:parseFloat(newQty), unit:newUnit, secondary_quantity:parseFloat(newSecQty)||0, secondary_unit:newSecUnit, godown:newGodown, dateAdded:new Date().toLocaleDateString(), builty_number:newBuilty, transporter:newTransporter, remarks:newRemarks, stock_type:newStockType })
    });
    await loadInventory();
    setNewItem(''); setNewQty(''); setNewSecQty(''); setNewBuilty(''); setNewTransporter(''); setNewRemarks('');
  };

  const issueItem = async (id) => {
    const qty = parseFloat(window.prompt('How many to issue?', '1'));
    if (!qty || qty <= 0) return;
    const res = await fetch(`${API}/inventory/${id}/issue`, { method:'PUT', headers: authHeaders(), body: JSON.stringify({ quantity: qty }) });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    await loadInventory();
  };

  // Issue Slip helpers
  const slipSuggestions = slipSearch.length > 0
    ? inventory.filter(i => i.name.toLowerCase().includes(slipSearch.toLowerCase()) && !slipItems.find(s => s.id === i.id)).slice(0, 8)
    : [];

  const addToSlip = (item) => {
    setSlipItems(prev => [...prev, { id: item.id, name: item.name, available: item.quantity, unit: item.unit || 'pcs', godown: item.godown, issueQty: 1 }]);
    setSlipSearch('');
  };

  const removeFromSlip = (id) => setSlipItems(prev => prev.filter(s => s.id !== id));

  const updateSlipQty = (id, val) => setSlipItems(prev => prev.map(s => s.id === id ? { ...s, issueQty: val } : s));

  const submitIssueSlip = async () => {
    const invalid = slipItems.filter(s => !s.issueQty || parseFloat(s.issueQty) <= 0 || parseFloat(s.issueQty) > s.available);
    if (invalid.length) { alert(`Check quantities — ${invalid.length} item(s) have invalid or excess quantities.`); return; }
    if (!slipItems.length) { alert('Add at least one item to the slip.'); return; }
    let errors = [];
    for (const s of slipItems) {
      const res = await fetch(`${API}/inventory/${s.id}/issue`, { method:'PUT', headers: authHeaders(), body: JSON.stringify({ quantity: parseFloat(s.issueQty), remarks: slipRemarks, issued_to: slipIssuedTo }) });
      const data = await res.json();
      if (!res.ok) errors.push(`${s.name}: ${data.error}`);
    }
    await loadInventory();
    if (errors.length) { alert('Some items failed:\n' + errors.join('\n')); }
    else {
      setIssueSuccess(`✅ Issued ${slipItems.length} item(s) successfully!`);
      setTimeout(() => setIssueSuccess(''), 4000);
      setSlipItems([]); setSlipIssuedTo(''); setSlipRemarks('');
    }
  };

  const deleteItem = async (id) => {
    if (!window.confirm('Delete this item?')) return;
    await fetch(`${API}/inventory/${id}`, { method:'DELETE', headers: authHeaders() });
    await loadInventory();
  };

  const addGodown = async (e) => {
    e.preventDefault();
    if (!newGodownName) return;
    const res = await fetch(`${API}/godowns`, { method:'POST', headers: authHeaders(), body: JSON.stringify({ name: newGodownName }) });
    if (res.ok) { await loadGodowns(); setNewGodownName(''); }
  };

  const renameGodown = async (oldName) => {
    if (!renameValue.trim()) return;
    await fetch(`${API}/godowns/${encodeURIComponent(oldName)}`, { method:'PUT', headers: authHeaders(), body: JSON.stringify({ newName: renameValue }) });
    await loadGodowns(); await loadInventory(); setRenamingGodown(null); setRenameValue('');
  };

  const deleteGodown = async (name) => {
    if (!window.confirm(`Delete godown "${name}"? Items inside won't be deleted.`)) return;
    await fetch(`${API}/godowns/${encodeURIComponent(name)}`, { method:'DELETE', headers: authHeaders() });
    await loadGodowns();
  };

  // CSV/XLS Import
  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''));
    return lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/"/g,''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || '');
      return {
        name: obj['name'] || obj['item'] || obj['item name'] || obj['product'] || '',
        quantity: parseFloat(obj['quantity'] || obj['qty'] || 0),
        unit: obj['unit'] || 'pcs',
        secondary_quantity: parseFloat(obj['secondary quantity'] || obj['sec qty'] || 0),
        secondary_unit: obj['secondary unit'] || obj['sec unit'] || '',
        price: parseFloat(obj['price'] || obj['rate'] || 0),
        hsn: obj['hsn'] || 'N/A',
        builty_number: obj['builty'] || obj['builty number'] || '',
        transporter: obj['transporter'] || '',
        remarks: obj['remarks'] || obj['remark'] || '',
      };
    }).filter(r => r.name);
  };

  const handleImportFile = (file) => {
    setImportFile(file); setImportError('');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = parseCSV(text);
        if (rows.length === 0) { setImportError('No valid rows found. Make sure CSV has a "name" or "item" column.'); return; }
        setImportPreview(rows);
      } catch (err) { setImportError('Failed to parse file: ' + err.message); }
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!importGodown) { alert('Please select a godown'); return; }
    const items = importPreview.map(row => ({ ...row, godown: importGodown, dateAdded: importDate, stock_type: 'regular' }));
    const res = await fetch(`${API}/inventory/bulk`, { method:'POST', headers: authHeaders(), body: JSON.stringify({ items }) });
    if (res.ok) {
      await loadInventory();
      setImportPreview([]); setImportFile(null); setShowImport(false);
      alert(`✅ Imported ${items.length} items successfully!`);
    }
  };

  // AI Extract
  const handleExtract = async () => {
    if (!uploadFile) return;
    setIsExtracting(true); setExtractionError('');
    try {
      let body;
      if (uploadFile.type === 'application/pdf') {
        await loadPdfJs();
        const arrayBuffer = await uploadFile.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const tc = await page.getTextContent();
          fullText += tc.items.map(x => x.str).join(' ') + '\n';
        }
        body = JSON.stringify({ text: fullText });
      } else {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result.split(',')[1]);
          reader.readAsDataURL(uploadFile);
        });
        body = JSON.stringify({ imageBase64: base64, mediaType: uploadFile.type });
      }
      const res = await fetch('/api/extract', { method:'POST', headers: authHeaders(), body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setExtractedData(data.items.map((item, idx) => ({ ...item, id:`temp_${idx}`, godown:'', stockEntryDate:new Date().toISOString().split('T')[0], quantity:parseInt(item.quantity)||1, unit:item.unit||'pcs' })));
    } catch (err) { setExtractionError('Failed: ' + err.message); }
    finally { setIsExtracting(false); }
  };

  const updateExtracted = (id, field, value) => setExtractedData(extractedData.map(i => i.id===id ? {...i,[field]:value} : i));

  const addExtractedItems = async () => {
    const missing = extractedData.filter(i => !i.godown);
    if (missing.length) { alert(`Select godown for all items (${missing.length} missing)`); return; }
    await fetch(`${API}/inventory/bulk`, { method:'POST', headers: authHeaders(), body: JSON.stringify({ items: extractedData.map(i => ({ name:i.name, quantity:i.quantity, unit:i.unit||'pcs', godown:i.godown, dateAdded:i.stockEntryDate, price:i.price||0, hsn:i.hsn||'N/A', remarks:i.remarks||'' }))}) });
    await loadInventory();
    setExtractedData([]); setUploadFile(null); setShowUpload(false);
    alert(`Added ${extractedData.length} items!`);
  };

  const exportCSV = () => {
    const csv = [
      ['Item','Quantity','Unit','Sec Qty','Sec Unit','Godown','Date','Added By','Builty','Transporter','Remarks','Type'],
      ...inventory.map(i => [i.name,i.quantity,i.unit||'',i.secondary_quantity||'',i.secondary_unit||'',i.godown,i.date_added,i.added_by,i.builty_number||'',i.transporter||'',i.remarks||'',i.stock_type||''])
    ].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    a.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const filtered = inventory.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const displayed = viewMode==='by-godown' ? filtered.filter(i => i.godown===selectedGodown) : filtered;
  const godownSummary = godowns.map(g => ({ name:g, items:inventory.filter(i=>i.godown===g).length, total:inventory.filter(i=>i.godown===g).reduce((s,i)=>s+i.quantity,0) }));

  if (!currentUser) return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>📦 Inventory Hub</h1>
        <p>Stock Management System</p>
        <form onSubmit={isLogin ? handleLogin : handleSignUp}>
          <input className="input" type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
          <input className="input" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required />
          {authError && <div className="alert-error">{authError}</div>}
          <button className="btn btn-blue" style={{width:'100%',justifyContent:'center',padding:'11px',fontSize:'15px',marginBottom:'12px'}} type="submit">
            {isLogin ? '🔐 Sign In' : '✅ Create Account'}
          </button>
        </form>
        <button onClick={()=>{setIsLogin(!isLogin);setAuthError('');}} style={{width:'100%',background:'none',border:'none',color:'#2563eb',cursor:'pointer',fontSize:'14px'}}>
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="header">
        <div><h1>📦 Inventory Hub</h1><p>👤 {currentUser}</p></div>
        <div className="header-btns">
          <button className="btn btn-orange" onClick={()=>setShowIssueSlip(!showIssueSlip)}>📋 Issue Slip</button>
          <button className="btn btn-green" onClick={()=>setShowUpload(!showUpload)}>📤 Upload Bill</button>
          <button className="btn" style={{background:'#0891b2',color:'white'}} onClick={()=>setShowImport(!showImport)}>📊 Import CSV/XLS</button>
          <button className="btn btn-light" onClick={()=>setEditingGodowns(!editingGodowns)}>🏭 Godowns</button>
          <button className="btn btn-red" onClick={handleLogout}>🚪 Sign Out</button>
        </div>
      </div>

      <div className="main">

        {/* Issue Slip */}
        {showIssueSlip && (
          <div className="card" style={{border:'2px solid #ea580c'}}>
            <div className="card-title">📋 Issue Slip — Bulk Issue</div>

            {issueSuccess && <div style={{background:'#dcfce7',border:'1px solid #86efac',color:'#166534',borderRadius:8,padding:'10px 16px',marginBottom:14,fontWeight:600}}>{issueSuccess}</div>}

            {/* Issued To + Remarks */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
              <div>
                <label className="field-label">Issued To (optional)</label>
                <input className="input" style={{marginBottom:0}} placeholder="Person / department name" value={slipIssuedTo} onChange={e=>setSlipIssuedTo(e.target.value)} />
              </div>
              <div>
                <label className="field-label">Remarks (optional)</label>
                <input className="input" style={{marginBottom:0}} placeholder="e.g. Production use, Dispatch..." value={slipRemarks} onChange={e=>setSlipRemarks(e.target.value)} />
              </div>
            </div>

            {/* Search to add items */}
            <div style={{position:'relative',marginBottom:14}}>
              <label className="field-label">Search & Add Items</label>
              <input
                className="input" style={{marginBottom:0}}
                placeholder="Type item name to search..."
                value={slipSearch}
                onChange={e=>setSlipSearch(e.target.value)}
              />
              {slipSuggestions.length > 0 && (
                <div style={{position:'absolute',zIndex:100,left:0,right:0,background:'white',border:'1px solid #cbd5e1',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',marginTop:4,maxHeight:260,overflowY:'auto'}}>
                  {slipSuggestions.map(item => (
                    <div key={item.id}
                      onClick={()=>addToSlip(item)}
                      style={{padding:'10px 16px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                      onMouseLeave={e=>e.currentTarget.style.background='white'}
                    >
                      <div>
                        <div style={{fontWeight:600}}>{item.name}</div>
                        <div style={{fontSize:12,color:'#64748b'}}>{item.godown}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <span style={{background:'#dbeafe',color:'#1d4ed8',padding:'2px 10px',borderRadius:20,fontSize:12,fontWeight:600}}>{item.quantity} {item.unit||'pcs'} avail.</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Slip table */}
            {slipItems.length > 0 ? (
              <>
                <div className="table-wrap" style={{marginBottom:14}}>
                  <table>
                    <thead>
                      <tr><th>#</th><th>Item</th><th>Godown</th><th>Available</th><th>Issue Qty</th><th></th></tr>
                    </thead>
                    <tbody>
                      {slipItems.map((s, idx) => {
                        const overLimit = parseFloat(s.issueQty) > s.available;
                        return (
                          <tr key={s.id} style={{background: overLimit ? '#fef2f2' : ''}}>
                            <td style={{color:'#94a3b8',fontWeight:700}}>{idx+1}</td>
                            <td style={{fontWeight:600}}>{s.name}</td>
                            <td style={{color:'#64748b',fontSize:13}}>{s.godown}</td>
                            <td><span style={{background:'#f1f5f9',padding:'2px 10px',borderRadius:20,fontWeight:600,fontSize:13}}>{s.available} {s.unit}</span></td>
                            <td>
                              <div style={{display:'flex',alignItems:'center',gap:6}}>
                                <input
                                  type="number" min="0.01" step="any"
                                  value={s.issueQty}
                                  onChange={e=>updateSlipQty(s.id, e.target.value)}
                                  style={{width:80,padding:'6px 10px',border:`1.5px solid ${overLimit?'#ef4444':'#cbd5e1'}`,borderRadius:6,fontSize:14,fontWeight:600,textAlign:'center'}}
                                />
                                <span style={{fontSize:12,color:'#94a3b8'}}>{s.unit}</span>
                                {overLimit && <span style={{color:'#ef4444',fontSize:11}}>⚠️ Exceeds stock</span>}
                              </div>
                            </td>
                            <td><button className="btn btn-red btn-sm" onClick={()=>removeFromSlip(s.id)}>✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <button className="btn btn-orange" style={{flex:1,justifyContent:'center',padding:'11px',fontSize:'15px'}} onClick={submitIssueSlip}>
                    📤 Issue All {slipItems.length} Item{slipItems.length>1?'s':''}
                  </button>
                  <button className="btn btn-gray" onClick={()=>setSlipItems([])}>🗑 Clear</button>
                </div>
              </>
            ) : (
              <div style={{textAlign:'center',padding:'24px',color:'#94a3b8',background:'#f8fafc',borderRadius:8,border:'1.5px dashed #cbd5e1'}}>
                Search for items above to add them to this issue slip
              </div>
            )}
          </div>
        )}

        {/* CSV/XLS Import */}
        {showImport && (
          <div className="card" style={{border:'2px solid #0891b2'}}>
            <div className="card-title">📊 Import Stock from CSV / Excel</div>
            {!importPreview.length ? (
              <>
                <div style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:8,padding:'12px 16px',marginBottom:14,fontSize:13,color:'#0369a1'}}>
                  <strong>CSV Format:</strong> Your file should have columns: <code>name, quantity, unit, secondary quantity, secondary unit, price, hsn, builty number, transporter, remarks</code><br/>
                  First row must be headers. Download a <button onClick={()=>{const csv='"name","quantity","unit","secondary quantity","secondary unit","price","hsn","builty number","transporter","remarks"\n"A4 Paper","100","ream","","","250","4802","BLT001","Fast Cargo",""\n"Pen Box","50","box","","","120","N/A","","","Sample"';const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='inventory_template.csv';a.click();}} style={{background:'none',border:'none',color:'#0891b2',cursor:'pointer',textDecoration:'underline',fontSize:13}}>sample template</button>
                </div>
                <label className="upload-box">
                  <div className="upload-icon">📊</div>
                  <div style={{fontWeight:600,marginBottom:4}}>Tap to select CSV or Excel file</div>
                  <div style={{color:'#64748b',fontSize:13}}>Supported: .csv, .txt</div>
                  {importFile && <div style={{color:'#16a34a',marginTop:8,fontWeight:600}}>✓ {importFile.name}</div>}
                  <input type="file" accept=".csv,.txt" style={{display:'none'}} onChange={e=>{if(e.target.files[0]) handleImportFile(e.target.files[0]);}} />
                </label>
                {importError && <div className="alert-error" style={{marginTop:10}}>{importError}</div>}
              </>
            ) : (
              <>
                <div style={{display:'flex',gap:12,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
                  <div>
                    <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Apply to Godown *</label>
                    <select className="input" style={{marginBottom:0,minWidth:160}} value={importGodown} onChange={e=>setImportGodown(e.target.value)}>
                      <option value="">Select Godown</option>
                      {godowns.map(g=><option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:13,fontWeight:600,display:'block',marginBottom:4}}>Stock Entry Date</label>
                    <input type="date" className="input" style={{marginBottom:0}} value={importDate} onChange={e=>setImportDate(e.target.value)} />
                  </div>
                  <div style={{alignSelf:'flex-end'}}>
                    <span style={{background:'#dbeafe',color:'#1d4ed8',padding:'4px 12px',borderRadius:20,fontSize:13,fontWeight:600}}>{importPreview.length} items found</span>
                  </div>
                </div>
                <div className="table-wrap" style={{maxHeight:300,overflowY:'auto'}}>
                  <table>
                    <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Sec Qty</th><th>Sec Unit</th><th>Price</th><th>Builty</th><th>Transporter</th><th>Remarks</th></tr></thead>
                    <tbody>
                      {importPreview.map((row,i)=>(
                        <tr key={i}>
                          <td style={{fontWeight:600}}>{row.name}</td>
                          <td>{row.quantity}</td>
                          <td>{row.unit}</td>
                          <td>{row.secondary_quantity||'-'}</td>
                          <td>{row.secondary_unit||'-'}</td>
                          <td>{row.price||'-'}</td>
                          <td>{row.builty_number||'-'}</td>
                          <td>{row.transporter||'-'}</td>
                          <td>{row.remarks||'-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex',gap:10,marginTop:14}}>
                  <button className="btn btn-green" style={{flex:1,justifyContent:'center'}} onClick={confirmImport}>✅ Import {importPreview.length} Items</button>
                  <button className="btn btn-gray" style={{flex:1,justifyContent:'center'}} onClick={()=>{setImportPreview([]);setImportFile(null);}}>✕ Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Upload Bill (AI) */}
        {showUpload && (
          <div className="card" style={{border:'2px solid #16a34a'}}>
            <div className="card-title">📤 Upload Invoice / Bill (AI Extract)</div>
            {!extractedData.length ? (
              <>
                <div className="mode-tabs">
                  <button className={`mode-tab ${uploadMode==='pdf'?'active':''}`} onClick={()=>{setUploadMode('pdf');setUploadFile(null);}}>📄 PDF File</button>
                  <button className={`mode-tab ${uploadMode==='camera'?'active':''}`} onClick={()=>{setUploadMode('camera');setUploadFile(null);}}>📷 Camera / Photo</button>
                </div>
                <label className="upload-box">
                  <div className="upload-icon">{uploadMode==='camera'?'📷':'📄'}</div>
                  <div style={{fontWeight:600,marginBottom:4}}>{uploadMode==='camera'?'Tap to open Camera':'Tap to select PDF'}</div>
                  <div style={{color:'#64748b',fontSize:13}}>{uploadMode==='camera'?'Take a photo of the bill':'Supplier invoice PDF'}</div>
                  {uploadFile && <div style={{color:'#16a34a',marginTop:8,fontWeight:600}}>✓ {uploadFile.name}</div>}
                  <input type="file" accept={uploadMode==='camera'?'image/*':'.pdf'} capture={uploadMode==='camera'?'environment':undefined} style={{display:'none'}} onChange={e=>setUploadFile(e.target.files[0])} />
                </label>
                {extractionError && <div className="alert-error" style={{marginTop:10}}>{extractionError}</div>}
                <button className="btn btn-green" disabled={!uploadFile||isExtracting} style={{width:'100%',justifyContent:'center',marginTop:12,padding:'11px'}} onClick={handleExtract}>
                  {isExtracting?'🔄 Extracting with AI...':'✨ Extract Items with AI'}
                </button>
              </>
            ) : (
              <>
                <div style={{fontWeight:700,marginBottom:12}}>Extracted Items ({extractedData.length})</div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Godown</th><th>Date</th></tr></thead>
                    <tbody>
                      {extractedData.map(item=>(
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td><input type="number" value={item.quantity} style={{width:70,padding:'4px 8px',border:'1px solid #cbd5e1',borderRadius:6}} onChange={e=>updateExtracted(item.id,'quantity',parseInt(e.target.value))} /></td>
                          <td>
                            <select value={item.unit||'pcs'} style={{padding:'4px 8px',border:'1px solid #cbd5e1',borderRadius:6}} onChange={e=>updateExtracted(item.id,'unit',e.target.value)}>
                              {UNITS.map(u=><option key={u}>{u}</option>)}
                            </select>
                          </td>
                          <td>
                            <select value={item.godown} style={{padding:'4px 8px',border:'1px solid #cbd5e1',borderRadius:6}} onChange={e=>updateExtracted(item.id,'godown',e.target.value)}>
                              <option value="">Select</option>
                              {godowns.map(g=><option key={g}>{g}</option>)}
                            </select>
                          </td>
                          <td><input type="date" value={item.stockEntryDate} style={{padding:'4px 8px',border:'1px solid #cbd5e1',borderRadius:6}} onChange={e=>updateExtracted(item.id,'stockEntryDate',e.target.value)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex',gap:10,marginTop:14}}>
                  <button className="btn btn-green" style={{flex:1,justifyContent:'center'}} onClick={addExtractedItems}>✅ Add All to Inventory</button>
                  <button className="btn btn-gray" style={{flex:1,justifyContent:'center'}} onClick={()=>{setExtractedData([]);setUploadFile(null);}}>✕ Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Godown Management */}
        {editingGodowns && (
          <div className="card">
            <div className="card-title">🏭 Manage Godowns</div>
            <form onSubmit={addGodown} style={{display:'flex',gap:10,marginBottom:16}}>
              <input className="input" style={{marginBottom:0,flex:1}} placeholder="New godown name" value={newGodownName} onChange={e=>setNewGodownName(e.target.value)} />
              <button className="btn btn-green" type="submit">Add</button>
            </form>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {godowns.map(g=>(
                <div key={g} style={{display:'flex',alignItems:'center',gap:8,background:'#f8fafc',borderRadius:8,padding:'8px 12px'}}>
                  {renamingGodown===g ? (
                    <>
                      <input className="input" style={{marginBottom:0,flex:1}} value={renameValue} onChange={e=>setRenameValue(e.target.value)} autoFocus />
                      <button className="btn btn-green btn-sm" onClick={()=>renameGodown(g)}>✓ Save</button>
                      <button className="btn btn-gray btn-sm" onClick={()=>setRenamingGodown(null)}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{flex:1,fontWeight:600}}>{g}</span>
                      <span style={{fontSize:12,color:'#94a3b8'}}>{inventory.filter(i=>i.godown===g).length} items</span>
                      <button className="btn btn-light btn-sm" onClick={()=>{setRenamingGodown(g);setRenameValue(g);}}>✏️ Rename</button>
                      <button className="btn btn-red btn-sm" onClick={()=>deleteGodown(g)}>🗑</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Stock Form */}
        <div className="card">
          <div className="card-title" style={{cursor:'pointer',justifyContent:'space-between'}} onClick={()=>setShowAddForm(!showAddForm)}>
            <span>➕ Add Stock {newStockType==='opening'?'(Opening Stock)':''}</span>
            <span style={{fontSize:13,color:'#64748b'}}>{showAddForm?'▲ Collapse':'▼ Expand'}</span>
          </div>
          {showAddForm && (
            <form onSubmit={addItem}>
              {/* Stock Type Toggle */}
              <div style={{display:'flex',gap:8,marginBottom:14}}>
                <button type="button" className={`btn btn-sm ${newStockType==='regular'?'btn-blue':'btn-light'}`} onClick={()=>setNewStockType('regular')}>📦 Regular Stock</button>
                <button type="button" className={`btn btn-sm ${newStockType==='opening'?'btn-blue':'btn-light'}`} onClick={()=>setNewStockType('opening')}>🗂 Opening Stock</button>
              </div>

              {/* Row 1: Item, Qty, Unit, Sec Qty, Sec Unit */}
              <div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr',gap:10,marginBottom:10}}>
                <div>
                  <label className="field-label">Item Name *</label>
                  <input className="input" style={{marginBottom:0}} placeholder="Item name" value={newItem} onChange={e=>setNewItem(e.target.value)} required />
                </div>
                <div>
                  <label className="field-label">Quantity *</label>
                  <input className="input" style={{marginBottom:0}} type="number" placeholder="Qty" value={newQty} onChange={e=>setNewQty(e.target.value)} required />
                </div>
                <div>
                  <label className="field-label">Unit</label>
                  <select className="input" style={{marginBottom:0}} value={newUnit} onChange={e=>setNewUnit(e.target.value)}>
                    {UNITS.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Sec. Qty</label>
                  <input className="input" style={{marginBottom:0}} type="number" placeholder="0" value={newSecQty} onChange={e=>setNewSecQty(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Sec. Unit</label>
                  <select className="input" style={{marginBottom:0}} value={newSecUnit} onChange={e=>setNewSecUnit(e.target.value)}>
                    <option value="">None</option>
                    {UNITS.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* Row 2: Godown, Builty, Transporter, Remarks */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 2fr',gap:10,marginBottom:14}}>
                <div>
                  <label className="field-label">Godown *</label>
                  <select className="input" style={{marginBottom:0}} value={newGodown} onChange={e=>setNewGodown(e.target.value)}>
                    {godowns.map(g=><option key={g}>{g}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Builty No.</label>
                  <input className="input" style={{marginBottom:0}} placeholder="Builty number" value={newBuilty} onChange={e=>setNewBuilty(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Transporter</label>
                  <input className="input" style={{marginBottom:0}} placeholder="Transporter name" value={newTransporter} onChange={e=>setNewTransporter(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">Remarks</label>
                  <input className="input" style={{marginBottom:0}} placeholder="Any remarks..." value={newRemarks} onChange={e=>setNewRemarks(e.target.value)} />
                </div>
              </div>

              <div style={{display:'flex',gap:10}}>
                <button className="btn btn-green" type="submit" style={{flex:1,justifyContent:'center'}}>➕ Add Item</button>
                <button className="btn btn-purple" type="button" onClick={exportCSV}>📥 Export CSV</button>
              </div>
            </form>
          )}
        </div>

        {/* View Toggle + Search */}
        <div className="card" style={{padding:'14px 20px'}}>
          <div className="toggle-row">
            <button className={`btn ${viewMode==='all'?'btn-blue':'btn-light'}`} onClick={()=>setViewMode('all')}>All Items</button>
            <button className={`btn ${viewMode==='by-godown'?'btn-blue':'btn-light'}`} onClick={()=>setViewMode('by-godown')}>By Godown</button>
            <div className="search-wrap">
              <span className="search-icon">🔍</span>
              <input className="input" style={{marginBottom:0}} placeholder="Search items..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Godown Grid */}
        {viewMode==='by-godown' && (
          <div className="godown-grid">
            {godownSummary.map(g=>(
              <button key={g.name} className={`godown-btn ${selectedGodown===g.name?'active':''}`} onClick={()=>setSelectedGodown(g.name)}>
                {g.name}<small>{g.items} items · {g.total} units</small>
              </button>
            ))}
          </div>
        )}

        {/* Inventory Table */}
        <div className="card" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'16px 20px',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:700,fontSize:17}}>
              {viewMode==='by-godown'?`${selectedGodown} — Stock`:'All Stock'}
              <span style={{color:'#64748b',fontWeight:400,fontSize:14,marginLeft:8}}>({displayed.length} items)</span>
            </span>
            <span style={{color:'#64748b',fontSize:13}}>{inventory.reduce((s,i)=>s+i.quantity,0)} total units</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th><th>Qty</th><th>Unit</th><th>Sec</th><th>Godown</th><th>Builty</th><th>Transporter</th><th>Remarks</th><th>Date</th><th>Type</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length===0 ? (
                  <tr><td colSpan="11" style={{textAlign:'center',color:'#94a3b8',padding:'32px'}}>No items found</td></tr>
                ) : displayed.map(item=>(
                  <tr key={item.id}>
                    <td style={{fontWeight:600}}>{item.name}</td>
                    <td><span className="badge">{item.quantity}</span></td>
                    <td style={{color:'#475569'}}>{item.unit||'pcs'}</td>
                    <td style={{color:'#94a3b8',fontSize:13}}>{item.secondary_quantity>0?`${item.secondary_quantity} ${item.secondary_unit}`:'-'}</td>
                    <td style={{color:'#475569'}}>{item.godown}</td>
                    <td style={{color:'#64748b',fontSize:12}}>{item.builty_number||'-'}</td>
                    <td style={{color:'#64748b',fontSize:12}}>{item.transporter||'-'}</td>
                    <td style={{color:'#64748b',fontSize:12,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.remarks||'-'}</td>
                    <td style={{color:'#94a3b8',fontSize:12}}>{item.date_added}</td>
                    <td>
                      {item.stock_type==='opening'
                        ? <span style={{background:'#fef3c7',color:'#92400e',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>Opening</span>
                        : <span style={{background:'#dcfce7',color:'#166534',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:600}}>Regular</span>}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-orange btn-sm" onClick={()=>issueItem(item.id)}>📤 Issue</button>
                        <button className="btn btn-red btn-sm" onClick={()=>deleteItem(item.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="footer">
          Total items: <strong>{inventory.length}</strong> &nbsp;|&nbsp; Total units: <strong>{inventory.reduce((s,i)=>s+i.quantity,0)}</strong>
        </div>
      </div>
    </div>
  );
};

export default InventoryApp;
