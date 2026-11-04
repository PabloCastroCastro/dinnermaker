// shared.js — utilidades comunes + acceso a datos de contenido.
// El juego ya no es solo "pizza": hay varios tipos de cena (data/dish-types.json),
// cada uno con su propia carpeta data/types/<id>/{ingredients,recipes,config}.json.

export async function loadGameConfig() {
  const [dishTypes, gameConfig] = await Promise.all([
    fetchJSON("./data/dish-types.json"),
    fetchJSON("./data/game-config.json"),
  ]);
  return { dishTypes, gameConfig };
}

export async function loadTypeData(typeId) {
  const [ingredients, recipes, config] = await Promise.all([
    fetchJSON(`./data/types/${typeId}/ingredients.json`),
    fetchJSON(`./data/types/${typeId}/recipes.json`),
    fetchJSON(`./data/types/${typeId}/config.json`),
  ]);
  return { ingredients, recipes, config, ingById: indexById(ingredients) };
}

// Todos los errores mencionan el fichero: fetch() sin red y res.json() con
// JSON inválido lanzan errores genéricos que no dicen qué falló.
async function fetchJSON(path) {
  let res;
  try {
    res = await fetch(path, { cache: "no-store" });
  } catch {
    throw new Error(`No se pudo cargar ${path} (sin conexión o servidor no disponible)`);
  }
  if (!res.ok) throw new Error(`No se pudo cargar ${path} (${res.status})`);
  try {
    return await res.json();
  } catch {
    throw new Error(`${path} no es un JSON válido`);
  }
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000;
  return h;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function slugify(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24) || "item" + Math.floor(Math.random() * 10000);
}

/**
 * Selecciona un mazo de ingredientes respetando los topes por categoría de
 * config.categoryCaps, para que ninguna categoría pueda dominar el mazo
 * aunque el catálogo tenga muchos ingredientes de un mismo tipo.
 */
export function buildBalancedPool(ingredients, config) {
  const caps = config.categoryCaps || {};
  const byCat = {};
  for (const ing of ingredients) {
    (byCat[ing.cat] = byCat[ing.cat] || []).push(ing);
  }
  let pool = [];
  for (const cat of Object.keys(byCat)) {
    const cap = caps[cat] ?? byCat[cat].length;
    pool = pool.concat(shuffle(byCat[cat]).slice(0, cap));
  }
  pool = shuffle(pool);
  return pool.slice(0, config.ingredientPoolSize || pool.length);
}

/**
 * Dado el conjunto de ids matcheados en la ronda anterior, propone recetas
 * candidatas: prioriza mayor solapamiento y menos ingredientes "extra" no
 * matcheados, y añade primero una receta personalizada con exactamente los
 * ingredientes matcheados (salvo que ya exista una receta con esos mismos
 * ingredientes).
 */
export function pickCandidates(matchedIds, recipes, config) {
  const matchedSet = new Set(matchedIds);
  const minOverlap = config.candidateMinOverlap ?? 2;
  const max = config.candidateMax ?? 6;

  const scored = recipes
    .map((r) => {
      const overlap = r.ingredients.filter((id) => matchedSet.has(id)).length;
      const extra = r.ingredients.length - overlap;
      return { ...r, overlap, extra };
    })
    .filter((r) => r.overlap >= 1);
  scored.sort((a, b) => b.overlap - a.overlap || a.extra - b.extra);

  // Si una receta tiene exactamente los ingredientes matcheados, la
  // personalizada sería el mismo plato repetido: se omite y su hueco lo
  // ocupa otra receta. (Esa receta siempre queda primera: overlap máximo y
  // extra 0, así que nunca se pierde en el recorte.)
  const sameAsCustom = (r) => r.extra === 0 && new Set(r.ingredients).size === matchedSet.size;
  const withCustom = !scored.some(sameAsCustom);
  const slots = withCustom ? max - 1 : max;

  let top = scored.filter((r) => r.overlap >= minOverlap).slice(0, slots);
  if (top.length < 2) top = scored.slice(0, slots);
  if (!withCustom) return top;

  const custom = { id: "custom", name: "La vuestra (con todo)", ingredients: [...matchedSet], custom: true };
  const merged = [custom, ...top].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
  return merged.slice(0, max);
}

/**
 * Mazo de la ronda 1: muestra aleatoria de como mucho `max` tipos de cena
 * (`game-config.json → dishTypeCandidateMax`), para que la ronda no se haga
 * eterna con muchos tipos. Sin `max` (o con 0) entran todos, barajados.
 */
export function pickDishTypes(dishTypes, max) {
  const deck = shuffle(dishTypes);
  return max > 0 ? deck.slice(0, max) : deck;
}

/**
 * Resuelve el tipo de cena elegido a partir de los tipos matcheados en la
 * ronda 1. Si hay más de uno, se sortea entre los empatados.
 */
export function resolveDishType(matchedTypes) {
  if (matchedTypes.length === 0) return null;
  if (matchedTypes.length === 1) return { chosen: matchedTypes[0], tie: false, others: [] };
  const chosen = matchedTypes[Math.floor(Math.random() * matchedTypes.length)];
  return { chosen, tie: true, others: matchedTypes.filter((t) => t.id !== chosen.id) };
}

export function ingObjs(ids, ingByIdMap) {
  return ids.map((id) => ingByIdMap[id]).filter(Boolean);
}

export function indexById(list) {
  return Object.fromEntries(list.map((i) => [i.id, i]));
}
