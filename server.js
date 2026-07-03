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

// Merge any rows that share the same item name + godown (case-insensitive)
// into one, summing quantities. Needed once to clean up data created before
// the upsert-on-add logic existed (e.g. separate Opening + Regular rows).
const mergeDuplicateInventoryRows = async () => {
  const { rows: groups } = await pool.query(`
    SELECT LOWER(name) AS lname, godown, array_agg(id ORDER BY id) AS ids,
           SUM(quantity) AS total_qty, SUM(secondary_quantity) AS total_sec_qty,
           SUM(opening_quantity) AS total_opening_qty
    FROM inventory
    GROUP BY LOWER(name), godown
    HAVING COUNT(*) > 1
  `);
  for (const g of groups) {
    const keepId = g.ids[g.ids.length - 1]; // most recently added row keeps its metadata
    const dropIds = g.ids.slice(0, -1);
    await pool.query(
      'UPDATE inventory SET quantity=$1, secondary_quantity=$2, opening_quantity=$3 WHERE id=$4',
      [g.total_qty, g.total_sec_qty, g.total_opening_qty, keepId]
    );
    await pool.query('DELETE FROM inventory WHERE id = ANY($1)', [dropIds]);
  }
  if (groups.length) console.log(`Merged ${groups.length} duplicate item/godown group(s) in inventory`);
};

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
    CREATE TABLE IF NOT EXISTS master_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      alias TEXT DEFAULT '',
      category TEXT DEFAULT '',
      unit TEXT DEFAULT 'Pcs',
      UNIQUE(name)
    );
    CREATE TABLE IF NOT EXISTS godowns (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT DEFAULT 'pcs',
      secondary_quantity REAL DEFAULT 0,
      secondary_unit TEXT DEFAULT '',
      godown TEXT NOT NULL,
      date_added TEXT NOT NULL,
      added_by TEXT NOT NULL,
      price REAL DEFAULT 0,
      hsn TEXT DEFAULT 'N/A',
      builty_number TEXT DEFAULT '',
      transporter TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      stock_type TEXT DEFAULT 'regular',
      last_issued TEXT,
      issued_by TEXT
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      from_godown TEXT NOT NULL,
      to_godown TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT DEFAULT 'pcs',
      remarks TEXT DEFAULT '',
      transferred_by TEXT NOT NULL,
      transfer_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_ledger (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      godown TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT DEFAULT 'pcs',
      reference TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      action_by TEXT NOT NULL,
      action_date TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Add new columns to existing table if they don't exist
  const alterCols = [
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'pcs'",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS secondary_quantity REAL DEFAULT 0",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS secondary_unit TEXT DEFAULT ''",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS builty_number TEXT DEFAULT ''",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS transporter TEXT DEFAULT ''",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS remarks TEXT DEFAULT ''",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stock_type TEXT DEFAULT 'regular'",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''",
    "ALTER TABLE inventory ADD COLUMN IF NOT EXISTS opening_quantity REAL DEFAULT 0",
  ];
  for (const sql of alterCols) {
    try { await pool.query(sql); } catch(e) { /* ignore */ }
  }

  // One-time cleanup: merge any pre-existing duplicate rows for the same
  // (name, godown) -- e.g. Opening Stock and Regular Stock entered before
  // the upsert logic existed -- into a single row, then enforce uniqueness.
  await mergeDuplicateInventoryRows();
  try {
    await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS inventory_name_godown_uniq ON inventory (LOWER(name), godown)');
  } catch (e) { console.error('Could not create uniqueness index, duplicates may remain:', e.message); }

  const defaults = ['Godown-1','Godown-2','Godown-3','Godown-4','Godown-5'];
  for (const g of defaults) {
    await pool.query('INSERT INTO godowns (name) VALUES ($1) ON CONFLICT DO NOTHING', [g]);
  }
  console.log('Database ready - v2.1');
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'build')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

const auth = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid token' });
  req.user = { email: rows[0].email };
  next();
};

// Auth
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    await pool.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, password]);
    res.json({ message: 'Account created! Now sign in.' });
  } catch { res.status(400).json({ error: 'Email already exists' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO sessions (token, email) VALUES ($1, $2)', [token, email]);
  res.json({ token, email });
});

app.post('/api/logout', auth, async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE token = $1', [req.headers['authorization']]);
  res.json({ message: 'Logged out' });
});

// Inventory
app.get('/api/inventory', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM inventory ORDER BY id DESC');
  res.json(rows);
});

const INV_FIELDS = `name, quantity, unit, secondary_quantity, secondary_unit, godown, date_added, added_by, price, hsn, builty_number, transporter, remarks, stock_type, category, opening_quantity`;
const INV_VALS  = `$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16`;

const logLedger = (client, { name, godown, movement_type, quantity, unit, reference, remarks, action_by, action_date }) =>
  client.query(
    `INSERT INTO stock_ledger (name, godown, movement_type, quantity, unit, reference, remarks, action_by, action_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [name, godown, movement_type, quantity, unit || 'pcs', reference || '', remarks || '', action_by, action_date || new Date().toLocaleDateString()]
  );

// Add stock to an existing (name, godown) row if one exists, otherwise create it.
// This is what makes Regular Stock additions accumulate on top of Opening Stock
// instead of fragmenting into a separate row.
async function upsertInventory(client, item, addedBy) {
  const {
    name, quantity, unit, secondary_quantity, secondary_unit, godown, dateAdded,
    price, hsn, builty_number, transporter, remarks, stock_type, category
  } = item;
  const qty = parseFloat(quantity) || 0;
  const secQty = parseFloat(secondary_quantity) || 0;

  const { rows: existing } = await client.query(
    'SELECT * FROM inventory WHERE LOWER(name)=LOWER($1) AND godown=$2 FOR UPDATE',
    [name, godown]
  );

  const movementType = stock_type === 'opening' ? 'OPENING' : 'IN';
  const ref = builty_number || transporter || '';

  if (existing.length) {
    const row = existing[0];
    const newQty = row.quantity + qty;
    const newSecQty = (row.secondary_quantity || 0) + secQty;
    const newOpeningQty = (row.opening_quantity || 0) + (stock_type === 'opening' ? qty : 0);
    const { rows: updated } = await client.query(
      `UPDATE inventory SET quantity=$1, secondary_quantity=$2,
         secondary_unit=COALESCE(NULLIF($3,''), secondary_unit),
         date_added=$4, added_by=$5, price=$6, hsn=$7, builty_number=$8,
         transporter=$9, remarks=$10, category=COALESCE(NULLIF($11,''), category),
         opening_quantity=$12
       WHERE id=$13 RETURNING *`,
      [newQty, newSecQty, secondary_unit || '', dateAdded, addedBy, price || 0,
       hsn || 'N/A', builty_number || '', transporter || '', remarks || '',
       category || '', newOpeningQty, row.id]
    );
    await logLedger(client, { name: row.name, godown, movement_type: movementType, quantity: qty, unit: row.unit, reference: ref, remarks, action_by: addedBy, action_date: dateAdded });
    return updated[0];
  }

  const { rows: inserted } = await client.query(
    `INSERT INTO inventory (${INV_FIELDS}) VALUES (${INV_VALS}) RETURNING *`,
    [name, qty, unit || 'pcs', secQty, secondary_unit || '', godown,
     dateAdded || new Date().toLocaleDateString(), addedBy,
     price || 0, hsn || 'N/A', builty_number || '', transporter || '', remarks || '',
     stock_type || 'regular', category || '', stock_type === 'opening' ? qty : 0]
  );
  await logLedger(client, { name: inserted[0].name, godown, movement_type: movementType, quantity: qty, unit: inserted[0].unit, reference: ref, remarks, action_by: addedBy, action_date: dateAdded });
  return inserted[0];
}

app.post('/api/inventory', auth, async (req, res) => {
  const row = await upsertInventory(pool, req.body, req.user.email);
  res.json(row);
});

app.post('/api/inventory/bulk', auth, async (req, res) => {
  const { items } = req.body;
  for (const item of items) {
    await upsertInventory(pool, item, req.user.email);
  }
  res.json({ message: `Added ${items.length} items` });
});

// Transfer stock between godowns -- atomic decrement at source, merge/credit at destination
app.post('/api/inventory/transfer', auth, async (req, res) => {
  const { name, fromGodown, toGodown, quantity, remarks, unit } = req.body;
  const qty = parseFloat(quantity) || 0;
  if (!name || !fromGodown || !toGodown || qty <= 0) {
    return res.status(400).json({ error: 'Item, source/destination godown and a positive quantity are required' });
  }
  if (fromGodown === toGodown) {
    return res.status(400).json({ error: 'Source and destination godown must be different' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: sourceRows } = await client.query(
      'SELECT * FROM inventory WHERE LOWER(name)=LOWER($1) AND godown=$2 FOR UPDATE',
      [name, fromGodown]
    );
    if (!sourceRows.length) throw Object.assign(new Error(`"${name}" not found in ${fromGodown}`), { status: 404 });
    const source = sourceRows[0];
    if (source.quantity < qty) throw Object.assign(new Error(`Only ${source.quantity} ${source.unit} available in ${fromGodown}`), { status: 400 });

    const remainingQty = source.quantity - qty;
    if (remainingQty === 0) {
      await client.query('DELETE FROM inventory WHERE id=$1', [source.id]);
    } else {
      await client.query('UPDATE inventory SET quantity=$1 WHERE id=$2', [remainingQty, source.id]);
    }

    const dateNow = new Date().toLocaleDateString();
    const destRow = await upsertInventory(client, {
      name: source.name, quantity: qty, unit: unit || source.unit,
      secondary_quantity: 0, secondary_unit: source.secondary_unit,
      godown: toGodown, dateAdded: dateNow, price: source.price, hsn: source.hsn,
      builty_number: source.builty_number, transporter: '',
      remarks: remarks || `Transferred from ${fromGodown}`,
      stock_type: 'regular', category: source.category
    }, req.user.email);

    await client.query(
      `INSERT INTO transfers (name, from_godown, to_godown, quantity, unit, remarks, transferred_by, transfer_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [source.name, fromGodown, toGodown, qty, source.unit, remarks || '', req.user.email, dateNow]
    );
    await logLedger(client, { name: source.name, godown: fromGodown, movement_type: 'TRANSFER-OUT', quantity: qty, unit: source.unit, reference: toGodown, remarks: remarks || '', action_by: req.user.email, action_date: dateNow });
    await logLedger(client, { name: source.name, godown: toGodown, movement_type: 'TRANSFER-IN', quantity: qty, unit: source.unit, reference: fromGodown, remarks: remarks || '', action_by: req.user.email, action_date: dateNow });

    await client.query('COMMIT');
    res.json({ message: `Transferred ${qty} ${source.unit} of ${source.name} from ${fromGodown} to ${toGodown}`, destination: destRow });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Transfer history
app.get('/api/transfers', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM transfers ORDER BY id DESC LIMIT 200');
  res.json(rows);
});

// Stock Ledger -- filterable IN/OUT log with running balance per item+godown
app.get('/api/ledger', auth, async (req, res) => {
  const { name, godown, type, from_date, to_date } = req.query;
  const conditions = [];
  const params = [];
  if (name)      { params.push(`%${name.toLowerCase()}%`); conditions.push(`LOWER(sl.name) LIKE $${params.length}`); }
  if (godown)    { params.push(godown);                    conditions.push(`sl.godown = $${params.length}`); }
  if (type)      { params.push(type);                      conditions.push(`sl.movement_type = $${params.length}`); }
  if (from_date) { params.push(from_date);                 conditions.push(`sl.created_at::date >= $${params.length}::date`); }
  if (to_date)   { params.push(to_date);                   conditions.push(`sl.created_at::date <= $${params.length}::date`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT sl.*,
       SUM(CASE WHEN sl.movement_type IN ('IN','OPENING','TRANSFER-IN') THEN sl.quantity
                ELSE -sl.quantity END)
       OVER (PARTITION BY LOWER(sl.name), sl.godown ORDER BY sl.id) AS running_balance
     FROM stock_ledger sl
     ${where}
     ORDER BY sl.id DESC
     LIMIT 500`,
    params
  );
  res.json(rows);
});

app.put('/api/inventory/:id/issue', auth, async (req, res) => {
  const { quantity, issued_to, remarks } = req.body;
  const { rows } = await pool.query('SELECT * FROM inventory WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Item not found' });
  const item = rows[0];
  const newQty = item.quantity - quantity;
  if (newQty < 0) return res.status(400).json({ error: 'Cannot issue more than available' });
  const dateNow = new Date().toLocaleDateString();
  await logLedger(pool, { name: item.name, godown: item.godown, movement_type: 'OUT', quantity, unit: item.unit, reference: issued_to || '', remarks: remarks || '', action_by: req.user.email, action_date: dateNow });
  if (newQty === 0) {
    await pool.query('DELETE FROM inventory WHERE id = $1', [item.id]);
    return res.json({ deleted: true });
  }
  const { rows: updated } = await pool.query(
    'UPDATE inventory SET quantity=$1, last_issued=$2, issued_by=$3 WHERE id=$4 RETURNING *',
    [newQty, dateNow, issued_to ? `${req.user.email} -> ${issued_to}` : req.user.email, item.id]
  );
  res.json(updated[0]);
});

app.delete('/api/inventory/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// Item name suggestions (autocomplete) â€" searches master list + existing inventory
app.get('/api/suggestions', auth, async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const { rows } = await pool.query(
    `SELECT name, category, unit FROM (
       SELECT name, category, unit, 1 AS priority FROM master_items WHERE LOWER(name) LIKE $1
       UNION
       SELECT DISTINCT name, category, unit, 2 AS priority FROM inventory WHERE LOWER(name) LIKE $1
     ) combined
     ORDER BY priority, name LIMIT 12`,
    [`%${q}%`]
  );
  res.json(rows);
});

// All distinct categories (from master + inventory)
app.get('/api/categories', auth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM (
       SELECT category FROM master_items WHERE category != ''
       UNION SELECT category FROM inventory WHERE category != ''
     ) all_cats ORDER BY category`
  );
  res.json(rows.map(r => r.category));
});

// Import master item list
app.post('/api/master-items/import', auth, async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'No items provided' });
    let inserted = 0;
    // Process one at a time to avoid parameter limit issues
    for (const item of items) {
      if (!item.name || item.name.trim().length < 1) continue;
      await pool.query(
        `INSERT INTO master_items (name, alias, category, unit) VALUES ($1,$2,$3,$4)
         ON CONFLICT (name) DO UPDATE SET alias=EXCLUDED.alias, category=EXCLUDED.category, unit=EXCLUDED.unit`,
        [item.name.trim(), item.alias||'', item.category||'', item.unit||'Pcs']
      );
      inserted++;
    }
    res.json({ message: `Imported ${inserted} items into master list` });
  } catch (err) {
    console.error('Master import error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Godowns
app.get('/api/godowns', auth, async (req, res) => {
  const { rows } = await pool.query('SELECT name FROM godowns ORDER BY id');
  res.json(rows.map(r => r.name));
});

app.post('/api/godowns', auth, async (req, res) => {
  const { name } = req.body;
  try {
    await pool.query('INSERT INTO godowns (name) VALUES ($1)', [name]);
    res.json({ name });
  } catch { res.status(400).json({ error: 'Godown already exists' }); }
});

// Rename godown
app.put('/api/godowns/:oldName', auth, async (req, res) => {
  const { newName } = req.body;
  const oldName = decodeURIComponent(req.params.oldName);
  try {
    await pool.query('UPDATE godowns SET name=$1 WHERE name=$2', [newName, oldName]);
    await pool.query('UPDATE inventory SET godown=$1 WHERE godown=$2', [newName, oldName]);
    res.json({ name: newName });
  } catch { res.status(400).json({ error: 'Name already exists' }); }
});

// Delete godown
app.delete('/api/godowns/:name', auth, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  await pool.query('DELETE FROM godowns WHERE name=$1', [name]);
  res.json({ message: 'Deleted' });
});

// AI Extract
app.post('/api/extract', auth, async (req, res) => {
  const { text, imageBase64, mediaType } = req.body;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Anthropic API key not configured' });
  const prompt = `Extract all items from this invoice. Return ONLY a JSON array:
[{"name":"Item","quantity":10,"unit":"pcs","price":500,"hsn":"N/A","remarks":""}]
No other text.`;
  let messageContent = imageBase64
    ? [{ type:'image', source:{type:'base64', media_type:mediaType||'image/jpeg', data:imageBase64}}, {type:'text', text:prompt}]
    : `${prompt}\n\nInvoice Text:\n${text}`;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'},
      body: JSON.stringify({ model:'claude-opus-4-5', max_tokens:1000, messages:[{role:'user',content:messageContent}]})
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.error?.message || 'Claude API error' });
    const match = data.content[0].text.match(/\[[\s\S]*\]/);
    if (!match) return res.status(500).json({ error: 'Could not parse response' });
    res.json({ items: JSON.parse(match[0]) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
 
