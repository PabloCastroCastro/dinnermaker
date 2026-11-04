// Coherencia entre service-worker.js y los ficheros del repo: si una ruta del
// precache no existe, ese fichero no estará disponible offline; si un módulo
// de js/ no está precacheado, la app no arranca offline en la primera visita.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sw = readFileSync(join(ROOT, "service-worker.js"), "utf8");
const block = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
const assets = block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];

test("service-worker.js declara ASSETS", () => {
  assert.ok(assets.length > 0, "no se encontró const ASSETS = [...] en service-worker.js");
});

test("todas las rutas precacheadas existen", () => {
  const missing = assets
    .filter((a) => a !== "./")
    .filter((a) => !existsSync(join(ROOT, a)));
  assert.deepEqual(missing, []);
});

test("el shell completo está precacheado (HTML, CSS, módulos JS, manifest, datos globales)", () => {
  const required = [
    "./index.html", "./admin.html", "./manifest.json", "./css/style.css",
    "./data/dish-types.json", "./data/game-config.json",
    ...readdirSync(join(ROOT, "js")).filter((f) => f.endsWith(".js")).map((f) => `./js/${f}`),
  ];
  assert.deepEqual(required.filter((r) => !assets.includes(r)), []);
});

test("los iconos del manifest están precacheados", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const icons = manifest.icons.map((i) => `./${i.src.replace(/^\.\//, "")}`);
  assert.deepEqual(icons.filter((i) => !assets.includes(i)), []);
});
