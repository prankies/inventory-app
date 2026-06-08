const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Init tables
const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      email TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS godowns (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      godown TEXT NOT NULL,
      date_added TEXT NOT NULL,
      added_by TEXT NOT NULL,
      price REAL DEFAULT 0,
      hsn TEXT DEFAULT 'N/A',
      last_issued TEXT,
      issued_by TEXT
    );
  `);

  // Seed default godowns
  const defaults = ['Godown-1','Godown-2','Godown-3','Godown-4','Godown-5'];
  for (const g of defaults) {
    await pool.query('INSERT INTO godowns (name) VALUES ($1) ON CONFLICT DO NOTHING', [g]);
  }
  console.log('Database ready');
};

app.use(cors());
app.use(express.json());

// Serve React frontend build
app.use(express.static(path.join(__dirname, 'build')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

// Auth middleware
const auth = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid token' });
  req.user = { email: rows[0].email };
  next();
};

// Signup
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    await pool.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, password]);
    res.json({ message: 'Account created! Now sign in.' });
  } catch {
    res.status(400).json({ error: 'Email already exists' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, email) VALUES ($1, $2)', [token, email]);
  res.json({ token, email });
});

// Logout
app.post('/api/logout', auth, async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token = $1', [req.headers['authorization']]);
  res.json({ message: 'Logged out' });
});

// Get inventory
app.get('/api/inventory', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM inventory ORDER BY id DESC');
  res.json(rows);
});

// Add single item
app.post('/api/inventory', auth, async (req, res) => {
  const { name, quantity, godown, dateAdded, price, hsn } = req.body;
  const { rows } = await pool.query(
    'INSERT INTO inventory (name, quantity, godown, date_added, added_by, price, hsn) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
    [name, quantity, godown, dateAdded || new Date().toLocaleDateString(), req.user.email, price || 0, hsn || 'N/A']
  );
  res.json(rows[0]);
});

// Bulk add
app.post('/api/inventory/bulk', auth, async (req, res) => {
  const { items } = req.body;
  for (const item of items) {
    await pool.query(
      'INSERT INTO inventory (name, quantity, godown, date_added, added_by, price, hsn) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [item.name, item.quantity, item.godown, item.dateAdded || new Date().toLocaleDateString(), req.user.email, item.price || 0, item.hsn || 'N/A']
    );
  }
  res.json({ message: `Added ${items.length} items` });
});

// Issue stock
app.put('/api/inventory/:id/issue', auth, async (req, res) => {
  const { quantity } = req.body;
  const { rows } = await pool.query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Item not found' });
  const newQty = rows[0].quantity - quantity;
  if (newQty < 0) return res.status(400).json({ error: 'Cannot issue more than available' });
  if (newQty === 0) {
    await pool.query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
    return res.json({ deleted: true });
  }
  const { rows: updated } = await pool.query(
    'UPDATE inventory SET quantity=$1, last_issued=$2, issued_by=$3 WHERE id=$4 RETURNING *',
    [newQty, new Date().toLocaleDateString(), req.user.email, req.params.id]
  );
  res.json(updated[0]);
});

// Delete item
app.delete('/api/inventory/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// Get godowns
app.get('/api/godowns', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM godowns ORDER BY id');
  res.json(rows.map(r => r.name));
});

// Add godown
app.post('/api/godowns', auth, async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('INSERT INTO godowns (name) VALUES ($1)', [name]);
    res.json({ name });
  } catch {
    res.status(400).json({ error: 'Godown already exists' });
  }
});

// Extract invoice data via Claude API (called from frontend)
app.post('/api/extract', auth, async (req, res) => {
  const { text, imageBase64, mediaType } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured' });

  const prompt = `You are an invoice data extraction assistant. Extract all items from this invoice.
For each item return: name, quantity (number), price (number or 0), hsn (string or "N/A").
Return ONLY a valid JSON array like:
[{"name":"A4 Paper","quantity":10,"price":500,"hsn":"4802"}]
No other text.`;

  let messageContent;
  if (imageBase64) {
    messageContent = [
      { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
      { type: 'text', text: prompt }
    ];
  } else {
    messageContent = `${prompt}\n\nInvoice Text:\n${text}`;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: messageContent }]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });
    const content = data.content[0].text;
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Could not parse response' });
    res.json({ items: JSON.parse(match[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
