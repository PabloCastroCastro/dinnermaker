import { loadGameConfig, loadTypeData, esc, slugify, indexById } from "./shared.js";

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
};

async function init() {
  const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  if (draft) {
    Object.assign(state, draft);
    toast("Borrador cargado desde este navegador");
  } else {
    const loaded = await loadGameConfig();
    state.dishTypes = loaded.dishTypes;
    state.gameConfig = loaded.gameConfig;
  }
  if (!state.selectedTypeId && state.dishTypes.length) state.selectedTypeId = state.dishTypes[0].id;
  render();
  if (state.selectedTypeId) await ensureTypeLoaded(state.selectedTypeId);
}

function saveDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({
    gameConfig: state.gameConfig, dishTypes: state.dishTypes, typeCache: state.typeCache,
  }));
}

async function ensureTypeLoaded(id) {
  if (state.typeCache[id]) return;
  try {
    const data = await loadTypeData(id);
    state.typeCache[id] = { ingredients: data.ingredients, recipes: data.recipes, config: data.config };
    saveDraft();
  } catch {
    state.typeCache[id] = { ingredients: [], recipes: [], config: { ingredientPoolSize: 0, categoryCaps: {}, candidateMax: 6, candidateMinOverlap: 2 } };
  }
  render();
}

function toast(msg) {
  let el = document.getElementById("toast");
  if (el) el.remove();
  el = document.createElement("div");
  el.id = "toast";
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
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
    <select class="select-input" id="type-selector">
      ${state.dishTypes.map((t) => `<option value="${esc(t.id)}" ${t.id === state.selectedTypeId ? "selected" : ""}>${t.emoji} ${esc(t.name)}</option>`).join("")}
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
      <input class="text-input" id="f-dt-name" placeholder="Nombre" value="${esc(v.name)}" />
      <input class="text-input" id="f-dt-emoji" placeholder="Emoji" value="${esc(v.emoji)}" />
    </div>
    <select class="select-input" id="f-dt-visual">
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
      <span class="emoji">${t.emoji}</span>
      <div class="meta"><div class="name">${esc(t.name)}</div><div class="sub">${esc(t.id)} · visual: ${esc(t.visualStyle)}</div></div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-dishtype" data-id="${esc(t.id)}">✎</button>
        <button class="icon-btn danger" data-action="delete-dishtype" data-id="${esc(t.id)}">✕</button>
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
      <div class="config-row"><span>Jugadores mínimo</span><input class="text-input" style="margin:0;" id="gc-min" type="number" value="${gc.minPlayers}" /></div>
      <div class="config-row"><span>Jugadores máximo</span><input class="text-input" style="margin:0;" id="gc-max" type="number" value="${gc.maxPlayers}" /></div>
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
      <input class="text-input" id="f-name" placeholder="Nombre" value="${esc(v.name)}" />
      <input class="text-input" id="f-emoji" placeholder="Emoji" value="${esc(v.emoji)}" />
    </div>
    <input class="text-input" id="f-cat" placeholder="Categoría (ej. queso, vegetal...)" value="${esc(v.cat)}" />
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
      <span class="emoji">${ing.emoji}</span>
      <div class="meta"><div class="name">${esc(ing.name)}</div><div class="sub">${esc(ing.cat)} · ${esc(ing.id)}</div></div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-ingredient" data-id="${esc(ing.id)}">✎</button>
        <button class="icon-btn danger" data-action="delete-ingredient" data-id="${esc(ing.id)}">✕</button>
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
    <span class="tag-toggle ${v.ingredients.includes(ing.id) ? "selected" : ""}" data-action="toggle-recipe-ing" data-id="${esc(ing.id)}">${ing.emoji} ${esc(ing.name)}</span>
  `).join("");
  return `
  <div class="card-panel" style="margin-bottom:14px;">
    <div class="row-label mono">${isNew ? "Nueva receta" : "Editar receta"}</div>
    <input class="text-input" id="f-recipe-name" placeholder="Nombre" value="${esc(v.name)}" />
    <div class="row-label mono">Ingredientes</div>
    <div class="tag-wrap" id="recipe-ing-tags">${tags}</div>
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
        <div class="sub">${r.ingredients.map((id) => byId[id]?.emoji || "?").join(" ")} · ${r.ingredients.length} ingr.</div>
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-recipe" data-id="${esc(r.id)}">✎</button>
        <button class="icon-btn danger" data-action="delete-recipe" data-id="${esc(r.id)}">✕</button>
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
  const catsInUse = [...new Set(t.ingredients.map((i) => i.cat))];
  const missing = catsInUse.filter((cat) => !(cat in caps));
  return `
    ${typeSelectorHTML()}
    <div class="card-panel">
      <div class="config-row"><span>Tamaño del mazo de ingredientes</span><input class="text-input" style="margin:0;" id="cfg-pool" type="number" value="${c.ingredientPoolSize}" /></div>
      <div class="config-row"><span>Recetas candidatas (máx)</span><input class="text-input" style="margin:0;" id="cfg-candmax" type="number" value="${c.candidateMax}" /></div>
      <div class="config-row"><span>Solapamiento mínimo candidata</span><input class="text-input" style="margin:0;" id="cfg-candmin" type="number" value="${c.candidateMinOverlap}" /></div>
    </div>
    <div class="row-label mono" style="margin-top:16px;">Tope de ingredientes por categoría</div>
    <div class="card-panel">
      ${Object.keys(caps).map((cat) => `<div class="config-row"><span>${esc(cat)}</span><input class="text-input" style="margin:0;" data-cap-cat="${esc(cat)}" type="number" value="${caps[cat]}" /></div>`).join("") || `<p class="subtitle">Sin categorías todavía.</p>`}
      ${missing.length ? `<p class="subtitle" style="text-align:left; color:#E8A33D;">Categorías usadas en ingredientes pero sin tope definido: ${missing.map(esc).join(", ")}. Se incluirán con tope "sin límite" hasta que les pongas uno.</p>` : ""}
    </div>
    <button class="cta" data-action="save-config">Guardar reglas</button>
  `;
}

function render() {
  const app = document.getElementById("app");
  const tabContent = state.tab === "dishtypes" ? dishTypesTab()
    : state.tab === "ingredients" ? ingredientsTab()
    : state.tab === "recipes" ? recipesTab()
    : configTab();
  app.innerHTML = `
    <div class="screen admin-wrap">
      <div class="admin-top">
        <span class="title display" style="font-size:24px;">⚙️ Configurar Dinner Match</span>
        <a href="./index.html" class="cta ghost small" style="width:auto; margin:0; padding:8px 12px; text-decoration:none;">← Volver al juego</a>
      </div>
      <div class="admin-nav">
        <button class="${state.tab === "dishtypes" ? "active" : ""}" data-action="tab" data-tab="dishtypes">Tipos de cena</button>
        <button class="${state.tab === "ingredients" ? "active" : ""}" data-action="tab" data-tab="ingredients">Ingredientes</button>
        <button class="${state.tab === "recipes" ? "active" : ""}" data-action="tab" data-tab="recipes">Recetas</button>
        <button class="${state.tab === "config" ? "active" : ""}" data-action="tab" data-tab="config">Reglas</button>
      </div>
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
  else if (action === "toggle-recipe-ing") { btn.classList.toggle("selected"); }
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
  else if (action === "save-config") {
    const t = currentType();
    t.config.ingredientPoolSize = +document.getElementById("cfg-pool").value || 0;
    t.config.candidateMax = +document.getElementById("cfg-candmax").value || 6;
    t.config.candidateMinOverlap = +document.getElementById("cfg-candmin").value || 2;
    const caps = {};
    document.querySelectorAll("[data-cap-cat]").forEach((inp) => { caps[inp.dataset.capCat] = +inp.value || 0; });
    t.config.categoryCaps = caps;
    saveDraft(); toast("Reglas guardadas");
  }

  // -- Export --
  else if (action === "export-dishtypes") download("dish-types.json", state.dishTypes);
  else if (action === "export-gameconfig") download("game-config.json", state.gameConfig);
  else if (action === "export-ingredients") download("ingredients.json", currentType().ingredients);
  else if (action === "export-recipes") download("recipes.json", currentType().recipes);
  else if (action === "export-typeconfig") download("config.json", currentType().config);

  else if (action === "clear-draft") {
    if (confirm("Se perderá el borrador local y se recargará el contenido de /data. ¿Continuar?")) {
      localStorage.removeItem(DRAFT_KEY);
      location.reload();
    }
  }
});

init();
