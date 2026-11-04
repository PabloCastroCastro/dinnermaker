// Tests de la lógica de negocio de js/shared.js con el runner nativo de Node
// (node:test), sin dependencias. Ejecutar desde la raíz del repo:
//   node --test
// Requiere Node >= 22 (importa js/shared.js como ES module sin package.json).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBalancedPool, pickCandidates, pickDishTypes, resolveDishType, shuffle } from "../js/shared.js";

// Las funciones usan Math.random: las propiedades se comprueban en muchas
// ejecuciones para no depender de una única barajada afortunada.
const RUNS = 200;

const ing = (id, cat) => ({ id, name: id, emoji: "·", cat });
const many = (prefix, cat, n) => Array.from({ length: n }, (_, i) => ing(`${prefix}${i}`, cat));
const countByCat = (pool) => pool.reduce((acc, i) => ((acc[i.cat] = (acc[i.cat] || 0) + 1), acc), {});
const ids = (list) => list.map((x) => x.id);

const readJSON = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const realTypes = readJSON("data/dish-types.json").map((t) => ({
  id: t.id,
  ingredients: readJSON(`data/types/${t.id}/ingredients.json`),
  recipes: readJSON(`data/types/${t.id}/recipes.json`),
  config: readJSON(`data/types/${t.id}/config.json`),
}));

describe("buildBalancedPool", () => {
  test("ninguna categoría supera su cap aunque domine el catálogo", () => {
    // El problema original: "15 quesos y 5 carnes". Aquí 30 quesos con cap 4.
    const ingredients = [...many("queso", "queso", 30), ...many("carne", "carne", 5), ...many("veg", "vegetal", 8)];
    const config = { ingredientPoolSize: 20, categoryCaps: { queso: 4, carne: 5, vegetal: 5 } };
    for (let r = 0; r < RUNS; r++) {
      const counts = countByCat(buildBalancedPool(ingredients, config));
      for (const [cat, cap] of Object.entries(config.categoryCaps)) {
        assert.ok((counts[cat] || 0) <= cap, `${cat}: ${counts[cat]} > cap ${cap}`);
      }
    }
  });

  test("con caps que caben en el pool, cada categoría llena exactamente su cap", () => {
    const ingredients = [...many("queso", "queso", 30), ...many("carne", "carne", 5)];
    const config = { ingredientPoolSize: 20, categoryCaps: { queso: 4, carne: 3 } };
    for (let r = 0; r < RUNS; r++) {
      assert.deepEqual(countByCat(buildBalancedPool(ingredients, config)), { queso: 4, carne: 3 });
    }
  });

  test("recorta a ingredientPoolSize cuando la suma de caps lo supera", () => {
    const ingredients = [...many("a", "a", 10), ...many("b", "b", 10)];
    const config = { ingredientPoolSize: 7, categoryCaps: { a: 10, b: 10 } };
    for (let r = 0; r < RUNS; r++) assert.equal(buildBalancedPool(ingredients, config).length, 7);
  });

  test("ingredientPoolSize 0 o ausente no recorta", () => {
    const ingredients = [...many("a", "a", 6), ...many("b", "b", 4)];
    assert.equal(buildBalancedPool(ingredients, { ingredientPoolSize: 0, categoryCaps: {} }).length, 10);
    assert.equal(buildBalancedPool(ingredients, {}).length, 10);
  });

  test("una categoría sin cap definido entra entera; cap 0 la excluye", () => {
    const ingredients = [...many("a", "a", 6), ...many("b", "b", 4)];
    for (let r = 0; r < RUNS; r++) {
      const counts = countByCat(buildBalancedPool(ingredients, { categoryCaps: { b: 0 } }));
      assert.deepEqual(counts, { a: 6 });
    }
  });

  test("sin duplicados, solo elementos del catálogo y sin mutar la entrada", () => {
    const ingredients = [...many("queso", "queso", 30), ...many("veg", "vegetal", 8)];
    const snapshot = structuredClone(ingredients);
    const config = { ingredientPoolSize: 10, categoryCaps: { queso: 4, vegetal: 8 } };
    const catalog = new Set(ids(ingredients));
    for (let r = 0; r < RUNS; r++) {
      const poolIds = ids(buildBalancedPool(ingredients, config));
      assert.equal(new Set(poolIds).size, poolIds.length, "ids duplicados en el pool");
      assert.ok(poolIds.every((id) => catalog.has(id)));
    }
    assert.deepEqual(ingredients, snapshot);
  });

  test("varía entre ejecuciones (baraja dentro de cada categoría)", () => {
    const ingredients = many("queso", "queso", 30);
    const config = { categoryCaps: { queso: 4 } };
    const seen = new Set();
    for (let r = 0; r < 50; r++) seen.add(ids(buildBalancedPool(ingredients, config)).sort().join());
    assert.ok(seen.size > 1, "siempre sale el mismo subconjunto");
  });

  test("catálogo vacío devuelve pool vacío", () => {
    assert.deepEqual(buildBalancedPool([], { ingredientPoolSize: 20, categoryCaps: { queso: 4 } }), []);
  });

  for (const t of realTypes) {
    test(`datos reales de ${t.id}: respeta categoryCaps e ingredientPoolSize`, () => {
      for (let r = 0; r < RUNS; r++) {
        const pool = buildBalancedPool(t.ingredients, t.config);
        assert.ok(pool.length <= t.config.ingredientPoolSize);
        for (const [cat, n] of Object.entries(countByCat(pool))) {
          const cap = t.config.categoryCaps[cat];
          if (cap !== undefined) assert.ok(n <= cap, `${cat}: ${n} > cap ${cap}`);
        }
      }
    });
  }
});

describe("pickCandidates", () => {
  const recipes = [
    { id: "r4", name: "r4", ingredients: ["a", "b", "c", "d"] },       // overlap 3 (a,b,c), extra 1
    { id: "r3", name: "r3", ingredients: ["a", "b", "c"] },            // overlap 3, extra 0
    { id: "r2", name: "r2", ingredients: ["a", "b", "x", "y"] },       // overlap 2, extra 2
    { id: "r2b", name: "r2b", ingredients: ["b", "c", "x"] },          // overlap 2, extra 1
    { id: "r1", name: "r1", ingredients: ["a", "x", "y"] },            // overlap 1
    { id: "r0", name: "r0", ingredients: ["x", "y", "z"] },            // overlap 0
  ];
  const config = { candidateMax: 6, candidateMinOverlap: 2 };

  test("0 matches: solo la receta personalizada, vacía", () => {
    const out = pickCandidates([], recipes, config);
    assert.equal(out.length, 1);
    assert.equal(out[0].custom, true);
    assert.deepEqual(out[0].ingredients, []);
  });

  test("matches sin ninguna receta con overlap >= 1: solo la personalizada con lo matcheado", () => {
    const out = pickCandidates(["q", "w"], recipes, config);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, "custom");
    assert.deepEqual(out[0].ingredients.sort(), ["q", "w"]);
  });

  test("caso normal: personalizada primero, luego por overlap desc y extra asc", () => {
    // "z" hace que ninguna receta coincida exactamente con lo matcheado.
    const out = pickCandidates(["a", "b", "c", "z"], recipes, config);
    assert.equal(out[0].id, "custom");
    assert.deepEqual(out[0].ingredients.sort(), ["a", "b", "c", "z"]);
    // r1 (overlap 1) queda fuera porque hay >= 2 recetas con overlap >= minOverlap.
    assert.deepEqual(ids(out.slice(1)), ["r3", "r4", "r2b", "r2"]);
    for (const r of out.slice(1)) {
      assert.ok(r.overlap >= 2);
      assert.equal(r.overlap + r.extra, r.ingredients.length);
    }
  });

  test("nunca propone recetas sin ningún ingrediente matcheado", () => {
    const out = pickCandidates(["a"], recipes, { candidateMax: 10, candidateMinOverlap: 1 });
    assert.ok(!ids(out).includes("r0"));
  });

  test("recorta a candidateMax contando la personalizada", () => {
    const out = pickCandidates(["a", "b", "c", "z"], recipes, { candidateMax: 3, candidateMinOverlap: 2 });
    assert.deepEqual(ids(out), ["custom", "r3", "r4"]);
  });

  test("si una receta coincide exactamente con lo matcheado, no se propone la personalizada", () => {
    // r3 = [a, b, c]: la personalizada sería el mismo plato.
    const out = pickCandidates(["a", "b", "c"], recipes, config);
    assert.ok(!ids(out).includes("custom"));
    assert.deepEqual(ids(out), ["r3", "r4", "r2b", "r2"]);
  });

  test("sin personalizada, su hueco lo ocupa otra receta (candidateMax completo)", () => {
    const out = pickCandidates(["a", "b", "c"], recipes, { candidateMax: 3, candidateMinOverlap: 2 });
    assert.deepEqual(ids(out), ["r3", "r4", "r2b"]);
  });

  test("la coincidencia exacta no depende del orden ni de repetidos en el match", () => {
    for (const m of [["c", "a", "b"], ["b", "b", "a", "c"]]) {
      assert.equal(pickCandidates(m, recipes, config)[0].id, "r3");
    }
  });

  test("una receta que contiene todo lo matcheado y algo más no cuenta como idéntica", () => {
    // r4 = [a, b, c, d] ⊃ [a, b, d]? No: con [a, b, d] r4 tiene extra 1 (c).
    const out = pickCandidates(["a", "b", "d"], recipes, config);
    assert.equal(out[0].id, "custom");
  });

  test("si hay menos de 2 recetas con overlap >= minOverlap, relaja a overlap >= 1", () => {
    // Con ["a", "x"]: overlap 2 → r2, r1; overlap 1 → r4, r3, r2b, r0... pero
    // con minOverlap 3 ninguna llega, así que se relaja.
    const out = pickCandidates(["a", "x"], recipes, { candidateMax: 10, candidateMinOverlap: 3 });
    const rest = out.slice(1);
    assert.ok(rest.length >= 2, "no se relajó el filtro");
    assert.ok(rest.every((r) => r.overlap >= 1));
    assert.ok(rest.some((r) => r.overlap < 3));
  });

  test("con exactamente 1 receta sobre minOverlap también relaja", () => {
    const out = pickCandidates(["c", "d"], recipes, { candidateMax: 10, candidateMinOverlap: 2 });
    // Solo r4 tiene overlap 2; se relaja e incluye r3 y r2b (overlap 1).
    assert.deepEqual(ids(out), ["custom", "r4", "r3", "r2b"]);
  });

  test("usa defaults (candidateMax 6, candidateMinOverlap 2) si faltan en config", () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, name: `p${i}`, ingredients: ["a", "b", `e${i}`] }));
    const out = pickCandidates(["a", "b"], big, {});
    assert.equal(out.length, 6);
    assert.ok(out.slice(1).every((r) => r.overlap >= 2));
  });

  test("no duplica ids aunque matchedIds venga con repetidos", () => {
    const out = pickCandidates(["a", "a", "b", "c"], recipes, config);
    assert.equal(new Set(ids(out)).size, out.length);
    assert.deepEqual(out[0].ingredients.sort(), ["a", "b", "c"]);
  });

  test("no muta las recetas de entrada", () => {
    const snapshot = structuredClone(recipes);
    pickCandidates(["a", "b", "c"], recipes, config);
    assert.deepEqual(recipes, snapshot);
  });

  for (const t of realTypes) {
    test(`datos reales de ${t.id}: candidatas válidas para cualquier pool de ronda 2`, () => {
      const known = new Set(ids(t.ingredients));
      for (let r = 0; r < RUNS; r++) {
        // Simula un match de ronda 2: subconjunto aleatorio no vacío del pool.
        const pool = buildBalancedPool(t.ingredients, t.config);
        const matched = ids(pool.filter(() => Math.random() < 0.4));
        if (matched.length === 0) matched.push(pool[0].id);
        const out = pickCandidates(matched, t.recipes, t.config);
        assert.ok(out.length >= 1 && out.length <= t.config.candidateMax);
        const set = new Set(matched);
        const identical = t.recipes.find((rc) => rc.ingredients.length === set.size && rc.ingredients.every((i) => set.has(i)));
        if (identical) {
          assert.ok(!ids(out).includes("custom"), "propone la personalizada habiendo una receta idéntica");
          assert.equal(out[0].id, identical.id);
        } else {
          assert.equal(out[0].id, "custom");
        }
        for (const c of out.filter((x) => !x.custom)) {
          assert.ok(c.overlap >= 1);
          assert.ok(c.ingredients.every((id) => known.has(id)), `${c.id} referencia un ingrediente inexistente`);
        }
      }
    });
  }
});

describe("pickDishTypes", () => {
  const types = Array.from({ length: 19 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));

  test("nunca devuelve más de max tipos, sin repetidos y solo del catálogo", () => {
    const catalog = new Set(ids(types));
    for (let r = 0; r < RUNS; r++) {
      const out = ids(pickDishTypes(types, 10));
      assert.equal(out.length, 10);
      assert.equal(new Set(out).size, 10);
      assert.ok(out.every((id) => catalog.has(id)));
    }
  });

  test("todos los tipos pueden salir (la muestra es aleatoria, no siempre los primeros)", () => {
    const seen = new Set();
    for (let r = 0; r < RUNS; r++) for (const id of ids(pickDishTypes(types, 10))) seen.add(id);
    assert.equal(seen.size, types.length);
  });

  test("con menos tipos que max, max 0 o sin max: entran todos, barajados", () => {
    for (const max of [50, 19, 0, undefined]) {
      assert.deepEqual(ids(pickDishTypes(types, max)).sort(), ids(types).sort(), `max=${max}`);
    }
    const orders = new Set();
    for (let r = 0; r < 20; r++) orders.add(ids(pickDishTypes(types, 0)).join());
    assert.ok(orders.size > 1, "no baraja");
  });

  test("no muta la lista de entrada", () => {
    const snapshot = structuredClone(types);
    pickDishTypes(types, 5);
    assert.deepEqual(types, snapshot);
  });

  test(`game-config.json: dishTypeCandidateMax por defecto razonable (8-10)`, () => {
    const max = readJSON("data/game-config.json").dishTypeCandidateMax;
    assert.ok(max >= 8 && max <= 10, String(max));
  });
});

describe("resolveDishType", () => {
  const types = [{ id: "pizza" }, { id: "hamburguesa" }, { id: "ensalada" }];

  test("sin matches devuelve null", () => {
    assert.equal(resolveDishType([]), null);
  });

  test("un único match: sin empate", () => {
    assert.deepEqual(resolveDishType([types[0]]), { chosen: types[0], tie: false, others: [] });
  });

  test("empate: elige uno de los matcheados y devuelve el resto en others", (t) => {
    t.mock.method(Math, "random", () => 0.5); // floor(0.5 * 3) = 1
    const res = resolveDishType(types);
    assert.equal(res.tie, true);
    assert.equal(res.chosen.id, "hamburguesa");
    assert.deepEqual(ids(res.others), ["pizza", "ensalada"]);
  });

  test("empate: todos los empatados pueden salir", () => {
    const seen = new Set();
    for (let r = 0; r < RUNS; r++) seen.add(resolveDishType(types).chosen.id);
    assert.deepEqual([...seen].sort(), ["ensalada", "hamburguesa", "pizza"]);
  });
});

describe("shuffle", () => {
  test("devuelve una permutación sin mutar la entrada", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const out = shuffle(input);
    assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual([...out].sort(), input);
  });
});
