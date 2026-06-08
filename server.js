const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4000;
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  inventory: path.join(DATA_DIR, 'inventory.json'),
  godowns: path.join(DATA_DIR, 'godowns.json'),
};

const read = (file, def) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
};
const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// Init defaults
if (!fs.existsSync(FILES.godowns)) write(FILES.godowns, ['Godown-1','Godown-2','Godown-3','Godown-4','Godown-5']);
if (!fs.existsSync(FILES.users)) write(FILES.users, {});
if (!fs.existsSync(FILES.sessions)) write(FILES.sessions, {});
if (!fs.existsSync(FILES.inventory)) write(FILES.inventory, []);

app.use(cors());
app.use(express.json());

const auth = (req, res, next) => {
  const token = req.headers['authorization'];
  const sessions = read(FILES.sessions, {});
  if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
  req.user = sessions[token];
  next();
};

// Signup
app.post('/api/signup', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const users = read(FILES.users, {});
  if (users[email]) return res.status(400).json({ error: 'Email already exists' });
  users[email] = password;
  write(FILES.users, users);
  res.json({ message: 'Account created! Now sign in.' });
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const users = read(FILES.users, {});
  if (!users[email] || users[email] !== password) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  const sessions = read(FILES.sessions, {});
  sessions[token] = { email };
  write(FILES.sessions, sessions);
  res.json({ token, email });
});

// Logout
app.post('/api/logout', auth, (req, res) => {
  const sessions = read(FILES.sessions, {});
  delete sessions[req.headers['authorization']];
  write(FILES.sessions, sessions);
  res.json({ message: 'Logged out' });
});

// Get inventory
app.get('/api/inventory', auth, (req, res) => {
  res.json(read(FILES.inventory, []).reverse());
});

// Add single item
app.post('/api/inventory', auth, (req, res) => {
  const { name, quantity, godown, dateAdded, price, hsn } = req.body;
  const inv = read(FILES.inventory, []);
  const item = {
    id: Date.now(),
    name, quantity, godown,
    date_added: dateAdded || new Date().toLocaleDateString(),
    added_by: req.user.email,
    price: price || 0,
    hsn: hsn || 'N/A'
  };
  inv.push(item);
  write(FILES.inventory, inv);
  res.json(item);
});

// Bulk add (from PDF)
app.post('/api/inventory/bulk', auth, (req, res) => {
  const { items } = req.body;
  const inv = read(FILES.inventory, []);
  const newItems = items.map(item => ({
    id: Date.now() + Math.random(),
    name: item.name,
    quantity: item.quantity,
    godown: item.godown,
    date_added: item.dateAdded || new Date().toLocaleDateString(),
    added_by: req.user.email,
    price: item.price || 0,
    hsn: item.hsn || 'N/A'
  }));
  inv.push(...newItems);
  write(FILES.inventory, inv);
  res.json({ message: `Added ${newItems.length} items` });
});

// Issue stock
app.put('/api/inventory/:id/issue', auth, (req, res) => {
  const id = parseFloat(req.params.id);
  const { quantity } = req.body;
  let inv = read(FILES.inventory, []);
  const idx = inv.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  const newQty = inv[idx].quantity - quantity;
  if (newQty < 0) return res.status(400).json({ error: 'Cannot issue more than available' });
  if (newQty === 0) {
    inv.splice(idx, 1);
    write(FILES.inventory, inv);
    return res.json({ deleted: true });
  }
  inv[idx].quantity = newQty;
  inv[idx].last_issued = new Date().toLocaleDateString();
  inv[idx].issued_by = req.user.email;
  write(FILES.inventory, inv);
  res.json(inv[idx]);
});

// Delete item
app.delete('/api/inventory/:id', auth, (req, res) => {
  const id = parseFloat(req.params.id);
  let inv = read(FILES.inventory, []);
  write(FILES.inventory, inv.filter(i => i.id !== id));
  res.json({ message: 'Deleted' });
});

// Get godowns
app.get('/api/godowns', auth, (req, res) => {
  res.json(read(FILES.godowns, []));
});

// Add godown
app.post('/api/godowns', auth, (req, res) => {
  const { name } = req.body;
  const godowns = read(FILES.godowns, []);
  if (godowns.includes(name)) return res.status(400).json({ error: 'Godown already exists' });
  godowns.push(name);
  write(FILES.godowns, godowns);
  res.json({ name });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
