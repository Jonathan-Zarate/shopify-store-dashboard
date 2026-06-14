require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

const SHOP  = process.env.SHOPIFY_STORE;   // e.g. reechai.myshopify.com
const TOKEN = process.env.SHOPIFY_TOKEN;  // shpat_...
const API_V = '2024-10';
const BIGQUERY_API = process.env.BIGQUERY_API_URL || 'https://bigquery-to-api-4933250423.southamerica-east1.run.app';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));  // serve frontend

// ── helpers ────────────────────────────────────────────────────
function shopifyUrl(path) {
  return `https://${SHOP}/admin/api/${API_V}${path}`;
}

function shopifyHeaders() {
  return {
    'Content-Type':         'application/json',
    'X-Shopify-Access-Token': TOKEN,
  };
}

function missingConfig(res) {
  if (!SHOP || !TOKEN) {
    res.status(500).json({ error: 'Missing SHOPIFY_SHOP or SHOPIFY_TOKEN in .env' });
    return true;
  }
  return false;
}

// ── GET /api/products ─────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  try {
    const [bqRes, shopifyRes] = await Promise.all([
      fetch(BIGQUERY_API),
      fetch(shopifyUrl('/products.json?limit=250&fields=id,images'), { headers: shopifyHeaders() }),
    ]);

    if (!bqRes.ok) {
      const text = await bqRes.text();
      return res.status(bqRes.status).json({ error: text });
    }

    const bqData  = await bqRes.json();
    const seen    = new Set();
    const products = (bqData.products || []).filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    if (shopifyRes.ok) {
      const shopifyData = await shopifyRes.json();
      const imageMap = {};
      (shopifyData.products || []).forEach(p => { imageMap[p.id] = p.images || []; });
      products.forEach(p => { p.images = imageMap[p.id] || []; });
    }

    res.json({ products, total: products.length, status: 'success' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/products ────────────────────────────────────────
app.post('/api/products', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const body = { product: req.body };
    const r = await fetch(shopifyUrl('/products.json'), {
      method:  'POST',
      headers: shopifyHeaders(),
      body:    JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.status(201).json(data.product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/products/:id ─────────────────────────────────────
app.put('/api/products/:id', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const body = { product: { id: req.params.id, ...req.body } };
    const r = await fetch(shopifyUrl(`/products/${req.params.id}.json`), {
      method:  'PUT',
      headers: shopifyHeaders(),
      body:    JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data.product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/products/:id ──────────────────────────────────
app.delete('/api/products/:id', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const r = await fetch(shopifyUrl(`/products/${req.params.id}.json`), {
      method:  'DELETE',
      headers: shopifyHeaders(),
    });
    if (!r.ok) {
      const data = await r.json();
      return res.status(r.status).json(data);
    }
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/images ───────────────────────────────────────────
app.get('/api/images', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const images = [];
    let url = shopifyUrl('/products.json?limit=250&fields=id,title,images');
    while (url) {
      const r = await fetch(url, { headers: shopifyHeaders() });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      const data = await r.json();
      (data.products || []).forEach(p => {
        (p.images || []).forEach(img => {
          images.push({ id: img.id, src: img.src, alt: img.alt || p.title, product_title: p.title });
        });
      });
      const link = r.headers.get('link') || '';
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      url = next ? next[1] : null;
    }
    res.json({ images });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    shop:   SHOP   || '(not set)',
    token:  TOKEN  ? `${TOKEN.slice(0, 10)}…` : '(not set)',
  });
});

app.listen(PORT, () => {
  console.log(`\n  Store Admin proxy running at http://localhost:${PORT}`);
  console.log(`  Shop:  ${SHOP  || '⚠ SHOPIFY_SHOP not set'}`);
  console.log(`  Token: ${TOKEN ? TOKEN.slice(0, 10) + '…' : '⚠ SHOPIFY_TOKEN not set'}\n`);
});
