# Dinner Match — contexto para Claude Code

App web (PWA, sin backend) para que un grupo decida qué cenar sin discutir:
tres rondas de swipe (tipo de cena → ingredientes de ese tipo → plato
final), con pizza/hamburguesa/ensalada como tipos de ejemplo y
`admin.html` para añadir más o editar contenido.

Lee primero `PROJECT.md` (definición completa: arquitectura, modelo de datos,
algoritmos, roadmap) y `README.md` (quickstart) antes de tocar nada. No
dupliques esa información aquí; este fichero es solo instrucciones operativas
para ti.

## Tarea inicial (ejecutar una sola vez, al arrancar en este repo)

1. Comprueba que `gh auth status` esté OK. Si no, pide al usuario que corra
   `gh auth login` y detente.
2. Ejecuta:
   ```
   bash scripts/bootstrap-github.sh dinner-match private
   ```
   (cambia el nombre o la visibilidad si el usuario te lo pide explícitamente).
   Esto crea el repo remoto si no existe, sube el código, crea y sube la rama
   `develop` (ver convención de ramas más abajo), y crea labels, milestones e
   issues a partir de `scripts/labels.tsv`, `scripts/milestones.json` y
   `backlog/issues.json`. Es idempotente: si algo ya existe lo salta, así que
   es seguro re-ejecutarlo.
3. Revisa la salida del script. Si algún label/milestone/issue falló, repórtalo
   al usuario en vez de reintentarlo en bucle silenciosamente.
4. Sustituye el placeholder `<usuario>/<repo>` en `README.md` (sección
   "Desplegar") por la URL real que devuelva `gh repo view --json url`.
5. Haz commit de esa actualización de README y push.
6. Resume al usuario: URL del repo, cuántos labels/milestones/issues se
   crearon (o ya existían), y qué issue tiene sentido abordar primero (mira
   `v1.0 – Deploy & Polish`, es la base antes de las demás).

No crees issues nuevas por tu cuenta en este primer arranque — el backlog
inicial ya está en `backlog/issues.json`. Si el usuario te pide una tarea que
no está ahí, añádela primero a `backlog/issues.json` (para que quede
documentada como fuente) y luego créala en GitHub con `gh issue create`,
manteniendo ambas cosas sincronizadas.

## Convenciones del proyecto

- **Ramas y releases**: `develop` es la rama de integración, `main` es
  producción (solo recibe merges desde `develop` al cerrar un milestone, o
  desde `hotfix/*`). Cada issue se trabaja en `feature/GH-{numero}` desde
  `develop`, PR a `develop`. Al mergear `develop` → `main` se tagea con la
  versión del milestone (`v1.0.0`, `v1.1.0`...). Detalle completo y flujo de
  hotfix en `CONTRIBUTING.md`. No abras ni mergees PRs contra `main`
  directamente salvo que sea ese release o un hotfix.
- **Sin build step**: HTML/CSS/JS vanilla con ES modules (`<script type="module">`).
  No introduzcas un bundler, framework o `package.json` con dependencias de
  build salvo que se abra un issue específico para ello y se discuta antes.
- **Contenido vive en `/data`, no en JS**: tipos de cena, ingredientes,
  recetas y reglas de balanceo son datos. `data/dish-types.json` lista los
  tipos disponibles; cada tipo tiene su propia carpeta
  `data/types/<id>/{ingredients,recipes,config}.json`. Nunca hardcodees un
  ingrediente, receta o tipo de cena dentro de `js/app.js` o `js/admin.js`.
- **`js/shared.js` es la única fuente de verdad** de `buildBalancedPool`
  (que respeta `categoryCaps` del `config.json` de cada tipo),
  `pickCandidates` (selección de recetas para la ronda final) y
  `resolveDishType` (desempate cuando varios tipos de cena matchean en
  ronda 1). No dupliques esta lógica en otro sitio.
- **Estilo visual**: paleta y tipografía ya definidas en `css/style.css`
  (Fredoka + Work Sans + Space Mono; tonos carbón/terracota/mostaza). Si
  añades UI nueva, reutiliza las clases existentes (`.cta`, `.card-panel`,
  `.chip`, etc.) antes de crear clases nuevas.
- **Verificación antes de abrir PR** (requiere Node ≥ 22, sin dependencias):
  ```bash
  node --test                                   # tests de js/shared.js + integridad de /data
  node --input-type=module --check < js/app.js
  ```
  Si cambias `buildBalancedPool`, `pickCandidates` o `resolveDishType`,
  añade o ajusta tests en `tests/shared.test.mjs`. Lo mismo corre en CI
  (`.github/workflows/ci.yml`) en cada push a `main`/`develop` y en cada PR.

## Cómo correr en local

```bash
python3 -m http.server 8080   # o: npx serve .
```

## Estado del roadmap

El backlog completo con criterios de aceptación está en
`backlog/issues.json` (y reflejado en GitHub Issues tras el bootstrap). Los
milestones, de más a menos prioritario ahora mismo:

1. `v1.0 – Deploy & Polish`
2. `v1.1 – Contenido configurable`
3. `v2.0 – Multijugador remoto`
4. `v1.2 – Calidad de vida`
