const express = require('express');
const cors = require('cors');
const path = require('path');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3');

const app = express();
const dbPath = path.join(__dirname, 'royal-imperial-domain.db');
const db = new Database(dbPath);

app.use(cors());
app.use(bodyParser.json());

// Initialize DB tables
const init = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      phone TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guestName TEXT NOT NULL,
      guestEmail TEXT NOT NULL,
      checkIn TEXT NOT NULL,
      checkOut TEXT NOT NULL,
      roomType TEXT NOT NULL,
      numberOfRooms INTEGER NOT NULL,
      totalPrice REAL NOT NULL,
      userId INTEGER,
      bookingStatus TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serviceType TEXT NOT NULL,
      tableNumber INTEGER,
      roomNumber TEXT,
      guestName TEXT NOT NULL,
      totalPrice REAL NOT NULL,
      userId INTEGER,
      status TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (orderId) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      userId INTEGER,
      rating INTEGER NOT NULL,
      text TEXT NOT NULL,
      date TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sync_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      userId INTEGER,
      synced INTEGER NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roomNumber INTEGER UNIQUE NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('available', 'occupied', 'cleaning')),
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kitchen_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requestor TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in-progress', 'completed')),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS housekeeping_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roomNumber INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('needed', 'cleaning', 'cleaned')),
      notes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  // Migrate existing databases to add role column
  try {
    const columnInfo = db.prepare('PRAGMA table_info(users)').all();
    const hasRoleColumn = columnInfo.some(col => col.name === 'role');
    
    if (!hasRoleColumn) {
      db.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT "user"');
      // Set admin role for admin user
      db.prepare('UPDATE users SET role = ? WHERE email = ?').run('admin', 'admin120@hotel.com');
      console.log('Migration: Added role column to users table');
    }
  } catch (err) {
    console.log('Migration check result:', err.message);
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO users (name, email, password, phone, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
    insertUser.run('John Smith', 'john@example.com', 'password', '+63-917-123-4567', 'user', new Date().toISOString());
    insertUser.run('Jane Doe', 'jane@example.com', 'password', '+63-918-234-5678', 'user', new Date().toISOString());
    insertUser.run('Admin', 'admin120@hotel.com', 'password123', '+63-917-555-0000', 'admin', new Date().toISOString());
  }

  const roomCount = db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count;
  if (roomCount === 0) {
    const insertRoom = db.prepare('INSERT INTO rooms (roomNumber, status, updatedAt) VALUES (?, ?, ?)');
    for (let i = 101; i <= 150; i++) {
      insertRoom.run(i, 'available', new Date().toISOString());
    }
  }
};

init();

app.get('/', (req, res) => {
  res.send('Royal Imperial Domain API is running');
});

// Auth
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email, and password are required' });
  }

  try {
    const sql = db.prepare('INSERT INTO users (name, email, password, phone, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)');
    const info = sql.run(name, email, password, phone || '', 'user', new Date().toISOString());
    const user = db.prepare('SELECT id, name, email, phone, role, createdAt FROM users WHERE id=?').get(info.lastInsertRowid);
    return res.json({ success: true, user });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed: users.email')) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }

  const user = db.prepare('SELECT id, name, email, phone, role, createdAt FROM users WHERE email = ? AND password = ?').get(email, password);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  return res.json({ success: true, user });
});

// Booking
app.post('/api/booking', (req, res) => {
  const { guestName, guestEmail, checkIn, checkOut, roomType, numberOfRooms, totalPrice, userId, bookingStatus } = req.body;
  if (!guestName || !guestEmail || !checkIn || !checkOut || !roomType || !numberOfRooms || !totalPrice) {
    return res.status(400).json({ success: false, message: 'Missing booking fields' });
  }

  const sql = db.prepare('INSERT INTO bookings (guestName, guestEmail, checkIn, checkOut, roomType, numberOfRooms, totalPrice, userId, bookingStatus, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const info = sql.run(guestName, guestEmail, checkIn, checkOut, roomType, numberOfRooms, totalPrice, userId || null, bookingStatus || 'confirmed', new Date().toISOString());
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);

  return res.json({ success: true, bookingId: booking.id, booking });
});

app.get('/api/admin/bookings', (req, res) => {
  const bookings = db.prepare('SELECT * FROM bookings ORDER BY createdAt DESC LIMIT 100').all();
  return res.json({ success: true, bookings });
});

// Orders
app.post('/api/order', (req, res) => {
  const { serviceType, tableNumber, roomNumber, items, totalPrice, guestName, userId, status } = req.body;
  if (!serviceType || !items || !Array.isArray(items) || items.length === 0 || !totalPrice || !guestName) {
    return res.status(400).json({ success: false, message: 'Missing order fields' });
  }

  const sql = db.prepare('INSERT INTO orders (serviceType, tableNumber, roomNumber, guestName, totalPrice, userId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const info = sql.run(serviceType, tableNumber || null, roomNumber || '', guestName, totalPrice, userId || null, status || 'received', new Date().toISOString());
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);

  const insertItem = db.prepare('INSERT INTO order_items (orderId, name, price) VALUES (?, ?, ?)');
  items.forEach(i => insertItem.run(order.id, i.name, i.price));

  return res.json({ success: true, orderId: order.id, order });
});

app.get('/api/admin/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY createdAt DESC LIMIT 100').all();
  return res.json({ success: true, orders });
});

app.get('/api/admin/rooms', (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY roomNumber').all();
  return res.json({ success: true, rooms });
});

app.post('/api/admin/rooms', (req, res) => {
  const { roomNumber, status } = req.body;
  if (!roomNumber || !status) {
    return res.status(400).json({ success: false, message: 'roomNumber and status are required' });
  }

  const update = db.prepare('UPDATE rooms SET status = ?, updatedAt = ? WHERE roomNumber = ?');
  const info = update.run(status, new Date().toISOString(), roomNumber);
  if (!info.changes) {
    return res.status(404).json({ success: false, message: 'Room not found' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE roomNumber = ?').get(roomNumber);
  return res.json({ success: true, room });
});

app.get('/api/kitchen/tasks', (req, res) => {
  const tasks = db.prepare('SELECT * FROM kitchen_tasks ORDER BY createdAt DESC LIMIT 200').all();
  return res.json({ success: true, tasks });
});

app.post('/api/kitchen/tasks', (req, res) => {
  const { requestor, description } = req.body;
  if (!requestor || !description) {
    return res.status(400).json({ success: false, message: 'requestor and description are required' });
  }

  const insert = db.prepare('INSERT INTO kitchen_tasks (requestor, description, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
  const info = insert.run(requestor, description, 'pending', new Date().toISOString(), new Date().toISOString());
  const task = db.prepare('SELECT * FROM kitchen_tasks WHERE id = ?').get(info.lastInsertRowid);
  return res.json({ success: true, task });
});

app.get('/api/housekeeping/tasks', (req, res) => {
  const tasks = db.prepare('SELECT * FROM housekeeping_tasks ORDER BY createdAt DESC LIMIT 200').all();
  return res.json({ success: true, tasks });
});

app.post('/api/housekeeping/tasks', (req, res) => {
  const { roomNumber, status, notes } = req.body;
  if (!roomNumber || !status) {
    return res.status(400).json({ success: false, message: 'roomNumber and status are required' });
  }

  const insert = db.prepare('INSERT INTO housekeeping_tasks (roomNumber, status, notes, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)');
  const info = insert.run(roomNumber, status, notes || '', new Date().toISOString(), new Date().toISOString());
  const task = db.prepare('SELECT * FROM housekeeping_tasks WHERE id = ?').get(info.lastInsertRowid);
  return res.json({ success: true, task });
});

app.get('/api/reviews', (req, res) => {
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC LIMIT 100').all();
  return res.json({ success: true, reviews });
});

app.post('/api/reviews', (req, res) => {
  const { name, userId, rating, text } = req.body;
  if (!name || !rating || !text) {
    return res.status(400).json({ success: false, message: 'Missing review fields' });
  }

  const sql = db.prepare('INSERT INTO reviews (name, userId, rating, text, date) VALUES (?, ?, ?, ?, ?)');
  const info = sql.run(name, userId || null, rating, text, new Date().toLocaleDateString());
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
  return res.json({ success: true, review });
});

// Sync transaction
app.post('/api/sync/transaction', (req, res) => {
  const { type, data, userId, timestamp } = req.body;

  if (!type || !data) {
    return res.status(400).json({ success: false, message: 'Missing transaction fields' });
  }

  const sql = db.prepare('INSERT INTO sync_transactions (type, data, userId, synced, timestamp) VALUES (?, ?, ?, ?, ?)');
  const info = sql.run(type, JSON.stringify(data), userId || null, 1, timestamp || new Date().toISOString());
  const transaction = db.prepare('SELECT * FROM sync_transactions WHERE id = ?').get(info.lastInsertRowid);

  return res.json({ success: true, transactionId: transaction.id });
});

app.get('/api/sync/transactions', (req, res) => {
  const transactions = db.prepare('SELECT * FROM sync_transactions ORDER BY timestamp DESC LIMIT 200').all();
  return res.json({ success: true, transactions });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Royal Imperial Domain API server started on port ${PORT}`);
});
