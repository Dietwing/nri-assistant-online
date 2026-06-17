const ATTRIBUTES = [
  ["strength", "Сила"],
  ["dexterity", "Ловкость"],
  ["constitution", "Телосложение"],
  ["intelligence", "Интеллект"],
  ["wisdom", "Мудрость"],
  ["charisma", "Харизма"],
];

const DEFAULT_MAP_WIDTH = 14;
const DEFAULT_MAP_HEIGHT = 10;
const MAX_MAP_WIDTH = 175;
const MAX_MAP_HEIGHT = 131;
const MIN_MAP_SIZE = 1;
const MAX_MAP_IMAGE_CHARS = 850000;
const STORAGE_KEY = "nri.state";
const OLD_CHARACTER_KEY = "nri.characters";
const OLD_BATTLE_KEY = "nri.battle";
const SAVE_DEBOUNCE_MS = 200;
const MAX_HISTORY_ENTRIES = 8;
const MAX_HISTORY_CHARS = 350000;
const MAX_BATTLE_SAVE_CHARS = 1000000;
const MAX_LOG_ENTRIES = 120;
const MAX_DICE_COUNT = 20;
const MAX_DICE_SIDES = 100;
const MAX_FORMULA_BONUS = 999;
const MAP_MOVE_LOCK_MS = 120;
const ONLINE_CONFIG_KEY = "nri.online.config";
const ONLINE_POLL_MS = 1500;
const ONLINE_PUSH_DEBOUNCE_MS = 350;
const ONLINE_ROOM_MAX_LENGTH = 40;
const MIN_MAP_ZOOM = 0.5;
const MAX_MAP_ZOOM = 3;
const MAP_ZOOM_STEP = 0.25;

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const starterCharacters = [
  {
    id: newId(),
    name: "Арлен",
    hp: 38,
    maxHp: 38,
    ac: 16,
    proficiency: 2,
    skills: "Атлетика +5, Выживание +3",
    attributes: { strength: 16, dexterity: 12, constitution: 14, intelligence: 9, wisdom: 13, charisma: 10 },
    abilities: [
      { id: newId(), name: "Длинный меч", type: "damage", attackBonus: 5, effectFormula: "1d8+3" },
      { id: newId(), name: "Второе дыхание", type: "heal", attackBonus: 0, effectFormula: "1d10+4" },
    ],
  },
  {
    id: newId(),
    name: "Мира",
    hp: 25,
    maxHp: 25,
    ac: 12,
    proficiency: 2,
    skills: "Магия +6, История +5",
    attributes: { strength: 8, dexterity: 14, constitution: 12, intelligence: 18, wisdom: 11, charisma: 13 },
    abilities: [
      { id: newId(), name: "Огненный луч", type: "damage", attackBonus: 6, effectFormula: "1d10+4" },
      { id: newId(), name: "Лечащее слово", type: "heal", attackBonus: 0, effectFormula: "1d4+4" },
    ],
  },
  {
    id: newId(),
    name: "Теневой страж",
    hp: 44,
    maxHp: 44,
    ac: 14,
    proficiency: 2,
    skills: "Скрытность +4, Внимательность +3",
    attributes: { strength: 14, dexterity: 15, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 },
    abilities: [
      { id: newId(), name: "Когти", type: "damage", attackBonus: 4, effectFormula: "2d6+2" },
      { id: newId(), name: "Темная подпитка", type: "heal", attackBonus: 0, effectFormula: "1d8+2" },
    ],
  },
];

const initialState = loadAppState();
const state = {
  characters: initialState.characters,
  battle: initialState.battle,
  selectedTab: "library",
  selectedMapCombatant: "",
  mapAction: { actorId: "", targetId: "" },
  mapZoom: 1,
  mapLogExpanded: false,
  online: loadOnlineConfig(),
};

const $ = (selector) => document.querySelector(selector);
let saveErrorShown = false;
let saveTimer = 0;
let mapMoveLocked = false;
let onlinePollTimer = 0;
let onlinePushTimer = 0;
let onlineApplyingRemote = false;

function saveAll() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = 0;
  }
  try {
    pruneBattleForStorage();
    const payload = JSON.stringify({
      version: 2,
      characters: state.characters,
      battle: state.battle,
    });
    if (payload.length > MAX_BATTLE_SAVE_CHARS) {
      pruneBattleForStorage(true);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 2,
      characters: state.characters,
      battle: state.battle,
    }));
    localStorage.removeItem(OLD_CHARACTER_KEY);
    localStorage.removeItem(OLD_BATTLE_KEY);
    saveErrorShown = false;
  } catch (error) {
    console.error("Ошибка сохранения:", error);
    if (!saveErrorShown) {
      saveErrorShown = true;
      alert("Не удалось сохранить данные. Возможно, хранилище переполнено.");
    }
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveAll, SAVE_DEBOUNCE_MS);
}

function createDefaultMap() {
  return { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT, image: "" };
}

function createEmptyBattle() {
  return { round: 1, teamA: [], teamB: [], log: [], history: [], map: createDefaultMap() };
}

function loadAppState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.length > MAX_BATTLE_SAVE_CHARS) {
        console.error("Сохраненное состояние приложения слишком большое. Используется стартовое состояние.");
        localStorage.removeItem(STORAGE_KEY);
      } else {
        const parsed = JSON.parse(raw);
        return {
          characters: parsed?.characters ?? clone(starterCharacters),
          battle: parsed?.battle ?? createEmptyBattle(),
        };
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки общего состояния:", error);
  }

  return {
    characters: load(OLD_CHARACTER_KEY, clone(starterCharacters)),
    battle: load(OLD_BATTLE_KEY, createEmptyBattle()),
  };
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    if (key === OLD_BATTLE_KEY && raw.length > MAX_BATTLE_SAVE_CHARS) {
      console.error("Сохраненное состояние боя слишком большое. Поле боя сброшено.");
      localStorage.removeItem(key);
      return fallback;
    }
    return JSON.parse(raw) ?? fallback;
  } catch (error) {
    console.error("Ошибка загрузки:", error);
    return fallback;
  }
}

function createOnlineConfig() {
  return {
    connected: false,
    role: "gm",
    dbUrl: "",
    roomCode: "",
    playerCombatId: "",
    clientId: newId(),
    status: "Онлайн-режим выключен.",
    lastRemoteUpdate: 0,
    lastPushAt: 0,
  };
}

function loadOnlineConfig() {
  const fallback = createOnlineConfig();
  try {
    const raw = localStorage.getItem(ONLINE_CONFIG_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      role: parsed?.role === "player" ? "player" : "gm",
      dbUrl: normalizeDatabaseUrl(parsed?.dbUrl || ""),
      roomCode: sanitizeRoomCode(parsed?.roomCode || ""),
      playerCombatId: String(parsed?.playerCombatId || ""),
      clientId: typeof parsed?.clientId === "string" && parsed.clientId ? parsed.clientId : fallback.clientId,
      connected: false,
    };
  } catch (error) {
    console.error("Ошибка загрузки онлайн-настроек:", error);
    return fallback;
  }
}

function saveOnlineConfig() {
  try {
    localStorage.setItem(ONLINE_CONFIG_KEY, JSON.stringify({
      role: state.online.role,
      dbUrl: state.online.dbUrl,
      roomCode: state.online.roomCode,
      playerCombatId: state.online.playerCombatId,
      clientId: state.online.clientId,
    }));
  } catch (error) {
    console.error("Ошибка сохранения онлайн-настроек:", error);
  }
}

function modifier(score) {
  return Math.floor((Number(score) - 10) / 2);
}

function signed(value) {
  return value >= 0 ? `+${value}` : `${value}`;
}

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function parseDiceFormula(formula) {
  const cleaned = String(formula || "0").replace(/\s/g, "").toLowerCase();
  if (/^[+-]?\d+$/.test(cleaned)) {
    const value = Number(cleaned);
    return Math.abs(value) <= MAX_FORMULA_BONUS ? { constant: value } : null;
  }
  const match = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/);
  if (!match) return null;
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const bonus = Number(match[3] || 0);
  if (!Number.isInteger(count) || count < 1 || count > MAX_DICE_COUNT) return null;
  if (!Number.isInteger(sides) || sides < 2 || sides > MAX_DICE_SIDES) return null;
  if (!Number.isInteger(bonus) || Math.abs(bonus) > MAX_FORMULA_BONUS) return null;
  return { count, sides, bonus };
}

function validateDiceFormula(formula) {
  return Boolean(parseDiceFormula(formula));
}

function rollFormula(formula) {
  const parsed = parseDiceFormula(formula);
  if (!parsed) return { total: 0, rolls: [], error: "Некорректная формула" };
  if ("constant" in parsed) return { total: parsed.constant, rolls: [] };
  const rolls = Array.from({ length: parsed.count }, () => rollDie(parsed.sides));
  return { total: rolls.reduce((sum, value) => sum + value, parsed.bonus), rolls };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createEmpty(message) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = message;
  return element;
}

function populateSelect(selector, items, valueKey, textKey, emptyText = "Нет элементов") {
  const select = $(selector);
  select.textContent = "";
  if (!items.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyText;
    select.appendChild(option);
    return;
  }

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = String(item[valueKey] ?? "");
    option.textContent = String(item[textKey] ?? "");
    select.appendChild(option);
  });
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function sanitizeRoomCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, ONLINE_ROOM_MAX_LENGTH);
}

function normalizeDatabaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.json$/i, "");
}

function getOnlineRoomUrl() {
  const dbUrl = normalizeDatabaseUrl(state.online.dbUrl);
  const roomCode = sanitizeRoomCode(state.online.roomCode);
  if (!dbUrl || !roomCode) return "";
  return `${dbUrl}/rooms/${encodeURIComponent(roomCode)}.json`;
}

function canManageBattle() {
  return !state.online.connected || state.online.role === "gm";
}

function canControlCombatant(combatId) {
  if (!state.online.connected) return true;
  if (state.online.role === "gm") return true;
  return state.online.role === "player" && state.online.playerCombatId === combatId;
}

function normalizeBattleMap(map) {
  return {
    width: clampInteger(map?.width, MIN_MAP_SIZE, MAX_MAP_WIDTH, DEFAULT_MAP_WIDTH),
    height: clampInteger(map?.height, MIN_MAP_SIZE, MAX_MAP_HEIGHT, DEFAULT_MAP_HEIGHT),
    image: typeof map?.image === "string" && map.image.startsWith("data:image/") && map.image.length <= MAX_MAP_IMAGE_CHARS ? map.image : "",
  };
}

function getBattleMap() {
  if (!state.battle.map) state.battle.map = createDefaultMap();
  state.battle.map = normalizeBattleMap(state.battle.map);
  return state.battle.map;
}

function validateAbility(ability) {
  return Boolean(
    ability
    && typeof ability.id === "string"
    && ability.id.trim()
    && typeof ability.name === "string"
    && ability.name.trim()
    && ["damage", "heal"].includes(ability.type)
    && Number.isFinite(Number(ability.attackBonus))
    && typeof ability.effectFormula === "string"
    && validateDiceFormula(ability.effectFormula)
  );
}

function validateCharacter(character) {
  return Boolean(
    character
    && typeof character.id === "string"
    && character.id.trim()
    && typeof character.name === "string"
    && character.name.trim()
    && Number.isFinite(Number(character.hp))
    && Number(character.hp) > 0
    && (character.maxHp == null || (Number.isFinite(Number(character.maxHp)) && Number(character.maxHp) > 0))
    && Number.isFinite(Number(character.ac))
    && Number(character.ac) > 0
    && (character.proficiency == null || Number.isFinite(Number(character.proficiency)))
    && (character.skills == null || typeof character.skills === "string")
    && character.attributes
    && ATTRIBUTES.every(([key]) => Number.isFinite(Number(character.attributes[key])))
    && Array.isArray(character.abilities)
    && character.abilities.every(validateAbility)
  );
}

function normalizeCharacter(character) {
  const attributes = {};
  ATTRIBUTES.forEach(([key]) => {
    attributes[key] = Number(character.attributes[key]);
  });

  return {
    id: character.id,
    name: character.name.trim(),
    hp: Number(character.hp),
    maxHp: Number(character.maxHp || character.hp),
    ac: Number(character.ac),
    proficiency: Number(character.proficiency || 0),
    skills: String(character.skills || ""),
    attributes,
    abilities: character.abilities.map((ability) => ({
      id: ability.id,
      name: ability.name.trim(),
      type: ability.type,
      attackBonus: Number(ability.attackBonus),
      effectFormula: ability.effectFormula.trim(),
    })),
  };
}

function sanitizeState() {
  if (!Array.isArray(state.characters) || !state.characters.every(validateCharacter)) {
    console.error("Некорректные данные библиотеки персонажей. Используется стартовый набор.");
    state.characters = clone(starterCharacters);
  } else {
    state.characters = state.characters.map(normalizeCharacter);
  }

  if (!state.battle || !Array.isArray(state.battle.teamA) || !Array.isArray(state.battle.teamB) || !Array.isArray(state.battle.log) || !Array.isArray(state.battle.history)) {
    console.error("Некорректные данные поля боя. Состояние боя сброшено.");
    state.battle = createEmptyBattle();
  } else {
    state.battle.map = normalizeBattleMap(state.battle.map);
    state.battle.teamA = state.battle.teamA.map(normalizeCombatant);
    state.battle.teamB = state.battle.teamB.map(normalizeCombatant);
    state.battle.history = state.battle.history.slice(-MAX_HISTORY_ENTRIES).map(normalizeBattleSnapshot);
    assignMissingMapPositions();
  }
}

function normalizeBattleSnapshot(snapshot) {
  const map = normalizeBattleMap(snapshot.map);
  return {
    round: Number(snapshot.round || 1),
    teamA: Array.isArray(snapshot.teamA) ? snapshot.teamA.map((unit) => normalizeCombatant(unit, map)) : [],
    teamB: Array.isArray(snapshot.teamB) ? snapshot.teamB.map((unit) => normalizeCombatant(unit, map)) : [],
    log: Array.isArray(snapshot.log) ? snapshot.log.map(String) : [],
    history: [],
    map,
  };
}

function normalizeCombatant(combatant, map = getBattleMap()) {
  return {
    ...combatant,
    initiative: Number.isFinite(Number(combatant.initiative)) ? Number(combatant.initiative) : 0,
    turnOrder: combatant.turnOrder == null ? "" : String(combatant.turnOrder),
    mapPosition: normalizeMapPosition(combatant.mapPosition, map),
    movedCells: Number.isFinite(Number(combatant.movedCells)) ? Number(combatant.movedCells) : 0,
  };
}

function normalizeMapPosition(position, map = getBattleMap()) {
  if (!position) return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
  if (x < 1 || x > map.width || y < 1 || y > map.height) return null;
  return { x, y };
}

function getCombatants() {
  return [...state.battle.teamA, ...state.battle.teamB].sort(compareTurnOrder);
}

function getCombatant(id) {
  return getCombatants().find((item) => item.combatId === id);
}

function getTeamOfCombatant(id) {
  if (state.battle.teamA.some((item) => item.combatId === id)) return state.battle.teamA;
  return state.battle.teamB;
}

function getTeamNameOfCombatant(id) {
  if (state.battle.teamA.some((item) => item.combatId === id)) return "A";
  if (state.battle.teamB.some((item) => item.combatId === id)) return "B";
  return "";
}

function makeCombatant(character) {
  const initiative = rollInitiative(character);
  return {
    ...clone(character),
    combatId: newId(),
    hp: Number(character.hp),
    maxHp: Number(character.maxHp || character.hp),
    ac: Number(character.ac),
    initiative,
    turnOrder: "",
    mapPosition: null,
    movedCells: 0,
    turnDone: false,
  };
}

function rollInitiative(character) {
  return rollDie(20) + modifier(character.attributes?.dexterity ?? 10);
}

function compareTurnOrder(first, second) {
  const firstValue = parseTurnOrder(first.turnOrder);
  const secondValue = parseTurnOrder(second.turnOrder);
  if (firstValue != null && secondValue != null && firstValue !== secondValue) return firstValue - secondValue;
  if (firstValue != null && secondValue == null) return -1;
  if (firstValue == null && secondValue != null) return 1;
  return String(first.turnOrder || first.name).localeCompare(String(second.turnOrder || second.name), "ru", { numeric: true });
}

function compareByNameAlpha(first, second) {
  return String(first?.name || "").localeCompare(String(second?.name || ""), "ru", { numeric: true, sensitivity: "base" });
}

function parseTurnOrder(value) {
  const cleaned = String(value ?? "").trim().replace(",", ".");
  if (!cleaned) return null;
  const numeric = Number(cleaned);
  return Number.isFinite(numeric) ? numeric : null;
}

function sortBattleTeams() {
  state.battle.teamA.sort(compareTurnOrder);
  state.battle.teamB.sort(compareTurnOrder);
}

function sortLibraryAlphabetically() {
  state.characters.sort(compareByNameAlpha);
  render();
}

function sortTeamAlphabetically(teamName) {
  if (!canManageBattle()) {
    alert("Сортировать списки боя может только гейммастер.");
    return;
  }
  const team = teamName === "A" ? state.battle.teamA : state.battle.teamB;
  if (!team.length) return;
  rememberBattle();
  team.sort(compareByNameAlpha);
  state.battle.log.unshift(`Раунд ${state.battle.round}: команда ${teamName === "A" ? "1" : "2"} отсортирована по алфавиту.`);
  markOnlineDirty("sort-team-alpha");
  render();
}

function rememberBattle() {
  const map = getBattleMap();
  state.battle.history.push({
    round: state.battle.round,
    teamA: clone(state.battle.teamA),
    teamB: clone(state.battle.teamB),
    log: clone(state.battle.log.slice(0, MAX_LOG_ENTRIES)),
    history: [],
    map: { width: map.width, height: map.height, image: "" },
  });
  pruneBattleForStorage();
}

function pruneBattleForStorage(force = false) {
  if (!state.battle) return;
  state.battle.map = normalizeBattleMap(state.battle.map);
  if (!Array.isArray(state.battle.log)) state.battle.log = [];
  if (!Array.isArray(state.battle.history)) state.battle.history = [];
  state.battle.history.forEach((snapshot) => {
    if (snapshot.map) snapshot.map.image = "";
  });
  state.battle.log = state.battle.log.slice(0, force ? 60 : MAX_LOG_ENTRIES);
  while (state.battle.history.length > (force ? 3 : MAX_HISTORY_ENTRIES)) {
    state.battle.history.shift();
  }
  while (state.battle.history.length > 1 && JSON.stringify(state.battle.history).length > MAX_HISTORY_CHARS) {
    state.battle.history.shift();
  }
}

function assignTurnOrderFromInitiative() {
  [...state.battle.teamA, ...state.battle.teamB]
    .sort((first, second) => {
      if (Number(second.initiative) !== Number(first.initiative)) return Number(second.initiative) - Number(first.initiative);
      return modifier(second.attributes?.dexterity ?? 10) - modifier(first.attributes?.dexterity ?? 10);
    })
    .forEach((unit, index) => {
      unit.turnOrder = String(index + 1);
    });
  sortBattleTeams();
}

function assignMapPosition(unit, team) {
  const map = getBattleMap();
  const occupied = new Set(getCombatants()
    .filter((item) => item.combatId !== unit.combatId && item.mapPosition)
    .map((item) => `${item.mapPosition.x}:${item.mapPosition.y}`));
  const startX = team === "A" ? 1 : map.width;
  const direction = team === "A" ? 1 : -1;
  for (let offset = 0; offset < map.width; offset += 1) {
    const x = startX + offset * direction;
    for (let y = 1; y <= map.height; y += 1) {
      const key = `${x}:${y}`;
      if (!occupied.has(key)) {
        unit.mapPosition = { x, y };
        return;
      }
    }
  }
  unit.mapPosition = null;
}

function assignMissingMapPositions() {
  state.battle.teamA.forEach((unit) => {
    if (!unit.mapPosition) assignMapPosition(unit, "A");
  });
  state.battle.teamB.forEach((unit) => {
    if (!unit.mapPosition) assignMapPosition(unit, "B");
  });
}

function init() {
  sanitizeState();
  applyOnlineUrlParams();
  buildAttributes();
  bindEvents();
  resetForm();
  render();
}

function applyOnlineUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const room = sanitizeRoomCode(params.get("room") || "");
  const role = params.get("role") === "player" ? "player" : "";
  if (room) state.online.roomCode = room;
  if (role) state.online.role = role;
  if (room || role) saveOnlineConfig();
}

function buildAttributes() {
  $("#attribute-inputs").innerHTML = ATTRIBUTES.map(([key, label]) => `
    <div class="attribute-row">
      <label>${label}<input id="attr-${key}" type="number" value="10" /></label>
      <div class="modifier" id="mod-${key}">+0</div>
    </div>
  `).join("");

  ATTRIBUTES.forEach(([key]) => {
    $(`#attr-${key}`).addEventListener("input", () => {
      $(`#mod-${key}`).textContent = signed(modifier($(`#attr-${key}`).value));
    });
  });
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTab = button.dataset.tab;
      renderTabs();
    });
  });

  $("#new-character").addEventListener("click", resetForm);
  $("#reset-form").addEventListener("click", resetForm);
  $("#add-ability").addEventListener("click", () => addAbilityRow());
  $("#character-form").addEventListener("submit", saveCharacterFromForm);
  $("#sort-library-alpha").addEventListener("click", sortLibraryAlphabetically);
  $("#export-library").addEventListener("click", exportLibrary);
  $("#export-battle").addEventListener("click", exportBattleState);
  $("#import-library").addEventListener("change", importLibrary);
  $("#import-battle").addEventListener("change", importBattleState);
  $("#add-team-a").addEventListener("click", () => addToTeam("A"));
  $("#add-team-b").addEventListener("click", () => addToTeam("B"));
  $("#sort-team-a-alpha").addEventListener("click", () => sortTeamAlphabetically("A"));
  $("#sort-team-b-alpha").addEventListener("click", () => sortTeamAlphabetically("B"));
  $("#reroll-initiative").addEventListener("click", rerollInitiative);
  $("#clear-battle").addEventListener("click", clearBattle);
  $("#next-round").addEventListener("click", nextRound);
  $("#actor-select").addEventListener("change", renderAbilityOptions);
  $("#perform-action").addEventListener("click", performAction);
  $("#undo-action").addEventListener("click", undoAction);
  $("#apply-map-settings").addEventListener("click", applyMapSettings);
  $("#map-image-input").addEventListener("change", loadMapImage);
  $("#remove-map-image").addEventListener("click", removeMapImage);
  $("#map-zoom-out").addEventListener("click", () => changeMapZoom(-MAP_ZOOM_STEP));
  $("#map-zoom-in").addEventListener("click", () => changeMapZoom(MAP_ZOOM_STEP));
  $("#map-zoom-reset").addEventListener("click", () => setMapZoom(1));
  $("#map-zoom-range").addEventListener("input", () => setMapZoom(Number($("#map-zoom-range").value) / 100));
  $("#battle-map-board").addEventListener("click", handleMapBoardClick);
  $("#battle-map-board").addEventListener("dragover", (event) => event.preventDefault());
  $("#battle-map-board").addEventListener("drop", handleMapDrop);
  $("#toggle-map-log").addEventListener("click", () => {
    state.mapLogExpanded = !state.mapLogExpanded;
    renderMapLog();
  });
  $("#close-map-action").addEventListener("click", closeMapActionDialog);
  $("#map-action-dialog").addEventListener("click", (event) => {
    if (event.target.id === "map-action-dialog") closeMapActionDialog();
  });
  $("#map-ability-select").addEventListener("change", renderMapActionPreview);
  $("#map-perform-action").addEventListener("click", performMapAction);
  ["map-attack-mode", "map-manual-attack", "map-effect-mode", "map-manual-effect"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderMapActionPreview);
  });
  $("#online-role").addEventListener("change", () => {
    state.online.role = $("#online-role").value === "player" ? "player" : "gm";
    saveOnlineConfig();
    renderOnlinePanel();
  });
  $("#online-db-url").addEventListener("input", () => {
    state.online.dbUrl = normalizeDatabaseUrl($("#online-db-url").value);
    saveOnlineConfig();
    renderOnlinePanel();
  });
  $("#online-room-code").addEventListener("input", () => {
    state.online.roomCode = sanitizeRoomCode($("#online-room-code").value);
    saveOnlineConfig();
    renderOnlinePanel();
  });
  $("#online-token-select").addEventListener("change", () => {
    state.online.playerCombatId = $("#online-token-select").value;
    saveOnlineConfig();
    renderOnlinePanel();
  });
  $("#generate-room-code").addEventListener("click", generateRoomCode);
  $("#connect-online").addEventListener("click", connectOnline);
  $("#disconnect-online").addEventListener("click", disconnectOnline);
  $("#publish-online").addEventListener("click", () => publishOnlineBattle(true));
  $("#pull-online").addEventListener("click", () => pullOnlineBattle(true));
  ["actor-select", "target-select", "ability-select", "attack-mode", "manual-attack", "effect-mode", "manual-effect"].forEach((id) => {
    $(`#${id}`).addEventListener("input", renderActionPreview);
  });
  window.addEventListener("beforeunload", saveAll);
}

function render() {
  renderTabs();
  renderCharacterList();
  renderBattleSelectors();
  renderTeams();
  renderBattleMap();
  renderActionPanel();
  renderLog();
  renderMapLog();
  renderOnlinePanel();
  scheduleSave();
}

function renderTabs() {
  document.querySelectorAll(".tab-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.selectedTab));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  $(`#${state.selectedTab}-view`).classList.add("active");
}

function resetForm() {
  $("#character-id").value = "";
  $("#character-name").value = "";
  $("#character-hp").value = 20;
  $("#character-ac").value = 12;
  $("#character-prof").value = 2;
  $("#character-skills").value = "";
  ATTRIBUTES.forEach(([key]) => {
    $(`#attr-${key}`).value = 10;
    $(`#mod-${key}`).textContent = "+0";
  });
  $("#abilities-editor").innerHTML = "";
  addAbilityRow({ name: "Базовая атака", type: "damage", attackBonus: 2, effectFormula: "1d6" });
}

function addAbilityRow(ability = { name: "", type: "damage", attackBonus: 0, effectFormula: "1d6" }) {
  const row = document.createElement("div");
  row.className = "ability-row";
  row.innerHTML = `
    <input class="ability-name" placeholder="Название" value="${escapeHtml(ability.name)}" />
    <select class="ability-type">
      <option value="damage"${ability.type === "damage" ? " selected" : ""}>Урон</option>
      <option value="heal"${ability.type === "heal" ? " selected" : ""}>Лечение</option>
    </select>
    <input class="ability-attack" type="number" placeholder="Бонус атаки" value="${Number(ability.attackBonus || 0)}" />
    <input class="ability-effect" placeholder="1d8+3" value="${escapeHtml(ability.effectFormula || "1d6")}" />
    <button type="button" class="icon-button" title="Удалить">×</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  const effectInput = row.querySelector(".ability-effect");
  effectInput.addEventListener("input", () => updateFormulaValidity(effectInput));
  updateFormulaValidity(effectInput);
  $("#abilities-editor").appendChild(row);
}

function updateFormulaValidity(input) {
  const isValid = validateDiceFormula(input.value.trim());
  input.classList.toggle("invalid", !isValid);
  input.setCustomValidity(isValid ? "" : "Формула должна быть в виде 1d8+3, 2d6, 1d4-1 или 5. Максимум 20d100.");
}

function saveCharacterFromForm(event) {
  event.preventDefault();
  const attributes = {};
  ATTRIBUTES.forEach(([key]) => attributes[key] = Number($(`#attr-${key}`).value || 10));
  const abilities = [...document.querySelectorAll(".ability-row")].map((row) => ({
    id: newId(),
    name: row.querySelector(".ability-name").value.trim() || "Без названия",
    type: row.querySelector(".ability-type").value,
    attackBonus: Number(row.querySelector(".ability-attack").value || 0),
    effectFormula: row.querySelector(".ability-effect").value.trim() || "0",
  }));

  const invalidFormula = [...document.querySelectorAll(".ability-effect")].find((input) => !validateDiceFormula(input.value.trim()));
  if (invalidFormula) {
    updateFormulaValidity(invalidFormula);
    invalidFormula.focus();
    alert("Проверьте формулу эффекта. Используйте вид 1d8+3, 2d6, 1d4-1 или число. Максимум 20d100.");
    return;
  }

  const character = {
    id: $("#character-id").value || newId(),
    name: $("#character-name").value.trim(),
    hp: Number($("#character-hp").value || 1),
    maxHp: Number($("#character-hp").value || 1),
    ac: Number($("#character-ac").value || 10),
    proficiency: Number($("#character-prof").value || 0),
    skills: $("#character-skills").value.trim(),
    attributes,
    abilities,
  };

  if (!character.name) return;
  const existing = state.characters.findIndex((item) => item.id === character.id);
  if (existing >= 0) state.characters[existing] = character;
  else state.characters.push(character);
  resetForm();
  render();
}

function editCharacter(id) {
  const character = state.characters.find((item) => item.id === id);
  if (!character) return;
  $("#character-id").value = character.id;
  $("#character-name").value = character.name;
  $("#character-hp").value = character.maxHp || character.hp;
  $("#character-ac").value = character.ac;
  $("#character-prof").value = character.proficiency;
  $("#character-skills").value = character.skills || "";
  ATTRIBUTES.forEach(([key]) => {
    $(`#attr-${key}`).value = character.attributes?.[key] ?? 10;
    $(`#mod-${key}`).textContent = signed(modifier($(`#attr-${key}`).value));
  });
  $("#abilities-editor").innerHTML = "";
  character.abilities.forEach(addAbilityRow);
  state.selectedTab = "library";
  renderTabs();
}

function deleteCharacter(id) {
  state.characters = state.characters.filter((item) => item.id !== id);
  render();
}

function renderCharacterList() {
  const list = $("#character-list");
  list.textContent = "";
  if (!state.characters.length) {
    list.appendChild(createEmpty("В библиотеке пока нет персонажей."));
    return;
  }

  state.characters.forEach((character) => {
    const article = document.createElement("article");
    article.className = "character-card";

    const head = document.createElement("div");
    head.className = "card-head";

    const title = document.createElement("h4");
    title.textContent = character.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `КД ${character.ac}`;

    head.append(title, badge);

    const stats = document.createElement("div");
    stats.className = "stats-line";
    [`Хиты: ${character.maxHp || character.hp}`, `БМ: ${signed(Number(character.proficiency || 0))}`, `Умений: ${character.abilities.length}`].forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      stats.appendChild(span);
    });

    const attributes = document.createElement("div");
    attributes.className = "stats-line";
    attributes.textContent = ATTRIBUTES
      .map(([key, label]) => `${label}: ${character.attributes?.[key] ?? 10} (${signed(modifier(character.attributes?.[key] ?? 10))})`)
      .join(" · ");

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const editButton = document.createElement("button");
    editButton.className = "ghost";
    editButton.type = "button";
    editButton.textContent = "Редактировать";
    editButton.addEventListener("click", () => editCharacter(character.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "danger";
    deleteButton.type = "button";
    deleteButton.textContent = "Удалить";
    deleteButton.addEventListener("click", () => deleteCharacter(character.id));

    actions.append(editButton, deleteButton);
    article.append(head, stats, attributes, actions);
    list.appendChild(article);
  });
}

function renderBattleSelectors() {
  populateSelect("#team-a-select", state.characters, "id", "name", "Нет персонажей");
  populateSelect("#team-b-select", state.characters, "id", "name", "Нет персонажей");
}

function addToTeam(team) {
  if (!canManageBattle()) {
    alert("Добавлять участников в онлайн-бой может только гейммастер.");
    return;
  }
  const select = team === "A" ? $("#team-a-select") : $("#team-b-select");
  const character = state.characters.find((item) => item.id === select.value);
  if (!character) return;
  rememberBattle();
  const combatant = makeCombatant(character);
  if (team === "A") state.battle.teamA.push(combatant);
  else state.battle.teamB.push(combatant);
  assignMapPosition(combatant, team);
  assignTurnOrderFromInitiative();
  state.battle.log.unshift(`Раунд ${state.battle.round}: ${character.name} добавлен в команду ${team === "A" ? "1" : "2"}. Инициатива: ${combatant.initiative}, очередь: ${combatant.turnOrder}.`);
  markOnlineDirty("add-combatant");
  render();
}

function renderTeams() {
  $("#round-number").textContent = state.battle.round;
  renderTeam("#team-a", state.battle.teamA);
  renderTeam("#team-b", state.battle.teamB);
}

function renderTeam(selector, team) {
  const column = $(selector);
  column.textContent = "";
  if (!team.length) {
    column.appendChild(createEmpty("Команда пока не собрана."));
    return;
  }

  team.forEach((unit) => {
    const article = document.createElement("article");
    article.className = `combatant-card ${unit.turnDone ? "active-turn" : ""}`;

    const head = document.createElement("div");
    head.className = "card-head";

    const title = document.createElement("h4");
    title.textContent = unit.name;

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = unit.turnDone ? "ход сделан" : "готов к ходу";

    head.append(title, badge);

    const fields = document.createElement("div");
    fields.className = "combat-fields";
    [
      ["Очередь", "turnOrder", unit.turnOrder ?? "", "text"],
      ["Иниц.", "initiative", unit.initiative ?? 0, "number"],
      ["Хиты", "hp", unit.hp, "number"],
      ["Макс. хиты", "maxHp", unit.maxHp, "number"],
      ["КД", "ac", unit.ac, "number"],
    ].forEach(([labelText, field, value, type]) => {
      const label = document.createElement("label");
      label.textContent = labelText;

      const input = document.createElement("input");
      input.type = type;
      input.value = value;
      if (field === "turnOrder") {
        input.placeholder = "1, A1...";
        input.maxLength = 12;
      }
      input.disabled = !canManageBattle();
      input.addEventListener("change", () => updateCombatant(unit.combatId, field, input.value));

      label.appendChild(input);
      fields.appendChild(label);
    });

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const turnButton = document.createElement("button");
    turnButton.className = "ghost";
    turnButton.type = "button";
    turnButton.textContent = "Переключить ход";
    turnButton.disabled = !canManageBattle();
    turnButton.addEventListener("click", () => markTurn(unit.combatId));

    const removeButton = document.createElement("button");
    removeButton.className = "danger";
    removeButton.type = "button";
    removeButton.textContent = "Убрать";
    removeButton.disabled = !canManageBattle();
    removeButton.addEventListener("click", () => removeCombatant(unit.combatId));

    actions.append(turnButton, removeButton);
    article.append(head, fields, actions);
    column.appendChild(article);
  });
}

function renderBattleMap() {
  const board = $("#battle-map-board");
  const roster = $("#battle-map-roster");
  if (!board || !roster) return;

  const map = getBattleMap();
  const combatants = getCombatants();
  if (state.online.connected && state.online.role === "player" && combatants.some((unit) => unit.combatId === state.online.playerCombatId)) {
    state.selectedMapCombatant = state.online.playerCombatId;
  }
  if (!combatants.some((unit) => unit.combatId === state.selectedMapCombatant)) {
    state.selectedMapCombatant = combatants.find((unit) => !unit.turnDone)?.combatId || combatants[0]?.combatId || "";
  }

  renderMapControls(map);
  board.textContent = "";
  roster.textContent = "";

  const cellSize = getMapCellSize(map);
  board.style.setProperty("--cell-size", `${cellSize}px`);
  board.style.width = `${map.width * cellSize}px`;
  board.style.height = `${map.height * cellSize}px`;
  board.style.backgroundImage = map.image ? `url(${map.image})` : "";
  board.classList.toggle("has-map-image", Boolean(map.image));

  if (!combatants.length) {
    roster.appendChild(createEmpty("На поле боя пока нет участников."));
    updateMapStatus("Сначала добавьте участников во вкладке «Поле боя».");
    renderMapActionDialog();
    return;
  }

  const placedCombatants = combatants.filter((unit) => unit.mapPosition);
  placedCombatants.forEach((unit) => {
    const teamName = getTeamNameOfCombatant(unit.combatId);
    const token = document.createElement("button");
    token.className = `map-token map-board-token team-${teamName.toLowerCase()} ${unit.combatId === state.selectedMapCombatant ? "active" : ""}`;
    token.type = "button";
    token.draggable = true;
    token.textContent = getMapMarker(unit);
    token.title = `${unit.name}: ${unit.mapPosition.x}:${unit.mapPosition.y}`;
    token.style.left = `${(unit.mapPosition.x - 0.5) * cellSize}px`;
    token.style.top = `${(unit.mapPosition.y - 0.5) * cellSize}px`;
    token.addEventListener("click", (event) => {
      event.stopPropagation();
      handleMapTokenInteraction(unit.combatId);
    });
    token.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("text/plain", unit.combatId);
      state.selectedMapCombatant = unit.combatId;
    });
    board.appendChild(token);
  });

  combatants.forEach((unit) => {
    const teamName = getTeamNameOfCombatant(unit.combatId);
    const item = document.createElement("div");
    item.className = `map-roster-item ${unit.combatId === state.selectedMapCombatant ? "active" : ""}`;

    const selectButton = document.createElement("button");
    selectButton.className = "map-roster-main";
    selectButton.type = "button";
    selectButton.addEventListener("click", () => {
      state.selectedMapCombatant = unit.combatId;
      renderBattleMap();
    });

    const marker = document.createElement("span");
    marker.className = `map-token team-${teamName.toLowerCase()}`;
    marker.textContent = getMapMarker(unit);

    const name = document.createElement("span");
    name.textContent = unit.name;

    const position = document.createElement("small");
    const cells = Number(unit.movedCells || 0);
    position.textContent = unit.mapPosition ? `${unit.mapPosition.x}:${unit.mapPosition.y} · ${cells} кл.` : `без клетки · ${cells} кл.`;

    selectButton.append(marker, name, position);

    const actions = document.createElement("div");
    actions.className = "map-roster-actions";

    const placeButton = document.createElement("button");
    placeButton.className = "ghost";
    placeButton.type = "button";
    placeButton.textContent = unit.mapPosition ? "Найти" : "Поставить";
    placeButton.disabled = !canControlCombatant(unit.combatId);
    placeButton.addEventListener("click", () => {
      state.selectedMapCombatant = unit.combatId;
      if (!unit.mapPosition) {
        const cell = findFreeMapCell(teamName);
        if (cell) moveCombatantToCell(unit.combatId, cell.x, cell.y);
        else alert("На карте нет свободных клеток.");
      } else {
        renderBattleMap();
      }
    });

    const removeButton = document.createElement("button");
    removeButton.className = "ghost";
    removeButton.type = "button";
    removeButton.textContent = "Убрать";
    removeButton.disabled = !unit.mapPosition || !canManageBattle();
    removeButton.addEventListener("click", () => removeTokenFromMap(unit.combatId));

    actions.append(placeButton, removeButton);
    item.append(selectButton, actions);
    roster.appendChild(item);
  });

  const selected = getCombatant(state.selectedMapCombatant);
  updateMapStatus(selected
    ? `Активный токен: ${selected.name}. Клик по пустой клетке перемещает его, клик по другому токену открывает окно действия.`
    : "Выберите участника в списке справа.");
  renderMapActionDialog();
}

function getMapMarker(unit) {
  return String(unit.turnOrder || unit.name || "?").trim().slice(0, 2).toUpperCase();
}

function renderMapControls(map) {
  const widthInput = $("#map-width");
  const heightInput = $("#map-height");
  const imageStatus = $("#map-image-status");
  const zoomRange = $("#map-zoom-range");
  const zoomValue = $("#map-zoom-value");
  const ownerMode = canManageBattle();
  if (widthInput && Number(widthInput.value) !== map.width) widthInput.value = map.width;
  if (heightInput && Number(heightInput.value) !== map.height) heightInput.value = map.height;
  if (zoomRange && Number(zoomRange.value) !== Math.round(state.mapZoom * 100)) zoomRange.value = Math.round(state.mapZoom * 100);
  if (zoomValue) zoomValue.textContent = `${Math.round(state.mapZoom * 100)}%`;
  if ($("#map-zoom-out")) $("#map-zoom-out").disabled = state.mapZoom <= MIN_MAP_ZOOM;
  if ($("#map-zoom-in")) $("#map-zoom-in").disabled = state.mapZoom >= MAX_MAP_ZOOM;
  if (widthInput) widthInput.disabled = !ownerMode;
  if (heightInput) heightInput.disabled = !ownerMode;
  if ($("#apply-map-settings")) $("#apply-map-settings").disabled = !ownerMode;
  if ($("#map-image-input")) $("#map-image-input").disabled = !ownerMode;
  if ($("#remove-map-image")) $("#remove-map-image").disabled = !ownerMode;
  if (imageStatus) imageStatus.textContent = map.image ? "Фон загружен" : "Фон не выбран";
}

function updateMapStatus(message) {
  const status = $("#map-status");
  if (status) status.textContent = message;
}

function getMapCellSize(map) {
  const largest = Math.max(map.width, map.height);
  let baseSize = 34;
  if (largest > 130) baseSize = 16;
  else if (largest > 90) baseSize = 18;
  else if (largest > 55) baseSize = 22;
  else if (largest > 30) baseSize = 26;
  return Math.round(baseSize * state.mapZoom);
}

function changeMapZoom(delta) {
  setMapZoom(state.mapZoom + delta);
}

function setMapZoom(value) {
  const next = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, Number(value) || 1));
  if (Math.abs(next - state.mapZoom) < 0.001) return;

  const viewport = $(".battle-map-viewport");
  const centerX = viewport && viewport.scrollWidth ? (viewport.scrollLeft + viewport.clientWidth / 2) / viewport.scrollWidth : 0.5;
  const centerY = viewport && viewport.scrollHeight ? (viewport.scrollTop + viewport.clientHeight / 2) / viewport.scrollHeight : 0.5;
  state.mapZoom = Math.round(next * 100) / 100;
  renderBattleMap();
  requestAnimationFrame(() => {
    const updated = $(".battle-map-viewport");
    if (!updated) return;
    updated.scrollLeft = Math.max(0, centerX * updated.scrollWidth - updated.clientWidth / 2);
    updated.scrollTop = Math.max(0, centerY * updated.scrollHeight - updated.clientHeight / 2);
  });
}

function getCellFromPointer(event) {
  const board = $("#battle-map-board");
  const map = getBattleMap();
  const rect = board.getBoundingClientRect();
  const x = clampInteger(Math.floor((event.clientX - rect.left) / rect.width * map.width) + 1, 1, map.width, 1);
  const y = clampInteger(Math.floor((event.clientY - rect.top) / rect.height * map.height) + 1, 1, map.height, 1);
  return { x, y };
}

function getOccupantAt(x, y) {
  return getCombatants().find((item) => item.mapPosition?.x === x && item.mapPosition?.y === y);
}

function handleMapBoardClick(event) {
  const { x, y } = getCellFromPointer(event);
  const occupant = getOccupantAt(x, y);
  if (occupant) {
    handleMapTokenInteraction(occupant.combatId);
    return;
  }
  moveSelectedCombatant(x, y);
}

function handleMapDrop(event) {
  event.preventDefault();
  const combatId = event.dataTransfer.getData("text/plain");
  const { x, y } = getCellFromPointer(event);
  if (combatId) moveCombatantToCell(combatId, x, y);
}

function handleMapTokenInteraction(targetId) {
  const selectedId = state.selectedMapCombatant;
  if (selectedId && selectedId !== targetId) {
    openMapActionDialog(selectedId, targetId);
    return;
  }
  state.selectedMapCombatant = targetId;
  renderBattleMap();
}

function moveSelectedCombatant(x, y) {
  moveCombatantToCell(state.selectedMapCombatant, x, y);
}

function moveCombatantToCell(combatantId, x, y) {
  if (mapMoveLocked) return;
  mapMoveLocked = true;
  try {
    if (!canControlCombatant(combatantId)) {
      updateMapStatus("В режиме игрока можно перемещать только свой выбранный токен.");
      return;
    }
    const map = getBattleMap();
    if (x < 1 || x > map.width || y < 1 || y > map.height) return;
    const occupant = getOccupantAt(x, y);
    if (occupant && occupant.combatId !== combatantId) {
      openMapActionDialog(combatantId, occupant.combatId);
      return;
    }
    const unit = getCombatant(combatantId);
    if (!unit) return;
    rememberBattle();
    const previous = unit.mapPosition;
    const distance = previous ? Math.abs(previous.x - x) + Math.abs(previous.y - y) : 0;
    unit.mapPosition = { x, y };
    unit.movedCells = Number(unit.movedCells || 0) + distance;
    state.selectedMapCombatant = unit.combatId;
    state.battle.log.unshift(`Раунд ${state.battle.round}: ${unit.name} перемещен на клетку ${x}:${y}. Пройдено клеток за раунд: ${unit.movedCells}.`);
    markOnlineDirty("token-move");
    render();
  } finally {
    setTimeout(() => {
      mapMoveLocked = false;
    }, MAP_MOVE_LOCK_MS);
  }
}

function removeTokenFromMap(combatantId) {
  if (!canManageBattle()) {
    updateMapStatus("Убирать токены с карты может только гейммастер.");
    return;
  }
  const unit = getCombatant(combatantId);
  if (!unit?.mapPosition) return;
  rememberBattle();
  unit.mapPosition = null;
  state.battle.log.unshift(`Раунд ${state.battle.round}: токен ${unit.name} убран с карты боя.`);
  markOnlineDirty("token-remove");
  render();
}

function findFreeMapCell(teamName = "A") {
  const map = getBattleMap();
  const occupied = new Set(getCombatants()
    .filter((item) => item.mapPosition)
    .map((item) => `${item.mapPosition.x}:${item.mapPosition.y}`));
  const startX = teamName === "A" ? 1 : map.width;
  const direction = teamName === "A" ? 1 : -1;
  for (let offset = 0; offset < map.width; offset += 1) {
    const x = startX + offset * direction;
    for (let y = 1; y <= map.height; y += 1) {
      if (!occupied.has(`${x}:${y}`)) return { x, y };
    }
  }
  return null;
}

function applyMapSettings() {
  if (!canManageBattle()) {
    alert("Настраивать карту в онлайн-бое может только гейммастер.");
    renderBattleMap();
    return;
  }
  const current = getBattleMap();
  const width = clampInteger($("#map-width").value, MIN_MAP_SIZE, MAX_MAP_WIDTH, current.width);
  const height = clampInteger($("#map-height").value, MIN_MAP_SIZE, MAX_MAP_HEIGHT, current.height);
  $("#map-width").value = width;
  $("#map-height").value = height;
  if (width === current.width && height === current.height) return;

  rememberBattle();
  state.battle.map = { ...current, width, height };
  getCombatants().forEach((unit) => {
    if (unit.mapPosition && (unit.mapPosition.x > width || unit.mapPosition.y > height)) {
      unit.mapPosition = null;
    }
  });
  state.battle.log.unshift(`Раунд ${state.battle.round}: размер карты изменен на ${width}×${height}.`);
  markOnlineDirty("map-size");
  render();
}

function loadMapImage(event) {
  if (!canManageBattle()) {
    alert("Загружать фон карты может только гейммастер.");
    event.target.value = "";
    return;
  }
  const file = event.target.files[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    alert("Можно загрузить PNG, JPG или WebP.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    fitMapImage(String(reader.result || ""))
      .then((image) => {
        if (!image || image.length > MAX_MAP_IMAGE_CHARS) {
          alert("Изображение слишком большое для локального сохранения. Попробуйте файл меньшего размера.");
          return;
        }
        rememberBattle();
        state.battle.map = { ...getBattleMap(), image };
        state.battle.log.unshift(`Раунд ${state.battle.round}: загружено изображение для карты боя.`);
        markOnlineDirty("map-image");
        render();
      })
      .catch((error) => {
        console.error("Ошибка загрузки карты:", error);
        alert("Не удалось загрузить изображение карты.");
      })
      .finally(() => {
        event.target.value = "";
      });
  };
  reader.readAsDataURL(file);
}

function fitMapImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (dataUrl.length <= MAX_MAP_IMAGE_CHARS) {
      resolve(dataUrl);
      return;
    }

    const image = new Image();
    image.onload = () => {
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function removeMapImage() {
  if (!canManageBattle()) {
    alert("Убирать фон карты может только гейммастер.");
    return;
  }
  const map = getBattleMap();
  if (!map.image) return;
  rememberBattle();
  state.battle.map = { ...map, image: "" };
  state.battle.log.unshift(`Раунд ${state.battle.round}: изображение карты боя удалено.`);
  markOnlineDirty("map-image-remove");
  render();
}

function updateCombatant(id, field, value) {
  if (!canManageBattle()) {
    alert("Редактировать параметры боя может только гейммастер.");
    render();
    return;
  }
  const unit = getCombatant(id);
  if (!unit) return;
  rememberBattle();
  unit[field] = field === "turnOrder" ? String(value).trim() : Number(value);
  const fieldNames = {
    turnOrder: "очередность хода",
    initiative: "инициатива",
    hp: "хиты",
    maxHp: "максимальные хиты",
    ac: "КД",
  };
  if (field === "turnOrder" || field === "initiative") sortBattleTeams();
  state.battle.log.unshift(`Раунд ${state.battle.round}: вручную изменено поле «${fieldNames[field] || field}» у ${unit.name}.`);
  markOnlineDirty("combatant-edit");
  render();
}

function rerollInitiative() {
  if (!canManageBattle()) {
    alert("Пересчитывать инициативу может только гейммастер.");
    return;
  }
  const combatants = [...state.battle.teamA, ...state.battle.teamB];
  if (!combatants.length) return;
  rememberBattle();
  combatants.forEach((unit) => {
    unit.initiative = rollInitiative(unit);
    unit.turnDone = false;
  });
  assignTurnOrderFromInitiative();
  state.battle.log.unshift(`Раунд ${state.battle.round}: инициатива участников рассчитана заново по Ловкости, очередность ходов обновлена.`);
  markOnlineDirty("initiative");
  render();
}

function markTurn(id) {
  if (!canManageBattle()) {
    alert("Отмечать ход может только гейммастер.");
    return;
  }
  const unit = getCombatant(id);
  if (!unit) return;
  unit.turnDone = !unit.turnDone;
  markOnlineDirty("turn-toggle");
  render();
}

function removeCombatant(id) {
  if (!canManageBattle()) {
    alert("Убирать участников из боя может только гейммастер.");
    return;
  }
  rememberBattle();
  state.battle.teamA = state.battle.teamA.filter((item) => item.combatId !== id);
  state.battle.teamB = state.battle.teamB.filter((item) => item.combatId !== id);
  markOnlineDirty("remove-combatant");
  render();
}

function renderActionPanel() {
  const combatants = getCombatants();
  populateSelect("#actor-select", combatants, "combatId", "name", "Нет участников");
  populateSelect("#target-select", combatants, "combatId", "name", "Нет участников");
  renderAbilityOptions();
}

function renderAbilityOptions() {
  const actor = getCombatant($("#actor-select").value);
  populateSelect("#ability-select", actor?.abilities || [], "id", "name", "Нет умений");
  renderActionPreview();
}

function renderActionPreview() {
  const actor = getCombatant($("#actor-select").value);
  const target = getCombatant($("#target-select").value);
  const ability = actor?.abilities?.find((item) => item.id === $("#ability-select").value);
  if (!actor || !target || !ability) {
    $("#action-preview").textContent = "Выберите персонажа, цель и умение.";
    return;
  }
  const kind = ability.type === "heal" ? "лечение" : "урон";
  $("#action-preview").textContent = `${actor.name} применяет «${ability.name}» на ${target.name}. Тип: ${kind}. Бонус атаки ${signed(Number(ability.attackBonus || 0))}, эффект ${ability.effectFormula}.`;
}

function openMapActionDialog(actorId, targetId) {
  const actor = getCombatant(actorId);
  const target = getCombatant(targetId);
  if (!actor || !target || actor.combatId === target.combatId) return;
  state.mapAction = { actorId, targetId };
  state.selectedMapCombatant = actorId;
  $("#map-action-dialog").classList.remove("hidden");
  renderMapActionDialog();
}

function closeMapActionDialog() {
  $("#map-action-dialog").classList.add("hidden");
  $("#map-manual-attack").value = "";
  $("#map-manual-effect").value = "";
}

function renderMapActionDialog() {
  const dialog = $("#map-action-dialog");
  if (!dialog) return;
  const actor = getCombatant(state.mapAction.actorId);
  const target = getCombatant(state.mapAction.targetId);
  if (!actor || !target || actor.combatId === target.combatId) {
    dialog.classList.add("hidden");
    return;
  }

  $("#map-action-title").textContent = `${actor.name} → ${target.name}`;
  $("#map-action-subtitle").textContent = `Цель: ${target.name}, КД ${target.ac}, хиты ${target.hp}/${target.maxHp}.`;

  const abilitySelect = $("#map-ability-select");
  const previousAbility = abilitySelect.value;
  abilitySelect.textContent = "";
  if (!actor.abilities.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Нет умений";
    abilitySelect.appendChild(option);
  } else {
    actor.abilities.forEach((ability) => {
      const option = document.createElement("option");
      option.value = ability.id;
      option.textContent = ability.name;
      abilitySelect.appendChild(option);
    });
    if (actor.abilities.some((ability) => ability.id === previousAbility)) {
      abilitySelect.value = previousAbility;
    }
  }
  renderMapActionPreview();
}

function renderMapActionPreview() {
  const actor = getCombatant(state.mapAction.actorId);
  const target = getCombatant(state.mapAction.targetId);
  const ability = actor?.abilities?.find((item) => item.id === $("#map-ability-select").value);
  if (!actor || !target || !ability) {
    $("#map-action-preview").textContent = "Для действия нужен активный токен, цель и умение.";
    return;
  }
  const kind = ability.type === "heal" ? "лечение" : "урон";
  $("#map-action-preview").textContent = `${actor.name} применяет «${ability.name}» на ${target.name}. Тип: ${kind}. Бонус атаки ${signed(Number(ability.attackBonus || 0))}, эффект ${ability.effectFormula}.`;
}

function performAction() {
  const completed = performCombatAction({
    actorId: $("#actor-select").value,
    targetId: $("#target-select").value,
    abilityId: $("#ability-select").value,
    attackMode: $("#attack-mode").value,
    effectMode: $("#effect-mode").value,
    manualAttack: $("#manual-attack").value,
    manualEffect: $("#manual-effect").value,
  });

  if (completed) {
    $("#manual-attack").value = "";
    $("#manual-effect").value = "";
  }
}

function performMapAction() {
  const completed = performCombatAction({
    actorId: state.mapAction.actorId,
    targetId: state.mapAction.targetId,
    abilityId: $("#map-ability-select").value,
    attackMode: $("#map-attack-mode").value,
    effectMode: $("#map-effect-mode").value,
    manualAttack: $("#map-manual-attack").value,
    manualEffect: $("#map-manual-effect").value,
  });

  if (completed) closeMapActionDialog();
}

function performCombatAction({ actorId, targetId, abilityId, attackMode, effectMode, manualAttack, manualEffect }) {
  if (!canControlCombatant(actorId)) {
    alert("В онлайн-режиме игрок может выполнять действия только своим выбранным токеном.");
    return false;
  }
  const actor = getCombatant(actorId);
  const target = getCombatant(targetId);
  const ability = actor?.abilities?.find((item) => item.id === abilityId);
  if (!actor || !target || !ability) return false;

  if (effectMode === "auto" && !validateDiceFormula(ability.effectFormula)) {
    alert(`У умения «${ability.name}» некорректная формула эффекта.`);
    return false;
  }

  rememberBattle();
  actor.turnDone = true;

  const attackRoll = attackMode === "manual"
    ? Number(manualAttack || 0)
    : rollDie(20) + Number(ability.attackBonus || 0);

  if (ability.type === "damage" && attackRoll < Number(target.ac)) {
    state.battle.log.unshift(`Раунд ${state.battle.round}: ${actor.name} применяет «${ability.name}» против ${target.name}. Атака ${attackRoll} против КД ${target.ac}: промах.`);
    markOnlineDirty("combat-action");
    render();
    return true;
  }

  const effect = effectMode === "manual"
    ? Number(manualEffect || 0)
    : rollFormula(ability.effectFormula).total;

  if (ability.type === "heal") {
    const before = target.hp;
    target.hp = Math.min(Number(target.maxHp), Number(target.hp) + effect);
    state.battle.log.unshift(`Раунд ${state.battle.round}: ${actor.name} применяет «${ability.name}» на ${target.name}. Восстановлено ${target.hp - before} хитов.`);
  } else {
    target.hp = Math.max(0, Number(target.hp) - effect);
    state.battle.log.unshift(`Раунд ${state.battle.round}: ${actor.name} попадает «${ability.name}» по ${target.name}. Атака ${attackRoll} против КД ${target.ac}, урон ${effect}.`);
  }

  markOnlineDirty("combat-action");
  render();
  return true;
}

function undoAction() {
  if (!canManageBattle()) {
    alert("Отматывать действия в онлайн-бое может только гейммастер.");
    return;
  }
  const previous = state.battle.history.pop();
  if (!previous) return;
  state.battle.round = previous.round;
  state.battle.teamA = previous.teamA;
  state.battle.teamB = previous.teamB;
  state.battle.log = previous.log;
  const currentImage = getBattleMap().image;
  state.battle.map = { ...normalizeBattleMap(previous.map), image: currentImage };
  markOnlineDirty("undo");
  render();
}

function nextRound() {
  if (!canManageBattle()) {
    alert("Начинать следующий раунд может только гейммастер.");
    return;
  }
  rememberBattle();
  state.battle.round += 1;
  state.battle.teamA.forEach((unit) => {
    unit.turnDone = false;
    unit.movedCells = 0;
  });
  state.battle.teamB.forEach((unit) => {
    unit.turnDone = false;
    unit.movedCells = 0;
  });
  state.battle.log.unshift(`Начат раунд ${state.battle.round}.`);
  markOnlineDirty("next-round");
  render();
}

function clearBattle() {
  if (!canManageBattle()) {
    alert("Очищать онлайн-бой может только гейммастер.");
    return;
  }
  rememberBattle();
  state.battle.round = 1;
  state.battle.teamA = [];
  state.battle.teamB = [];
  state.battle.log = ["Поле боя очищено."];
  state.selectedMapCombatant = "";
  state.mapAction = { actorId: "", targetId: "" };
  closeMapActionDialog();
  markOnlineDirty("clear-battle");
  render();
}

function renderLog() {
  const log = $("#battle-log");
  log.textContent = "";
  const entries = state.battle.log.length ? state.battle.log : ["Лог боя пока пуст."];
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    log.appendChild(item);
  });
}

function renderMapLog() {
  const panel = $("#map-log-panel");
  const list = $("#map-battle-log");
  const toggle = $("#toggle-map-log");
  const summary = $("#map-log-summary");
  if (!panel || !list || !toggle || !summary) return;

  const entries = state.battle.log.length ? state.battle.log : ["Лог боя пока пуст."];
  panel.classList.toggle("collapsed", !state.mapLogExpanded);
  toggle.textContent = state.mapLogExpanded ? "Свернуть" : "Развернуть";
  summary.textContent = state.mapLogExpanded ? `Записей: ${entries.length}` : entries[0];
  list.textContent = "";

  if (!state.mapLogExpanded) return;
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    list.appendChild(item);
  });
}

function renderOnlinePanel() {
  const roleInput = $("#online-role");
  if (!roleInput) return;

  const combatants = getCombatants();
  $("#online-db-url").value = state.online.dbUrl;
  $("#online-room-code").value = state.online.roomCode;
  roleInput.value = state.online.role;

  populateSelect("#online-token-select", combatants, "combatId", "name", "Нет участников боя");
  if (combatants.some((unit) => unit.combatId === state.online.playerCombatId)) {
    $("#online-token-select").value = state.online.playerCombatId;
  } else if (state.online.role === "player") {
    state.online.playerCombatId = $("#online-token-select").value || "";
  }

  $("#online-token-select").disabled = state.online.role !== "player";
  $("#connect-online").disabled = state.online.connected;
  $("#disconnect-online").disabled = !state.online.connected;
  $("#publish-online").disabled = !state.online.connected || state.online.role !== "gm";
  $("#pull-online").disabled = !state.online.connected;

  const status = $("#online-status");
  status.textContent = state.online.status;
  status.className = `online-status ${state.online.connected ? "connected" : ""}`;

  const roomUrl = getOnlineRoomUrl();
  const share = $("#online-share-link");
  const currentUrl = new URL(window.location.href);
  if (state.online.roomCode) {
    currentUrl.searchParams.set("room", state.online.roomCode);
    currentUrl.searchParams.set("role", "player");
  }
  share.value = state.online.roomCode ? currentUrl.toString() : "";

  const lockSetup = state.online.connected && state.online.role === "player";
  ["add-team-a", "add-team-b", "sort-team-a-alpha", "sort-team-b-alpha", "reroll-initiative", "clear-battle", "next-round", "undo-action"].forEach((id) => {
    const element = $(`#${id}`);
    if (element) element.disabled = lockSetup;
  });
  $("#online-room-path").textContent = roomUrl ? `Комната: ${state.online.roomCode}` : "Комната не настроена.";
}

function setOnlineStatus(message) {
  state.online.status = message;
  const status = $("#online-status");
  if (status) status.textContent = message;
}

function generateRoomCode() {
  const code = `ROOM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  state.online.roomCode = code;
  $("#online-room-code").value = code;
  saveOnlineConfig();
  renderOnlinePanel();
}

async function connectOnline() {
  state.online.dbUrl = normalizeDatabaseUrl($("#online-db-url").value);
  state.online.roomCode = sanitizeRoomCode($("#online-room-code").value);
  state.online.role = $("#online-role").value === "player" ? "player" : "gm";
  state.online.playerCombatId = $("#online-token-select").value || state.online.playerCombatId || "";

  if (!state.online.dbUrl || !state.online.roomCode) {
    alert("Укажите адрес Firebase Realtime Database и код комнаты.");
    return;
  }
  if (!/^https:\/\/.+firebaseio\.com|^https:\/\/.+firebasedatabase\.app/i.test(state.online.dbUrl)) {
    alert("Укажите полный HTTPS-адрес Firebase Realtime Database.");
    return;
  }

  state.online.connected = true;
  saveOnlineConfig();
  setOnlineStatus("Подключение к онлайн-комнате...");
  renderOnlinePanel();

  if (state.online.role === "gm") {
    const connected = await publishOnlineBattle(true);
    if (!connected) {
      state.online.connected = false;
      renderOnlinePanel();
      return;
    }
  } else {
    const connected = await pullOnlineBattle(true);
    if (!connected) {
      state.online.connected = false;
      renderOnlinePanel();
      return;
    }
  }
  startOnlinePolling();
}

function disconnectOnline() {
  state.online.connected = false;
  if (onlinePollTimer) clearInterval(onlinePollTimer);
  if (onlinePushTimer) clearTimeout(onlinePushTimer);
  onlinePollTimer = 0;
  onlinePushTimer = 0;
  setOnlineStatus("Онлайн-режим выключен.");
  saveOnlineConfig();
  render();
}

function startOnlinePolling() {
  if (onlinePollTimer) clearInterval(onlinePollTimer);
  onlinePollTimer = setInterval(() => pullOnlineBattle(false), ONLINE_POLL_MS);
}

function getOnlineBattlePayload() {
  const battle = clone(state.battle);
  battle.history = [];
  battle.log = Array.isArray(battle.log) ? battle.log.slice(0, 80) : [];
  return {
    version: 3,
    updatedAt: Date.now(),
    updatedBy: state.online.clientId,
    role: state.online.role,
    battle,
  };
}

function normalizeOnlineBattle(battle) {
  const map = normalizeBattleMap(battle?.map);
  return {
    round: Number(battle?.round || 1),
    teamA: Array.isArray(battle?.teamA) ? battle.teamA.map((unit) => normalizeCombatant(unit, map)) : [],
    teamB: Array.isArray(battle?.teamB) ? battle.teamB.map((unit) => normalizeCombatant(unit, map)) : [],
    log: Array.isArray(battle?.log) ? battle.log.map(String).slice(0, MAX_LOG_ENTRIES) : [],
    history: [],
    map,
  };
}

function markOnlineDirty(reason = "battle-change") {
  if (onlineApplyingRemote || !state.online.connected) return;
  scheduleOnlinePush(reason);
}

function scheduleOnlinePush(reason) {
  if (!state.online.connected) return;
  if (onlinePushTimer) clearTimeout(onlinePushTimer);
  onlinePushTimer = setTimeout(() => publishOnlineBattle(false, reason), ONLINE_PUSH_DEBOUNCE_MS);
}

async function publishOnlineBattle(manual = false, reason = "manual") {
  if (!state.online.connected) return false;
  const url = getOnlineRoomUrl();
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getOnlineBattlePayload()),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.online.lastPushAt = Date.now();
    setOnlineStatus(`Синхронизация включена. Последняя отправка: ${new Date(state.online.lastPushAt).toLocaleTimeString("ru-RU")}.`);
    if (manual) renderOnlinePanel();
    return true;
  } catch (error) {
    console.error("Ошибка онлайн-публикации:", error);
    setOnlineStatus("Не удалось отправить состояние боя. Проверьте адрес базы и правила доступа.");
    if (manual) alert("Не удалось отправить состояние боя в онлайн-комнату.");
    return false;
  }
}

async function pullOnlineBattle(manual = false) {
  if (!state.online.connected) return false;
  const url = getOnlineRoomUrl();
  if (!url) return false;
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload?.battle) {
      if (state.online.role === "gm") await publishOnlineBattle(false, "empty-room");
      else setOnlineStatus("Комната пока пуста. Дождитесь публикации боя гейммастером.");
      return true;
    }
    if (payload.updatedBy === state.online.clientId && !manual) return true;
    if (Number(payload.updatedAt || 0) <= Number(state.online.lastRemoteUpdate || 0) && !manual) return true;

    onlineApplyingRemote = true;
    state.battle = normalizeOnlineBattle(payload.battle);
    state.online.lastRemoteUpdate = Number(payload.updatedAt || Date.now());
    assignMissingMapPositions();
    onlineApplyingRemote = false;
    setOnlineStatus(`Синхронизация включена. Последнее получение: ${new Date().toLocaleTimeString("ru-RU")}.`);
    render();
    return true;
  } catch (error) {
    onlineApplyingRemote = false;
    console.error("Ошибка онлайн-загрузки:", error);
    setOnlineStatus("Не удалось получить состояние боя. Проверьте подключение и настройки Firebase.");
    if (manual) alert("Не удалось получить состояние боя из онлайн-комнаты.");
    return false;
  }
}

function exportLibrary() {
  const blob = new Blob([JSON.stringify(state.characters, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "nri-character-library.json";
  link.click();
  URL.revokeObjectURL(url);
}

function exportBattleState() {
  pruneBattleForStorage();
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    battle: state.battle,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `nri-battle-round-${state.battle.round}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importBattleState(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!canManageBattle()) {
    alert("Импортировать состояние онлайн-боя может только гейммастер.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      const importedBattle = imported?.battle || imported;
      if (!importedBattle || !Array.isArray(importedBattle.teamA) || !Array.isArray(importedBattle.teamB)) {
        throw new Error("Invalid battle structure");
      }

      rememberBattle();
      state.battle = normalizeOnlineBattle(importedBattle);
      state.battle.log.unshift(`Раунд ${state.battle.round}: состояние боя импортировано из файла ${file.name}.`);
      state.selectedMapCombatant = getCombatants()[0]?.combatId || "";
      state.mapAction = { actorId: "", targetId: "" };
      closeMapActionDialog();
      markOnlineDirty("battle-import");
      state.selectedTab = "battlemap";
      render();
    } catch (error) {
      console.error("Ошибка импорта боя:", error);
      alert("Не удалось импортировать бой. Проверьте JSON-файл экспорта боя.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

function importLibrary(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported) || !imported.every(validateCharacter)) {
        throw new Error("Invalid library structure");
      }
      state.characters = imported.map(normalizeCharacter);
      render();
    } catch (error) {
      console.error("Ошибка импорта:", error);
      alert("Не удалось импортировать библиотеку. Проверьте JSON-файл.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

init();

