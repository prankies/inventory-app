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
  const [newCategory, setNewCategory] = useState('');
  const [showAddForm, setShowAddForm] = useState(true);

  // Autocomplete
  const [itemSuggestions, setItemSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [categories, setCategories] = useState([]);
  const [filterCategory, setFilterCategory] = useState('');

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

  // Master item list
  const [showMasterImport, setShowMasterImport] = useState(false);
  const [masterImportStatus, setMasterImportStatus] = useState('');

  // Issue Slip
  const [showIssueSlip, setShowIssueSlip] = useState(false);
  const [slipItems, setSlipItems] = useState([]);
  const [slipSearch, setSlipSearch] = useState('');
  const [slipIssuedTo, setSlipIssuedTo] = useState('');
  const [slipRemarks, setSlipRemarks] = useState('');
  const [issueSuccess, setIssueSuccess] = useState('');
  const [recentSlips, setRecentSlips] = useState([]);
  const [showRecentSlips, setShowRecentSlips] = useState(false);

  // Stock Ledger
  const [showLedger, setShowLedger] = useState(false);
  const [ledgerRows, setLedgerRows] = useState([]);
  const [ledgerFilter, setLedgerFilter] = useState({ name: '', godown: '', type: '', from_date: '', to_date: '' });
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Transfer Stock
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferSearch, setTransferSearch] = useState('');
  const [transferItem, setTransferItem] = useState(null);
  const [transferFromGodown, setTransferFromGodown] = useState('');
  const [transferToGodown, setTransferToGodown] = useState('');
  const [transferQty, setTransferQty] = useState('');
  const [transferRemarks, setTransferRemarks] = useState('');
  const [transferError, setTransferError] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');

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

  const loadCategories = useCallback(async (tok) => {
    const t = tok || token;
    const res = await fetch(`${API}/categories`, { headers: { Authorization: t } });
    const data = await res.json();
    setCategories(Array.isArray(data) ? data : []);
  }, [token]);

  const loadLedger = useCallback(async (filters) => {
    setLedgerLoading(true);
    const f = filters || ledgerFilter;
    const params = new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([,v]) => v)));
    const res = await fetch(`${API}/ledger?${params}`, { headers: { Authorization: token } });
    const data = await res.json();
    setLedgerRows(Array.isArray(data) ? data : []);
    setLedgerLoading(false);
  }, [token, ledgerFilter]);

  const fetchSuggestions = async (q) => {
    if (!q || q.length < 1) { setItemSuggestions([]); return; }
    const res = await fetch(`${API}/suggestions?q=${encodeURIComponent(q)}`, { headers: { Authorization: token } });
    const data = await res.json();
    setItemSuggestions(Array.isArray(data) ? data : []);
    setShowSuggestions(true);
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('inv_token');
    const savedUser = localStorage.getItem('inv_user');
    if (savedToken && savedUser) {
      setToken(savedToken); setCurrentUser(savedUser);
      loadInventory(savedToken); loadGodowns(savedToken); loadCategories(savedToken);
    }
  }, [loadInventory, loadGodowns, loadCategories]);

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

  const handleMasterImport = (file) => {
    setMasterImportStatus('Reading file...');
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target.result;
      const lines = text.split('\n');
      // Skip header rows — find the row with "Name" as first column
      let startIdx = 0;
      for (let i = 0; i < Math.min(10, lines.length); i++) {
        if (lines[i].toLowerCase().includes('name') && lines[i].toLowerCase().includes('unit')) {
          startIdx = i + 1; break;
        }
      }
      const items = [];
      for (let i = startIdx; i < lines.length; i++) {
        const row = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, '').trim());
        const name = row[0];
        if (!name || name.length < 2) continue;
        const alias = row[1] || '';
        const category = row[2] || '';
        const unit = (row[4] || 'Pcs').replace(/\.$/, ''); // strip trailing dot
        items.push({ name, alias, category, unit });
      }
      setMasterImportStatus(`⏳ Uploading ${items.length} items to database...`);
      try {
        const res = await fetch('/api/master-items/import', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ items })
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { throw new Error('Server error: ' + text.substring(0,100)); }
        if (res.ok) {
          setMasterImportStatus(`✅ ${data.message} — autocomplete is ready!`);
          await loadCategories();
        } else {
          setMasterImportStatus(`❌ Error: ${data.error || 'Unknown error'}`);
        }
      } catch (err) {
        setMasterImportStatus(`❌ Failed: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setAuthError('');
    const res = await fetch(`${API}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
    const data = await res.json();
    if (!res.ok) { setAuthError(data.error); return; }
    setToken(data.token); setCurrentUser(data.email);
    localStorage.setItem('inv_token', data.token); localStorage.setItem('inv_user', data.email);
    await loadInventory(data.token); await loadGodowns(data.token); await loadCategories(data.token);
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
      body: JSON.stringify({ name:newItem, quantity:parseFloat(newQty), unit:newUnit, secondary_quantity:parseFloat(newSecQty)||0, secondary_unit:newSecUnit, godown:newGodown, dateAdded:new Date().toLocaleDateString(), builty_number:newBuilty, transporter:newTransporter, remarks:newRemarks, stock_type:newStockType, category:newCategory })
    });
    await loadInventory(); await loadCategories();
    setNewItem(''); setNewQty(''); setNewSecQty(''); setNewBuilty(''); setNewTransporter(''); setNewRemarks(''); setNewCategory('');
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
    const res = await fetch(`${API}/issue-slips`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        items: slipItems.map(s => ({ id: s.id, name: s.name, quantity: parseFloat(s.issueQty) })),
        issued_to: slipIssuedTo, remarks: slipRemarks
      })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    await loadInventory(); await loadRecentSlips();
    setIssueSuccess(`✅ ${data.message}`);
    setTimeout(() => setIssueSuccess(''), 4000);
    setSlipItems([]); setSlipIssuedTo(''); setSlipRemarks('');
  };

  const loadRecentSlips = useCallback(async () => {
    const res = await fetch(`${API}/issue-slips`, { headers: { Authorization: token } });
    const data = await res.json();
    setRecentSlips(Array.isArray(data) ? data : []);
  }, [token]);

  const cancelSlip = async (id) => {
    if (!window.confirm(`Cancel Slip #${id}? All its quantities will be added back to stock.`)) return;
    const res = await fetch(`${API}/issue-slips/${id}`, { method: 'DELETE', headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    await loadInventory(); await loadRecentSlips();
    setIssueSuccess(`✅ ${data.message}`);
    setTimeout(() => setIssueSuccess(''), 4000);
  };

  // Transfer Stock helpers
  const transferSuggestions = transferSearch.length > 0 && !transferItem
    ? Array.from(new Map(inventory.filter(i => i.quantity > 0 && i.name.toLowerCase().includes(transferSearch.toLowerCase())).map(i => [i.name, i])).values()).slice(0, 8)
    : [];

  const transferSourceGodowns = transferItem
    ? inventory.filter(i => i.name === transferItem.name && i.quantity > 0)
    : [];

  const pickTransferItem = (item) => {
    setTransferItem(item);
    setTransferSearch(item.name);
    setTransferFromGodown(item.godown);
    setTransferToGodown('');
    setTransferQty('');
    setTransferError('');
  };

  const transferAvailableQty = transferItem
    ? (inventory.find(i => i.name === transferItem.name && i.godown === transferFromGodown)?.quantity || 0)
    : 0;

  const submitTransfer = async () => {
    setTransferError('');
    const qty = parseFloat(transferQty);
    if (!transferItem || !transferFromGodown || !transferToGodown) { setTransferError('Select item, source and destination godown.'); return; }
    if (transferFromGodown === transferToGodown) { setTransferError('Source and destination godown must be different.'); return; }
    if (!qty || qty <= 0) { setTransferError('Enter a valid quantity.'); return; }
    if (qty > transferAvailableQty) { setTransferError(`Only ${transferAvailableQty} available in ${transferFromGodown}.`); return; }

    const res = await fetch(`${API}/inventory/transfer`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ name: transferItem.name, fromGodown: transferFromGodown, toGodown: transferToGodown, quantity: qty, remarks: transferRemarks })
    });
    const data = await res.json();
    if (!res.ok) { setTransferError(data.error); return; }
    await loadInventory();
    setTransferSuccess(`✅ ${data.message}`);
    setTimeout(() => setTransferSuccess(''), 4000);
    setTransferItem(null); setTransferSearch(''); setTransferFromGodown(''); setTransferToGodown(''); setTransferQty(''); setTransferRemarks('');
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

  const printStock = () => {
    const isGodownView = viewMode === 'by-godown';
    const rows = isGodownView ? inventory.filter(i => i.godown === selectedGodown) : inventory;
    const sorted = [...rows].sort((a, b) => a.godown.localeCompare(b.godown) || a.name.localeCompare(b.name));
    const title = isGodownView ? `Stock Report — ${selectedGodown}` : 'Stock Report — All Godowns';
    const totalQty = sorted.reduce((s, i) => s + i.quantity, 0);
    const html = `<!DOCTYPE html><html><head><title>${title}</title><style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
      .rpt-head { text-align: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 16px; }
      .rpt-head h1 { margin: 0; font-size: 20px; }
      .rpt-head h2 { margin: 4px 0 0; font-size: 15px; font-weight: normal; }
      .rpt-meta { display: flex; justify-content: space-between; font-size: 12px; color: #444; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
      th { background: #eee; }
      td.num, th.num { text-align: right; }
      tfoot td { font-weight: bold; background: #f5f5f5; }
      .sign { margin-top: 48px; display: flex; justify-content: space-between; font-size: 12px; }
      .sign div { border-top: 1px solid #333; padding-top: 4px; width: 180px; text-align: center; }
      @media print { body { margin: 10mm; } }
    </style></head><body>
      <div class="rpt-head">
        <h1>Goyal Printing &amp; Converting Industries</h1>
        <h2>${title}</h2>
      </div>
      <div class="rpt-meta">
        <span>Date: ${new Date().toLocaleDateString()} &nbsp; Time: ${new Date().toLocaleTimeString()}</span>
        <span>Printed by: ${currentUser}</span>
      </div>
      <table>
        <thead><tr>
          <th>#</th><th>Item</th><th>Category</th>${isGodownView ? '' : '<th>Godown</th>'}
          <th class="num">Qty</th><th>Unit</th><th class="num">Sec. Qty</th><th>Sec. Unit</th><th>Remarks</th>
        </tr></thead>
        <tbody>
          ${sorted.map((i, idx) => `<tr>
            <td>${idx + 1}</td><td>${i.name}</td><td>${i.category || '-'}</td>${isGodownView ? '' : `<td>${i.godown}</td>`}
            <td class="num">${i.quantity}</td><td>${i.unit || 'pcs'}</td>
            <td class="num">${i.secondary_quantity > 0 ? i.secondary_quantity : '-'}</td><td>${i.secondary_unit || '-'}</td>
            <td>${i.remarks || '-'}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="${isGodownView ? 3 : 4}">Total: ${sorted.length} items</td>
          <td class="num">${totalQty}</td><td colspan="4"></td>
        </tr></tfoot>
      </table>
      <div class="sign"><div>Prepared By</div><div>Checked By</div><div>Authorised Signatory</div></div>
      <script>window.onload = () => { window.print(); }</script>
    </body></html>`;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
  };

  const filtered = inventory.filter(i =>
    i.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (filterCategory === '' || i.category === filterCategory)
  );
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
          <button className="btn" style={{background:'#6d28d9',color:'white'}} onClick={()=>setShowMasterImport(!showMasterImport)}>📚 Item Master</button>
          <button className="btn btn-orange" onClick={()=>setShowIssueSlip(!showIssueSlip)}>📋 Issue Slip</button>
          <button className="btn" style={{background:'#0d9488',color:'white'}} onClick={()=>setShowTransfer(!showTransfer)}>🔄 Transfer</button>
          <button className="btn btn-green" onClick={()=>setShowUpload(!showUpload)}>📤 Upload Bill</button>
          <button className="btn" style={{background:'#0891b2',color:'white'}} onClick={()=>setShowImport(!showImport)}>📊 Import CSV/XLS</button>
          <button className="btn" style={{background:'#b45309',color:'white'}} onClick={()=>{ setShowLedger(!showLedger); if(!showLedger) loadLedger(); }}>📒 Ledger</button>
          <button className="btn btn-light" onClick={()=>setEditingGodowns(!editingGodowns)}>🏭 Godowns</button>
          <button className="btn btn-red" onClick={handleLogout}>🚪 Sign Out</button>
        </div>
      </div>

      <div className="main">

        {/* Master Item List Import */}
        {showMasterImport && (
          <div className="card" style={{border:'2px solid #6d28d9'}}>
            <div className="card-title">📚 Item Master List</div>
            <p style={{fontSize:13,color:'#64748b',marginBottom:14}}>
              Upload your master item list CSV (Tally/Excel export). All item names will be available in autocomplete when adding stock. Expected columns: <strong>Name, Alias, Parent Group, Op. Stock, Unit</strong>
            </p>
            <label className="upload-box" style={{borderColor:'#a78bfa'}}>
              <div className="upload-icon">📚</div>
              <div style={{fontWeight:600,marginBottom:4}}>Tap to select your Item Master CSV</div>
              <div style={{color:'#64748b',fontSize:13}}>Your DMPM_ListofItems.csv or any similar export</div>
              <input type="file" accept=".csv,.txt" style={{display:'none'}}
                onChange={e=>{ if(e.target.files[0]) handleMasterImport(e.target.files[0]); }} />
            </label>
            {masterImportStatus && (
              <div style={{marginTop:12,padding:'10px 16px',borderRadius:8,
                background: masterImportStatus.startsWith('✅') ? '#f0fdf4' : masterImportStatus.startsWith('❌') ? '#fef2f2' : '#f8fafc',
                border: `1px solid ${masterImportStatus.startsWith('✅') ? '#86efac' : masterImportStatus.startsWith('❌') ? '#fecaca' : '#e2e8f0'}`,
                color: masterImportStatus.startsWith('✅') ? '#166534' : masterImportStatus.startsWith('❌') ? '#dc2626' : '#475569',
                fontWeight:600,fontSize:14}}>
                {masterImportStatus}
              </div>
            )}
          </div>
        )}

        {/* Issue Slip */}
        {showIssueSlip && (
          <div className="card" style={{border:'2px solid #ea580c'}}>
            <div className="card-title">📋 Issue Slip — Bulk Issue</div>

            {issueSuccess && <div style={{background:'#dcfce7',border:'1px solid #86efac',color:'#166534',borderRadius:8,padding:'10px 16px',marginBottom:14,fontWeight:600}}>{issueSuccess}</div>}

            {/* Issued To + Remarks */}
            <div className='form-row-2'>
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

            {/* Recent slips — view & cancel */}
            <div style={{marginTop:16,borderTop:'1px solid #f1f5f9',paddingTop:12}}>
              <button className="btn btn-light btn-sm" onClick={async()=>{ if(!showRecentSlips) await loadRecentSlips(); setShowRecentSlips(!showRecentSlips); }}>
                {showRecentSlips ? '▲ Hide Recent Slips' : '▼ Show Recent Slips (view / cancel)'}
              </button>
              {showRecentSlips && (
                recentSlips.length === 0 ? (
                  <div style={{padding:'14px',color:'#94a3b8',fontSize:13}}>No slips yet.</div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10}}>
                    {recentSlips.map(slip => (
                      <div key={slip.id} style={{background: slip.status==='cancelled' ? '#fef2f2' : '#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 14px'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:6}}>
                          <div>
                            <span style={{fontWeight:700}}>Slip #{slip.id}</span>
                            <span style={{color:'#64748b',fontSize:12,marginLeft:8}}>{slip.issue_date} · by {slip.issued_by}{slip.issued_to ? ` → ${slip.issued_to}` : ''}</span>
                            {slip.status==='cancelled' && <span style={{background:'#fee2e2',color:'#991b1b',padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700,marginLeft:8}}>CANCELLED</span>}
                          </div>
                          {slip.status!=='cancelled' && (
                            <button className="btn btn-red btn-sm" onClick={()=>cancelSlip(slip.id)}>↩ Cancel & Restore</button>
                          )}
                        </div>
                        <div style={{fontSize:12,color:'#475569',marginTop:6}}>
                          {slip.items.map(it => `${it.name} (${it.quantity} ${it.unit}, ${it.godown})`).join(' · ')}
                        </div>
                        {slip.remarks && <div style={{fontSize:12,color:'#94a3b8',marginTop:2}}>Remarks: {slip.remarks}</div>}
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* Transfer Stock */}
        {showTransfer && (
          <div className="card" style={{border:'2px solid #0d9488'}}>
            <div className="card-title">🔄 Transfer Stock Between Godowns</div>

            {transferSuccess && <div style={{background:'#dcfce7',border:'1px solid #86efac',color:'#166534',borderRadius:8,padding:'10px 16px',marginBottom:14,fontWeight:600}}>{transferSuccess}</div>}
            {transferError && <div className="alert-error">{transferError}</div>}

            {/* Item search */}
            <div style={{position:'relative',marginBottom:14}}>
              <label className="field-label">Item to Transfer</label>
              <input
                className="input" style={{marginBottom:0}}
                placeholder="Type item name to search..."
                value={transferSearch}
                onChange={e=>{ setTransferSearch(e.target.value); setTransferItem(null); }}
              />
              {transferSuggestions.length > 0 && (
                <div style={{position:'absolute',zIndex:100,left:0,right:0,background:'white',border:'1px solid #cbd5e1',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,0.12)',marginTop:4,maxHeight:260,overflowY:'auto'}}>
                  {transferSuggestions.map(item => (
                    <div key={item.id}
                      onClick={()=>pickTransferItem(item)}
                      style={{padding:'10px 16px',cursor:'pointer',borderBottom:'1px solid #f1f5f9'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                      onMouseLeave={e=>e.currentTarget.style.background='white'}
                    >
                      <div style={{fontWeight:600}}>{item.name}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {transferItem && (
              <>
                <div className="form-row-2">
                  <div>
                    <label className="field-label">From Godown</label>
                    <select className="input" style={{marginBottom:0}} value={transferFromGodown} onChange={e=>{setTransferFromGodown(e.target.value); setTransferQty('');}}>
                      {transferSourceGodowns.map(i => <option key={i.godown} value={i.godown}>{i.godown} ({i.quantity} {i.unit||'pcs'} avail.)</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">To Godown</label>
                    <select className="input" style={{marginBottom:0}} value={transferToGodown} onChange={e=>setTransferToGodown(e.target.value)}>
                      <option value="">Select Godown</option>
                      {godowns.filter(g => g !== transferFromGodown).map(g => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-row-2">
                  <div>
                    <label className="field-label">Quantity (max {transferAvailableQty})</label>
                    <input className="input" style={{marginBottom:0}} type="number" min="0.01" max={transferAvailableQty} step="any" placeholder="Qty to move" value={transferQty} onChange={e=>setTransferQty(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label">Remarks (optional)</label>
                    <input className="input" style={{marginBottom:0}} placeholder="e.g. Production need" value={transferRemarks} onChange={e=>setTransferRemarks(e.target.value)} />
                  </div>
                </div>
                <button className="btn" style={{background:'#0d9488',color:'white',width:'100%',justifyContent:'center',padding:'11px',fontSize:'15px'}} onClick={submitTransfer}>
                  🔄 Transfer Stock
                </button>
              </>
            )}
          </div>
        )}

        {/* Stock Ledger */}
        {showLedger && (
          <div className="card" style={{border:'2px solid #b45309'}}>
            <div className="card-title" style={{justifyContent:'space-between'}}>
              <span>📒 Stock Ledger — IN / OUT Statement</span>
              <button className="btn btn-green btn-sm" onClick={()=>{ const csv=[['Date','Item','Godown','Movement','Qty','Unit','Balance','Reference','Remarks','By'],...ledgerRows.map(r=>[r.action_date,r.name,r.godown,r.movement_type,r.quantity,r.unit,r.running_balance,r.reference,r.remarks,r.action_by])].map(r=>r.map(v=>`"${v||''}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download=`ledger_${new Date().toISOString().split('T')[0]}.csv`;a.click();}}>📥 Export CSV</button>
            </div>

            {/* Filters */}
            <div className="form-row-5a" style={{marginBottom:14}}>
              <div>
                <label className="field-label">Item Name</label>
                <input className="input" style={{marginBottom:0}} placeholder="Search item..." value={ledgerFilter.name}
                  list="ledger-item-list" autoComplete="off"
                  onChange={e=>setLedgerFilter(f=>({...f,name:e.target.value}))} />
                <datalist id="ledger-item-list">
                  {[...new Set(inventory.map(i=>i.name))].sort().map(n=><option key={n} value={n}/>)}
                </datalist>
              </div>
              <div>
                <label className="field-label">Godown</label>
                <select className="input" style={{marginBottom:0}} value={ledgerFilter.godown} onChange={e=>setLedgerFilter(f=>({...f,godown:e.target.value}))}>
                  <option value="">All</option>
                  {godowns.map(g=><option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Movement</label>
                <select className="input" style={{marginBottom:0}} value={ledgerFilter.type} onChange={e=>setLedgerFilter(f=>({...f,type:e.target.value}))}>
                  <option value="">All</option>
                  <option value="IN">IN (Regular)</option>
                  <option value="OPENING">IN (Opening)</option>
                  <option value="OUT">OUT (Issue)</option>
                  <option value="TRANSFER-IN">Transfer IN</option>
                  <option value="TRANSFER-OUT">Transfer OUT</option>
                </select>
              </div>
              <div>
                <label className="field-label">From Date</label>
                <input type="date" className="input" style={{marginBottom:0}} value={ledgerFilter.from_date} onChange={e=>setLedgerFilter(f=>({...f,from_date:e.target.value}))} />
              </div>
              <div>
                <label className="field-label">To Date</label>
                <input type="date" className="input" style={{marginBottom:0}} value={ledgerFilter.to_date} onChange={e=>setLedgerFilter(f=>({...f,to_date:e.target.value}))} />
              </div>
            </div>
            <button className="btn btn-blue" style={{marginBottom:14}} onClick={()=>loadLedger()}>🔍 Apply Filters</button>

            {ledgerLoading ? (
              <div style={{textAlign:'center',padding:24,color:'#64748b'}}>Loading...</div>
            ) : ledgerRows.length === 0 ? (
              <div style={{textAlign:'center',padding:24,color:'#94a3b8',background:'#f8fafc',borderRadius:8,border:'1.5px dashed #cbd5e1'}}>
                No ledger entries yet. Stock movements (add / issue / transfer) will appear here automatically.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th><th>Item</th><th>Godown</th><th>Movement</th>
                      <th style={{textAlign:'right'}}>Qty</th><th>Unit</th>
                      <th style={{textAlign:'right'}}>Balance</th>
                      <th>Reference</th><th>Remarks</th><th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map(row => {
                      const isIn = ['IN','OPENING','TRANSFER-IN'].includes(row.movement_type);
                      const typeColors = {
                        'IN':          {bg:'#dcfce7',color:'#166534'},
                        'OPENING':     {bg:'#fef3c7',color:'#92400e'},
                        'OUT':         {bg:'#fee2e2',color:'#991b1b'},
                        'TRANSFER-IN': {bg:'#dbeafe',color:'#1e40af'},
                        'TRANSFER-OUT':{bg:'#ede9fe',color:'#5b21b6'},
                      };
                      const tc = typeColors[row.movement_type] || {bg:'#f1f5f9',color:'#475569'};
                      return (
                        <tr key={row.id}>
                          <td style={{color:'#94a3b8',fontSize:12,whiteSpace:'nowrap'}}>{row.action_date}</td>
                          <td style={{fontWeight:600}}>{row.name}</td>
                          <td style={{color:'#475569'}}>{row.godown}</td>
                          <td><span style={{background:tc.bg,color:tc.color,padding:'2px 8px',borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>{row.movement_type}</span></td>
                          <td style={{textAlign:'right',fontWeight:600,color: isIn ? '#16a34a' : '#dc2626'}}>{isIn ? '+' : '-'}{row.quantity}</td>
                          <td style={{color:'#64748b',fontSize:12}}>{row.unit}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{parseFloat(row.running_balance).toFixed(2)}</td>
                          <td style={{color:'#64748b',fontSize:12}}>{row.reference || '-'}</td>
                          <td style={{color:'#64748b',fontSize:12,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{row.remarks || '-'}</td>
                          <td style={{color:'#94a3b8',fontSize:11}}>{row.action_by}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
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
              <div className='form-row-5a'>
                <div style={{position:'relative'}}>
                  <label className="field-label">Item Name *</label>
                  <input className="input" style={{marginBottom:0}} placeholder="Item name" value={newItem}
                    onChange={e=>{ setNewItem(e.target.value); fetchSuggestions(e.target.value); }}
                    onBlur={()=>setTimeout(()=>setShowSuggestions(false),180)}
                    onFocus={()=>newItem && fetchSuggestions(newItem)}
                    autoComplete="off" required />
                  {showSuggestions && itemSuggestions.length > 0 && (
                    <div style={{position:'absolute',zIndex:200,left:0,right:0,background:'white',border:'1px solid #cbd5e1',borderRadius:8,boxShadow:'0 8px 20px rgba(0,0,0,0.12)',top:'100%',maxHeight:220,overflowY:'auto'}}>
                      {itemSuggestions.map((s,i)=>(
                        <div key={i}
                          onMouseDown={()=>{ setNewItem(s.name); if(s.unit) setNewUnit(s.unit); if(s.category) setNewCategory(s.category); setShowSuggestions(false); }}
                          style={{padding:'9px 14px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}}
                          onMouseEnter={e=>e.currentTarget.style.background='#f0f9ff'}
                          onMouseLeave={e=>e.currentTarget.style.background='white'}
                        >
                          <span style={{fontWeight:600}}>{s.name}</span>
                          <span style={{fontSize:12,color:'#94a3b8'}}>{s.category && <span style={{background:'#ede9fe',color:'#6d28d9',padding:'1px 7px',borderRadius:10,marginRight:6,fontSize:11}}>{s.category}</span>}{s.unit}</span>
                        </div>
                      ))}
                    </div>
                  )}
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

              {/* Row 2: Category, Godown, Builty, Transporter, Remarks */}
              <div className='form-row-5b'>
                <div>
                  <label className="field-label">Category</label>
                  <input className="input" style={{marginBottom:0}} placeholder="e.g. Paper, Ink..." value={newCategory}
                    onChange={e=>setNewCategory(e.target.value)}
                    list="category-list" />
                  <datalist id="category-list">
                    {categories.map(c=><option key={c} value={c}/>)}
                  </datalist>
                </div>
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
            {categories.length > 0 && (
              <select className="input" style={{marginBottom:0,minWidth:130}} value={filterCategory} onChange={e=>setFilterCategory(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map(c=><option key={c}>{c}</option>)}
              </select>
            )}
            <div className="search-wrap">
              <span className="search-icon">🔍</span>
              <input className="input" style={{marginBottom:0}} placeholder="Search items..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} list="inv-search-list" autoComplete="off" />
              <datalist id="inv-search-list">
                {[...new Set(inventory.map(i=>i.name))].sort().map(n=><option key={n} value={n}/>)}
              </datalist>
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
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span style={{color:'#64748b',fontSize:13}}>{inventory.reduce((s,i)=>s+i.quantity,0)} total units</span>
              <button className="btn btn-light btn-sm" onClick={printStock}>🖨 Print</button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th><th>Category</th><th>Qty</th><th>Unit</th><th>Sec</th><th>Godown</th><th>Builty</th><th>Transporter</th><th>Remarks</th><th>Date</th><th>Type</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.length===0 ? (
                  <tr><td colSpan="11" style={{textAlign:'center',color:'#94a3b8',padding:'32px'}}>No items found</td></tr>
                ) : displayed.map(item=>(
                  <tr key={item.id}>
                    <td style={{fontWeight:600}}>{item.name}</td>
                    <td>{item.category ? <span style={{background:'#ede9fe',color:'#6d28d9',padding:'2px 9px',borderRadius:20,fontSize:12,fontWeight:600}}>{item.category}</span> : <span style={{color:'#cbd5e1'}}>—</span>}</td>
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
