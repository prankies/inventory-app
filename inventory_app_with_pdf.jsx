import React, { useState, useEffect } from 'react';
import { Plus, Minus, Search, LogOut, Settings, Upload, Check, X, Edit2 } from 'lucide-react';

const InventoryApp = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  
  const [inventory, setInventory] = useState([]);
  const [godowns, setGodowns] = useState(['Godown-1', 'Godown-2', 'Godown-3', 'Godown-4', 'Godown-5']);
  const [newItem, setNewItem] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [newGodown, setNewGodown] = useState('Godown-1');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('all');
  const [selectedGodown, setSelectedGodown] = useState('Godown-1');
  const [editingGodowns, setEditingGodowns] = useState(false);
  const [newGodownName, setNewGodownName] = useState('');
  
  // PDF Extraction states
  const [showPdfUpload, setShowPdfUpload] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [extractedData, setExtractedData] = useState([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState('');
  const [editingExtracted, setEditingExtracted] = useState(null);

  const users = JSON.parse(localStorage.getItem('users') || '{}');

  // Load PDF.js library dynamically
  const loadPdfJs = async () => {
    if (!window.pdfjsLib) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      };
      document.head.appendChild(script);
    }
  };

  useEffect(() => {
    loadPdfJs();
  }, []);

  const handleSignUp = (e) => {
    e.preventDefault();
    if (email && password) {
      if (users[email]) {
        alert('Email already exists');
        return;
      }
      users[email] = password;
      localStorage.setItem('users', JSON.stringify(users));
      alert('Account created! Now sign in.');
      setIsLogin(true);
      setEmail('');
      setPassword('');
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (users[email] && users[email] === password) {
      setCurrentUser(email);
      setEmail('');
      setPassword('');
      const userInv = JSON.parse(localStorage.getItem(`inv_${email}`) || '[]');
      setInventory(userInv);
    } else {
      alert('Invalid credentials');
    }
  };

  const handleLogout = () => {
    localStorage.setItem(`inv_${currentUser}`, JSON.stringify(inventory));
    setCurrentUser(null);
    setInventory([]);
  };

  // Extract text from PDF
  const extractTextFromPdf = async (file) => {
    try {
      setIsExtracting(true);
      setExtractionError('');
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument(arrayBuffer).promise;
      
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        fullText += text.items.map(item => item.str).join(' ') + '\n';
      }
      
      // Use Claude to extract structured data
      await extractDataWithClaude(fullText);
    } catch (error) {
      setExtractionError('Failed to extract PDF: ' + error.message);
      setIsExtracting(false);
    }
  };

  // Call Claude API to parse invoice text
  const extractDataWithClaude = async (pdfText) => {
    try {
      const prompt = `You are an invoice data extraction assistant. Extract items from this invoice/bill text.

For each item found, extract:
- Item name (product/item description)
- Quantity (number of units)
- Price per unit (if available)
- HSN/SAC code (if visible, otherwise put "N/A")

Return ONLY a JSON array like this format:
[
  {"name": "A4 Paper Bundle", "quantity": 10, "price": 500, "hsn": "4802"},
  {"name": "Ballpoint Pens Box", "quantity": 5, "price": 200, "hsn": "N/A"}
]

Invoice Text:
${pdfText}

Extract items only. Return valid JSON array only, no other text.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error('Claude API error: ' + response.statusText);
      }

      const data = await response.json();
      const content = data.content[0].text;
      
      // Parse JSON from response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Add IDs, leave godown empty for user to fill
        const withIds = parsed.map((item, idx) => ({
          ...item,
          id: `temp_${idx}`,
          godown: '',
          stockEntryDate: new Date().toISOString().split('T')[0],
          quantity: parseInt(item.quantity) || 1
        }));
        setExtractedData(withIds);
      } else {
        throw new Error('Could not parse Claude response');
      }
    } catch (error) {
      setExtractionError('Failed to extract data: ' + error.message);
    } finally {
      setIsExtracting(false);
    }
  };

  // Update extracted item
  const updateExtractedItem = (id, field, value) => {
    setExtractedData(extractedData.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  // Add all extracted items to inventory
  const addExtractedItems = () => {
    // Check that all items have godown selected
    const missingGodowns = extractedData.filter(item => !item.godown);
    if (missingGodowns.length > 0) {
      alert(`Please select Godown for all items. Missing: ${missingGodowns.length} item(s)`);
      return;
    }

    const newItems = extractedData.map(item => ({
      id: Date.now() + Math.random(),
      name: item.name,
      quantity: item.quantity,
      godown: item.godown,
      dateAdded: item.stockEntryDate,
      addedBy: currentUser,
      price: item.price || 0,
      hsn: item.hsn || 'N/A'
    }));
    
    const updated = [...inventory, ...newItems];
    setInventory(updated);
    localStorage.setItem(`inv_${currentUser}`, JSON.stringify(updated));
    
    setExtractedData([]);
    setPdfFile(null);
    setShowPdfUpload(false);
    alert(`Added ${newItems.length} items to inventory`);
  };

  const addItem = (e) => {
    e.preventDefault();
    if (newItem && newQuantity && newGodown) {
      const item = {
        id: Date.now(),
        name: newItem,
        quantity: parseInt(newQuantity),
        godown: newGodown,
        dateAdded: new Date().toLocaleDateString(),
        addedBy: currentUser
      };
      const updated = [...inventory, item];
      setInventory(updated);
      localStorage.setItem(`inv_${currentUser}`, JSON.stringify(updated));
      setNewItem('');
      setNewQuantity('');
      setNewGodown('Godown-1');
    }
  };

  const issueItem = (id, quantity) => {
    const issueQty = parseInt(prompt('How many to issue?', '1'));
    if (issueQty && issueQty > 0) {
      const updated = inventory.map(item => {
        if (item.id === id) {
          const newQty = item.quantity - issueQty;
          if (newQty < 0) {
            alert('Cannot issue more than available!');
            return item;
          }
          return { ...item, quantity: newQty, lastIssued: new Date().toLocaleDateString(), issuedBy: currentUser };
        }
        return item;
      }).filter(item => item.quantity > 0);
      setInventory(updated);
      localStorage.setItem(`inv_${currentUser}`, JSON.stringify(updated));
    }
  };

  const deleteItem = (id) => {
    if (confirm('Delete this item?')) {
      const updated = inventory.filter(item => item.id !== id);
      setInventory(updated);
      localStorage.setItem(`inv_${currentUser}`, JSON.stringify(updated));
    }
  };

  const addGodown = (e) => {
    e.preventDefault();
    if (newGodownName && !godowns.includes(newGodownName)) {
      setGodowns([...godowns, newGodownName]);
      setNewGodownName('');
    }
  };

  const exportCSV = () => {
    const csv = [
      ['Item', 'Quantity', 'Godown', 'Date Added', 'Added By', 'Price', 'HSN'],
      ...inventory.map(i => [i.name, i.quantity, i.godown, i.dateAdded, i.addedBy, i.price || '', i.hsn || ''])
    ].map(row => row.join(',')).join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const filteredInventory = inventory.filter(item =>
    item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const godownInventory = viewMode === 'by-godown' 
    ? filteredInventory.filter(item => item.godown === selectedGodown)
    : filteredInventory;

  const godownSummary = godowns.map(g => ({
    name: g,
    items: inventory.filter(i => i.godown === g).length,
    totalQty: inventory.filter(i => i.godown === g).reduce((sum, i) => sum + i.quantity, 0)
  }));

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <h1 className="text-3xl font-bold text-center mb-2 text-blue-600">Inventory Hub</h1>
          <p className="text-center text-gray-600 mb-8">PDF-Powered Stock Management</p>
          
          <form onSubmit={isLogin ? handleLogin : handleSignUp}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mb-4 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full mb-6 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-semibold mb-4"
            >
              {isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <button
            onClick={() => setIsLogin(!isLogin)}
            className="w-full text-blue-600 hover:underline"
          >
            {isLogin ? "Don't have account? Sign up" : 'Already have account? Sign in'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Inventory Hub</h1>
            <p className="text-sm text-blue-100">Logged in: {currentUser}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setShowPdfUpload(!showPdfUpload)}
              className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <Upload size={18} /> Upload PDF
            </button>
            <button
              onClick={() => setEditingGodowns(!editingGodowns)}
              className="bg-blue-700 hover:bg-blue-800 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <Settings size={18} /> Godowns
            </button>
            <button
              onClick={handleLogout}
              className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <LogOut size={18} /> Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4">
        
        {/* PDF Upload Section */}
        {showPdfUpload && (
          <div className="bg-white rounded-lg shadow p-6 mb-6 border-2 border-green-300">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Upload size={20} /> Upload Invoice PDF
            </h2>
            
            {!extractedData.length ? (
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setPdfFile(e.target.files[0])}
                    className="hidden"
                    id="pdf-upload"
                  />
                  <label htmlFor="pdf-upload" className="cursor-pointer">
                    <Upload size={40} className="mx-auto mb-2 text-gray-400" />
                    <p className="text-gray-700 font-semibold">Click to select PDF</p>
                    <p className="text-sm text-gray-500">or drag and drop an invoice</p>
                    {pdfFile && <p className="text-green-600 mt-2">✓ {pdfFile.name}</p>}
                  </label>
                </div>
                
                {extractionError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                    {extractionError}
                  </div>
                )}
                
                <button
                  onClick={() => {
                    if (pdfFile) {
                      extractTextFromPdf(pdfFile);
                    } else {
                      alert('Please select a PDF file');
                    }
                  }}
                  disabled={!pdfFile || isExtracting}
                  className={`w-full py-3 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    isExtracting || !pdfFile
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  {isExtracting ? '🔄 Extracting...' : '📄 Extract Items'}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="font-bold text-lg">Extracted Items ({extractedData.length})</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="px-3 py-2 text-left">Item Name</th>
                        <th className="px-3 py-2 text-left">Qty</th>
                        <th className="px-3 py-2 text-left">Price</th>
                        <th className="px-3 py-2 text-left">Godown *</th>
                        <th className="px-3 py-2 text-left">Stock Entry Date *</th>
                        <th className="px-3 py-2 text-left">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {extractedData.map((item) => (
                        <tr key={item.id} className="border-b border-gray-200">
                          <td className="px-3 py-2">
                            {editingExtracted === item.id ? (
                              <input
                                type="text"
                                value={item.name}
                                onChange={(e) => updateExtractedItem(item.id, 'name', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded"
                              />
                            ) : (
                              item.name
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {editingExtracted === item.id ? (
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => updateExtractedItem(item.id, 'quantity', parseInt(e.target.value))}
                                className="w-20 px-2 py-1 border border-gray-300 rounded"
                              />
                            ) : (
                              item.quantity
                            )}
                          </td>
                          <td className="px-3 py-2">{item.price || '-'}</td>
                          <td className="px-3 py-2">
                            {editingExtracted === item.id ? (
                              <select
                                value={item.godown}
                                onChange={(e) => updateExtractedItem(item.id, 'godown', e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option value="">Select Godown</option>
                                {godowns.map(g => <option key={g}>{g}</option>)}
                              </select>
                            ) : (
                              <span className={item.godown ? '' : 'text-red-600 font-bold'}>
                                {item.godown || '⚠ Not selected'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {editingExtracted === item.id ? (
                              <input
                                type="date"
                                value={item.stockEntryDate}
                                onChange={(e) => updateExtractedItem(item.id, 'stockEntryDate', e.target.value)}
                                className="px-2 py-1 border border-gray-300 rounded text-sm"
                              />
                            ) : (
                              item.stockEntryDate
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => setEditingExtracted(editingExtracted === item.id ? null : item.id)}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              {editingExtracted === item.id ? '✓' : '✎'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={addExtractedItems}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-semibold"
                  >
                    ✓ Add All to Inventory
                  </button>
                  <button
                    onClick={() => {
                      setExtractedData([]);
                      setPdfFile(null);
                    }}
                    className="flex-1 bg-gray-500 hover:bg-gray-600 text-white py-2 rounded-lg font-semibold"
                  >
                    ✕ Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Godown Management */}
        {editingGodowns && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">Manage Godowns</h2>
            <form onSubmit={addGodown} className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="New godown name"
                value={newGodownName}
                onChange={(e) => setNewGodownName(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold">
                Add
              </button>
            </form>
            <div className="flex flex-wrap gap-2">
              {godowns.map(g => (
                <span key={g} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-lg text-sm">
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Add Item Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <Plus size={20} /> Add Stock Manually
          </h2>
          <form onSubmit={addItem} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="Item name"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="number"
              placeholder="Quantity"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={newGodown}
              onChange={(e) => setNewGodown(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {godowns.map(g => <option key={g}>{g}</option>)}
            </select>
            <button
              type="submit"
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold"
            >
              Add Item
            </button>
            <button
              type="button"
              onClick={exportCSV}
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold text-sm"
            >
              Export CSV
            </button>
          </form>
        </div>

        {/* View Mode Toggle */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex gap-4 items-center">
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('all')}
                className={`px-4 py-2 rounded-lg font-semibold ${viewMode === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              >
                All Items
              </button>
              <button
                onClick={() => setViewMode('by-godown')}
                className={`px-4 py-2 rounded-lg font-semibold ${viewMode === 'by-godown' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}
              >
                By Godown
              </button>
            </div>
            
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-3 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Godown Summary (if by-godown mode) */}
        {viewMode === 'by-godown' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {godownSummary.map(g => (
                <button
                  key={g.name}
                  onClick={() => setSelectedGodown(g.name)}
                  className={`p-4 rounded-lg font-semibold text-center transition ${
                    selectedGodown === g.name
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'bg-white text-gray-800 border border-gray-200 hover:border-blue-400'
                  }`}
                >
                  <div className="text-lg">{g.name}</div>
                  <div className="text-sm mt-1">{g.items} items</div>
                  <div className="text-sm mt-1">{g.totalQty} units</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Inventory List */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-bold">
              {viewMode === 'by-godown' ? `${selectedGodown} - Stock` : 'All Stock'}
              <span className="text-sm text-gray-600 ml-2">({godownInventory.length} items)</span>
            </h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Item</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Qty</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Godown</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Date</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {godownInventory.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                      No items found
                    </td>
                  </tr>
                ) : (
                  godownInventory.map(item => (
                    <tr key={item.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">{item.name}</td>
                      <td className="px-6 py-4">
                        <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-bold">
                          {item.quantity}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">{item.godown}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{item.dateAdded}</td>
                      <td className="px-6 py-4 flex gap-2">
                        <button
                          onClick={() => issueItem(item.id, item.quantity)}
                          className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-1 rounded-lg text-sm flex items-center gap-1"
                        >
                          <Minus size={16} /> Issue
                        </button>
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-lg text-sm"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-gray-500 text-sm mt-8">
          <p>Total items in system: <strong>{inventory.length}</strong> | Total units: <strong>{inventory.reduce((sum, i) => sum + i.quantity, 0)}</strong></p>
        </div>
      </div>
    </div>
  );
};

export default InventoryApp;
