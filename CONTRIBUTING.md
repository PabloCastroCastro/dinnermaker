# Contribuir a Dinner Match

## Antes de nada
Lee `PROJECT.md` (arquitectura y modelo de datos) y, si vas a usar Claude
Code, `CLAUDE.md` (convenciones que debe seguir).

## Flujo de ramas y releases

- **`main`**: rama de producción, siempre desplegable (es lo que sirve GitHub
  Pages). Solo recibe merges desde `develop` (al cerrar un milestone) o desde
  `hotfix/*` (parches urgentes).
- **`develop`**: rama de integración. Todo el trabajo en curso vive aquí antes
  de llegar a producción.
- **Por cada issue**, rama `feature/GH-{numero}` desde `develop` (ej.
  `feature/GH-12` para la issue #12):
  ```bash
  git checkout develop && git pull
  git checkout -b feature/GH-12
  ```
  PR de `feature/GH-{numero}` → `develop` (no a `main`), enlazando la issue
  con `Closes #12` en el cuerpo del PR.
- **Release**: cuando las issues de un milestone (`v1.0`, `v1.1`...) están
  cerradas en `develop`, se abre un PR `develop` → `main`. Al mergearlo:
  1. Tag en `main` con la versión exacta del milestone: `v1.0.0`, `v1.1.0`,
     `v1.2.0`, `v2.0.0`.
  2. GitHub Release con las entradas correspondientes de `CHANGELOG.md`.
- **Hotfix** (bug urgente en producción que no puede esperar al siguiente
  release): rama `hotfix/GH-{numero}` desde `main`, PR a `main`, tag de patch
  (ej. `v1.0.0` → `v1.0.1`), y después back-merge de `main` a `develop` para
  no perder el fix:
  ```bash
  git checkout main && git checkout -b hotfix/GH-12
  # ... fix, PR y merge a main, tag vX.Y.(Z+1) ...
  git checkout develop && git merge main && git push
  ```

## Cada cambio, paso a paso
1. Cambios en tu rama `feature/GH-{numero}`. Si tocas contenido, hazlo en
   `/data/*.json`, no en JS.
2. Verificación mínima antes de abrir PR (Node ≥ 22, sin `npm install`):
   ```bash
   node --test   # tests de js/shared.js + integridad de /data (tests/*.test.mjs)
   node --input-type=module --check < js/app.js
   node --input-type=module --check < js/admin.js
   node --input-type=module --check < js/shared.js
   ```
   La CI (`.github/workflows/ci.yml`) corre lo mismo en cada PR; no
   mergees con la CI en rojo.
3. Sirve la app en local y pruébala de verdad (`python3 -m http.server 8080`)
   antes de pedir review — la mayoría de bugs de este proyecto son de UI/estado,
   no se ven solo leyendo el diff.
4. Abre PR contra `develop` usando la plantilla, enlaza la issue con
   `Closes #N`.

## Añadir un ingrediente o receta a un tipo existente
No hace falta tocar código:
- A mano: edita `data/types/<tipo>/ingredients.json` / `recipes.json`.
- Con UI: `admin.html` → elige el tipo en el desplegable → editar → exportar
  → sustituir el fichero.

Si el ingrediente introduce una categoría (`cat`) nueva, añade también su
tope en `data/types/<tipo>/config.json → categoryCaps`, o el mazo de esa
ronda la ignorará al repartir cupos.

## Añadir un tipo de cena nuevo
Ver `README.md` sección "Añadir un tipo de cena nuevo" — resumen: crea
`data/types/<id>/{ingredients,recipes,config}.json` (a mano o vía
`admin.html`) y añade la entrada en `data/dish-types.json`. No hace falta
tocar `service-worker.js` ni el código JS.

## Service worker y caché
`service-worker.js` sirve todo lo del propio sitio con *network-first*
(con conexión siempre llega lo último publicado; la caché es solo para
offline o red lenta) y nunca cachea respuestas de error. Por eso:
- **Cambiar `/data` o el código no requiere tocar el service worker.**
- **Sube `CACHE_NAME`** (`dinner-match-v4` → `v5`...) solo si quieres purgar
  la caché de todos los clientes: al renombrar o borrar ficheros del shell,
  o si cambias la estrategia de caché.
- Si añades un fichero al shell (un HTML, CSS o módulo de `js/` nuevo),
  añádelo a `ASSETS` para que funcione offline desde la primera visita.
  `tests/sw.test.mjs` falla si falta alguno o si una ruta de `ASSETS` no
  existe.

## Añadir una tarea al backlog
Añádela a `backlog/issues.json` (con `title`, `body`, `labels`, `milestone`)
y luego créala en GitHub con:
```bash
gh issue create --title "..." --body "..." --label "..." --milestone "..."
```
o vuelve a correr `scripts/bootstrap-github.sh`, que es idempotente y solo
creará lo que falte.

## Estilo
Sigue la paleta y componentes ya definidos en `css/style.css`.

### Accesibilidad (WCAG 2.1 AA)
- **Contraste**: texto normal ≥ 4.5:1, texto grande e iconos ≥ 3:1. Los
  botones rellenos con texto claro usan `#C93A1F` (no `#E1472B`, que solo
  da 3.9:1); el texto secundario no baja de `rgba(247,237,221,0.62)`.
- **Emojis**: siempre decorativos y con el nombre en texto al lado. En el
  juego y el admin usa el helper `emo()` (los envuelve en
  `aria-hidden="true"`). Botones de solo icono → `aria-label`.
- **Foco**: no pongas `outline: none` sin alternativa; el anillo común es
  `:focus-visible`. En `js/app.js`, marca con `data-autofocus` el control
  que debe recibir el foco al llegar a una pantalla, y con `data-announce`
  el texto que se lee por la región `aria-live`.
- Inputs con `<label>` o `aria-label`; controles conmutables como
  `<button aria-pressed>`, no `<span>` clicables. Si necesitas
justificar una decisión de diseño no trivial, documenta el porqué en el
propio PR, no solo el qué.
