// Integridad del contenido de /data. Corre en CI con `node --test` y
// sirve igual en local antes de hacer commit de cambios en los JSON.
// Cuando exista la validación compartida en js/shared.js (issue de
// "Validar integridad de datos"), estos tests deberían delegar en ella.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VISUAL_STYLES = ["round", "bowl", "stack"];

const readJSON = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const dupes = (list) => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];

test("todos los JSON de /data parsean", () => {
  const files = readdirSync(join(ROOT, "data"), { recursive: true })
    .map((f) => String(f).replaceAll("\\", "/"))
    .filter((f) => f.endsWith(".json"));
  assert.ok(files.length > 0);
  const errors = [];
  for (const f of files) {
    try { readJSON(`data/${f}`); } catch (e) { errors.push(`data/${f}: ${e.message}`); }
  }
  assert.deepEqual(errors, []);
});

test("game-config.json tiene un rango de jugadores válido", () => {
  const gc = readJSON("data/game-config.json");
  assert.ok(Number.isInteger(gc.minPlayers) && gc.minPlayers >= 1, "minPlayers");
  assert.ok(Number.isInteger(gc.maxPlayers) && gc.maxPlayers >= gc.minPlayers, "maxPlayers >= minPlayers");
});

const dishTypes = readJSON("data/dish-types.json");

test("dish-types.json: ids únicos, campos obligatorios y visualStyle conocido", () => {
  assert.ok(Array.isArray(dishTypes) && dishTypes.length > 0);
  assert.deepEqual(dupes(dishTypes.map((t) => t.id)), [], "ids de tipo duplicados");
  for (const t of dishTypes) {
    for (const k of ["id", "name", "emoji"]) assert.ok(t[k], `${t.id ?? "?"}: falta ${k}`);
    assert.ok(VISUAL_STYLES.includes(t.visualStyle), `${t.id}: visualStyle "${t.visualStyle}" no es ${VISUAL_STYLES.join("/")}`);
  }
});

for (const { id } of dishTypes) {
  describe(`tipo ${id}`, () => {
    const dir = `data/types/${id}`;

    test("tiene ingredients.json, recipes.json y config.json", () => {
      const missing = ["ingredients", "recipes", "config"].filter((f) => !existsSync(join(ROOT, dir, `${f}.json`)));
      assert.deepEqual(missing, [], `faltan en ${dir}/`);
    });
    if (!["ingredients", "recipes", "config"].every((f) => existsSync(join(ROOT, dir, `${f}.json`)))) return;

    const ingredients = readJSON(`${dir}/ingredients.json`);
    const recipes = readJSON(`${dir}/recipes.json`);
    const config = readJSON(`${dir}/config.json`);
    const ingIds = new Set(ingredients.map((i) => i.id));

    test("ingredientes: ids únicos y campos obligatorios", () => {
      assert.deepEqual(dupes(ingredients.map((i) => i.id)), [], "ids de ingrediente duplicados");
      for (const i of ingredients) {
        for (const k of ["id", "name", "emoji", "cat"]) assert.ok(i[k], `${i.id ?? "?"}: falta ${k}`);
      }
    });

    test("recetas: ids únicos, con ingredientes y sin referencias a ingredientes inexistentes", () => {
      assert.deepEqual(dupes(recipes.map((r) => r.id)), [], "ids de receta duplicados");
      // "custom" lo reserva pickCandidates para la receta personalizada.
      assert.ok(!recipes.some((r) => r.id === "custom"), `el id "custom" está reservado`);
      const broken = [];
      for (const r of recipes) {
        assert.ok(r.name, `${r.id}: falta name`);
        assert.ok(Array.isArray(r.ingredients) && r.ingredients.length > 0, `${r.id}: sin ingredientes`);
        for (const ingId of r.ingredients) if (!ingIds.has(ingId)) broken.push(`${r.id} → ${ingId}`);
      }
      assert.deepEqual(broken, [], "recetas que referencian ingredientes inexistentes");
    });

    test("config: cada categoría usada tiene tope en categoryCaps", () => {
      // CONTRIBUTING: una categoría nueva necesita su tope; sin él entra
      // entera en el mazo y rompe el balanceo.
      const caps = config.categoryCaps || {};
      const cats = [...new Set(ingredients.map((i) => i.cat))];
      assert.deepEqual(cats.filter((c) => !(c in caps)), [], "categorías sin tope en config.json → categoryCaps");
      for (const [cat, cap] of Object.entries(caps)) {
        assert.ok(Number.isInteger(cap) && cap >= 0, `categoryCaps.${cat} debe ser un entero >= 0`);
      }
    });

    test("config: valores numéricos válidos", () => {
      for (const k of ["ingredientPoolSize", "candidateMax", "candidateMinOverlap"]) {
        assert.ok(Number.isInteger(config[k]) && config[k] >= 0, `${k} debe ser un entero >= 0`);
      }
      assert.ok(config.candidateMax >= 1, "candidateMax debe ser >= 1");
    });
  });
}
