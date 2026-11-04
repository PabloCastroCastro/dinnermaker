# Dinner Match 🍽️

Decide la cena del grupo sin discutir. Tres rondas de swipe tipo Tinder:
tipo de cena primero (pizza, hamburguesa, ensalada...), sus ingredientes
después, y el plato final al terminar. Ver [`PROJECT.md`](./PROJECT.md)
para la definición completa del proyecto y arquitectura.

## Correr en local

No hay build ni dependencias, pero necesitas un servidor estático (el juego
carga `/data/*.json` con `fetch`, y eso no funciona abriendo el HTML
directamente con `file://`):

```bash
npx serve .
# o
python3 -m http.server 8080
```

Abre `http://localhost:PORT` para el juego y `/admin.html` para el panel de
configuración.

## Tests

La lógica de `js/shared.js` (balanceo del mazo, selección de platos
candidatos, desempate de tipos) tiene tests con el runner nativo de Node, sin
dependencias ni `npm install`. Requiere Node ≥ 22:

```bash
node --test
```

## Configurar contenido

Dos formas, sin tocar código JS:

1. **A mano**: edita `data/dish-types.json`, `data/game-config.json`, o
   dentro de `data/types/<tipo>/`: `ingredients.json`, `recipes.json`,
   `config.json`. Haz commit.
2. **Con el panel**: abre `admin.html` — pestaña "Tipos de cena" para
   añadir/editar tipos de cena y ajustes globales; pestañas "Ingredientes" /
   "Recetas" / "Reglas" (con un desplegable para elegir de qué tipo) para el
   contenido de cada uno. Usa los botones "⬇ descargar" para generar los
   JSON actualizados y sustitúyelos en el repo.
   (Es un sitio estático sin backend — el panel no escribe en el repo por
   sí solo, ver `PROJECT.md` §7 para el roadmap de persistencia real.)

### Añadir un tipo de cena nuevo (ej. "Pasta")
1. `admin.html` → "Tipos de cena" → "+ Añadir tipo" → rellena nombre, emoji
   y `visualStyle`.
2. Cambia a las pestañas Ingredientes / Recetas / Reglas (aparecerá
   seleccionado el tipo nuevo en el desplegable) y da de alta su contenido.
3. Exporta los 4 ficheros (`dish-types.json` + los 3 del tipo) y colócalos:
   `data/dish-types.json` y `data/types/pasta/{ingredients,recipes,config}.json`.

## Publicar el repo en GitHub y crear el backlog

Repo real: **https://github.com/PabloCastroCastro/dinnermaker** (`main` para
producción, `develop` para integración — ver `CONTRIBUTING.md` para el flujo
de ramas y releases). Labels, los 4 milestones y las 18 issues del backlog
inicial ya están creados ahí.

Si tienes [Claude Code](https://docs.claude.com/claude-code) conectado a tu
GitHub, ábrelo en esta carpeta y pídele que siga las instrucciones de
`CLAUDE.md` (las lee automáticamente al arrancar). Eso crea el repo, sube el
código, y da de alta labels/milestones/issues a partir de `backlog/issues.json`.

También puedes hacerlo tú directamente sin Claude Code:
```bash
gh auth login   # si no lo has hecho ya
bash scripts/bootstrap-github.sh dinnermaker public
```
El script es idempotente: si el repo, un label, un milestone o una issue ya
existen, los salta en vez de duplicarlos.

## Desplegar

Cualquier hosting estático con HTTPS sirve, por ejemplo:

**Netlify (más rápido para probar)**
1. [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arrastra la carpeta del repo
3. Copia la URL HTTPS que te da

**GitHub Pages**
1. Settings → Pages → Deploy from branch → `main` / `/ (root)`
2. Tu app queda en `https://pablocastrocastro.github.io/dinnermaker/`

Una vez desplegado, entra desde el móvil y usa "Añadir a pantalla de inicio"
(o el banner de instalación que aparece solo en Chrome/Edge Android).

## Estructura

```
index.html            juego (3 rondas)
admin.html              panel de configuración
data/
  dish-types.json        catálogo de tipos de cena
  game-config.json       ajustes globales
  types/<id>/             ingredients.json, recipes.json, config.json por tipo
js/                     lógica (ES modules, sin build step)
css/style.css
icons/
manifest.json
service-worker.js
PROJECT.md              definición de proyecto y arquitectura
CLAUDE.md                contexto e instrucciones para Claude Code
CONTRIBUTING.md
CHANGELOG.md
backlog/issues.json      backlog estructurado (fuente de las GitHub Issues)
scripts/bootstrap-github.sh   crea repo/labels/milestones/issues en GitHub
.github/                 plantillas de issue y PR
```
