# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

## [Sin publicar]

### Añadido
- Tests de `buildBalancedPool`, `pickCandidates`, `resolveDishType` y
  `shuffle` con `node:test` (`tests/shared.test.mjs`), incluyendo
  comprobaciones sobre los datos reales de `data/types/` (#2).

### Corregido
- La ronda 2 ya no se queda en "Cargando…" si falla la carga del tipo de
  cena elegido: muestra el error con el fichero que falló y permite
  reintentar (sin perder la ronda 1) o volver al inicio (#19).
- Los errores de carga de `/data` indican siempre el fichero afectado,
  también sin conexión o con JSON inválido.

## [2.0.0] — sin publicar

### Cambiado — rediseño mayor: de "Pizza Match" a "Dinner Match"
- El juego pasa de 2 a **3 rondas**: tipo de cena → ingredientes de ese
  tipo → plato final. Antes solo existía "pizza"; ahora el tipo de cena es
  el resultado de la primera ronda de swipe.
- Modelo de datos reestructurado: `data/ingredients.json` +
  `data/pizzas.json` + `data/config.json` (planos, solo pizza) →
  `data/dish-types.json` + `data/game-config.json` (global) +
  `data/types/<id>/{ingredients,recipes,config}.json` (por tipo).
- `js/shared.js`: `buildRound1Pool` renombrado a `buildBalancedPool`
  (genérico, ya no ligado a "ronda 1"); nueva función `resolveDishType`
  para el desempate cuando varios tipos de cena matchean en la ronda 1.
- `admin.html` gana una pestaña "Tipos de cena" y un selector de tipo en
  Ingredientes/Recetas/Reglas, para gestionar varios catálogos a la vez.
- Contenido de ejemplo: pizza (heredado de v1), más hamburguesa y ensalada
  nuevas, cada una con ~20 ingredientes balanceados por categoría y ~12
  recetas.
- Rebranding: nombre, manifest, iconos (de "pizza" a plato + cubiertos
  genérico) y textos de la UI.

## [1.0.0] — sin publicar

### Añadido
- Juego de dos rondas: swipe de ingredientes (ronda 1) y swipe de pizzas
  propuestas a partir del match de ronda 1 (ronda 2).
- Selección de pool de ronda 1 balanceada por categoría (`categoryCaps` en
  `data/config.json`) para evitar que un tipo de ingrediente domine el mazo.
- Selección de pizzas candidatas para ronda 2 por solapamiento con el match
  de ronda 1, más una opción "con todo" siempre disponible.
- Panel de administración (`admin.html`) para crear/editar/borrar
  ingredientes y pizzas, y ajustar las reglas de balanceo, con exportación a
  JSON.
- PWA instalable (manifest + service worker con cache del app shell).
- Contenido separado del código en `/data/*.json`.
- Documentación de proyecto (`PROJECT.md`), guía de contribución
  (`CONTRIBUTING.md`), contexto para Claude Code (`CLAUDE.md`) y backlog
  estructurado (`backlog/issues.json`) con script de bootstrap a GitHub
  Issues (`scripts/bootstrap-github.sh`).
