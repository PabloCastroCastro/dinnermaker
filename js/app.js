import { loadGameConfig, loadTypeData, shuffle, hashStr, esc, buildBalancedPool, pickCandidates, resolveDishType, ingObjs } from "./shared.js";

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
  errorMsg: "",
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
    const saved = JSON.parse(localStorage.getItem("dinnerMatchNames") || "null");
    if (saved && saved.length >= gameConfig.minPlayers) {
      state.names = saved;
      state.numPlayers = saved.length;
    } else {
      state.numPlayers = Math.max(gameConfig.minPlayers, Math.min(3, gameConfig.maxPlayers));
      state.names = Array.from({ length: state.numPlayers }, (_, i) => `Jugador ${i + 1}`);
    }
    state.stage = "setup";
  } catch (e) {
    state.stage = "error";
    state.errorMsg = e.message;
  }
  render();
}

function setNumPlayersClamped(n) {
  const c = Math.max(gameConfig.minPlayers, Math.min(gameConfig.maxPlayers, n));
  state.numPlayers = c;
  while (state.names.length < c) state.names.push(`Jugador ${state.names.length + 1}`);
  state.names = state.names.slice(0, c);
  render();
}

function startRound1() {
  localStorage.setItem("dinnerMatchNames", JSON.stringify(state.names));
  state.round = 1;
  state.deck = shuffle(dishTypes);
  state.likesByPlayer = Array.from({ length: state.numPlayers }, () => []);
  state.playerIdx = 0;
  state.cardIdx = 0;
  state.stage = "handoff";
  render();
}

async function startRound2() {
  state.stage = "loading";
  render();
  typeData = await loadTypeData(state.dishTypeResult.chosen.id);
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

// ---- Render pieces ----
function dishVisualHTML(ingredients, style, size = 240) {
  const toppings = ingredients.map((ing, i) => {
    const h = hashStr(ing.id);
    const angle = (i / Math.max(ingredients.length, 1)) * 2 * Math.PI + (h % 100) / 100;
    const radius = 22 + (h % 55);
    const left = 50 + radius * Math.cos(angle) * 0.42;
    const top = 50 + radius * Math.sin(angle) * 0.42;
    return `<span class="topping" style="left:${left}%;top:${top}%">${ing.emoji}</span>`;
  }).join("");
  return `<div class="pizza-wrap dish-visual ${style}" style="width:${size}px;height:${size}px;"><div class="plate-bg"></div><div class="plate-fill"></div>${toppings}</div>`;
}

function renderLoading() {
  return `<div class="screen"><p class="subtitle">Cargando…</p></div>`;
}
function renderError() {
  return `<div class="screen"><div class="error-box">No se pudo cargar el contenido del juego.<br>${esc(state.errorMsg)}<br><br>¿Estás sirviendo la carpeta con un servidor local (no file://)?</div></div>`;
}

function renderSetup() {
  return `
  <div class="screen">
    <div class="logo-row">🍽️<span class="title display">Dinner Match</span></div>
    <p class="subtitle">Tres rondas: primero el tipo de cena, luego sus ingredientes, y por último el plato concreto.</p>
    <div class="card-panel">
      <div class="row-label mono">Jugadores</div>
      <div class="stepper">
        <button class="step-btn" data-action="dec-players">−</button>
        <span class="step-count">${state.numPlayers}</span>
        <button class="step-btn" data-action="inc-players">+</button>
      </div>
      <div class="row-label mono">Nombres</div>
      ${state.names.map((n, i) => `<input class="name-input" data-name-idx="${i}" maxlength="16" value="${esc(n)}" />`).join("")}
      <div class="row-label mono" style="margin-top:14px;">Tipos de cena en juego</div>
      <div class="chip-list" style="margin-bottom:0;">
        ${dishTypes.map((t) => `<div class="chip">${t.emoji}${esc(t.name)}</div>`).join("")}
      </div>
    </div>
    <button class="cta" data-action="start-round1">🍽️ Empezar ronda 1</button>
    <a href="./admin.html" class="cta ghost small" style="text-decoration:none; text-align:center;">⚙️ Configurar tipos, ingredientes y recetas</a>
  </div>`;
}

function roundLabel() {
  if (state.round === 1) return "Ronda 1 · Tipo de cena";
  const typeName = state.dishTypeResult?.chosen?.name || "";
  if (state.round === 2) return `Ronda 2 · Ingredientes de ${typeName}`;
  return `Ronda 3 · Platos de ${typeName}`;
}

function renderHandoff() {
  const sub = state.round === 1
    ? "Pasa el móvil y toca cuando estés listo/a. Nadie más debería ver tus elecciones."
    : state.round === 2
      ? `Ahora vas a votar ingredientes de ${state.dishTypeResult.chosen.name}.`
      : `Ahora vas a votar platos completos de ${state.dishTypeResult.chosen.name} propuestos a partir de la ronda anterior.`;
  const color = PLAYER_COLORS[state.playerIdx % PLAYER_COLORS.length];
  const name = state.names[state.playerIdx] || "?";
  return `
  <div class="screen">
    <div class="round-pill">${roundLabel()}</div>
    <div class="player-tag mono">Jugador ${state.playerIdx + 1} de ${state.numPlayers}</div>
    <div class="avatar" style="background:${color}">${esc(name.charAt(0).toUpperCase() || "?")}</div>
    <div class="handoff-title display">Turno de ${esc(name)}</div>
    <div class="handoff-sub">${sub}</div>
    <button class="cta" data-action="begin-turn">Estoy listo/a →</button>
  </div>`;
}

function renderSwipe() {
  const currentCard = state.deck[state.cardIdx];
  if (!currentCard) return `<div class="screen"></div>`;
  const nextCard = state.deck[state.cardIdx + 1];
  const simpleCard = state.round === 1 || state.round === 2;

  const behindHTML = nextCard ? (
    simpleCard
      ? `<div class="ing-card behind"><div class="ing-emoji">${nextCard.emoji}</div><div class="ing-name display">${esc(nextCard.name)}</div></div>`
      : `<div class="ing-card behind"><div class="pizza-card-name display">${esc(nextCard.name)}</div></div>`
  ) : "";

  const topInner = simpleCard
    ? `<div class="ing-emoji">${currentCard.emoji}</div><div class="ing-name display">${esc(currentCard.name)}</div>`
    : `<div class="pizza-card-name display">${esc(currentCard.name)}</div>
       <div class="pizza-ing-grid">${ingObjs(currentCard.ingredients, typeData.ingById).map((ing) => `<span class="pizza-ing-chip">${ing.emoji}${esc(ing.name)}</span>`).join("")}</div>
       ${currentCard.custom ? `<div class="custom-tag">Todo lo de la ronda anterior</div>` : ""}`;

  return `
  <div class="screen">
    <div class="swipe-top">
      <span class="count-label mono">${esc(state.names[state.playerIdx])} · ${state.cardIdx + 1}/${state.deck.length}</span>
      <div class="progress-track"><div class="progress-fill" style="width:${(state.cardIdx / state.deck.length) * 100}%"></div></div>
    </div>
    <div class="stack">
      ${behindHTML}
      <div class="ing-card top" data-action="card">
        <div class="stamp yes display">SÍ</div>
        <div class="stamp no display">NO</div>
        ${topInner}
      </div>
    </div>
    <div class="swipe-btns">
      <button class="round-btn no" data-action="swipe-no">✕</button>
      <button class="round-btn yes" data-action="swipe-yes">♥</button>
    </div>
    <div class="hint">Desliza la carta o usa los botones</div>
  </div>`;
}

function renderSummary1() {
  const has = state.round1Matches.length > 0;
  if (!has) {
    return `
    <div class="screen">
      <div class="round-pill">Ronda 1 completada</div>
      <div class="result-title display">Sin coincidencias…</div>
      <div class="result-sub">No hubo ni un tipo de cena en el que todos dijerais que sí.</div>
      <button class="cta" data-action="reset">↺ Jugar otra ronda</button>
    </div>`;
  }
  const r = state.dishTypeResult;
  return `
  <div class="screen">
    <div class="round-pill">Ronda 1 completada</div>
    <div class="result-title display">Toca ${esc(r.chosen.name)} ${r.chosen.emoji}</div>
    <div class="result-sub">
      ${state.round1Matches.length > 1
        ? `Coincidisteis en ${state.round1Matches.length} tipos (${state.round1Matches.map((t) => t.name).join(", ")}) — sorteado entre ellos.`
        : `Los ${state.numPlayers} coincidisteis en este tipo de cena.`}
    </div>
    <button class="cta" data-action="start-round2">✨ Ver ingredientes de ${esc(r.chosen.name)}</button>
    <button class="cta ghost" data-action="reset" style="margin-top:10px;">↺ Empezar de cero</button>
  </div>`;
}

function renderSummary2() {
  const has = state.round2Matches.length > 0;
  const typeName = state.dishTypeResult.chosen.name;
  return `
  <div class="screen">
    <div class="round-pill">Ronda 2 completada</div>
    <div class="result-title display">${has ? "Ingredientes en común" : "Sin coincidencias…"}</div>
    <div class="result-sub">${has
      ? `Los ${state.numPlayers} coincidisteis en ${state.round2Matches.length} ingrediente${state.round2Matches.length > 1 ? "s" : ""} de ${typeName}. Ahora toca elegir el plato.`
      : `No hubo ni un ingrediente de ${typeName} en el que todos dijerais que sí.`}</div>
    ${has ? `
      <div class="chip-list">${state.round2Matches.map((ing) => `<div class="chip">${ing.emoji}${esc(ing.name)}</div>`).join("")}</div>
      <button class="cta" data-action="start-round3">✨ Ver propuestas de ${esc(typeName)}</button>
      <button class="cta ghost" data-action="reset" style="margin-top:10px;">↺ Empezar de cero</button>
    ` : `<button class="cta" data-action="reset">↺ Jugar otra ronda</button>`}
  </div>`;
}

function renderResults() {
  const has = state.round3Matches.length > 0;
  const style = state.dishTypeResult.chosen.visualStyle || "round";
  if (!has) {
    return `
    <div class="screen">
      <div class="round-pill">Ronda 3 completada</div>
      <div class="result-title display">Tampoco hubo acuerdo…</div>
      <div class="result-sub">Ninguna propuesta de ${esc(state.dishTypeResult.chosen.name)} convenció a todo el grupo.</div>
      <div class="empty-msg">Consuelo: esto era lo que teníais en común en la ronda de ingredientes.</div>
      ${dishVisualHTML(state.round2Matches, style, 200)}
      <button class="cta" data-action="reset">↺ Jugar otra ronda</button>
    </div>`;
  }
  const main = state.round3Matches[0];
  const rest = state.round3Matches.slice(1);
  return `
  <div class="screen">
    <div class="round-pill">Ronda 3 completada</div>
    <div class="result-title display">¡Esta es vuestra cena!</div>
    <div class="result-sub">Coincidisteis los ${state.numPlayers} en ${state.round3Matches.length} propuesta${state.round3Matches.length > 1 ? "s" : ""} de ${esc(state.dishTypeResult.chosen.name)}.</div>
    ${dishVisualHTML(ingObjs(main.ingredients, typeData.ingById), style)}
    <div class="pizza-card-name display" style="margin-bottom:16px;">${esc(main.name)}</div>
    <div class="chip-list">${ingObjs(main.ingredients, typeData.ingById).map((ing) => `<div class="chip">${ing.emoji}${esc(ing.name)}</div>`).join("")}</div>
    ${rest.length > 0 ? `
      <div class="section-title">También coincidisteis en</div>
      <div class="extra-pizza-row">
        ${rest.map((r) => `<div class="extra-pizza"><span class="extra-pizza-name">${esc(r.name)}</span><span class="extra-pizza-emojis">${ingObjs(r.ingredients, typeData.ingById).map((i) => i.emoji).join(" ")}</span></div>`).join("")}
      </div>` : ""}
    <button class="cta" data-action="reset">↺ Jugar otra ronda</button>
  </div>`;
}

function render() {
  const app = document.getElementById("app");
  const renderers = {
    loading: renderLoading, error: renderError, setup: renderSetup,
    handoff: renderHandoff, swipe: renderSwipe,
    summary1: renderSummary1, summary2: renderSummary2, results: renderResults,
  };
  app.innerHTML = (renderers[state.stage] || renderLoading)();

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
  else if (action === "start-round2") startRound2();
  else if (action === "start-round3") startRound3();
  else if (action === "reset") resetAll();
});
document.getElementById("app").addEventListener("input", (e) => {
  const idx = e.target.getAttribute("data-name-idx");
  if (idx !== null) state.names[+idx] = e.target.value;
});

// ---- PWA install ----
let deferredPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "flex";
});
document.getElementById("installBtn")?.addEventListener("click", async () => {
  document.getElementById("installBanner").style.display = "none";
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
});
window.addEventListener("appinstalled", () => {
  const banner = document.getElementById("installBanner");
  if (banner) banner.style.display = "none";
});
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}

init();
