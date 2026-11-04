// Estrategia de caché:
// - Mismo origen (HTML, JS, CSS, iconos y /data): network-first. Con
//   conexión siempre se sirve lo último publicado (contenido de /data y
//   código siempre coherentes entre sí); la caché solo se usa sin red o si
//   la red tarda más de NETWORK_TIMEOUT_MS. Por eso publicar cambios en /data
//   o en el código NO requiere tocar este fichero.
// - Otros orígenes (Google Fonts): cache-first, no cambian.
// - Solo se guardan respuestas válidas: un 404/500 nunca se cachea.
//
// CACHE_NAME solo hay que cambiarlo si se quiere purgar la caché de todos
// los clientes (p. ej. al renombrar o borrar ficheros del shell). Ver
// CONTRIBUTING.md.
const CACHE_NAME = "dinner-match-v4";
const NETWORK_TIMEOUT_MS = 4000;
// Tras un timeout, durante este tiempo se sirve directamente de caché (sin
// esperar otra vez a la red) para que la cadena HTML → JS → JSON no sume un
// timeout por nivel. La red se sigue consultando en segundo plano.
const SLOW_NETWORK_GRACE_MS = 15000;
let slowNetworkUntil = 0;

// Shell precacheado para que la app arranque offline desde la primera
// visita. Los datos de cada tipo (data/types/<id>/*.json) se cachean en
// runtime la primera vez que se piden. tests/sw.test.mjs comprueba que
// todas estas rutas existen.
const ASSETS = [
  "./",
  "./index.html",
  "./admin.html",
  "./manifest.json",
  "./css/style.css",
  "./js/shared.js",
  "./js/app.js",
  "./js/admin.js",
  "./data/dish-types.json",
  "./data/game-config.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Uno a uno en vez de addAll: si falla un fichero se avisa de cuál y el
    // resto sí queda precacheado (addAll es todo o nada).
    const results = await Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" }))));
    results.forEach((r, i) => {
      if (r.status === "rejected") console.warn(`[sw] No se pudo precachear ${ASSETS[i]}:`, r.reason);
    });
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  event.respondWith(url.origin === self.location.origin ? networkFirst(event) : cacheFirst(event));
});

function cacheable(response) {
  // Las respuestas opacas (CSS/fuentes de Google cargadas sin CORS) no
  // exponen su status; se aceptan solo para otros orígenes.
  return response && (response.ok || response.type === "opaque");
}

function store(event, response) {
  if (!cacheable(response)) return;
  const copy = response.clone();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
}

async function networkFirst(event) {
  const { request } = event;
  const network = fetch(request).then((response) => {
    if (response.ok) store(event, response);
    return response;
  });
  // Evita un unhandled rejection si gana el timeout y luego falla la red.
  network.catch(() => {});

  const cached = await caches.match(request);
  if (!cached) return network; // sin copia local: lo que diga la red, errores incluidos
  if (Date.now() < slowNetworkUntil) return cached;

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      slowNetworkUntil = Date.now() + SLOW_NETWORK_GRACE_MS;
      resolve(cached);
    }, NETWORK_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([network, timeout]);
    // Si el servidor responde con error pero hay copia válida, mejor la copia
    // que romper la app (p. ej. un 5xx puntual del hosting).
    return response.ok || response === cached ? response : cached;
  } catch {
    return cached; // sin red
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(event) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  store(event, response);
  return response;
}
