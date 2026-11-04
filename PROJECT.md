# Dinner Match — definición de proyecto

## 1. Qué es

Una app para que un grupo decida qué cenar sin discutir. Cada persona
desliza tarjetas tipo Tinder en tres rondas independientes, por turnos, en
el mismo móvil:

1. **Ronda 1 — Tipo de cena**: cada jugador dice sí/no a los tipos de cena
   disponibles (pizza, hamburguesa, ensalada, o los que se hayan
   configurado). Si hay más de un tipo en el que coincide todo el grupo, se
   sortea entre los empatados.
2. **Ronda 2 — Ingredientes**: con el tipo de cena ya decidido, se repite el
   swipe sobre los ingredientes de ese tipo concreto.
3. **Ronda 3 — Plato final**: con los ingredientes en los que coincidió todo
   el grupo, la app propone platos reales de ese tipo (de una base de datos
   configurable) y se repite el proceso una vez más, esta vez sobre platos
   completos.
4. **Resultado**: el/los plato(s) en los que todos coincidieron en la ronda 3.

Si en cualquier ronda nadie coincide en nada, la partida termina ahí con un
mensaje honesto, no se fuerza un resultado.

## 2. Alcance de esta fase

- App web estática (PWA instalable), sin backend, un móvil pasado entre
  jugadores.
- **Multi-tipo desde el modelo de datos**: pizza, hamburguesa y ensalada
  vienen precargadas como ejemplo completo, pero añadir un tipo nuevo
  (pasta, tacos, sushi...) es cuestión de datos, no de código — ver §4.
- Contenido (tipos de cena, ingredientes, platos, reglas de balanceo)
  configurable sin tocar código, vía JSON versionado en el repo o vía un
  panel de administración (`admin.html`).
- Fuera de alcance por ahora: cuentas de usuario, multijugador remoto en
  tiempo real (cada jugador en su propio móvil), backend/base de datos. Ver
  §7 Roadmap.

## 3. Arquitectura

```
Static site (HTML/CSS/JS vanilla, sin build step)
├── index.html          → el juego
├── admin.html            → editor de contenido
├── /data
│   ├── dish-types.json    → catálogo de tipos de cena disponibles
│   ├── game-config.json   → ajustes globales (nº de jugadores)
│   └── types/
│       ├── pizza/
│       │   ├── ingredients.json
│       │   ├── recipes.json
│       │   └── config.json    → reglas de balanceo de ESTE tipo
│       ├── hamburguesa/       → misma estructura
│       └── ensalada/          → misma estructura
├── /js
│   ├── shared.js          → utilidades + acceso a datos, usado por ambas páginas
│   ├── app.js              → lógica del juego (las 3 rondas)
│   └── admin.js             → lógica del editor
├── /css/style.css
├── /icons
├── manifest.json
└── service-worker.js
```

Sin build step a propósito: cualquier hosting estático (GitHub Pages,
Netlify, Vercel) lo sirve tal cual, y editar `/data` a mano en GitHub ya es
suficiente para cambiar el contenido sin redeploy manual.

## 4. Modelo de datos

### `data/dish-types.json`
```json
[
  { "id": "pizza", "name": "Pizza", "emoji": "🍕", "visualStyle": "round" }
]
```
`visualStyle` controla cómo se dibuja el plato en el resultado final:
`round` (pizza, sushi), `bowl` (ensalada, pasta, sopa), `stack`
(hamburguesa, tacos, sándwich).

### `data/game-config.json`
```json
{ "minPlayers": 2, "maxPlayers": 8, "dishTypeCandidateMax": 10 }
```
Ajustes globales, independientes del tipo de cena elegido.

### `data/types/<id>/ingredients.json`
```json
[
  { "id": "mozzarella", "name": "Mozzarella", "emoji": "🧀", "cat": "queso" }
]
```
`cat` es libre (string) por tipo — pizza usa `queso/carne/pescado/...`,
hamburguesa usa `pan/proteina/queso/...`, ensalada usa `base/proteina/...`.
Debe coincidir con las claves usadas en `config.json → categoryCaps` de
*ese mismo tipo* para que el balanceo funcione.

### `data/types/<id>/recipes.json`
```json
[
  { "id": "margarita", "name": "Margarita", "ingredients": ["mozzarella", "tomate", "albahaca"] }
]
```
`ingredients` son ids que deben existir en el `ingredients.json` del mismo
tipo.

### `data/types/<id>/config.json`
```json
{
  "ingredientPoolSize": 20,
  "categoryCaps": { "queso": 4, "carne": 5, "...": 0 },
  "candidateMax": 6,
  "candidateMinOverlap": 2
}
```
- `categoryCaps` evita que una categoría domine la ronda de ingredientes
  (el problema original: "15 quesos y 5 carnes"). El algoritmo coge, por
  categoría, hasta el máximo indicado, baraja y recorta a
  `ingredientPoolSize`. Si añades 30 quesos al JSON, la ronda seguirá
  enseñando como mucho lo que diga el cap.
- `candidateMinOverlap` / `candidateMax` controlan cuántos platos se
  proponen en la ronda 3 y qué tan estricta es la coincidencia con lo
  matcheado en ronda 2.

### Añadir un tipo de cena nuevo
1. Crear `data/types/<id>/` con `ingredients.json`, `recipes.json` y
   `config.json` (o usar `admin.html` → "Tipos de cena" → "+ Añadir tipo",
   que genera los tres ficheros vacíos listos para rellenar y exportar).
2. Añadir la entrada correspondiente en `data/dish-types.json`.
3. No hace falta tocar `service-worker.js`: los ficheros de un tipo se
   cachean en runtime la primera vez que se piden.

## 5. Algoritmos clave (`js/shared.js`)

- **`buildBalancedPool(ingredients, config)`**: agrupa por `cat`, muestrea
  hasta `categoryCaps[cat]` de cada grupo (barajado), concatena y recorta a
  `ingredientPoolSize`. Se usa igual en ronda 1 (con `dishTypes` como
  "ingredientes" sin balanceo real, ya que no suele haber muchos tipos) y en
  ronda 2.
- **Match**: intersección de los ids marcados "sí" por todos los jugadores,
  en cualquier ronda.
- **`resolveDishType(matchedTypes)`**: si hay más de un tipo de cena
  matcheado en ronda 1, sortea uno y devuelve también los descartados, para
  poder mostrar "sorteado entre X e Y" en la UI.
- **`pickCandidates(matchedIds, recipes, config)`**: para cada receta,
  `overlap` = nº de sus ingredientes que están en el match de ronda 2;
  `extra` = resto. Se ordenan por overlap desc, extra asc; se filtran las
  que tengan `overlap >= candidateMinOverlap` (si hay menos de 2 así, se
  relaja a `overlap >= 1`). Se añade siempre una receta "personalizada" con
  exactamente los ingredientes matcheados, como comodín. Se recorta a
  `candidateMax`.

## 6. Panel de administración (`admin.html`)

Cuatro pestañas:
- **Tipos de cena**: alta/edición/baja de tipos (nombre, emoji,
  `visualStyle`) + ajustes globales de jugadores.
- **Ingredientes** / **Recetas** / **Reglas**: scoped al tipo seleccionado
  en el desplegable que aparece en cada una de estas tres pestañas.

Guardado en `localStorage` como borrador de trabajo (incluye todos los
tipos cargados, no solo el que se esté viendo). Botones de descarga por
fichero — como es un sitio estático sin backend, el flujo real es: editar
en `admin.html` → descargar → sustituir el fichero en `/data` (o
`/data/types/<id>/`) → commit al repo. No hay persistencia de servidor en
esta fase.

El borrador guarda también una huella (hash) del contenido de `/data` de
cada fichero en el momento en que entró al borrador. Al reabrir el admin se
vuelve a leer `/data` y, por fichero:
- si `/data` no ha cambiado, se mantiene el borrador;
- si `/data` ha cambiado y el borrador no tiene ediciones en ese fichero,
  se actualiza solo;
- si han cambiado ambos, se avisa (conflicto) para elegir entre la versión
  de `/data` (solo en esos ficheros) o mantener el borrador.

Si `/data` no carga, el admin muestra un error con "Reintentar" (sin
borrador) o trabaja sobre el borrador avisando de que no pudo comprobarlo.

## 7. Roadmap (fuera de esta fase)

1. **Multijugador remoto real**: cada jugador entra desde su móvil con un
   código de partida compartido. Requiere backend (sync de estado).
2. **Persistencia real del admin**: sustituir el flujo de "descargar JSON y
   hacer commit" por un backend pequeño (o un CMS headless).
3. **Historial de partidas**: qué tipo/ingredientes/plato salió cada vez.
4. **Filtros dietéticos**: vegetariano/vegano/sin gluten como metadatos de
   ingrediente, con opción de excluir categorías antes de cada ronda.
5. **Más tipos de cena de fábrica**: pasta, tacos, sushi, poke, sopa/ramen —
   la arquitectura ya lo soporta, solo falta poblar los datos.

## 8. Cómo correrlo en local

No requiere build ni dependencias. Basta un servidor estático (por CORS al
hacer `fetch` de los JSON, `file://` directo no funciona):

```bash
npx serve .
# o
python3 -m http.server 8080
```

## 9. Despliegue

Cualquier hosting estático con HTTPS: GitHub Pages, Netlify, Vercel. Ver
`README.md` para los pasos concretos.

## 10. Historial de diseño

- **v1**: solo pizza, dos rondas (ingredientes → pizza).
- **v2 (actual)**: generalizado a "tipo de cena" configurable, tres rondas
  (tipo → ingredientes de ese tipo → plato final), con pizza/hamburguesa/
  ensalada como contenido de ejemplo. El cambio de v1 a v2 fue
  principalmente de modelo de datos (`/data/ingredients.json` +
  `/data/pizzas.json` planos → `/data/types/<id>/...`) y de estado del
  juego (2 rondas → 3 rondas con carga diferida del tipo elegido).
