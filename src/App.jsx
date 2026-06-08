import React, { useState, useEffect, useCallback } from 'react';

const API = '/api';

const InventoryApp = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [authError, setAuthError] = useState('');

  const [inventory, setInventory] = useState([]);
  const [godowns, setGodowns] = useState([]);
  const [newItem, setNewItem] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newGodown, setNewGodown] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('all');
  const [selectedGodown, setSelectedGodown] = useState('');
  const [editingGodowns, setEditingGodowns] = useState(false);
  const [newGodownName, setNewGodownName] = useState('');

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMode, setUploadMode] = useState('pdf');
  const [extractedData, setExtractedData] = useState([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState('');

  const authHeaders = useCallback(() => ({
    'Content-Type': 'application/json',
    'Authorization': token
  }), [token]);

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
    if (data.length > 0) { setNewGodown(data[0]); setSelectedGodown(data[0]); }
  }, [token]);

  useEffect(() => {
    const savedToken = localStorage.getItem('inv_token');
    const savedUser = localStorage.getItem('inv_user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setCurrentUser(savedUser);
      loadInventory(savedToken);
      loadGodowns(savedToken);
    }
  }, [loadInventory, loadGodowns]);

  const loadPdfJs = async () => {
    if (!window.pdfjsLib) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = () => {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve();
        };
        document.head.appendChild(script);
      });
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setAuthError('');
    const res = await fetch(`${API}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error); return; }
    alert('Account created! Now sign in.');
    setIsLogin(true); setEmail(''); setPassword('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error); return; }
    setToken(data.token); setCurrentUser(data.email);
    localStorage.setItem('inv_token', data.token);
    localStorage.setItem('inv_user', data.email);
    await loadInventory(data.token);
    await loadGodowns(data.token);
    setEmail(''); setPassword('');
  };

  const handleLogout = async () => {
    await fetch(`${API}/logout`, { method: 'POST', headers: authHeaders() });
    localStorage.removeItem('inv_token'); localStorage.removeItem('inv_user');
    setCurrentUser(null); setToken(null); setInventory([]); setGodowns([]);
  };

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
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token },
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setExtractedData(data.items.map((item, idx) => ({
        ...item, id: `temp_${idx}`, godown: '',
        stockEntryDate: new Date().toISOString().split('T')[0],
        quantity: parseInt(item.quantity) || 1
      })));
    } catch (err) {
      setExtractionError('Failed: ' + err.message);
    } finally {
      setIsExtracting(false);
    }
  };

  const updateExtracted = (id, field, value) =>
    setExtractedData(extractedData.map(i => i.id === id ? { ...i, [field]: value } : i));

  const addExtractedItems = async () => {
    const missing = extractedData.filter(i => !i.godown);
    if (missing.length) { alert(`Select godown for all items (${missing.length} missing)`); return; }
    await fetch(`${API}/inventory/bulk`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ items: extractedData.map(i => ({
        name: i.name, quantity: i.quantity, godown: i.godown,
        dateAdded: i.stockEntryDate, price: i.price || 0, hsn: i.hsn || 'N/A'
      }))})
    });
    await loadInventory();
    setExtractedData([]); setUploadFile(null); setShowUpload(false);
    alert(`Added ${extractedData.length} items!`);
  };

  const addItem = async (e) => {
    e.preventDefault();
    if (!newItem || !newQuantity || !newGodown) return;
    await fetch(`${API}/inventory`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: newItem, quantity: parseInt(newQuantity), godown: newGodown, dateAdded: new Date().toLocaleDateString() })
    });
    await loadInventory();
    setNewItem(''); setNewQuantity('');
  };

  const issueItem = async (id) => {
    const qty = parseInt(window.prompt('How many to issue?', '1'));
    if (!qty || qty <= 0) return;
    const res = await fetch(`${API}/inventory/${id}/issue`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify({ quantity: qty })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    await loadInventory();
  };

  const deleteItem = async (id) => {
    if (!window.confirm('Delete this item?')) return;
    await fetch(`${API}/inventory/${id}`, { method: 'DELETE', headers: authHeaders() });
    await loadInventory();
  };

  const addGodown = async (e) => {
    e.preventDefault();
    if (!newGodownName) return;
    const res = await fetch(`${API}/godowns`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ name: newGodownName })
    });
    if (res.ok) { await loadGodowns(); setNewGodownName(''); }
  };

  const exportCSV = () => {
    const csv = [
      ['Item','Quantity','Godown','Date Added','Added By'],
      ...inventory.map(i => [i.name, i.quantity, i.godown, i.date_added, i.added_by])
    ].map(r => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const filtered = inventory.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const displayed = viewMode === 'by-godown' ? filtered.filter(i => i.godown === selectedGodown) : filtered;
  const godownSummary = godowns.map(g => ({
    name: g,
    items: inventory.filter(i => i.godown === g).length,
    total: inventory.filter(i => i.godown === g).reduce((s, i) => s + i.quantity, 0)
  }));

  // LOGIN SCREEN
  if (!currentUser) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>📦 Inventory Hub</h1>
          <p>Stock Management System</p>
          <form onSubmit={isLogin ? handleLogin : handleSignUp}>
            <input className="input" type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} required />
            <input className="input" type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required />
            {authError && <div className="alert-error">{authError}</div>}
            <button className="btn btn-blue" style={{width:'100%', justifyContent:'center', padding:'11px', fontSize:'15px', marginBottom:'12px'}} type="submit">
              {isLogin ? '🔐 Sign In' : '✅ Create Account'}
            </button>
          </form>
          <button onClick={() => { setIsLogin(!isLogin); setAuthError(''); }}
            style={{width:'100%', background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontSize:'14px'}}>
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    );
  }

  // MAIN APP
  return (
    <div>
      {/* Header */}
      <div className="header">
        <div>
          <h1>📦 Inventory Hub</h1>
          <p>👤 {currentUser}</p>
        </div>
        <div className="header-btns">
          <button className="btn btn-green" onClick={() => setShowUpload(!showUpload)}>📤 Upload Bill</button>
          <button className="btn btn-light" onClick={() => setEditingGodowns(!editingGodowns)}>🏭 Godowns</button>
          <button className="btn btn-red" onClick={handleLogout}>🚪 Sign Out</button>
        </div>
      </div>

      <div className="main">

        {/* Upload / Camera section */}
        {showUpload && (
          <div className="card" style={{border: '2px solid #16a34a'}}>
            <div className="card-title">📤 Upload Invoice / Bill</div>
            {!extractedData.length ? (
              <>
                <div className="mode-tabs">
                  <button className={`mode-tab ${uploadMode==='pdf'?'active':''}`} onClick={() => { setUploadMode('pdf'); setUploadFile(null); }}>📄 PDF File</button>
                  <button className={`mode-tab ${uploadMode==='camera'?'active':''}`} onClick={() => { setUploadMode('camera'); setUploadFile(null); }}>📷 Camera / Photo</button>
                </div>
                <label className="upload-box">
                  <div className="upload-icon">{uploadMode==='camera' ? '📷' : '📄'}</div>
                  <div style={{fontWeight:600, marginBottom:4}}>
                    {uploadMode==='camera' ? 'Tap to open Camera' : 'Tap to select PDF'}
                  </div>
                  <div style={{color:'#64748b', fontSize:13}}>
                    {uploadMode==='camera' ? 'Take a photo of the bill' : 'Supplier invoice PDF'}
                  </div>
                  {uploadFile && <div style={{color:'#16a34a', marginTop:8, fontWeight:600}}>✓ {uploadFile.name}</div>}
                  <input type="file"
                    accept={uploadMode==='camera' ? 'image/*' : '.pdf'}
                    capture={uploadMode==='camera' ? 'environment' : undefined}
                    style={{display:'none'}}
                    onChange={e => setUploadFile(e.target.files[0])} />
                </label>
                {extractionError && <div className="alert-error" style={{marginTop:10}}>{extractionError}</div>}
                <button className="btn btn-green" disabled={!uploadFile || isExtracting}
                  style={{width:'100%', justifyContent:'center', marginTop:12, padding:'11px'}}
                  onClick={handleExtract}>
                  {isExtracting ? '🔄 Extracting with AI...' : '✨ Extract Items with AI'}
                </button>
              </>
            ) : (
              <>
                <div style={{fontWeight:700, marginBottom:12}}>Extracted Items ({extractedData.length})</div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Item</th><th>Qty</th><th>Godown</th><th>Date</th></tr></thead>
                    <tbody>
                      {extractedData.map(item => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td><input type="number" value={item.quantity} style={{width:70, padding:'4px 8px', border:'1px solid #cbd5e1', borderRadius:6}}
                            onChange={e => updateExtracted(item.id, 'quantity', parseInt(e.target.value))} /></td>
                          <td>
                            <select value={item.godown} style={{padding:'4px 8px', border:'1px solid #cbd5e1', borderRadius:6}}
                              onChange={e => updateExtracted(item.id, 'godown', e.target.value)}>
                              <option value="">Select</option>
                              {godowns.map(g => <option key={g}>{g}</option>)}
                            </select>
                          </td>
                          <td><input type="date" value={item.stockEntryDate} style={{padding:'4px 8px', border:'1px solid #cbd5e1', borderRadius:6}}
                            onChange={e => updateExtracted(item.id, 'stockEntryDate', e.target.value)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{display:'flex', gap:10, marginTop:14}}>
                  <button className="btn btn-green" style={{flex:1, justifyContent:'center'}} onClick={addExtractedItems}>✅ Add All to Inventory</button>
                  <button className="btn btn-gray" style={{flex:1, justifyContent:'center'}} onClick={() => { setExtractedData([]); setUploadFile(null); }}>✕ Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Godown Management */}
        {editingGodowns && (
          <div className="card">
            <div className="card-title">🏭 Manage Godowns</div>
            <form onSubmit={addGodown} style={{display:'flex', gap:10, marginBottom:14}}>
              <input className="input" style={{marginBottom:0, flex:1}} placeholder="New godown name" value={newGodownName} onChange={e => setNewGodownName(e.target.value)} />
              <button className="btn btn-green" type="submit">Add</button>
            </form>
            <div>{godowns.map(g => <span key={g} className="tag">{g}</span>)}</div>
          </div>
        )}

        {/* Add Item Form */}
        <div className="card">
          <div className="card-title">➕ Add Stock Manually</div>
          <form onSubmit={addItem} className="add-form">
            <input className="input" style={{marginBottom:0}} placeholder="Item name" value={newItem} onChange={e => setNewItem(e.target.value)} />
            <input className="input" style={{marginBottom:0}} type="number" placeholder="Quantity" value={newQuantity} onChange={e => setNewQuantity(e.target.value)} />
            <select className="input" style={{marginBottom:0}} value={newGodown} onChange={e => setNewGodown(e.target.value)}>
              {godowns.map(g => <option key={g}>{g}</option>)}
            </select>
            <button className="btn btn-green" type="submit">Add Item</button>
            <button className="btn btn-purple" type="button" onClick={exportCSV}>Export CSV</button>
          </form>
        </div>

        {/* View Toggle */}
        <div className="card" style={{padding:'14px 20px'}}>
          <div className="toggle-row">
            <button className={`btn ${viewMode==='all'?'btn-blue':'btn-light'}`} onClick={() => setViewMode('all')}>All Items</button>
            <button className={`btn ${viewMode==='by-godown'?'btn-blue':'btn-light'}`} onClick={() => setViewMode('by-godown')}>By Godown</button>
            <div className="search-wrap">
              <span className="search-icon">🔍</span>
              <input className="input" style={{marginBottom:0}} placeholder="Search items..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Godown Grid */}
        {viewMode === 'by-godown' && (
          <div className="godown-grid">
            {godownSummary.map(g => (
              <button key={g.name} className={`godown-btn ${selectedGodown===g.name?'active':''}`} onClick={() => setSelectedGodown(g.name)}>
                {g.name}
                <small>{g.items} items · {g.total} units</small>
              </button>
            ))}
          </div>
        )}

        {/* Inventory Table */}
        <div className="card" style={{padding:0, overflow:'hidden'}}>
          <div style={{padding:'16px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <span style={{fontWeight:700, fontSize:17}}>
              {viewMode==='by-godown' ? `${selectedGodown} — Stock` : 'All Stock'}
              <span style={{color:'#64748b', fontWeight:400, fontSize:14, marginLeft:8}}>({displayed.length} items)</span>
            </span>
            <span style={{color:'#64748b', fontSize:13}}>{inventory.reduce((s,i)=>s+i.quantity,0)} total units</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Godown</th><th>Date</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {displayed.length === 0 ? (
                  <tr><td colSpan="5" style={{textAlign:'center', color:'#94a3b8', padding:'32px'}}>No items found</td></tr>
                ) : displayed.map(item => (
                  <tr key={item.id}>
                    <td style={{fontWeight:600}}>{item.name}</td>
                    <td><span className="badge">{item.quantity}</span></td>
                    <td style={{color:'#475569'}}>{item.godown}</td>
                    <td style={{color:'#94a3b8', fontSize:13}}>{item.date_added}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-orange btn-sm" onClick={() => issueItem(item.id)}>📤 Issue</button>
                        <button className="btn btn-red btn-sm" onClick={() => deleteItem(item.id)}>🗑</button>
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
