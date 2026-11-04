import { loadGameConfig, loadTypeData, shuffle, hashStr, esc, buildBalancedPool, pickCandidates, pickDishTypes, resolveDishType, ingObjs } from "./shared.js";

const PLAYER_COLORS = ["#E1472B", "#E8A33D", "#6B8F47", "#B4654A", "#C98A3E", "#8C9E5E", "#D3562F", "#A46B2E"];

const state = {
  stage: "loading", // loading | error | setup | handoff | swipe | summary1 | summary2 | results
  round: 1, // 1 = tipo de cena, 2 = ingredientes, 3 = receta final
  numPlayers: 3,
  names: ["Jugador 1", "Jugador 2", "Jugador 3"],
  deck: [],
  likesByPlayer: [],
  playerIdx: 0,
  cardIdx: 0,
  round1Matches: [],   // tipos de cena matcheados
  dishTypeResult: null, // { chosen, tie, others }
  round2Matches: [],   // ingredientes matcheados dentro del tipo elegido
  round3Matches: [],   // recetas finales matcheadas
  dragX: 0,
  dragging: false,
  exitDir: 0,
  animating: false,
  errorTitle: "",
  errorMsg: "",
  errorRetry: "reload", // reload | round2
};

let dishTypes = [];
let gameConfig = null;
let typeData = null; // { ingredients, recipes, config, ingById } del tipo elegido
let startX = 0;

async function init() {
  try {
    const loaded = await loadGameConfig();
    dishTypes = loaded.dishTypes;
    gameConfig = loaded.gameConfig;
    if (!dishTypes.length) throw new Error("No hay tipos de cena configurados en data/dish-types.json");
    const saved = readSavedNames();
    if (saved.length >= gameConfig.minPlayers) {
      // Recortado a maxPlayers: puede haber bajado desde la última partida.
      state.names = saved.slice(0, gameConfig.maxPlayers);
      state.numPlayers = state.names.length;
    } else {
      state.numPlayers = Math.max(gameConfig.minPlayers, Math.min(3, gameConfig.maxPlayers));
      state.names = Array.from({ length: state.numPlayers }, (_, i) => saved[i] || defaultName(i));
    }
    state.stage = "setup";
  } catch (e) {
    showError("No se pudo cargar el contenido del juego.", e.message, "reload");
    return;
  }
  render();
}

// retry: "reload" (fallo al arrancar, no hay nada que conservar) o
// "round2" (reintenta solo la carga del tipo, sin perder la ronda 1; además
// se puede volver al setup porque los datos globales sí están cargados).
function showError(title, detail, retry) {
  state.stage = "error";
  state.errorTitle = title;
  state.errorMsg = detail;
  state.errorRetry = retry;
  render();
}

// Tipos que el grupo ha quitado hoy en el setup ("hoy no quiero pizza").
// No se guarda: es una decisión de cada partida.
const excludedTypes = new Set();
const typesInPlay = () => dishTypes.filter((t) => !excludedTypes.has(t.id));

function toggleType(id) {
  if (!excludedTypes.has(id) && typesInPlay().length === 1) {
    announce("Tiene que quedar al menos un tipo de cena en juego");
    return;
  }
  excludedTypes.has(id) ? excludedTypes.delete(id) : excludedTypes.add(id);
  render();
  const t = dishTypes.find((x) => x.id === id);
  announce(`${t.name} ${excludedTypes.has(id) ? "fuera" : "en juego"}. ${roundOneSummary()}`);
}

function roundOneSummary() {
  const n = typesInPlay().length;
  const max = gameConfig.dishTypeCandidateMax;
  return max > 0 && n > max
    ? `${n} tipos en juego: en la ronda 1 saldrán ${max} al azar.`
    : `${n} tipo${n === 1 ? "" : "s"} en juego.`;
}

const NAMES_KEY = "dinnerMatchNames";
const defaultName = (i) => `Jugador ${i + 1}`;

// Nombres de la última partida. Tolera localStorage corrupto o bloqueado
// (no debe impedir arrancar) y descarta lo que no sean textos no vacíos.
function readSavedNames() {
  try {
    const saved = JSON.parse(localStorage.getItem(NAMES_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter((n) => typeof n === "string").map((n) => n.trim().slice(0, 16)).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function setNumPlayersClamped(n) {
  const c = Math.max(gameConfig.minPlayers, Math.min(gameConfig.maxPlayers, n));
  state.numPlayers = c;
  while (state.names.length < c) state.names.push(defaultName(state.names.length));
  state.names = state.names.slice(0, c);
  render();
  announce(`${c} jugadores`);
}

function startRound1() {
  // Un nombre vacío (o solo espacios) pasa a "Jugador N" en vez de "Turno de ".
  state.names = state.names.map((n, i) => n.trim() || defaultName(i));
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(state.names)); } catch { /* modo privado, sin cuota… */ }
  state.round = 1;
  state.deck = pickDishTypes(typesInPlay(), gameConfig.dishTypeCandidateMax);
  state.likesByPlayer = Array.from({ length: state.numPlayers }, () => []);
  state.playerIdx = 0;
  state.cardIdx = 0;
  state.stage = "handoff";
  render();
}

async function startRound2() {
  state.stage = "loading";
  render();
  const chosen = state.dishTypeResult.chosen;
  try {
    typeData = await loadTypeData(chosen.id);
  } catch (e) {
    showError(`No se pudo cargar el contenido de «${chosen.name}».`, e.message, "round2");
    return;
  }
  state.round = 2;
  state.deck = buildBalancedPool(typeData.ingredients, typeData.config);
  state.likesByPlayer = Array.from({ length: state.numPlayers }, () => []);
  state.playerIdx = 0;
  state.cardIdx = 0;
  state.stage = "handoff";
  render();
}

function startRound3() {
  const cand = pickCandidates(state.round2Matches.map((i) => i.id), typeData.recipes, typeData.config);
  state.round = 3;
  state.deck = shuffle(cand);
  state.likesByPlayer = Array.from({ length: state.numPlayers }, () => []);
  state.playerIdx = 0;
  state.cardIdx = 0;
  state.stage = "handoff";
  render();
}

function beginTurn() { state.stage = "swipe"; render(); }

function finishCard(liked) {
  const currentCard = state.deck[state.cardIdx];
  if (liked && !state.likesByPlayer[state.playerIdx].includes(currentCard.id)) {
    state.likesByPlayer[state.playerIdx].push(currentCard.id);
  }
  const nextCard = state.cardIdx + 1;
  if (nextCard >= state.deck.length) {
    if (state.playerIdx + 1 < state.numPlayers) {
      state.playerIdx += 1;
      state.cardIdx = 0;
      state.stage = "handoff";
    } else {
      const matched = state.deck.filter((c) => state.likesByPlayer.every((l) => l.includes(c.id)));
      if (state.round === 1) {
        state.round1Matches = matched;
        state.dishTypeResult = resolveDishType(matched);
        state.stage = "summary1";
      } else if (state.round === 2) {
        state.round2Matches = matched;
        state.stage = "summary2";
      } else {
        state.round3Matches = matched;
        state.stage = "results";
      }
    }
  } else {
    state.cardIdx = nextCard;
  }
  state.dragX = 0; state.exitDir = 0; state.animating = false;
  render();
}

// Deshacer el último voto del jugador actual: vuelve a la carta anterior y
// la quita de sus "sí" (si era un "no", no hay nada que quitar). Solo dentro
// del turno: en la primera carta no hay voto propio que deshacer, y votar la
// última carta cierra el turno.
function undoSwipe() {
  if (state.stage !== "swipe" || state.animating || state.cardIdx === 0) return;
  state.cardIdx -= 1;
  const card = state.deck[state.cardIdx];
  const likes = state.likesByPlayer[state.playerIdx];
  const i = likes.indexOf(card.id);
  if (i !== -1) likes.splice(i, 1);
  state.dragX = 0; state.exitDir = 0;
  render();
  announce(`Voto deshecho: ${card.name}`);
}

function triggerSwipe(liked) {
  if (state.animating || !state.deck[state.cardIdx]) return;
  state.animating = true;
  state.exitDir = liked ? 1 : -1;
  updateCardTransform();
  setTimeout(() => finishCard(liked), 260);
}

function resetAll() {
  state.likesByPlayer = []; state.playerIdx = 0; state.cardIdx = 0;
  state.round1Matches = []; state.round2Matches = []; state.round3Matches = [];
  state.dishTypeResult = null;
  typeData = null;
  state.stage = "setup";
  render();
}

// ---- Drag ----
function updateCardTransform() {
  const card = document.querySelector(".ing-card.top");
  if (!card) return;
  const x = state.dragging ? state.dragX : state.exitDir * 600;
  const rot = state.dragging ? state.dragX / 18 : state.exitDir * 25;
  card.style.transform = `translateX(${x}px) rotate(${rot}deg)`;
  card.style.transition = state.dragging ? "none" : "transform .26s ease";
  const yesStamp = card.querySelector(".stamp.yes");
  const noStamp = card.querySelector(".stamp.no");
  if (yesStamp) yesStamp.style.display = state.dragX > 40 ? "block" : "none";
  if (noStamp) noStamp.style.display = state.dragX < -40 ? "block" : "none";
}

document.addEventListener("pointermove", (e) => {
  if (!state.dragging || state.animating) return;
  state.dragX = e.clientX - startX;
  updateCardTransform();
});
document.addEventListener("pointerup", () => {
  if (!state.dragging) return;
  state.dragging = false;
  if (Math.abs(state.dragX) > 110) {
    triggerSwipe(state.dragX > 0);
  } else {
    state.dragX = 0;
    updateCardTransform();
  }
});
// El navegador cancela el gesto (scroll del sistema, llamada entrante, otro
// dedo…): la carta vuelve a su sitio sin votar y el arrastre no queda colgado.
document.addEventListener("pointercancel", () => {
  if (!state.dragging) return;
  state.dragging = false;
  state.dragX = 0;
  updateCardTransform();
});

// ---- Render pieces ----
// Accesibilidad:
// - Los emojis son decorativos (aria-hidden): el nombre siempre va en texto.
// - [data-autofocus] recibe el foco al cambiar de pantalla (o de carta), para
//   que teclado y lectores de pantalla sigan el flujo sin perderse en <body>.
// - [data-announce] es lo que se lee por la región aria-live al llegar a una
//   pantalla (turno, resumen de ronda, resultado).
const emo = (e) => `<span aria-hidden="true">${esc(e)}</span>`;
const namesOf = (ings) => ings.map((i) => i.name).join(", ");

function dishVisualHTML(ingredients, style, size = 240) {
  const toppings = ingredients.map((ing, i) => {
    const h = hashStr(ing.id);
    const angle = (i / Math.max(ingredients.length, 1)) * 2 * Math.PI + (h % 100) / 100;
    const radius = 22 + (h % 55);
    const left = 50 + radius * Math.cos(angle) * 0.42;
    const top = 50 + radius * Math.sin(angle) * 0.42;
    return `<span class="topping" style="left:${left}%;top:${top}%">${esc(ing.emoji)}</span>`;
  }).join("");
  return `<div class="pizza-wrap dish-visual ${esc(style)}" aria-hidden="true" style="width:${size}px;height:${size}px;"><div class="plate-bg"></div><div class="plate-fill"></div>${toppings}</div>`;
}

const chipsHTML = (ings) => `<ul class="chip-list">${ings.map((ing) => `<li class="chip">${emo(ing.emoji)}${esc(ing.name)}</li>`).join("")}</ul>`;

function renderLoading() {
  return `<div class="screen"><p class="subtitle" role="status">Cargando…</p></div>`;
}
function renderError() {
  const hint = location.protocol === "file:"
    ? `<br><br>¿Estás sirviendo la carpeta con un servidor local (no file://)?`
    : "";
  return `
  <div class="screen">
    <div class="error-box" role="alert">${esc(state.errorTitle)}<br>${esc(state.errorMsg)}${hint}</div>
    <button class="cta" data-action="retry" data-autofocus style="margin-top:16px;">${emo("⟳")} Reintentar</button>
    ${state.errorRetry === "round2" ? `<button class="cta ghost" data-action="reset" style="margin-top:10px;">${emo("↺")} Volver al inicio</button>` : ""}
  </div>`;
}

function renderSetup() {
  return `
  <div class="screen">
    <h1 class="logo-row">${emo("🍽️")}<span class="title display">Dinner Match</span></h1>
    <p class="subtitle">Tres rondas: primero el tipo de cena, luego sus ingredientes, y por último el plato concreto.</p>
    <div class="card-panel">
      <div class="row-label mono" id="players-label">Jugadores</div>
      <div class="stepper" role="group" aria-labelledby="players-label">
        <button class="step-btn" data-action="dec-players" aria-label="Quitar jugador" ${state.numPlayers <= gameConfig.minPlayers ? "disabled" : ""}>−</button>
        <span class="step-count">${state.numPlayers}</span>
        <button class="step-btn" data-action="inc-players" aria-label="Añadir jugador" ${state.numPlayers >= gameConfig.maxPlayers ? "disabled" : ""}>+</button>
      </div>
      <div class="row-label mono">Nombres</div>
      ${state.names.map((n, i) => `<input class="name-input" data-name-idx="${i}" maxlength="16" value="${esc(n)}" aria-label="Nombre del jugador ${i + 1}" />`).join("")}
      <div class="row-label mono" style="margin-top:14px;" id="types-label">Tipos de cena en juego</div>
      <div role="group" aria-labelledby="types-label" aria-describedby="types-summary">
      <ul class="chip-list" style="margin-bottom:8px;">
        ${dishTypes.map((t) => {
          const on = !excludedTypes.has(t.id);
          return `<li><button type="button" class="chip chip-toggle${on ? "" : " off"}" data-action="toggle-type" data-id="${esc(t.id)}" aria-pressed="${on}">${emo(on ? t.emoji : "🚫")}${esc(t.name)}</button></li>`;
        }).join("")}
      </ul>
      </div>
      <p class="subtitle" id="types-summary" style="margin:0; font-size:12px;">${esc(roundOneSummary())} Toca un tipo para quitarlo hoy.</p>
    </div>
    <button class="cta" data-action="start-round1" data-autofocus>${emo("🍽️")} Empezar ronda 1</button>
    <a href="./admin.html" class="cta ghost small" style="text-decoration:none; text-align:center;">${emo("⚙️")} Configurar tipos, ingredientes y recetas</a>
  </div>`;
}

function roundLabel() {
  if (state.round === 1) return "Ronda 1 · Tipo de cena";
  const typeName = state.dishTypeResult?.chosen?.name || "";
  if (state.round === 2) return `Ronda 2 · Ingredientes de ${typeName}`;
  return `Ronda 3 · Platos de ${typeName}`;
}

function renderHandoff() {
  const typeName = esc(state.dishTypeResult?.chosen?.name || "");
  const sub = state.round === 1
    ? "Pasa el móvil y toca cuando estés listo/a. Nadie más debería ver tus elecciones."
    : state.round === 2
      ? `Ahora vas a votar ingredientes de ${typeName}.`
      : `Ahora vas a votar platos completos de ${typeName} propuestos a partir de la ronda anterior.`;
  const color = PLAYER_COLORS[state.playerIdx % PLAYER_COLORS.length];
  const name = state.names[state.playerIdx] || "?";
  return `
  <div class="screen">
    <div class="round-pill" data-announce>${esc(roundLabel())}</div>
    <div class="player-tag mono">Jugador ${state.playerIdx + 1} de ${state.numPlayers}</div>
    <div class="avatar" aria-hidden="true" style="background:${color}">${esc(name.charAt(0).toUpperCase() || "?")}</div>
    <h1 class="handoff-title display" data-announce>Turno de ${esc(name)}</h1>
    <div class="handoff-sub">${sub}</div>
    <button class="cta" data-action="begin-turn" data-autofocus>Estoy listo/a ${emo("→")}</button>
  </div>`;
}

function renderSwipe() {
  const currentCard = state.deck[state.cardIdx];
  if (!currentCard) return `<div class="screen"></div>`;
  const nextCard = state.deck[state.cardIdx + 1];
  const simpleCard = state.round === 1 || state.round === 2;
  const pos = `${state.cardIdx + 1} de ${state.deck.length}`;

  const behindHTML = nextCard ? (
    simpleCard
      ? `<div class="ing-card behind" aria-hidden="true"><div class="ing-emoji">${esc(nextCard.emoji)}</div><div class="ing-name display">${esc(nextCard.name)}</div></div>`
      : `<div class="ing-card behind" aria-hidden="true"><div class="pizza-card-name display">${esc(nextCard.name)}</div></div>`
  ) : "";

  const recipeIngs = simpleCard ? [] : ingObjs(currentCard.ingredients, typeData.ingById);
  const topInner = simpleCard
    ? `<div class="ing-emoji" aria-hidden="true">${esc(currentCard.emoji)}</div><div class="ing-name display">${esc(currentCard.name)}</div>`
    : `<div class="pizza-card-name display">${esc(currentCard.name)}</div>
       <div class="pizza-ing-grid">${recipeIngs.map((ing) => `<span class="pizza-ing-chip">${emo(ing.emoji)}${esc(ing.name)}</span>`).join("")}</div>
       ${currentCard.custom ? `<div class="custom-tag">Todo lo de la ronda anterior</div>` : ""}`;
  const cardLabel = simpleCard
    ? `${currentCard.name}. Carta ${pos}`
    : `${currentCard.name}: ${namesOf(recipeIngs)}. Carta ${pos}`;

  return `
  <div class="screen">
    <h1 class="sr-only">${esc(roundLabel())}: turno de ${esc(state.names[state.playerIdx])}</h1>
    <div class="swipe-top">
      <span class="count-label mono">${esc(state.names[state.playerIdx])} · ${state.cardIdx + 1}/${state.deck.length}</span>
      <div class="progress-track" role="progressbar" aria-label="Cartas votadas" aria-valuemin="0" aria-valuemax="${state.deck.length}" aria-valuenow="${state.cardIdx}"><div class="progress-fill" style="width:${(state.cardIdx / state.deck.length) * 100}%"></div></div>
    </div>
    <div class="stack">
      ${behindHTML}
      <div class="ing-card top" data-action="card" tabindex="0" role="group" aria-roledescription="carta"
           aria-label="${esc(cardLabel)}" aria-describedby="swipe-hint" data-autofocus>
        <div class="stamp yes display" aria-hidden="true">SÍ</div>
        <div class="stamp no display" aria-hidden="true">NO</div>
        ${topInner}
      </div>
    </div>
    <div class="swipe-btns">
      <button class="round-btn no" data-action="swipe-no" aria-label="No" aria-keyshortcuts="ArrowLeft">${emo("✕")}</button>
      <button class="round-btn yes" data-action="swipe-yes" aria-label="Sí" aria-keyshortcuts="ArrowRight">${emo("♥")}</button>
    </div>
    <button class="cta ghost small undo-btn" data-action="undo" aria-keyshortcuts="Control+Z"
            ${state.cardIdx === 0 ? "disabled" : ""}>${emo("↶")} Deshacer${state.cardIdx > 0 ? `<span class="sr-only">: ${esc(state.deck[state.cardIdx - 1].name)}</span>` : ""}</button>
    <div class="hint" id="swipe-hint">Desliza la carta, usa los botones o las flechas ← (no) y → (sí) del teclado. Ctrl+Z deshace.</div>
  </div>`;
}

function renderSummary1() {
  const has = state.round1Matches.length > 0;
  if (!has) {
    return `
    <div class="screen">
      <div class="round-pill">Ronda 1 completada</div>
      <h1 class="result-title display" data-announce>Sin coincidencias…</h1>
      <div class="result-sub" data-announce>No hubo ni un tipo de cena en el que todos dijerais que sí.</div>
      <button class="cta" data-action="reset" data-autofocus>${emo("↺")} Jugar otra ronda</button>
    </div>`;
  }
  const r = state.dishTypeResult;
  return `
  <div class="screen">
    <div class="round-pill">Ronda 1 completada</div>
    <h1 class="result-title display" data-announce>Toca ${esc(r.chosen.name)} ${emo(r.chosen.emoji)}</h1>
    <div class="result-sub" data-announce>
      ${state.round1Matches.length > 1
        ? `Coincidisteis en ${state.round1Matches.length} tipos (${esc(state.round1Matches.map((t) => t.name).join(", "))}) — sorteado entre ellos.`
        : `Los ${state.numPlayers} coincidisteis en este tipo de cena.`}
    </div>
    <button class="cta" data-action="start-round2" data-autofocus>${emo("✨")} Ver ingredientes de ${esc(r.chosen.name)}</button>
    <button class="cta ghost" data-action="reset" style="margin-top:10px;">${emo("↺")} Empezar de cero</button>
  </div>`;
}

function renderSummary2() {
  const has = state.round2Matches.length > 0;
  const typeName = esc(state.dishTypeResult.chosen.name);
  return `
  <div class="screen">
    <div class="round-pill">Ronda 2 completada</div>
    <h1 class="result-title display" data-announce>${has ? "Ingredientes en común" : "Sin coincidencias…"}</h1>
    <div class="result-sub" data-announce>${has
      ? `Los ${state.numPlayers} coincidisteis en ${state.round2Matches.length} ingrediente${state.round2Matches.length > 1 ? "s" : ""} de ${typeName}: ${esc(namesOf(state.round2Matches))}. Ahora toca elegir el plato.`
      : `No hubo ni un ingrediente de ${typeName} en el que todos dijerais que sí.`}</div>
    ${has ? `
      ${chipsHTML(state.round2Matches)}
      <button class="cta" data-action="start-round3" data-autofocus>${emo("✨")} Ver propuestas de ${typeName}</button>
      <button class="cta ghost" data-action="reset" style="margin-top:10px;">${emo("↺")} Empezar de cero</button>
    ` : `<button class="cta" data-action="reset" data-autofocus>${emo("↺")} Jugar otra ronda</button>`}
  </div>`;
}

function renderResults() {
  const has = state.round3Matches.length > 0;
  const style = state.dishTypeResult.chosen.visualStyle || "round";
  const typeName = esc(state.dishTypeResult.chosen.name);
  if (!has) {
    return `
    <div class="screen">
      <div class="round-pill">Ronda 3 completada</div>
      <h1 class="result-title display" data-announce>Tampoco hubo acuerdo…</h1>
      <div class="result-sub" data-announce>Ninguna propuesta de ${typeName} convenció a todo el grupo.</div>
      <div class="empty-msg">Consuelo: esto era lo que teníais en común en la ronda de ingredientes.</div>
      ${dishVisualHTML(state.round2Matches, style, 200)}
      ${chipsHTML(state.round2Matches)}
      <button class="cta" data-action="reset" data-autofocus>${emo("↺")} Jugar otra ronda</button>
    </div>`;
  }
  const main = state.round3Matches[0];
  const mainIngs = ingObjs(main.ingredients, typeData.ingById);
  const rest = state.round3Matches.slice(1);
  return `
  <div class="screen">
    <div class="round-pill">Ronda 3 completada</div>
    <h1 class="result-title display" data-announce>¡Esta es vuestra cena!</h1>
    <div class="result-sub">Coincidisteis los ${state.numPlayers} en ${state.round3Matches.length} propuesta${state.round3Matches.length > 1 ? "s" : ""} de ${typeName}.</div>
    ${dishVisualHTML(mainIngs, style)}
    <h2 class="pizza-card-name display" style="margin-bottom:16px;" data-announce>${esc(main.name)}</h2>
    ${chipsHTML(mainIngs)}
    ${rest.length > 0 ? `
      <h2 class="section-title">También coincidisteis en</h2>
      <ul class="extra-pizza-row">
        ${rest.map((r) => {
          const ings = ingObjs(r.ingredients, typeData.ingById);
          return `<li class="extra-pizza"><span class="extra-pizza-name">${esc(r.name)}</span><span class="extra-pizza-ings">${ings.map((i) => `${emo(i.emoji)} ${esc(i.name)}`).join(" · ")}</span></li>`;
        }).join("")}
      </ul>` : ""}
    <button class="cta" data-action="reset" data-autofocus>${emo("↺")} Jugar otra ronda</button>
  </div>`;
}

let lastStage = null;
let lastCardIdx = null;

// Texto tal como lo leería un lector de pantalla: sin lo marcado aria-hidden (emojis).
function spokenText(el) {
  const copy = el.cloneNode(true);
  copy.querySelectorAll("[aria-hidden='true']").forEach((n) => n.remove());
  return copy.textContent.trim().replace(/\s+/g, " ");
}

function announce(msg) {
  const el = document.getElementById("announcer");
  if (!el || !msg) return;
  // Vaciar y reescribir en el siguiente tick para que se anuncie aunque el
  // texto coincida con el anterior.
  el.textContent = "";
  setTimeout(() => { el.textContent = msg; }, 50);
}

function render() {
  const app = document.getElementById("app");
  const renderers = {
    loading: renderLoading, error: renderError, setup: renderSetup,
    handoff: renderHandoff, swipe: renderSwipe,
    summary1: renderSummary1, summary2: renderSummary2, results: renderResults,
  };
  // innerHTML destruye el elemento con foco: recordar cuál era para
  // devolvérselo a su equivalente (p. ej. el botón + del stepper).
  const prevFocus = document.activeElement?.closest?.("#app [data-action], #app [data-name-idx]");
  const prevFocusSel = prevFocus
    ? (prevFocus.dataset.nameIdx !== undefined ? `[data-name-idx="${prevFocus.dataset.nameIdx}"]`
      : `[data-action="${prevFocus.dataset.action}"]` + (prevFocus.dataset.id ? `[data-id="${CSS.escape(prevFocus.dataset.id)}"]` : ""))
    : null;

  app.innerHTML = (renderers[state.stage] || renderLoading)();

  const stageChanged = state.stage !== lastStage;
  const cardChanged = state.stage === "swipe" && state.cardIdx !== lastCardIdx;
  const firstScreen = lastStage === null; // no robar el foco al abrir la app
  lastStage = state.stage;
  lastCardIdx = state.stage === "swipe" ? state.cardIdx : null;

  const restore = prevFocusSel && app.querySelector(prevFocusSel);
  if ((stageChanged || cardChanged) && !firstScreen) {
    app.querySelector("[data-autofocus]")?.focus({ preventScroll: state.stage === "swipe" });
  } else if (restore) {
    // Si el botón quedó deshabilitado (p. ej. + al llegar al máximo), al otro del stepper.
    (restore.disabled ? app.querySelector(".step-btn:not([disabled])") : restore)?.focus();
  }
  if (stageChanged && !firstScreen) {
    announce([...app.querySelectorAll("[data-announce]")].map(spokenText).filter(Boolean)
      .map((t) => (/[.!?…:]$/.test(t) ? t : `${t}.`)).join(" "));
  }

  if (state.stage === "swipe") {
    const card = app.querySelector(".ing-card.top");
    if (card) {
      updateCardTransform();
      card.addEventListener("pointerdown", (e) => {
        if (state.animating) return;
        state.dragging = true;
        startX = e.clientX;
      });
    }
  }
}

// Teclado en el swipe: ← no, → sí (sin auto-repetición, para no votar
// varias cartas por mantener la tecla pulsada).
document.addEventListener("keydown", (e) => {
  if (state.stage !== "swipe" || e.repeat || e.altKey || e.shiftKey) return;
  if (e.target.closest?.("input, textarea, select")) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoSwipe(); return; }
  if (e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowRight") { e.preventDefault(); triggerSwipe(true); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); triggerSwipe(false); }
});

document.getElementById("app").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.getAttribute("data-action");
  if (action === "dec-players") setNumPlayersClamped(state.numPlayers - 1);
  else if (action === "inc-players") setNumPlayersClamped(state.numPlayers + 1);
  else if (action === "start-round1") startRound1();
  else if (action === "begin-turn") beginTurn();
  else if (action === "swipe-no") triggerSwipe(false);
  else if (action === "swipe-yes") triggerSwipe(true);
  else if (action === "undo") undoSwipe();
  else if (action === "toggle-type") toggleType(btn.dataset.id);
  else if (action === "start-round2") startRound2();
  else if (action === "start-round3") startRound3();
  else if (action === "reset") resetAll();
  else if (action === "retry") state.errorRetry === "round2" ? startRound2() : location.reload();
});
document.getElementById("app").addEventListener("input", (e) => {
  const idx = e.target.getAttribute("data-name-idx");
  if (idx !== null) state.names[+idx] = e.target.value;
});

// ---- PWA install ----
// El banner es position: fixed. Mientras se ve, el body reserva abajo su
// altura real (--install-banner-h, medida con ResizeObserver porque en móvil
// el texto puede ocupar dos líneas) para que no tape el último botón.
const INSTALL_DISMISSED_KEY = "dinnerMatchInstallDismissed";
const installBanner = document.getElementById("installBanner");
let deferredPrompt;
const bannerObserver = "ResizeObserver" in window
  ? new ResizeObserver(() => document.body.style.setProperty("--install-banner-h", `${installBanner.offsetHeight}px`))
  : null;

function installDismissed() {
  try { return localStorage.getItem(INSTALL_DISMISSED_KEY) === "1"; } catch { return false; }
}
function setInstallBanner(visible) {
  if (!installBanner) return;
  installBanner.hidden = !visible;
  document.body.classList.toggle("has-install-banner", visible);
  if (visible) {
    document.body.style.setProperty("--install-banner-h", `${installBanner.offsetHeight}px`);
    bannerObserver?.observe(installBanner);
  } else {
    bannerObserver?.disconnect();
  }
}
// Al cerrar el banner con su botón, el foco no debe caer en <body>.
function focusAfterBanner() {
  if (installBanner?.contains(document.activeElement)) document.querySelector("#app [data-autofocus]")?.focus();
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (!installDismissed()) setInstallBanner(true);
});
document.getElementById("installBtn")?.addEventListener("click", () => {
  focusAfterBanner();
  setInstallBanner(false);
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
});
document.getElementById("installClose")?.addEventListener("click", () => {
  focusAfterBanner();
  setInstallBanner(false);
  try { localStorage.setItem(INSTALL_DISMISSED_KEY, "1"); } catch { /* sin almacenamiento: volverá a salir */ }
});
window.addEventListener("appinstalled", () => setInstallBanner(false));
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

init();
