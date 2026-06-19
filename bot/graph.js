'use strict';

const { createReactAgent } = require('@langchain/langgraph/prebuilt');
const { ChatGroq } = require('@langchain/groq');
const { buscarProductos, listarCategorias, verInventario, compararPrecios } = require('./tools');

const SYSTEM_PROMPT = `Eres el asistente virtual de la tienda online Test-Reech, especializada en equipamiento para deportes de invierno (snowboards y accesorios).
Eres amigable, entusiasta de los deportes de montaña, y experto en los productos de la tienda.

HERRAMIENTAS DISPONIBLES — úsalas así:
- buscar_productos: cuando el usuario pregunta por un producto concreto o quiere filtrar por precio
- listar_categorias: cuando el usuario quiere explorar qué tipos de productos hay o pide el catálogo
- ver_inventario: cuando el usuario pregunta por disponibilidad o stock (usa buscar_productos primero para obtener el ID)
- comparar_precios: cuando el usuario pide el más barato, más caro, o quiere comparar precios en una categoría

REGLAS CRÍTICAS:
1. Usa COMO MÁXIMO UNA herramienta por turno
2. Tras recibir el resultado de una herramienta, responde directamente al usuario SIN llamar más herramientas
3. Responde SIEMPRE en español, de forma cercana y natural
4. Incluye el precio siempre que lo tengas
5. Respuestas concisas (máximo 5 oraciones)
6. Si el usuario pregunta por el precio más barato o más caro, usa comparar_precios con tipo y ordenar`;

let _bot = null;

function createBot() {
  const llm = new ChatGroq({
    model: 'llama-3.3-70b-versatile',
    temperature: 0.3,
    apiKey: process.env.GROQ_API_KEY,
  });

  return createReactAgent({
    llm,
    tools: [buscarProductos, listarCategorias, compararPrecios, verInventario],
    stateModifier: SYSTEM_PROMPT,
  });
}

function getBot() {
  if (!_bot) _bot = createBot();
  return _bot;
}

module.exports = { createBot, getBot };
