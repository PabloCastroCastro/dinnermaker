import { loadGameConfig, loadTypeData, esc, slugify, indexById } from "./shared.js";

// Emoji decorativo: el nombre va siempre en texto al lado.
const emo = (e) => `<span aria-hidden="true">${esc(e)}</span>`;

const DRAFT_KEY = "dinnerMatchAdminDraft";
const VISUAL_STYLES = ["round", "bowl", "stack"];

const state = {
  tab: "dishtypes", // dishtypes | ingredients | recipes | config
  gameConfig: { minPlayers: 2, maxPlayers: 8, dishTypeCandidateMax: 10 },
  dishTypes: [],
  selectedTypeId: null,
  typeCache: {}, // { [id]: { ingredients, recipes, config } }
  editingDishType: null,
  editingIngredient: null,
  editingRecipe: null,
  // Huella del contenido de /data de cada fichero cuando entró al borrador
  // ({ "data/dish-types.json": "9f3a…", ... }). Permite saber, al volver a
  // abrir el admin, si /data ha cambiado desde entonces y si el borrador
  // tiene ediciones propias en ese fichero.
  base: {},
  draftNotice: null, // { kind: "conflict" | "legacy" | "unchecked", files?, error? }
  loadError: null,   // fallo al cargar /data sin borrador: pantalla de error
};
let remoteSnapshot = null; // { files: { [fichero]: contenido }, prints: { [fichero]: huella } }

const TYPE_FILES = ["ingredients", "recipes", "config"];
const F_TYPES = "data/dish-types.json";
const F_GAME = "data/game-config.json";
const typeFile = (id, kind) => `data/types/${id}/${kind}.json`;
const parseTypeFile = (f) => f.match(/^data\/types\/([^/]+)\/(ingredients|recipes|config)\.json$/)?.slice(1);

// FNV-1a de 32 bits sobre el JSON: basta para detectar cambios, no es criptográfico.
function fingerprint(value) {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function getDraftFile(f) {
  if (f === F_TYPES) return state.dishTypes;
  if (f === F_GAME) return state.gameConfig;
  const [id, kind] = parseTypeFile(f) || [];
  return state.typeCache[id]?.[kind];
}
function setDraftFile(f, value) {
  if (f === F_TYPES) state.dishTypes = value;
  else if (f === F_GAME) state.gameConfig = value;
  else {
    const [id, kind] = parseTypeFile(f);
    state.typeCache[id] = state.typeCache[id] || { ingredients: [], recipes: [], config: emptyTypeConfig() };
    state.typeCache[id][kind] = value;
  }
}
const emptyTypeConfig = () => ({ ingredientPoolSize: 0, categoryCaps: {}, candidateMax: 6, candidateMinOverlap: 2 });

function readDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

async function init() {
  const draft = readDraft();
  let remote = null;
  let remoteError = null;
  try { remote = await loadGameConfig(); } catch (e) { remoteError = e; }

  if (!draft) {
    if (!remote) { state.loadError = remoteError.message; render(); return; }
    state.dishTypes = remote.dishTypes;
    state.gameConfig = remote.gameConfig;
    state.base = { [F_TYPES]: fingerprint(remote.dishTypes), [F_GAME]: fingerprint(remote.gameConfig) };
  } else {
    state.gameConfig = draft.gameConfig;
    state.dishTypes = draft.dishTypes;
    state.typeCache = draft.typeCache || {};
    state.base = draft.base || {};
    if (remote) await reconcileWithData(draft, remote);
    else state.draftNotice = { kind: "unchecked", error: remoteError.message };
  }
  if (!state.selectedTypeId && state.dishTypes.length) state.selectedTypeId = state.dishTypes[0].id;
  render();
  if (state.selectedTypeId) await ensureTypeLoaded(state.selectedTypeId);
}

// Compara el borrador con /data fichero a fichero:
// - /data no cambió desde que entró al borrador → se mantiene el borrador.
// - /data cambió y el borrador no tenía ediciones en ese fichero → se
//   actualiza solo (aviso breve).
// - /data cambió y el borrador también → conflicto: aviso visible para
//   elegir entre la versión de /data o mantener el borrador.
// Un borrador anterior a este mecanismo (sin `base`) no permite distinguir
// ediciones propias, así que se avisa siempre.
async function reconcileWithData(draft, remote) {
  const files = { [F_TYPES]: remote.dishTypes, [F_GAME]: remote.gameConfig };
  const remoteIds = new Set(remote.dishTypes.map((t) => t.id));
  const draftIds = Object.keys(state.typeCache);
  const hadBase = (id) => TYPE_FILES.some((k) => typeFile(id, k) in state.base);
  const unreadable = new Set(); // listados en /data pero que no cargan: sin comprobar, no "eliminados"
  await Promise.all(draftIds.filter((id) => remoteIds.has(id) || hadBase(id)).map(async (id) => {
    try {
      const d = await loadTypeData(id);
      for (const k of TYPE_FILES) files[typeFile(id, k)] = d[k];
    } catch {
      if (remoteIds.has(id)) unreadable.add(id); // si no está en dish-types.json, se trata como eliminado
    }
  }));
  const prints = Object.fromEntries(Object.entries(files).map(([f, v]) => [f, fingerprint(v)]));
  remoteSnapshot = { files, prints };

  if (!draft.base) {
    state.draftNotice = { kind: "legacy", files: Object.keys(files) };
    return;
  }
  const updated = [];
  const conflicts = [];
  for (const [f, basePrint] of Object.entries(state.base)) {
    if (prints[f] === basePrint) continue;                        // /data no ha cambiado
    if (unreadable.has(parseTypeFile(f)?.[0])) continue;          // no se pudo leer: sin comprobar
    const localEdits = fingerprint(getDraftFile(f)) !== basePrint;
    if (!localEdits) {
      if (f in files) { setDraftFile(f, files[f]); state.base[f] = prints[f]; }
      else { delete state.base[f]; }                              // eliminado en /data, sin ediciones
      updated.push(f);
    } else {
      conflicts.push({ file: f, removed: !(f in files) });
    }
  }
  // Tipos que ya no están en /data ni en el borrador: fuera de la caché.
  for (const id of Object.keys(state.typeCache)) {
    if (!state.dishTypes.some((t) => t.id === id) && !hadBase(id)) delete state.typeCache[id];
  }
  if (updated.length) saveDraft();
  if (conflicts.length) state.draftNotice = { kind: "conflict", files: conflicts };
  else toast(updated.length
    ? `Borrador cargado. Actualizado desde /data (sin ediciones tuyas): ${updated.join(", ")}`
    : "Borrador cargado desde este navegador");
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    version: 2,
    gameConfig: state.gameConfig, dishTypes: state.dishTypes, typeCache: state.typeCache, base: state.base,
  }));
}

async function ensureTypeLoaded(id) {
  if (state.typeCache[id]) return;
  try {
    const data = await loadTypeData(id);
    state.typeCache[id] = { ingredients: data.ingredients, recipes: data.recipes, config: data.config };
    for (const k of TYPE_FILES) state.base[typeFile(id, k)] = fingerprint(data[k]);
    saveDraft();
  } catch (e) {
    // Se muestra vacío para poder darle contenido, pero avisando del motivo.
    state.typeCache[id] = { ingredients: [], recipes: [], config: emptyTypeConfig() };
    toast(`No se pudo cargar el tipo «${id}» de /data: ${e.message}. Se muestra vacío.`);
  }
  render();
}

function draftNoticeHTML() {
  const n = state.draftNotice;
  if (!n) return "";
  const list = (files) => `<ul style="margin:6px 0 10px; padding-left:18px;">${files.map((f) =>
    `<li><code>${esc(f.file || f)}</code>${f.removed ? " (eliminado en /data)" : ""}</li>`).join("")}</ul>`;
  const body = n.kind === "conflict"
    ? `<p style="margin:0;">Estos ficheros han cambiado en <code>/data</code> desde que empezaste el borrador, y también los has editado aquí:</p>
       ${list(n.files)}
       <p style="margin:0 0 4px;">Si usas la versión de <code>/data</code>, perderás tus cambios en esos ficheros (el resto del borrador se mantiene).</p>`
    : n.kind === "legacy"
      ? `<p style="margin:0 0 4px;">Este borrador es de una versión anterior del admin y no se puede saber si <code>/data</code> ha cambiado desde entonces. Si no recuerdas haber editado nada, usa la versión de <code>/data</code>.</p>`
      : `<p style="margin:0 0 4px;">No se pudo leer <code>/data</code> para comprobar si ha cambiado (${esc(n.error)}). Estás trabajando sobre el borrador guardado en este navegador.</p>`;
  const actions = n.kind === "unchecked"
    ? `<button class="cta small" data-action="notice-retry">${emo("⟳")} Reintentar</button>
       <button class="cta ghost small" data-action="notice-keep">Seguir con el borrador</button>`
    : `<button class="cta small" data-action="notice-use-data">Usar la versión de /data</button>
       <button class="cta ghost small" data-action="notice-keep">Mantener mi borrador</button>`;
  return `
    <section class="card-panel draft-notice" role="alert" aria-labelledby="draft-notice-title" style="margin-bottom:16px; border-color:rgba(232,163,61,0.6);">
      <h2 id="draft-notice-title" class="row-label mono" style="color:#E8A33D; margin:0 0 8px;">${{ unchecked: "No se pudo comprobar /data", legacy: "Borrador de una versión anterior", conflict: "/data ha cambiado" }[n.kind]}</h2>
      <div style="font-size:14px;">${body}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">${actions}</div>
    </section>`;
}

function renderLoadError() {
  document.getElementById("app").innerHTML = `
    <div class="screen">
      <h1 class="title display" style="font-size:24px;margin:0 0 16px;">${emo("⚙️")} Configurar Dinner Match</h1>
      <div class="error-box" role="alert">No se pudo cargar el contenido de <code>/data</code>.<br>${esc(state.loadError)}</div>
      <button class="cta" data-action="notice-retry" style="margin-top:16px;">${emo("⟳")} Reintentar</button>
      <a href="./index.html" class="cta ghost small" style="text-decoration:none; text-align:center;">← Volver al juego</a>
    </div>`;
}

// Región de avisos persistente (creada al cargar, no con el primer aviso,
// para que los lectores de pantalla anuncien también el primero).
const toastHost = document.createElement("aside");
toastHost.setAttribute("aria-label", "Avisos");
toastHost.innerHTML = `<div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
document.body.appendChild(toastHost);
let toastTimer;

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; el.textContent = ""; }, 2200);
}

function download(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function currentType() { return state.typeCache[state.selectedTypeId]; }

function typeSelectorHTML() {
  return `
  <div class="type-select-row">
    <select class="select-input" id="type-selector" aria-label="Tipo de cena">
      ${state.dishTypes.map((t) => `<option value="${esc(t.id)}" ${t.id === state.selectedTypeId ? "selected" : ""}>${esc(t.emoji)} ${esc(t.name)}</option>`).join("")}
    </select>
    <span class="visual-badge">${esc(state.selectedTypeId || "")}</span>
  </div>`;
}

// ---- Tab: Tipos de cena ----
function dishTypeForm(dt) {
  const isNew = !dt;
  const v = dt || { id: "", name: "", emoji: "🍽️", visualStyle: "round" };
  return `
  <div class="card-panel" style="margin-bottom:14px;">
    <div class="row-label mono">${isNew ? "Nuevo tipo de cena" : "Editar tipo de cena"}</div>
    <div class="form-grid">
      <input class="text-input" id="f-dt-name" placeholder="Nombre" aria-label="Nombre del tipo de cena" value="${esc(v.name)}" />
      <input class="text-input" id="f-dt-emoji" placeholder="Emoji" aria-label="Emoji" value="${esc(v.emoji)}" />
    </div>
    <select class="select-input" id="f-dt-visual" aria-label="Estilo visual del plato">
      ${VISUAL_STYLES.map((s) => `<option value="${s}" ${s === v.visualStyle ? "selected" : ""}>${s}</option>`).join("")}
    </select>
    <p class="subtitle" style="text-align:left; margin: 4px 0 10px;">visualStyle controla cómo se dibuja el plato final: <b>round</b> (pizza/sushi), <b>bowl</b> (ensalada/pasta/sopa), <b>stack</b> (hamburguesa/tacos).</p>
    <div style="display:flex; gap:8px;">
      <button class="cta small" data-action="save-dishtype" data-orig-id="${esc(v.id)}">Guardar</button>
      <button class="cta ghost small" data-action="cancel-dishtype">Cancelar</button>
    </div>
  </div>`;
}

function dishTypesTab() {
  const rows = state.dishTypes.map((t) => `
    <div class="item-row">
      <span class="emoji" aria-hidden="true">${esc(t.emoji)}</span>
      <div class="meta"><div class="name">${esc(t.name)}</div><div class="sub">${esc(t.id)} · visual: ${esc(t.visualStyle)}</div></div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-dishtype" data-id="${esc(t.id)}" aria-label="Editar ${esc(t.name)}">${emo("✎")}</button>
        <button class="icon-btn danger" data-action="delete-dishtype" data-id="${esc(t.id)}" aria-label="Eliminar ${esc(t.name)}">${emo("✕")}</button>
      </div>
    </div>`).join("");
  const formHTML = state.editingDishType === "new"
    ? dishTypeForm(null)
    : state.editingDishType
      ? dishTypeForm(state.dishTypes.find((t) => t.id === state.editingDishType))
      : "";
  const gc = state.gameConfig;
  return `
    <div class="card-panel" style="margin-bottom:16px;">
      <div class="row-label mono">Ajustes globales</div>
      <div class="config-row"><label for="gc-min">Jugadores mínimo</label><input class="text-input" style="margin:0;" id="gc-min" type="number" value="${gc.minPlayers}" /></div>
      <div class="config-row"><label for="gc-max">Jugadores máximo</label><input class="text-input" style="margin:0;" id="gc-max" type="number" value="${gc.maxPlayers}" /></div>
      <button class="cta small" data-action="save-gameconfig">Guardar ajustes globales</button>
    </div>
    ${formHTML}
    ${!state.editingDishType ? `<button class="cta small" data-action="new-dishtype">+ Añadir tipo de cena</button>` : ""}
    <div style="height:14px;"></div>
    ${rows || `<p class="subtitle">Sin tipos de cena todavía.</p>`}
  `;
}

// ---- Tab: Ingredientes (del tipo seleccionado) ----
function ingredientForm(ing) {
  const isNew = !ing;
  const v = ing || { id: "", name: "", emoji: "🍽️", cat: "" };
  return `
  <div class="card-panel" style="margin-bottom:14px;">
    <div class="row-label mono">${isNew ? "Nuevo ingrediente" : "Editar ingrediente"}</div>
    <div class="form-grid">
      <input class="text-input" id="f-name" placeholder="Nombre" aria-label="Nombre del ingrediente" value="${esc(v.name)}" />
      <input class="text-input" id="f-emoji" placeholder="Emoji" aria-label="Emoji" value="${esc(v.emoji)}" />
    </div>
    <input class="text-input" id="f-cat" placeholder="Categoría (ej. queso, vegetal...)" aria-label="Categoría" value="${esc(v.cat)}" />
    <p class="subtitle" style="text-align:left; margin: 0 0 10px;">La categoría debe coincidir con una clave en las Reglas de este tipo para que el balanceo la tenga en cuenta.</p>
    <div style="display:flex; gap:8px;">
      <button class="cta small" data-action="save-ingredient" data-orig-id="${esc(v.id)}">Guardar</button>
      <button class="cta ghost small" data-action="cancel-ingredient">Cancelar</button>
    </div>
  </div>`;
}

function ingredientsTab() {
  const t = currentType();
  if (!t) return `<p class="subtitle">Cargando…</p>`;
  const rows = t.ingredients.map((ing) => `
    <div class="item-row">
      <span class="emoji" aria-hidden="true">${esc(ing.emoji)}</span>
      <div class="meta"><div class="name">${esc(ing.name)}</div><div class="sub">${esc(ing.cat)} · ${esc(ing.id)}</div></div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-ingredient" data-id="${esc(ing.id)}" aria-label="Editar ${esc(ing.name)}">${emo("✎")}</button>
        <button class="icon-btn danger" data-action="delete-ingredient" data-id="${esc(ing.id)}" aria-label="Eliminar ${esc(ing.name)}">${emo("✕")}</button>
      </div>
    </div>`).join("");
  const formHTML = state.editingIngredient === "new"
    ? ingredientForm(null)
    : state.editingIngredient
      ? ingredientForm(t.ingredients.find((i) => i.id === state.editingIngredient))
      : "";
  return `
    ${typeSelectorHTML()}
    ${formHTML}
    ${!state.editingIngredient ? `<button class="cta small" data-action="new-ingredient">+ Añadir ingrediente</button>` : ""}
    <div style="height:14px;"></div>
    ${rows || `<p class="subtitle">Sin ingredientes todavía para este tipo.</p>`}
  `;
}

// ---- Tab: Recetas (del tipo seleccionado) ----
function recipeForm(recipe) {
  const t = currentType();
  const isNew = !recipe;
  const v = recipe || { id: "", name: "", ingredients: [] };
  const tags = t.ingredients.map((ing) => `
    <button type="button" class="tag-toggle ${v.ingredients.includes(ing.id) ? "selected" : ""}" aria-pressed="${v.ingredients.includes(ing.id)}" data-action="toggle-recipe-ing" data-id="${esc(ing.id)}">${emo(ing.emoji)} ${esc(ing.name)}</button>
  `).join("");
  return `
  <div class="card-panel" style="margin-bottom:14px;">
    <div class="row-label mono">${isNew ? "Nueva receta" : "Editar receta"}</div>
    <input class="text-input" id="f-recipe-name" placeholder="Nombre" aria-label="Nombre de la receta" value="${esc(v.name)}" />
    <div class="row-label mono" id="recipe-ing-label">Ingredientes</div>
    <div class="tag-wrap" id="recipe-ing-tags" role="group" aria-labelledby="recipe-ing-label">${tags}</div>
    <div style="display:flex; gap:8px; margin-top:8px;">
      <button class="cta small" data-action="save-recipe" data-orig-id="${esc(v.id)}">Guardar</button>
      <button class="cta ghost small" data-action="cancel-recipe">Cancelar</button>
    </div>
  </div>`;
}

function recipesTab() {
  const t = currentType();
  if (!t) return `<p class="subtitle">Cargando…</p>`;
  const byId = indexById(t.ingredients);
  const rows = t.recipes.map((r) => `
    <div class="item-row">
      <div class="meta">
        <div class="name">${esc(r.name)}</div>
        <div class="sub">${esc(r.ingredients.map((id) => byId[id]?.name || `¿${id}?`).join(", "))} · ${r.ingredients.length} ingr.</div>
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-recipe" data-id="${esc(r.id)}" aria-label="Editar ${esc(r.name)}">${emo("✎")}</button>
        <button class="icon-btn danger" data-action="delete-recipe" data-id="${esc(r.id)}" aria-label="Eliminar ${esc(r.name)}">${emo("✕")}</button>
      </div>
    </div>`).join("");
  const formHTML = state.editingRecipe === "new"
    ? recipeForm(null)
    : state.editingRecipe
      ? recipeForm(t.recipes.find((r) => r.id === state.editingRecipe))
      : "";
  return `
    ${typeSelectorHTML()}
    ${formHTML}
    ${!state.editingRecipe ? `<button class="cta small" data-action="new-recipe">+ Añadir receta</button>` : ""}
    <div style="height:14px;"></div>
    ${rows || `<p class="subtitle">Sin recetas todavía para este tipo.</p>`}
  `;
}

// ---- Tab: Reglas (del tipo seleccionado) ----
function configTab() {
  const t = currentType();
  if (!t) return `<p class="subtitle">Cargando…</p>`;
  const c = t.config;
  const caps = c.categoryCaps || {};
  const countByCat = {};
  for (const i of t.ingredients) countByCat[i.cat] = (countByCat[i.cat] || 0) + 1;
  // Una fila por cada categoría en uso (tenga tope o no) y, al final, las que
  // tienen tope pero ya no usa ningún ingrediente, con opción de quitarlas.
  const inUse = Object.keys(countByCat).sort((a, b) => a.localeCompare(b, "es"));
  const unused = Object.keys(caps).filter((cat) => !countByCat[cat]).sort((a, b) => a.localeCompare(b, "es"));
  const missing = inUse.filter((cat) => !(cat in caps));
  const capRow = (cat) => {
    const n = countByCat[cat] || 0;
    const value = cat in caps ? caps[cat] : "";
    return `
      <div class="config-row" data-cap-row="${esc(cat)}">
        <span><span aria-hidden="true">${esc(cat)}</span> <span class="visual-badge">${n ? `${n} ingr.` : "sin ingredientes"}</span></span>
        <span style="display:flex; gap:6px; align-items:center;">
          <input class="text-input" style="margin:0;" data-cap-cat="${esc(cat)}" aria-label="Tope de ${esc(cat)}${n ? ` (${n} ingredientes)` : " (sin ingredientes)"}"
                 type="number" min="0" step="1" inputmode="numeric" placeholder="∞" value="${esc(value)}" />
          ${n ? "" : `<button type="button" class="icon-btn danger" data-action="remove-cap" data-cat="${esc(cat)}" aria-label="Quitar el tope de ${esc(cat)}">${emo("✕")}</button>`}
        </span>
      </div>`;
  };
  return `
    ${typeSelectorHTML()}
    <div class="card-panel">
      <div class="config-row"><label for="cfg-pool">Tamaño del mazo de ingredientes <span class="visual-badge">0 = sin límite</span></label><input class="text-input" style="margin:0;" id="cfg-pool" type="number" min="0" step="1" inputmode="numeric" value="${c.ingredientPoolSize ?? 0}" /></div>
      <div class="config-row"><label for="cfg-candmax">Recetas candidatas (máx)</label><input class="text-input" style="margin:0;" id="cfg-candmax" type="number" min="1" step="1" inputmode="numeric" value="${c.candidateMax ?? 6}" /></div>
      <div class="config-row"><label for="cfg-candmin">Solapamiento mínimo candidata</label><input class="text-input" style="margin:0;" id="cfg-candmin" type="number" min="0" step="1" inputmode="numeric" value="${c.candidateMinOverlap ?? 2}" /></div>
    </div>
    <div class="row-label mono" style="margin-top:16px;">Tope de ingredientes por categoría</div>
    <div class="card-panel" id="caps-panel">
      ${[...inUse, ...unused].map(capRow).join("") || `<p class="subtitle">Sin categorías todavía: añade ingredientes a este tipo.</p>`}
      ${missing.length ? `<p class="subtitle" style="text-align:left; color:#E8A33D;">Sin tope: ${missing.map(esc).join(", ")}. Vacío = sin límite (entran todos sus ingredientes al mazo). Ponles un tope antes de publicar: la CI lo exige.</p>` : ""}
    </div>
    <button class="cta" data-action="save-config">Guardar reglas</button>
  `;
}

function render() {
  if (state.loadError) return renderLoadError();
  const app = document.getElementById("app");
  const tabContent = state.tab === "dishtypes" ? dishTypesTab()
    : state.tab === "ingredients" ? ingredientsTab()
    : state.tab === "recipes" ? recipesTab()
    : configTab();
  app.innerHTML = `
    <div class="screen admin-wrap">
      <div class="admin-top">
        <h1 class="title display" style="font-size:24px;margin:0;">${emo("⚙️")} Configurar Dinner Match</h1>
        <a href="./index.html" class="cta ghost small" style="width:auto; margin:0; padding:8px 12px; text-decoration:none;">← Volver al juego</a>
      </div>
      ${draftNoticeHTML()}
      <nav class="admin-nav" aria-label="Secciones">
        <button class="${state.tab === "dishtypes" ? "active" : ""}" aria-pressed="${state.tab === "dishtypes"}" data-action="tab" data-tab="dishtypes">Tipos de cena</button>
        <button class="${state.tab === "ingredients" ? "active" : ""}" aria-pressed="${state.tab === "ingredients"}" data-action="tab" data-tab="ingredients">Ingredientes</button>
        <button class="${state.tab === "recipes" ? "active" : ""}" aria-pressed="${state.tab === "recipes"}" data-action="tab" data-tab="recipes">Recetas</button>
        <button class="${state.tab === "config" ? "active" : ""}" aria-pressed="${state.tab === "config"}" data-action="tab" data-tab="config">Reglas</button>
      </nav>
      ${tabContent}
      <div class="row-label mono" style="margin-top:20px;">Exportar</div>
      <p class="subtitle" style="margin-bottom:10px; text-align:left;">Es un sitio estático: descarga estos ficheros y sustitúyelos en el repo para publicar los cambios (los del tipo van en <code>data/types/&lt;id&gt;/</code>).</p>
      <div class="export-row">
        <button class="cta small" data-action="export-dishtypes">⬇ dish-types.json</button>
        <button class="cta small" data-action="export-gameconfig">⬇ game-config.json</button>
      </div>
      <div class="export-row">
        <button class="cta small" data-action="export-ingredients">⬇ ingredients.json (${esc(state.selectedTypeId || "")})</button>
        <button class="cta small" data-action="export-recipes">⬇ recipes.json (${esc(state.selectedTypeId || "")})</button>
        <button class="cta small" data-action="export-typeconfig">⬇ config.json (${esc(state.selectedTypeId || "")})</button>
      </div>
      <button class="cta ghost small" data-action="clear-draft">Descartar borrador y recargar de /data</button>
    </div>
  `;
}

document.getElementById("app").addEventListener("change", (e) => {
  if (e.target.id === "type-selector") {
    state.selectedTypeId = e.target.value;
    state.editingIngredient = null; state.editingRecipe = null;
    ensureTypeLoaded(state.selectedTypeId);
    render();
  }
});

document.getElementById("app").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");

  if (action === "tab") {
    state.tab = btn.dataset.tab;
    state.editingIngredient = null; state.editingRecipe = null; state.editingDishType = null;
    if (state.tab !== "dishtypes" && state.selectedTypeId) await ensureTypeLoaded(state.selectedTypeId);
    render();
  }

  // -- Dish types --
  else if (action === "new-dishtype") { state.editingDishType = "new"; render(); }
  else if (action === "edit-dishtype") { state.editingDishType = btn.dataset.id; render(); }
  else if (action === "cancel-dishtype") { state.editingDishType = null; render(); }
  else if (action === "delete-dishtype") {
    if (confirm("¿Eliminar este tipo de cena y todo su contenido (ingredientes/recetas)?")) {
      state.dishTypes = state.dishTypes.filter((t) => t.id !== btn.dataset.id);
      delete state.typeCache[btn.dataset.id];
      if (state.selectedTypeId === btn.dataset.id) state.selectedTypeId = state.dishTypes[0]?.id || null;
      saveDraft(); render();
    }
  }
  else if (action === "save-dishtype") {
    const name = document.getElementById("f-dt-name").value.trim();
    const emoji = document.getElementById("f-dt-emoji").value.trim() || "🍽️";
    const visualStyle = document.getElementById("f-dt-visual").value;
    if (!name) { toast("Falta el nombre"); return; }
    const origId = btn.dataset.origId;
    if (origId) {
      Object.assign(state.dishTypes.find((t) => t.id === origId), { name, emoji, visualStyle });
    } else {
      let id = slugify(name);
      while (state.dishTypes.some((t) => t.id === id)) id += "2";
      state.dishTypes.push({ id, name, emoji, visualStyle });
      state.typeCache[id] = { ingredients: [], recipes: [], config: { ingredientPoolSize: 0, categoryCaps: {}, candidateMax: 6, candidateMinOverlap: 2 } };
      state.selectedTypeId = id;
    }
    state.editingDishType = null;
    saveDraft(); render(); toast("Tipo de cena guardado");
  }
  else if (action === "save-gameconfig") {
    state.gameConfig.minPlayers = +document.getElementById("gc-min").value || 2;
    state.gameConfig.maxPlayers = +document.getElementById("gc-max").value || 8;
    saveDraft(); toast("Ajustes globales guardados");
  }

  // -- Ingredients --
  else if (action === "new-ingredient") { state.editingIngredient = "new"; render(); }
  else if (action === "edit-ingredient") { state.editingIngredient = btn.dataset.id; render(); }
  else if (action === "cancel-ingredient") { state.editingIngredient = null; render(); }
  else if (action === "delete-ingredient") {
    if (confirm("¿Eliminar este ingrediente? También se quitará de las recetas que lo usen.")) {
      const t = currentType();
      t.ingredients = t.ingredients.filter((i) => i.id !== btn.dataset.id);
      t.recipes = t.recipes.map((r) => ({ ...r, ingredients: r.ingredients.filter((id) => id !== btn.dataset.id) }));
      saveDraft(); render();
    }
  }
  else if (action === "save-ingredient") {
    const t = currentType();
    const name = document.getElementById("f-name").value.trim();
    const emoji = document.getElementById("f-emoji").value.trim() || "🍽️";
    const cat = document.getElementById("f-cat").value.trim() || "otros";
    if (!name) { toast("Falta el nombre"); return; }
    const origId = btn.dataset.origId;
    if (origId) {
      Object.assign(t.ingredients.find((i) => i.id === origId), { name, emoji, cat });
    } else {
      let id = slugify(name);
      while (t.ingredients.some((i) => i.id === id)) id += "2";
      t.ingredients.push({ id, name, emoji, cat });
    }
    state.editingIngredient = null;
    saveDraft(); render(); toast("Ingrediente guardado");
  }

  // -- Recipes --
  else if (action === "new-recipe") { state.editingRecipe = "new"; render(); }
  else if (action === "edit-recipe") { state.editingRecipe = btn.dataset.id; render(); }
  else if (action === "cancel-recipe") { state.editingRecipe = null; render(); }
  else if (action === "delete-recipe") {
    if (confirm("¿Eliminar esta receta?")) {
      const t = currentType();
      t.recipes = t.recipes.filter((r) => r.id !== btn.dataset.id);
      saveDraft(); render();
    }
  }
  else if (action === "toggle-recipe-ing") {
    const on = btn.classList.toggle("selected");
    btn.setAttribute("aria-pressed", String(on));
  }
  else if (action === "save-recipe") {
    const t = currentType();
    const name = document.getElementById("f-recipe-name").value.trim();
    const selected = [...document.querySelectorAll("#recipe-ing-tags .tag-toggle.selected")].map((el) => el.dataset.id);
    if (!name) { toast("Falta el nombre"); return; }
    if (selected.length === 0) { toast("Selecciona al menos un ingrediente"); return; }
    const origId = btn.dataset.origId;
    if (origId) {
      Object.assign(t.recipes.find((r) => r.id === origId), { name, ingredients: selected });
    } else {
      let id = slugify(name);
      while (t.recipes.some((r) => r.id === id)) id += "2";
      t.recipes.push({ id, name, ingredients: selected });
    }
    state.editingRecipe = null;
    saveDraft(); render(); toast("Receta guardada");
  }

  // -- Config --
  else if (action === "remove-cap") {
    // Solo en el formulario: se aplica al pulsar "Guardar reglas", así no se
    // pierden otros cambios sin guardar.
    const row = btn.closest("[data-cap-row]");
    const next = row.nextElementSibling?.querySelector("input") || document.querySelector('[data-action="save-config"]');
    row.remove();
    next?.focus();
    toast(`Tope de «${btn.dataset.cat}» quitado (pulsa Guardar reglas)`);
  }
  else if (action === "save-config") {
    const t = currentType();
    // Enteros >= min; vacío → valor por defecto (o "sin tope" en categorías).
    // Un valor inválido no se sustituye en silencio: se avisa y no se guarda.
    const errors = [];
    const readInt = (input, label, min, fallback) => {
      const raw = input.value.trim();
      if (raw === "") return fallback;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min) { errors.push(`${label} debe ser un entero ≥ ${min}`); input.setAttribute("aria-invalid", "true"); return undefined; }
      input.removeAttribute("aria-invalid");
      return n;
    };
    const pool = readInt(document.getElementById("cfg-pool"), "Tamaño del mazo", 0, 0);
    const candMax = readInt(document.getElementById("cfg-candmax"), "Recetas candidatas", 1, 6);
    const candMin = readInt(document.getElementById("cfg-candmin"), "Solapamiento mínimo", 0, 2);
    const caps = {};
    document.querySelectorAll("[data-cap-cat]").forEach((inp) => {
      const v = readInt(inp, `Tope de ${inp.dataset.capCat}`, 0, null);
      if (v !== null && v !== undefined) caps[inp.dataset.capCat] = v;
    });
    if (errors.length) {
      toast(errors[0]);
      document.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    Object.assign(t.config, { ingredientPoolSize: pool, candidateMax: candMax, candidateMinOverlap: candMin, categoryCaps: caps });
    saveDraft(); render(); toast("Reglas guardadas");
  }

  // -- Export --
  else if (action === "export-dishtypes") download("dish-types.json", state.dishTypes);
  else if (action === "export-gameconfig") download("game-config.json", state.gameConfig);
  else if (action === "export-ingredients") download("ingredients.json", currentType().ingredients);
  else if (action === "export-recipes") download("recipes.json", currentType().recipes);
  else if (action === "export-typeconfig") download("config.json", currentType().config);

  // -- Aviso de borrador vs /data --
  else if (action === "notice-retry") location.reload();
  else if (action === "notice-use-data") {
    const n = state.draftNotice;
    if (n.kind === "legacy") { localStorage.removeItem(DRAFT_KEY); location.reload(); return; }
    for (const { file, removed } of n.files) {
      if (!removed) { setDraftFile(file, remoteSnapshot.files[file]); state.base[file] = remoteSnapshot.prints[file]; continue; }
      // Tipo eliminado en /data: fuera del borrador entero.
      const [id] = parseTypeFile(file) || [];
      if (id) { delete state.typeCache[id]; for (const k of TYPE_FILES) delete state.base[typeFile(id, k)]; }
    }
    if (state.selectedTypeId && !state.typeCache[state.selectedTypeId] && !state.dishTypes.some((t) => t.id === state.selectedTypeId)) {
      state.selectedTypeId = state.dishTypes[0]?.id || null;
    }
    state.draftNotice = null;
    saveDraft(); render();
    document.querySelector(".admin-nav button.active")?.focus();
    toast("Cargada la versión de /data en esos ficheros");
  }
  else if (action === "notice-keep") {
    const n = state.draftNotice;
    // A partir de ahora la referencia es el /data actual: solo se volverá a
    // avisar si /data cambia otra vez.
    if (n.kind === "conflict") {
      for (const { file, removed } of n.files) {
        if (removed) delete state.base[file]; else state.base[file] = remoteSnapshot.prints[file];
      }
    } else if (n.kind === "legacy") {
      for (const [f, p] of Object.entries(remoteSnapshot.prints)) if (getDraftFile(f) !== undefined) state.base[f] = p;
    }
    state.draftNotice = null;
    if (n.kind !== "unchecked") saveDraft();
    render();
    document.querySelector(".admin-nav button.active")?.focus();
    toast(n.kind === "unchecked" ? "Trabajando sobre el borrador" : "Borrador mantenido");
  }

  else if (action === "clear-draft") {
    if (confirm("Se perderá el borrador local y se recargará el contenido de /data. ¿Continuar?")) {
      localStorage.removeItem(DRAFT_KEY);
      location.reload();
    }
  }
});

init();
