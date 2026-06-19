require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const path     = require('path');
const { getBot } = require('./bot/graph');

const app  = express();
const PORT = process.env.PORT || 3000;

const SHOP  = process.env.SHOPIFY_STORE;   // e.g. reechai.myshopify.com
const TOKEN = process.env.SHOPIFY_TOKEN;  // shpat_...
const API_V = '2024-10';
const BIGQUERY_API    = process.env.BIGQUERY_API_URL || 'https://bigquery-to-api-4933250423.southamerica-east1.run.app';
const GROQ_API_KEY    = process.env.GROQ_API_KEY;
const GROQ_MODEL      = 'llama-3.3-70b-versatile';
const TELEGRAM_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT   = process.env.TELEGRAM_CHAT_ID;

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
      fetch(shopifyUrl('/products.json?limit=250&fields=id,images,variants'), { headers: shopifyHeaders() }),
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
      const priceMap = {};
      (shopifyData.products || []).forEach(p => {
        imageMap[p.id] = p.images || [];
        const v = (p.variants || [])[0];
        if (v?.price) priceMap[p.id] = v.price;
      });
      products.forEach(p => {
        p.images = imageMap[p.id] || [];
        if (priceMap[p.id]) p.price = priceMap[p.id];
      });
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
    sendTelegram(`✅ *Producto creado*\n*${data.product.title}*\nEstado: ${data.product.status}`);
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
    sendTelegram(`✏️ *Producto actualizado*\n*${data.product.title}*\nEstado: ${data.product.status}`);
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
    sendTelegram(`🗑️ *Producto eliminado*\nID: \`${req.params.id}\``);
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Telegram helper ───────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'Markdown' }),
    });
  } catch (err) {
    console.error('Telegram error:', err.message);
  }
}

// ── POST /api/ai/generate ─────────────────────────────────────
app.post('/api/ai/generate', async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  const { title, product_type, vendor, description, action = 'generate', campaign } = req.body;
  const context = `"${title}"${product_type ? ` (tipo: ${product_type})` : ''}${vendor ? `, marca ${vendor}` : ''}`;
  const prompts = {
    generate: `Escribe una descripción comercial atractiva de 2-3 oraciones para el producto ${context}. Solo devuelve el texto de la descripción.`,
    improve:  `Mejora esta descripción del producto ${context}: "${description}". Hazla más atractiva y comercial. Solo devuelve el texto mejorado.`,
    campaign: `Escribe una descripción promocional urgente para el producto ${context} para una campaña de ${campaign || 'ventas'}. Solo devuelve el texto.`,
  };
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompts[action] || prompts.generate }],
        max_tokens: 250,
        temperature: 0.7,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Groq error' });
    res.json({ description: data.choices[0].message.content.trim() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/notify ──────────────────────────────────────────
app.post('/api/notify', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  await sendTelegram(message);
  res.json({ success: true });
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

// ── GET /api/inventory/:productId ────────────────────────────
app.get('/api/inventory/:productId', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const variantsRes  = await fetch(shopifyUrl(`/products/${req.params.productId}/variants.json`), { headers: shopifyHeaders() });
    const variantsData = await variantsRes.json();
    const variants     = variantsData.variants || [];

    res.json({
      variants: variants.map(v => ({
        id:                   v.id,
        title:                v.title,
        sku:                  v.sku || '',
        price:                v.price,
        inventory_item_id:    v.inventory_item_id,
        inventory_management: v.inventory_management,
        available:            v.inventory_quantity ?? 0,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/inventory/:variantId ─────────────────────────────
app.put('/api/inventory/:variantId', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const { inventory_item_id, available, product_title, variant_title } = req.body;

    // Get location from inventory levels (no read_locations scope needed)
    const levelsRes  = await fetch(shopifyUrl(`/inventory_levels.json?inventory_item_ids=${inventory_item_id}`), { headers: shopifyHeaders() });
    const levelsData = await levelsRes.json();
    const locationId = levelsData.inventory_levels?.[0]?.location_id;
    if (!locationId) return res.status(500).json({ error: 'No inventory location found. Enable inventory tracking for this product in Shopify.' });

    const r = await fetch(shopifyUrl('/inventory_levels/set.json'), {
      method: 'POST',
      headers: shopifyHeaders(),
      body: JSON.stringify({
        inventory_item_id: Number(inventory_item_id),
        location_id:       Number(locationId),
        available:         parseInt(available, 10),
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);

    const qty  = parseInt(available, 10);
    const name = product_title + (variant_title && variant_title !== 'Default Title' ? ` - ${variant_title}` : '');
    if (qty <= 5) {
      sendTelegram(`⚠️ *Stock bajo detectado*\n*${name}*\nStock actual: *${qty} unidades*\nSe recomienda reabastecer.`);
    } else {
      sendTelegram(`📦 *Inventario actualizado*\n*${name}*\nNuevo stock: *${qty} unidades*`);
    }

    res.json(data.inventory_level);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collections ─────────────────────────────────────
app.get('/api/collections', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const [smartRes, customRes] = await Promise.all([
      fetch(shopifyUrl('/smart_collections.json?limit=250'), { headers: shopifyHeaders() }),
      fetch(shopifyUrl('/custom_collections.json?limit=250'), { headers: shopifyHeaders() }),
    ]);
    const smartData  = await smartRes.json();
    const customData = await customRes.json();
    const smart  = (smartData.smart_collections  || []).map(c => ({ ...c, type: 'smart'  }));
    const custom = (customData.custom_collections || []).map(c => ({ ...c, type: 'custom' }));
    res.json({ collections: [...smart, ...custom] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/collections ─────────────────────────────────────
app.post('/api/collections', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const { title, rules, disjunctive = false } = req.body;
    const body = { smart_collection: { title, disjunctive, rules } };
    const r = await fetch(shopifyUrl('/smart_collections.json'), {
      method: 'POST', headers: shopifyHeaders(), body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    sendTelegram(`📂 *Colección creada*\n*${data.smart_collection.title}*\n${rules.length} regla(s) configurada(s)`);
    res.status(201).json(data.smart_collection);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/collections/:id/products ────────────────────────
app.get('/api/collections/:id/products', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const r = await fetch(
      shopifyUrl(`/collections/${req.params.id}/products.json?limit=250&fields=id,title,status,vendor,product_type,images`),
      { headers: shopifyHeaders() }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json({ products: data.products || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/collections/:id ──────────────────────────────
app.delete('/api/collections/:id', async (req, res) => {
  if (missingConfig(res)) return;
  try {
    const r = await fetch(shopifyUrl(`/smart_collections/${req.params.id}.json`), {
      method: 'DELETE', headers: shopifyHeaders(),
    });
    if (!r.ok) {
      const data = await r.json();
      return res.status(r.status).json(data);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/chat (LangGraph assistant — usa BigQuery + Shopify) ─
app.post('/api/chat', async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  const { messages } = req.body;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'messages required' });
  try {
    const result = await getBot().invoke({ messages }, { recursionLimit: 10 });
    const last   = result.messages[result.messages.length - 1];
    res.json({ reply: last.content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/meetings/summarize ──────────────────────────────
app.post('/api/meetings/summarize', async (req, res) => {
  if (!GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  const { title, date, participants, transcript } = req.body;
  if (!transcript || !transcript.trim()) return res.status(400).json({ error: 'transcript is required' });

  const prompt = `Analiza las siguientes notas de reunión y genera un resumen estructurado en español.

Reunión: "${title || 'Sin título'}"${date ? `\nFecha: ${date}` : ''}${participants ? `\nParticipantes: ${participants}` : ''}

Notas/Transcripción:
${transcript}

Responde ÚNICAMENTE con un JSON válido con esta estructura:
{
  "summary": "Resumen ejecutivo de 2-3 oraciones",
  "key_points": ["punto clave 1", "punto clave 2"],
  "agreements": ["acuerdo 1", "acuerdo 2"],
  "action_items": ["acción 1", "acción 2"]
}`;

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.3,
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Groq error' });

    const text = data.choices[0].message.content.trim();
    let result;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      result = { summary: text, key_points: [], agreements: [], action_items: [] };
    }

    const kp = (result.key_points || []).map(p => `• ${p}`).join('\n') || '—';
    const ag = (result.agreements   || []).map(a => `• ${a}`).join('\n') || '—';
    const ai = (result.action_items || []).map(a => `• ${a}`).join('\n') || '—';
    sendTelegram(`📋 *Resumen de reunión*\n*${title || 'Sin título'}*${date ? `\n📅 ${date}` : ''}\n\n*Resumen:*\n${result.summary}\n\n*Puntos clave:*\n${kp}\n\n*Acuerdos:*\n${ag}\n\n*Acciones:*\n${ai}`);

    res.json(result);
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
