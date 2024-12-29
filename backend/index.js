const express = require('express');
const bodyParser = require('body-parser');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database initialization
let db;
(async () => {
  db = await open({
    filename: './ecommerce.db',
    driver: sqlite3.Database,
  });

  // Initialize tables
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
})();

// Routes

// Add item to cart
app.post('/cart', async (req, res) => {
  const { userId, productId, quantity } = req.body;

  try {
    const product = await db.get('SELECT * FROM products WHERE id = ?', [productId]);
    if (!product || product.stock < quantity) {
      throw new Error('Product not available or insufficient stock.');
    }

    await db.run(
      'INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)',
      [userId, productId, quantity]
    );

    res.status(200).send({ message: 'Item added to cart.' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Fetch cart details
app.get('/cart/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const cartItems = await db.all(
      `SELECT c.id, p.name, p.price, c.quantity 
       FROM carts c 
       JOIN products p ON c.product_id = p.id 
       WHERE c.user_id = ?`,
      [userId]
    );
    res.status(200).send(cartItems);
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Initiate payment using fetch
app.post('/payment', async (req, res) => {
  const { userId, amount } = req.body;

  try {
    const order = await db.run(
      'INSERT INTO orders (user_id, amount) VALUES (?, ?)',
      [userId, amount]
    );

    const orderId = order.lastID; // Corrected to `lastID`

    const response = await fetch('https://sandbox.cashfree.com/api/v2/cftoken/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': 'your-client-id', // Replace with your Cashfree client ID
        'x-client-secret': 'your-client-secret', // Replace with your Cashfree client secret
      },
      body: JSON.stringify({
        orderId: orderId,
        orderAmount: amount,
        orderCurrency: 'INR',
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate payment token');
    }

    const responseData = await response.json();

    res.status(200).send({ token: responseData.cftoken });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Handle webhooks for payment status
app.post('/payment/webhook', async (req, res) => {
  const { orderId, orderStatus } = req.body;

  try {
    if (!orderId || !orderStatus) {
      throw new Error('Invalid webhook payload.');
    }

    await db.run('UPDATE orders SET status = ? WHERE id = ?', [orderStatus, orderId]);
    res.status(200).send({ message: 'Payment status updated.' });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
