const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// Express 4 does not catch a rejected promise from an async handler, and Node
// exits the process on an unhandled rejection -- so one database hiccup used to
// take the whole app down. Wrapping the route-registration methods catches
// every handler, including any added later, without touching each route.
for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  const register = app[method].bind(app);
  app[method] = (path, ...handlers) => register(path, ...handlers.map(h =>
    (typeof h === 'function' && h.length < 4)
      ? (req, res, next) => Promise.resolve(h(req, res, next)).catch(next)
      : h));
}

// ---- Passwords --------------------------------------------------------------
// scrypt via the built-in crypto module: no new dependency, and the salt and
// parameters travel with the hash so it can be changed later without a
// migration. Rows written before this existed are plain text and are upgraded
// transparently the next time that user signs in successfully.
const PW_KEYLEN = 64;

const hashPassword = (plain) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const dk = crypto.scryptSync(String(plain), salt, PW_KEYLEN).toString('hex');
  return `scrypt$${salt}$${dk}`;
};

const isLegacyPassword = (stored) => !String(stored || '').startsWith('scrypt$');

const verifyPassword = (plain, stored) => {
  if (!stored) return false;
  try {
    if (isLegacyPassword(stored)) {
      const a = Buffer.from(String(plain));
      const b = Buffer.from(String(stored));
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    const [, salt, dk] = String(stored).split('$');
    // A malformed digest must never authenticate. Buffer.from('', 'hex') and
    // Buffer.from('zz', 'hex') both yield an EMPTY buffer, and scryptSync with
    // keylen 0 yields another -- timingSafeEqual would then call them equal and
    // let any password through. Insist on a full-length hex digest first.
    const HEX = /^[0-9a-f]+$/i;
    if (!salt || !dk || !HEX.test(salt) || !HEX.test(dk) || dk.length !== PW_KEYLEN * 2) return false;
    const want = Buffer.from(dk, 'hex');
    if (want.length !== PW_KEYLEN) return false;
    const got = crypto.scryptSync(String(plain), salt, want.length);
    return crypto.timingSafeEqual(got, want);
  } catch (e) {
    return false;
  }
};

// ---- Login throttle ---------------------------------------------------------
// Small in-memory counter -- enough to stop credential stuffing against a
// single-instance deployment. Cleared on restart, which is acceptable.
const LOGIN_MAX_FAILURES = 6;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const loginFailures = new Map();

const loginKey = (req, email) => `${req.ip}|${String(email || '').toLowerCase()}`;

const loginLockedFor = (key) => {
  const rec = loginFailures.get(key);
  if (!rec) return 0;
  if (Date.now() - rec.at > LOGIN_LOCKOUT_MS) { loginFailures.delete(key); return 0; }
  if (rec.count < LOGIN_MAX_FAILURES) return 0;
  return Math.ceil((LOGIN_LOCKOUT_MS - (Date.now() - rec.at)) / 60000);
};

const noteLoginFailure = (key) => {
  const rec = loginFailures.get(key);
  if (!rec || Date.now() - rec.at > LOGIN_LOCKOUT_MS) loginFailures.set(key, { count: 1, at: Date.now() });
  else { rec.count++; rec.at = Date.now(); }
};

const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '30', 10);

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

// Seed an opening-balance ledger entry for every current stock item that has
// no seed yet, so items that existed BEFORE the ledger feature show their real
// balance. Opening = current qty minus whatever the ledger already accounts for,
// so seeding is safe even if some movements were already logged.
const seedLedgerFromInventory = async () => {
  const { rows: inv } = await pool.query('SELECT name, godown, quantity, unit FROM inventory');
  let seeded = 0;
  for (const it of inv) {
    const { rows: [agg] } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE reference = 'SYSTEM-SEED') AS seed_count,
         COALESCE(SUM(CASE WHEN movement_type = 'ADJUST' THEN quantity
                           WHEN movement_type IN ('IN','OPENING','TRANSFER-IN') THEN quantity
                           ELSE -quantity END), 0) AS net
       FROM stock_ledger WHERE LOWER(name)=LOWER($1) AND godown=$2`,
      [it.name, it.godown]
    );
    if (parseInt(agg.seed_count) > 0) continue;           // already seeded, skip
    const opening = it.quantity - parseFloat(agg.net);    // base so opening + logged movements = current
    await pool.query(
      `INSERT INTO stock_ledger (name, godown, movement_type, quantity, unit, reference, remarks, action_by, action_date, created_at)
       VALUES ($1,$2,'OPENING',$3,$4,'SYSTEM-SEED','Opening balance', 'system', $5, TIMESTAMPTZ '2000-01-01')`,
      [it.name, it.godown, opening, it.unit || 'pcs', new Date().toLocaleDateString()]
    );
    seeded++;
  }
  if (seeded) console.log(`Seeded ${seeded} opening-balance ledger entries`);
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
    CREATE TABLE IF NOT EXISTS issue_slips (
      id SERIAL PRIMARY KEY,
      issued_to TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      issued_by TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS issue_slip_items (
      id SERIAL PRIMARY KEY,
      slip_id INTEGER NOT NULL REFERENCES issue_slips(id),
      name TEXT NOT NULL,
      godown TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT DEFAULT 'pcs'
    );
    CREATE TABLE IF NOT EXISTS stock_verifications (
      id SERIAL PRIMARY KEY,
      godown TEXT NOT NULL,
      verify_date TEXT NOT NULL,
      note TEXT DEFAULT '',
      full_count BOOLEAN DEFAULT FALSE,
      items_counted INTEGER DEFAULT 0,
      items_adjusted INTEGER DEFAULT 0,
      net_change REAL DEFAULT 0,
      verified_by TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stock_verification_lines (
      id SERIAL PRIMARY KEY,
      verification_id INTEGER NOT NULL REFERENCES stock_verifications(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      godown TEXT NOT NULL,
      unit TEXT DEFAULT 'pcs',
      system_qty REAL NOT NULL,
      counted_qty REAL NOT NULL,
      difference REAL NOT NULL
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
    "ALTER TABLE master_items ADD COLUMN IF NOT EXISTS secondary_unit TEXT DEFAULT ''",
    "ALTER TABLE master_items ADD COLUMN IF NOT EXISTS conversion REAL DEFAULT 0",
    // Sessions now expire. Existing tokens are given a full term rather than
    // being cut off, so nobody is signed out by the upgrade itself.
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()",
    "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",
    `UPDATE sessions SET expires_at = NOW() + INTERVAL '${SESSION_DAYS} days' WHERE expires_at IS NULL`,
    // Roles. The column is added without a default first, so only rows that
    // existed BEFORE this upgrade come out NULL -- those are the accounts you
    // already trust, and they are promoted to admin. Everyone created after
    // this defaults to staff. Idempotent: later boots find no NULLs.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT",
    "UPDATE users SET role = 'admin' WHERE role IS NULL",
    "ALTER TABLE users ALTER COLUMN role SET DEFAULT 'staff'",
  ];
  for (const sql of alterCols) {
    try { await pool.query(sql); }
    catch (e) { console.error('Migration step failed:', sql.slice(0, 70), '->', e.message); }
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

  // Backfill opening balances into the ledger for pre-existing stock
  try { await seedLedgerFromInventory(); } catch (e) { console.error('Ledger seed failed:', e.message); }

  console.log('Database ready - v2.2');
};

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'build')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'build', 'index.html')));

const auth = async (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const { rows } = await pool.query(
    `SELECT s.email, s.expires_at, u.role
     FROM sessions s LEFT JOIN users u ON u.email = s.email
     WHERE s.token = $1`,
    [token]
  );
  if (!rows.length) return res.status(401).json({ error: 'Invalid token' });
  if (rows[0].expires_at && new Date(rows[0].expires_at) < new Date()) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  }
  req.user = { email: rows[0].email, role: rows[0].role || 'staff' };
  // Sliding expiry, so an account in daily use is never signed out mid-task --
  // but only refreshed once the term is more than half spent, to avoid a
  // database write on every request.
  const remaining = rows[0].expires_at ? new Date(rows[0].expires_at) - Date.now() : 0;
  if (remaining < (SESSION_DAYS * 24 * 60 * 60 * 1000) / 2) {
    pool.query(
      `UPDATE sessions SET expires_at = NOW() + INTERVAL '${SESSION_DAYS} days' WHERE token = $1`,
      [token]
    ).catch(() => {});
  }
  next();
};

// Destructive and account-management actions are owner-only. Every account that
// existed before roles were introduced is an admin, so nothing you do today
// changes; only newly created staff accounts are limited.
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only an owner account can do this.' });
  }
  next();
};

// Auth
// Public signup is closed. It stays available only while there are no accounts
// at all, so a fresh deployment can create its first owner; after that, accounts
// are created by an owner through POST /api/users.
app.post('/api/signup', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM users');
  if (count > 0 && process.env.ALLOW_SIGNUP !== '1') {
    return res.status(403).json({ error: 'Sign-up is closed. Ask the owner to create your account.' });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  try {
    await pool.query('INSERT INTO users (email, password, role) VALUES ($1, $2, $3)',
      [email, hashPassword(password), count === 0 ? 'admin' : 'staff']);
    res.json({ message: 'Account created! Now sign in.' });
  } catch { res.status(400).json({ error: 'Email already exists' }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const key = loginKey(req, email);
  const lockedMins = loginLockedFor(key);
  if (lockedMins) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${lockedMins} minute(s).` });
  }

  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password)) {
    noteLoginFailure(key);
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  loginFailures.delete(key);

  // Upgrade the stored password in place the first time a legacy account signs
  // in correctly, so plain text disappears without anyone having to reset.
  if (isLegacyPassword(user.password)) {
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(password), user.id]);
  }

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (token, email, expires_at) VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')`,
    [token, user.email]
  );
  res.json({ token, email: user.email, role: user.role || 'staff' });
});

// ---- Accounts ---------------------------------------------------------------
app.get('/api/users', auth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query('SELECT id, email, role FROM users ORDER BY id');
  res.json(rows);
});

app.post('/api/users', auth, requireAdmin, async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const wanted = role === 'admin' ? 'admin' : 'staff';
  try {
    const { rows: [row] } = await pool.query(
      'INSERT INTO users (email, password, role) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, hashPassword(password), wanted]
    );
    res.json(row);
  } catch (e) {
    res.status(400).json({ error: 'That email already has an account' });
  }
});

app.delete('/api/users/:id', auth, requireAdmin, async (req, res) => {
  const { rows: [target] } = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'No such account' });
  if (target.email === req.user.email) return res.status(400).json({ error: 'You cannot delete your own account' });
  await pool.query('DELETE FROM sessions WHERE email = $1', [target.email]);
  await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.json({ message: 'Account removed' });
});

// Anyone can change their OWN password; doing so signs out every other device.
app.post('/api/change-password', auth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (String(new_password || '').length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const { rows: [user] } = await pool.query('SELECT * FROM users WHERE email = $1', [req.user.email]);
  if (!user || !verifyPassword(current_password, user.password)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(new_password), user.id]);
  await pool.query('DELETE FROM sessions WHERE email = $1 AND token <> $2',
    [req.user.email, req.headers['authorization']]);
  res.json({ message: 'Password changed' });
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

// A day sheet can be built for any date, not just today. When entry_date is a
// YYYY-MM-DD string the movement is stamped at midday IST on that date, so
// /api/daily-receipts -- which buckets by created_at in IST -- files it under
// the day the stock actually arrived rather than the day it was typed in.
const IST_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const logLedger = (client, { name, godown, movement_type, quantity, unit, reference, remarks, action_by, action_date, entry_date }) =>
  client.query(
    `INSERT INTO stock_ledger (name, godown, movement_type, quantity, unit, reference, remarks, action_by, action_date, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
             COALESCE(($10::date + TIME '12:00') AT TIME ZONE 'Asia/Kolkata', NOW()))`,
    [name, godown, movement_type, quantity, unit || 'pcs', reference || '', remarks || '', action_by,
     action_date || new Date().toLocaleDateString(),
     IST_DATE_RE.test(entry_date || '') ? entry_date : null]
  );

// Add stock to an existing (name, godown) row if one exists, otherwise create it.
// This is what makes Regular Stock additions accumulate on top of Opening Stock
// instead of fragmenting into a separate row.
async function upsertInventory(client, item, addedBy) {
  const {
    name, quantity, unit, secondary_quantity, secondary_unit, godown, dateAdded,
    price, hsn, builty_number, transporter, remarks, stock_type, category, entry_date
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
    await logLedger(client, { name: row.name, godown, movement_type: movementType, quantity: qty, unit: row.unit, reference: ref, remarks, action_by: addedBy, action_date: dateAdded, entry_date });
    return updated[0];
  }

  const { rows: inserted } = await client.query(
    `INSERT INTO inventory (${INV_FIELDS}) VALUES (${INV_VALS}) RETURNING *`,
    [name, qty, unit || 'pcs', secQty, secondary_unit || '', godown,
     dateAdded || new Date().toLocaleDateString(), addedBy,
     price || 0, hsn || 'N/A', builty_number || '', transporter || '', remarks || '',
     stock_type || 'regular', category || '', stock_type === 'opening' ? qty : 0]
  );
  await logLedger(client, { name: inserted[0].name, godown, movement_type: movementType, quantity: qty, unit: inserted[0].unit, reference: ref, remarks, action_by: addedBy, action_date: dateAdded, entry_date });
  return inserted[0];
}

app.post('/api/inventory', auth, async (req, res) => {
  const row = await upsertInventory(pool, req.body, req.user.email);
  // Remember this item's conversion + secondary unit in the master list so it
  // doesn't have to be re-entered next time the item is added.
  const conv = parseFloat(req.body.conversion);
  if (req.body.name && conv > 0) {
    try {
      await pool.query(
        `INSERT INTO master_items (name, unit, secondary_unit, conversion)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (name) DO UPDATE SET conversion=EXCLUDED.conversion,
           secondary_unit=EXCLUDED.secondary_unit,
           unit=COALESCE(NULLIF(EXCLUDED.unit,''), master_items.unit)`,
        [req.body.name.trim(), req.body.unit || 'pcs', req.body.secondary_unit || '', conv]
      );
    } catch (e) { /* non-fatal */ }
  }
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

// Create an issue slip: deduct all items atomically and store the slip record
app.post('/api/issue-slips', auth, async (req, res) => {
  const { items, issued_to, remarks } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'No items on the slip' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const dateNow = new Date().toLocaleDateString();

    // Validate all availabilities first
    for (const it of items) {
      const { rows } = await client.query(
        'SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [it.id]);
      if (!rows.length) throw Object.assign(new Error(`${it.name}: item not found`), { status: 404 });
      if (rows[0].quantity < it.quantity) throw Object.assign(new Error(`${it.name}: only ${rows[0].quantity} available`), { status: 400 });
    }

    const { rows: slipRows } = await client.query(
      `INSERT INTO issue_slips (issued_to, remarks, issued_by, issue_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [issued_to || '', remarks || '', req.user.email, dateNow]
    );
    const slip = slipRows[0];

    for (const it of items) {
      const { rows } = await client.query('SELECT * FROM inventory WHERE id=$1', [it.id]);
      const inv = rows[0];
      const newQty = inv.quantity - it.quantity;
      if (newQty === 0) {
        await client.query('DELETE FROM inventory WHERE id=$1', [inv.id]);
      } else {
        await client.query(
          'UPDATE inventory SET quantity=$1, last_issued=$2, issued_by=$3 WHERE id=$4',
          [newQty, dateNow, issued_to ? `${req.user.email} -> ${issued_to}` : req.user.email, inv.id]
        );
      }
      await client.query(
        `INSERT INTO issue_slip_items (slip_id, name, godown, quantity, unit) VALUES ($1,$2,$3,$4,$5)`,
        [slip.id, inv.name, inv.godown, it.quantity, inv.unit || 'pcs']
      );
      await logLedger(client, { name: inv.name, godown: inv.godown, movement_type: 'OUT', quantity: it.quantity, unit: inv.unit, reference: `Slip #${slip.id}${issued_to ? ' / ' + issued_to : ''}`, remarks: remarks || '', action_by: req.user.email, action_date: dateNow });
    }

    await client.query('COMMIT');
    res.json({ message: `Slip #${slip.id} issued (${items.length} items)`, slip_id: slip.id });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Recent issue slips with their items
app.get('/api/issue-slips', auth, async (req, res) => {
  const { rows: slips } = await pool.query(`SELECT * FROM issue_slips ORDER BY id DESC LIMIT 50`);
  const ids = slips.map(s => s.id);
  const { rows: items } = ids.length
    ? await pool.query('SELECT * FROM issue_slip_items WHERE slip_id = ANY($1)', [ids])
    : { rows: [] };
  res.json(slips.map(s => ({ ...s, items: items.filter(i => i.slip_id === s.id) })));
});

// Delete (undo) an issue slip: restore quantities to their godowns
app.delete('/api/issue-slips/:id', auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: slips } = await client.query('SELECT * FROM issue_slips WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!slips.length) throw Object.assign(new Error('Slip not found'), { status: 404 });
    if (slips[0].status === 'cancelled') throw Object.assign(new Error('Slip already cancelled'), { status: 400 });

    const { rows: items } = await client.query('SELECT * FROM issue_slip_items WHERE slip_id=$1', [req.params.id]);
    const dateNow = new Date().toLocaleDateString();

    for (const it of items) {
      // Restore quantity: merge back into existing row or recreate it
      const { rows: existing } = await client.query(
        'SELECT * FROM inventory WHERE LOWER(name)=LOWER($1) AND godown=$2 FOR UPDATE',
        [it.name, it.godown]
      );
      if (existing.length) {
        await client.query('UPDATE inventory SET quantity=quantity+$1 WHERE id=$2', [it.quantity, existing[0].id]);
      } else {
        await client.query(
          `INSERT INTO inventory (${INV_FIELDS}) VALUES (${INV_VALS})`,
          [it.name, it.quantity, it.unit || 'pcs', 0, '', it.godown, dateNow, req.user.email,
           0, 'N/A', '', '', `Restored from cancelled slip #${req.params.id}`, 'regular', '', 0]
        );
      }
      await logLedger(client, { name: it.name, godown: it.godown, movement_type: 'IN', quantity: it.quantity, unit: it.unit, reference: `Cancelled slip #${req.params.id}`, remarks: 'Issue slip reversed', action_by: req.user.email, action_date: dateNow });
    }

    await client.query("UPDATE issue_slips SET status='cancelled' WHERE id=$1", [req.params.id]);
    await client.query('COMMIT');
    res.json({ message: `Slip #${req.params.id} cancelled — ${items.length} item(s) restored to stock` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
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
       SUM(CASE WHEN sl.movement_type = 'ADJUST' THEN sl.quantity
                WHEN sl.movement_type IN ('IN','OPENING','TRANSFER-IN') THEN sl.quantity
                ELSE -sl.quantity END)
       OVER (PARTITION BY LOWER(sl.name), sl.godown ORDER BY sl.created_at, sl.id) AS running_balance
     FROM stock_ledger sl
     ${where}
     ORDER BY sl.created_at DESC, sl.id DESC
     LIMIT 500`,
    params
  );
  res.json(rows);
});

// Daily stock received -- IN movements for a given day (IST), for the day-end summary
app.get('/api/daily-receipts', auth, async (req, res) => {
  const date = req.query.date; // YYYY-MM-DD in IST; defaults to today
  const { rows } = await pool.query(
    `SELECT name, godown, quantity, unit, reference, remarks, action_by, created_at
     FROM stock_ledger
     WHERE movement_type = 'IN'
       AND reference <> 'SYSTEM-SEED'
       AND (created_at AT TIME ZONE 'Asia/Kolkata')::date
           = COALESCE($1::date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
     ORDER BY id DESC`,
    [date || null]
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

app.delete('/api/inventory/:id', auth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM inventory WHERE id = $1', [req.params.id]);
  res.json({ message: 'Deleted' });
});

// Item name suggestions (autocomplete) â€" searches master list + existing inventory
app.get('/api/suggestions', auth, async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const { rows } = await pool.query(
    `SELECT name, category, unit, conversion, secondary_unit FROM (
       SELECT name, category, unit, conversion, secondary_unit, 1 AS priority FROM master_items WHERE LOWER(name) LIKE $1
       UNION
       SELECT DISTINCT name, category, unit, 0 AS conversion, secondary_unit, 2 AS priority FROM inventory WHERE LOWER(name) LIKE $1
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
app.put('/api/godowns/:oldName', auth, requireAdmin, async (req, res) => {
  const { newName } = req.body;
  const oldName = decodeURIComponent(req.params.oldName);
  try {
    await pool.query('UPDATE godowns SET name=$1 WHERE name=$2', [newName, oldName]);
    await pool.query('UPDATE inventory SET godown=$1 WHERE godown=$2', [newName, oldName]);
    res.json({ name: newName });
  } catch { res.status(400).json({ error: 'Name already exists' }); }
});

// Delete godown
app.delete('/api/godowns/:name', auth, requireAdmin, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  await pool.query('DELETE FROM godowns WHERE name=$1', [name]);
  res.json({ message: 'Deleted' });
});

// AI Extract
// ---- Physical stock verification -------------------------------------------
// A count sheet for one godown: every item the system thinks is there, so the
// floor figure can be typed straight against it.
app.get('/api/verification/sheet', auth, async (req, res) => {
  const { godown } = req.query;
  if (!godown) return res.status(400).json({ error: 'Godown is required' });
  const { rows } = await pool.query(
    `SELECT id, name, unit, quantity AS system_qty, category
     FROM inventory WHERE godown = $1 ORDER BY LOWER(name)`,
    [godown]
  );
  res.json(rows);
});

// Post a count. Items left blank are NOT counted and are left untouched, unless
// full_count says the whole godown was walked -- then a blank means zero.
// Every difference becomes a signed ADJUST ledger row, so the ledger says
// plainly that stock was corrected by a count and never disguises it as a
// receipt or an issue.
app.post('/api/verification', auth, async (req, res) => {
  const { godown, verify_date, note, full_count, lines, new_items } = req.body;
  const extras = Array.isArray(new_items) ? new_items : [];
  if (!godown) return res.status(400).json({ error: 'Godown is required' });
  if ((!Array.isArray(lines) || !lines.length) && !extras.length) {
    return res.status(400).json({ error: 'Nothing counted' });
  }
  const vdate = IST_DATE_RE.test(verify_date || '') ? verify_date : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: stock } = await client.query(
      'SELECT id, name, unit, quantity FROM inventory WHERE godown = $1 FOR UPDATE',
      [godown]
    );
    const byName = new Map(stock.map(r => [r.name.toLowerCase(), r]));

    let counted = 0, adjusted = 0, net = 0;
    const applied = [];

    for (const line of (Array.isArray(lines) ? lines : [])) {
      const row = byName.get(String(line.name || '').toLowerCase());
      if (!row) continue;                                  // item not in this godown
      const raw = line.counted;
      const blank = raw === '' || raw === null || raw === undefined;
      if (blank && !full_count) continue;                  // not counted -- leave alone
      const countedQty = blank ? 0 : parseFloat(raw);
      if (!isFinite(countedQty) || countedQty < 0) continue;

      counted++;
      const diff = +(countedQty - row.quantity).toFixed(3);
      if (diff === 0) continue;

      adjusted++;
      net += diff;
      await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [countedQty, row.id]);
      await logLedger(client, {
        name: row.name, godown, movement_type: 'ADJUST',
        quantity: diff,                                    // signed: negative = short
        unit: row.unit,
        reference: `VERIFY-${vdate || 'today'}-${godown}`,
        remarks: `Physical count ${countedQty} vs system ${row.quantity}${note ? ' -- ' + note : ''}`,
        action_by: req.user.email,
        action_date: vdate || new Date().toLocaleDateString(),
        entry_date: vdate,
      });
      applied.push({ name: row.name, unit: row.unit, system_qty: row.quantity, counted_qty: countedQty, difference: diff });
    }

    // Stock standing on the floor that the system has never heard of. The count
    // is the first time it is seen, so the item is created here at zero and the
    // whole quantity is posted as a single ADJUST -- same as any other
    // difference, rather than being back-dated as a receipt that never happened.
    for (const extra of extras) {
      const name = String(extra.name || '').trim();
      if (!name) continue;
      const qty = parseFloat(extra.counted);
      if (!isFinite(qty) || qty <= 0) continue;

      const known = byName.get(name.toLowerCase());
      if (known) {                                   // it was on the sheet after all
        const diff = +(qty - known.quantity).toFixed(3);
        counted++;
        if (diff !== 0) {
          adjusted++; net += diff;
          await client.query('UPDATE inventory SET quantity = $1 WHERE id = $2', [qty, known.id]);
          await logLedger(client, {
            name: known.name, godown, movement_type: 'ADJUST', quantity: diff, unit: known.unit,
            reference: `VERIFY-${vdate || 'today'}-${godown}`,
            remarks: `Physical count ${qty} vs system ${known.quantity}${note ? ' -- ' + note : ''}`,
            action_by: req.user.email, action_date: vdate || new Date().toLocaleDateString(), entry_date: vdate,
          });
          applied.push({ name: known.name, unit: known.unit, system_qty: known.quantity, counted_qty: qty, difference: diff });
        }
        continue;
      }

      const unit = (extra.unit || 'pcs').trim() || 'pcs';
      const { rows: [created] } = await client.query(
        `INSERT INTO inventory (name, quantity, unit, godown, date_added, added_by, stock_type)
         VALUES ($1,$2,$3,$4,$5,$6,'regular') RETURNING *`,
        [name, qty, unit, godown, vdate || new Date().toLocaleDateString(), req.user.email]
      );
      byName.set(name.toLowerCase(), { id: created.id, name: created.name, unit: created.unit, quantity: qty });

      counted++; adjusted++; net += qty;
      await logLedger(client, {
        name: created.name, godown, movement_type: 'ADJUST', quantity: qty, unit,
        reference: `VERIFY-${vdate || 'today'}-${godown}`,
        remarks: `Found on floor during count, not previously in system${note ? ' -- ' + note : ''}`,
        action_by: req.user.email, action_date: vdate || new Date().toLocaleDateString(), entry_date: vdate,
      });
      applied.push({ name: created.name, unit, system_qty: 0, counted_qty: qty, difference: qty, is_new: true });
    }

    const { rows: [header] } = await client.query(
      `INSERT INTO stock_verifications (godown, verify_date, note, full_count, items_counted, items_adjusted, net_change, verified_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [godown, vdate || new Date().toISOString().split('T')[0], note || '', !!full_count,
       counted, adjusted, +net.toFixed(3), req.user.email]
    );
    for (const a of applied) {
      await client.query(
        `INSERT INTO stock_verification_lines (verification_id, name, godown, unit, system_qty, counted_qty, difference)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [header.id, a.name, godown, a.unit || 'pcs', a.system_qty, a.counted_qty, a.difference]
      );
    }

    await client.query('COMMIT');
    res.json({ ...header, lines: applied });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get('/api/verifications', auth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM stock_verifications ORDER BY created_at DESC LIMIT 100'
  );
  res.json(rows);
});

app.get('/api/verifications/:id', auth, async (req, res) => {
  const { rows: [header] } = await pool.query('SELECT * FROM stock_verifications WHERE id = $1', [req.params.id]);
  if (!header) return res.status(404).json({ error: 'Verification not found' });
  const { rows: lines } = await pool.query(
    'SELECT * FROM stock_verification_lines WHERE verification_id = $1 ORDER BY LOWER(name)',
    [req.params.id]
  );
  res.json({ ...header, lines });
});

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

// Must sit after every route: the wrapper above funnels rejected handlers here
// instead of letting them become unhandled rejections.
app.use((err, req, res, next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}).catch(err => { console.error('DB init failed:', err); process.exit(1); });
 
