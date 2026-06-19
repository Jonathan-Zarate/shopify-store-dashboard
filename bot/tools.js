'use strict';

const { tool } = require('@langchain/core/tools');
const { z } = require('zod');

// Usa el servidor desplegado que ya tiene el token correcto de Shopify + BigQuery
function storeApi() {
  return process.env.STORE_API_URL || 'https://reech-ai-demo01-4933250423.southamerica-east1.run.app';
}

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

// ── Tool 1: Buscar productos ──────────────────────────────────────
const buscarProductos = tool(
  async ({ query, tipo, precio_max, precio_min }) => {
    try {
      const data = await fetchJSON(`${storeApi()}/api/products`);
      let products = (data.products || []).filter(p => p.status === 'active');

      if (query) {
        const q = query.toLowerCase();
        products = products.filter(p =>
          p.title?.toLowerCase().includes(q) ||
          p.product_type?.toLowerCase().includes(q) ||
          p.vendor?.toLowerCase().includes(q)
        );
      }
      if (tipo) {
        const t = tipo.toLowerCase();
        products = products.filter(p => p.product_type?.toLowerCase().includes(t));
      }
      if (precio_max != null) products = products.filter(p => parseFloat(p.price) <= precio_max);
      if (precio_min != null) products = products.filter(p => parseFloat(p.price) >= precio_min);

      if (!products.length) return 'No encontré productos con esos criterios. Prueba con otros términos o consulta las categorías disponibles.';

      return products.slice(0, 8).map(p => {
        const price = p.price ? `$${parseFloat(p.price).toFixed(2)}` : 'precio no disponible';
        const img   = p.images?.[0]?.src || '';
        return `• ${p.title} [${p.product_type || 'producto'}] — ${price}${img ? `\n  Imagen: ${img}` : ''}`;
      }).join('\n');
    } catch (e) {
      return `Error al buscar productos: ${e.message}`;
    }
  },
  {
    name: 'buscar_productos',
    description:
      'Busca productos en la tienda por nombre, tipo de producto o rango de precio. ' +
      'Úsalo cuando el usuario pregunte por un artículo específico, quiera ver qué hay disponible, o filtre por precio.',
    schema: z.object({
      query: z.string().optional().describe('Término de búsqueda: nombre del producto, vendor, etc.'),
      tipo: z.string().optional().describe('Tipo de producto: snowboard, accessories, giftcard, etc.'),
      precio_max: z.number().optional().describe('Precio máximo en dólares'),
      precio_min: z.number().optional().describe('Precio mínimo en dólares'),
    }),
  }
);

// ── Tool 2: Ver categorías disponibles ───────────────────────────
const listarCategorias = tool(
  async () => {
    try {
      const data = await fetchJSON(`${storeApi()}/api/products`);
      const products = data.products || [];
      const tipos = [...new Set(products.filter(p => p.product_type).map(p => p.product_type))];
      const vendors = [...new Set(products.filter(p => p.vendor).map(p => p.vendor))];
      const stats = tipos.map(t => {
        const grupo = products.filter(p => p.product_type === t);
        const precios = grupo.map(p => parseFloat(p.price)).filter(Boolean);
        const min = Math.min(...precios);
        const max = Math.max(...precios);
        return `• ${t} (${grupo.length} productos, $${min.toFixed(2)} – $${max.toFixed(2)})`;
      });
      return `Categorías disponibles en la tienda:\n${stats.join('\n')}\n\nVendedores: ${vendors.join(', ')}`;
    } catch (e) {
      return `Error al obtener categorías: ${e.message}`;
    }
  },
  {
    name: 'listar_categorias',
    description:
      'Lista todas las categorías de productos disponibles con rango de precios. ' +
      'Úsalo cuando el usuario pregunte qué tipos de productos hay o quiera explorar el catálogo.',
    schema: z.object({}),
  }
);

// ── Tool 3: Ver colecciones ───────────────────────────────────────
const verColecciones = tool(
  async () => {
    try {
      const data = await fetchJSON(`${storeApi()}/api/collections`);
      const cols = data.collections || [];
      if (!cols.length) return 'No hay colecciones configuradas en la tienda.';
      return 'Colecciones de la tienda:\n' +
        cols.map(c => `• ${c.title} (${c.type || 'colección'}) — handle: "${c.handle}"`).join('\n');
    } catch (e) {
      return `Error al obtener colecciones: ${e.message}`;
    }
  },
  {
    name: 'ver_colecciones',
    description:
      'Muestra las colecciones y agrupaciones de la tienda. ' +
      'Úsalo cuando el usuario pregunte por colecciones, temporadas o grupos especiales de productos.',
    schema: z.object({}),
  }
);

// ── Tool 4: Ver inventario de un producto ────────────────────────
const verInventario = tool(
  async ({ product_id }) => {
    try {
      const data = await fetchJSON(`${storeApi()}/api/inventory/${product_id}`);
      const variants = data.variants || [];
      if (!variants.length) return `No se encontraron variantes para el producto ${product_id}.`;
      const lines = variants.map(v => {
        const stock = v.available ?? v.inventory_quantity ?? 'desconocido';
        const stockLabel = typeof stock === 'number'
          ? (stock === 0 ? '❌ Sin stock' : stock <= 5 ? `⚠️ Pocas unidades (${stock})` : `✅ En stock (${stock})`)
          : 'Stock desconocido';
        return `• ${v.title} — $${v.price} | ${stockLabel}`;
      });
      return `Variantes e inventario:\n${lines.join('\n')}`;
    } catch (e) {
      return `Error al consultar inventario: ${e.message}`;
    }
  },
  {
    name: 'ver_inventario',
    description:
      'Consulta las variantes, tallas, precios y disponibilidad de stock de un producto específico. ' +
      'Úsalo cuando el usuario pregunte por disponibilidad, tallas o quiera saber si hay stock.',
    schema: z.object({
      product_id: z.number().describe('ID numérico del producto en Shopify (obtenido de buscar_productos)'),
    }),
  }
);

// ── Tool 5: Producto más barato / más caro ───────────────────────
const compararPrecios = tool(
  async ({ tipo, ordenar }) => {
    try {
      const data = await fetchJSON(`${storeApi()}/api/products`);
      let products = (data.products || []).filter(p => p.status === 'active' && p.price);
      if (tipo) products = products.filter(p => p.product_type?.toLowerCase().includes(tipo.toLowerCase()));

      products.sort((a, b) =>
        ordenar === 'desc'
          ? parseFloat(b.price) - parseFloat(a.price)
          : parseFloat(a.price) - parseFloat(b.price)
      );

      if (!products.length) return 'No hay productos disponibles con esos criterios.';

      return products.slice(0, 5).map((p, i) =>
        `${i + 1}. ${p.title} — $${parseFloat(p.price).toFixed(2)}`
      ).join('\n');
    } catch (e) {
      return `Error al comparar precios: ${e.message}`;
    }
  },
  {
    name: 'comparar_precios',
    description:
      'Ordena productos por precio (más barato o más caro). ' +
      'Úsalo cuando el usuario quiera el producto más económico, el más caro, o comparar precios dentro de una categoría.',
    schema: z.object({
      tipo: z.string().optional().describe('Filtrar por tipo de producto (ej: snowboard)'),
      ordenar: z.enum(['asc', 'desc']).describe('"asc" para más baratos primero, "desc" para más caros primero'),
    }),
  }
);

module.exports = { buscarProductos, listarCategorias, verColecciones, verInventario, compararPrecios };
