'use strict';

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

// ── Catalog cache (5 min TTL) ─────────────────────────────────
let _cache = null;
let _cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

function storeApi() {
  return process.env.STORE_API_URL || 'https://reech-ai-demo01-4933250423.southamerica-east1.run.app';
}

async function getCatalog() {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL) return _cache;
  const r = await fetch(`${storeApi()}/api/products`);
  if (!r.ok) throw new Error(`API error ${r.status}`);
  const data = await r.json();
  // Sólo activos, con precio real (> 0), sin duplicados por id
  const seen = new Set();
  _cache = (data.products || []).filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    const price = parseFloat(p.price);
    return p.status === 'active' && !isNaN(price) && price > 0;
  });
  _cachedAt = Date.now();
  return _cache;
}

function formatProduct(p) {
  const price = `$${parseFloat(p.price).toFixed(2)}`;
  const img   = p.images?.[0]?.src;
  return `• ${p.title} [${p.product_type || 'producto'}] — ${price}${img ? `\n  ${img}` : ''}`;
}

// ── Tool 1: Buscar productos ──────────────────────────────────
const buscarProductos = tool(
  async ({ query, tipo, precio_max, precio_min }) => {
    try {
      let products = await getCatalog();

      if (query) {
        const q = query.toLowerCase().trim();
        // Filtro estricto: al menos título O tipo deben coincidir
        products = products.filter(p =>
          p.title?.toLowerCase().includes(q) ||
          p.product_type?.toLowerCase().includes(q)
        );
      }
      if (tipo) {
        const t = tipo.toLowerCase();
        products = products.filter(p => p.product_type?.toLowerCase().includes(t));
      }
      if (precio_max != null) products = products.filter(p => parseFloat(p.price) <= precio_max);
      if (precio_min != null) products = products.filter(p => parseFloat(p.price) >= precio_min);

      if (!products.length)
        return 'No encontré productos con esos criterios. Usa listar_categorias para ver qué tipos hay disponibles.';

      return products.slice(0, 8).map(formatProduct).join('\n');
    } catch (e) {
      return `Error al buscar productos: ${e.message}`;
    }
  },
  {
    name: 'buscar_productos',
    description:
      'Busca productos activos en la tienda por nombre, tipo o rango de precio. ' +
      'Úsalo cuando el usuario pregunte por un artículo concreto o quiera filtrar por precio.',
    schema: z.object({
      query:     z.string().optional().describe('Término de búsqueda: nombre del producto o tipo'),
      tipo:      z.string().optional().describe('Tipo exacto: snowboard, accessories, giftcard'),
      precio_max: z.number().optional().describe('Precio máximo en dólares'),
      precio_min: z.number().optional().describe('Precio mínimo en dólares'),
    }),
  }
);

// ── Tool 2: Listar categorías ─────────────────────────────────
const listarCategorias = tool(
  async () => {
    try {
      const products = await getCatalog();
      // Normaliza tipos (snowboard y Snowboard → snowboard)
      const tipoMap = {};
      products.forEach(p => {
        const t = (p.product_type || 'sin categoría').toLowerCase();
        if (!tipoMap[t]) tipoMap[t] = [];
        tipoMap[t].push(parseFloat(p.price));
      });

      const lines = Object.entries(tipoMap).map(([tipo, prices]) => {
        const min = Math.min(...prices);
        const max = Math.max(...prices);
        const rango = min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} – $${max.toFixed(2)}`;
        return `• ${tipo} (${prices.length} producto${prices.length > 1 ? 's' : ''}, ${rango})`;
      });

      return `Catálogo disponible (${products.length} productos activos):\n${lines.join('\n')}`;
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'listar_categorias',
    description:
      'Lista las categorías de productos activos con cantidad y rango de precios. ' +
      'Úsalo cuando el usuario pregunte qué tipos de productos hay o quiera explorar el catálogo.',
    schema: z.object({}),
  }
);

// ── Tool 3: Comparar precios ──────────────────────────────────
const compararPrecios = tool(
  async ({ tipo, ordenar }) => {
    try {
      let products = await getCatalog();
      if (tipo) {
        const t = tipo.toLowerCase();
        products = products.filter(p => p.product_type?.toLowerCase().includes(t));
      }
      if (!products.length) return `No hay productos activos${tipo ? ` del tipo "${tipo}"` : ''}.`;

      products.sort((a, b) =>
        ordenar === 'desc'
          ? parseFloat(b.price) - parseFloat(a.price)
          : parseFloat(a.price) - parseFloat(b.price)
      );

      const label = ordenar === 'desc' ? 'más caros' : 'más baratos';
      return `Productos ${label}${tipo ? ` (${tipo})` : ''}:\n` +
        products.slice(0, 6).map((p, i) =>
          `${i + 1}. ${p.title} — $${parseFloat(p.price).toFixed(2)}`
        ).join('\n');
    } catch (e) {
      return `Error: ${e.message}`;
    }
  },
  {
    name: 'comparar_precios',
    description:
      'Ordena productos por precio. Úsalo cuando el usuario pregunte cuál es el más barato, ' +
      'el más caro, o quiera comparar precios dentro de una categoría.',
    schema: z.object({
      tipo:    z.string().optional().describe('Filtrar por tipo de producto (ej: snowboard)'),
      ordenar: z.enum(['asc', 'desc']).describe('"asc" = más baratos primero, "desc" = más caros'),
    }),
  }
);

// ── Tool 4: Ver inventario ────────────────────────────────────
const verInventario = tool(
  async ({ product_id }) => {
    try {
      const r = await fetch(`${storeApi()}/api/inventory/${product_id}`);
      if (!r.ok) return `No se pudo obtener el inventario para el producto ${product_id}.`;
      const data = await r.json();
      const variants = data.variants || [];
      if (!variants.length) return 'Este producto no tiene variantes registradas.';
      return variants.map(v => {
        const stock = v.available ?? 0;
        const estado = v.inventory_management !== 'shopify'
          ? 'sin seguimiento'
          : stock === 0 ? '❌ Agotado'
          : stock <= 5  ? `⚠️ Pocas unidades (${stock})`
          : `✅ En stock (${stock})`;
        return `• ${v.title} — $${v.price} | ${estado}`;
      }).join('\n');
    } catch (e) {
      return `Error al consultar inventario: ${e.message}`;
    }
  },
  {
    name: 'ver_inventario',
    description:
      'Consulta disponibilidad y stock de un producto por su ID numérico de Shopify. ' +
      'Obtén el ID primero con buscar_productos.',
    schema: z.object({
      product_id: z.number().describe('ID numérico del producto (de buscar_productos)'),
    }),
  }
);

module.exports = { buscarProductos, listarCategorias, compararPrecios, verInventario };
