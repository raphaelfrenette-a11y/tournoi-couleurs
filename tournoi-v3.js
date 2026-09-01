import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getDatabase, ref, onValue, update, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "COLLE_TON_API_KEY",
  authDomain: "COLLE_TON_AUTH_DOMAIN",
  databaseURL: "COLLE_TON_DATABASE_URL",
  projectId: "COLLE_TON_PROJECT_ID",
  storageBucket: "COLLE_TON_STORAGE_BUCKET",
  messagingSenderId: "COLLE_TON_MESSAGING_SENDER_ID",
  appId: "COLLE_TON_APP_ID"
};

const STORAGE_KEY = "tournoi-couleurs-v2";
const GYM_KEY = "tournoi-gym-selection";
const SCHOOL_START = "2026-08-31";
const SCHOOL_END = "2027-06-23";

const TEAMS = {
  rouge: { label: "Rouge" },
  vert: { label: "Vert" },
  bleu: { label: "Bleu" },
  jaune: { label: "Jaune" }
};
const TEAM_ORDER = ["rouge", "vert", "bleu", "jaune"];
const LEVELS = { S1: "Secondaire 1", S2: "Secondaire 2", S345: "Secondaire 3-4-5" };
const DAILY_MATCHES = [
  { id: 1, slot: 1, time: "11 h 30 – 11 h 40", gym: "A", a: "rouge", b: "vert" },
  { id: 2, slot: 1, time: "11 h 30 – 11 h 40", gym: "B", a: "bleu", b: "jaune" },
  { id: 3, slot: 2, time: "11 h 40 – 11 h 50", gym: "A", a: "rouge", b: "bleu" },
  { id: 4, slot: 2, time: "11 h 40 – 11 h 50", gym: "B", a: "vert", b: "jaune" },
  { id: 5, slot: 3, time: "11 h 50 – 12 h 00", gym: "A", a: "rouge", b: "jaune" },
  { id: 6, slot: 3, time: "11 h 50 – 12 h 00", gym: "B", a: "vert", b: "bleu" }
];

const fixedNoSchool = new Map();
const addNo = (d, l) => fixedNoSchool.set(d, l);
function addRange(s, e, l) {
  let d = parseDate(s), last = parseDate(e);
  while (d <= last) {
    if (d.getDay() !== 0 && d.getDay() !== 6) addNo(fmt(d), l);
    d.setDate(d.getDate() + 1);
  }
}
addNo("2026-09-07", "Congé");
addNo("2026-10-05", "Journée pédagogique");
addNo("2026-10-12", "Congé");
addNo("2026-10-23", "Journée pédagogique");
addNo("2026-11-19", "Journée pédagogique");
addNo("2026-11-20", "Journée pédagogique");
addRange("2026-12-21", "2027-01-01", "Congé des Fêtes");
addNo("2027-01-04", "Journée pédagogique");
addNo("2027-02-12", "Journée pédagogique");
addRange("2027-03-01", "2027-03-05", "Semaine de relâche");
addNo("2027-03-26", "Congé");
addNo("2027-03-29", "Congé");
addNo("2027-04-09", "Journée pédagogique");
addNo("2027-04-19", "Journée pédagogique / reprise possible");
addNo("2027-05-10", "Journée pédagogique / reprise possible");
addNo("2027-05-21", "Journée pédagogique");
addNo("2027-05-24", "Congé");
const floatingPed = new Map([
  ["2026-09-25", "Journée pédagogique flottante"],
  ["2027-01-29", "Journée pédagogique flottante"]
]);
const specialCycle = { "2027-06-21": 1, "2027-06-22": 3 };

let localDB = loadLocal();
let cloudRecords = {};
let selectedDate = fmt(new Date());
let selectedGym = localStorage.getItem(GYM_KEY) || null;
let rankingFilter = "all";
let firebaseLive = false;
let realtimeDB = null;
let toastTimer = null;

const $ = id => document.getElementById(id);
const els = {
  datePicker: $("datePicker"),
  dayStatus: $("dayStatus"),
  competitionArea: $("competitionArea"),
  matches: $("matches"),
  bonusGrid: $("bonusGrid"),
  dayPoints: $("dayPoints"),
  submitCard: $("submitCard"),
  rankingCards: $("rankingCards"),
  historyList: $("historyList"),
  overrideDate: $("overrideDate"),
  overrideCycle: $("overrideCycle"),
  overrideList: $("overrideList"),
  toast: $("toast"),
  gymGate: $("gymGate"),
  gymChip: $("gymChip"),
  gymTitle: $("gymTitle"),
  saveState: $("saveState"),
  syncPill: $("syncPill"),
  syncText: $("syncText"),
  deviceGymText: $("deviceGymText"),
  firebaseStatusText: $("firebaseStatusText")
};

init();

async function init() {
  els.datePicker.value = selectedDate;
  els.overrideDate.value = selectedDate;
  bind();
  updateGymUI();
  renderAll();
  await initFirebase();
  if (!selectedGym) openGymGate();
}

function firebaseConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("COLLE_") && firebaseConfig.databaseURL.startsWith("https://");
}

async function initFirebase() {
  if (!firebaseConfigured()) {
    setSync(false, "Mode local");
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    await signInAnonymously(auth);
    realtimeDB = getDatabase(app);
    firebaseLive = true;
    setSync(true, "En direct");
    els.firebaseStatusText.textContent = "Firebase est connecté. Les deux arbitres voient les mêmes résultats, bonus et validations de gymnase en direct.";
    onValue(ref(realtimeDB, "tournoi/records"), snap => {
      cloudRecords = snap.val() || {};
      localDB.records = cloudRecords;
      persistLocal();
      renderAll();
    });
  } catch (e) {
    console.error(e);
    firebaseLive = false;
    setSync(false, "Erreur sync");
    els.firebaseStatusText.textContent = "Firebase est configuré, mais la connexion a échoué. Vérifie Authentication anonyme, Realtime Database et les règles.";
  }
}

function setSync(live, text) {
  els.syncPill.classList.toggle("live", live);
  els.syncText.textContent = text;
  els.saveState.textContent = live ? "Synchronisation en direct" : "Sauvegarde locale";
}

function bind() {
  $("prevDayBtn").onclick = () => shiftDate(-1);
  $("nextDayBtn").onclick = () => shiftDate(1);
  els.datePicker.onchange = () => setDate(els.datePicker.value);
  els.gymChip.onclick = openGymGate;
  $("changeGymBtn").onclick = openGymGate;
  document.querySelectorAll("[data-pick-gym]").forEach(b => b.onclick = () => chooseGym(b.dataset.pickGym));
  document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => showView(b.dataset.view));
  document.querySelectorAll(".segment").forEach(b => b.onclick = () => {
    rankingFilter = b.dataset.filter;
    document.querySelectorAll(".segment").forEach(x => x.classList.toggle("active", x === b));
    renderRanking();
  });
  $("saveOverrideBtn").onclick = saveOverride;
  $("resetBtn").onclick = resetLocal;
}

function openGymGate() { els.gymGate.classList.remove("hidden"); }
function chooseGym(g) {
  selectedGym = g;
  localStorage.setItem(GYM_KEY, g);
  els.gymGate.classList.add("hidden");
  updateGymUI();
  renderToday();
  showToast(`Gymnase ${g} sélectionné`);
}
function updateGymUI() {
  els.gymChip.textContent = selectedGym ? `Gym ${selectedGym}` : "Choisir gym";
  els.gymTitle.textContent = selectedGym ? `Gymnase ${selectedGym}` : "Choisis ton gymnase";
  els.deviceGymText.textContent = selectedGym ? `Cet appareil est assigné au gymnase ${selectedGym}.` : "Aucun gymnase choisi.";
}
function showView(v) {
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === `view-${v}`));
  document.querySelectorAll(".nav-btn").forEach(x => x.classList.toggle("active", x.dataset.view === v));
  if (v === "ranking") renderRanking();
  if (v === "history") renderHistory();
  if (v === "settings") renderOverrides();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function setDate(iso) {
  if (!iso) return;
  selectedDate = iso;
  els.datePicker.value = iso;
  els.overrideDate.value = iso;
  renderToday();
}
function shiftDate(n) {
  const d = parseDate(selectedDate);
  d.setDate(d.getDate() + n);
  setDate(fmt(d));
}

function getLevel(day) {
  if (day === 2 || day === 6) return "S1";
  if (day === 3 || day === 7) return "S2";
  if (day === 4 || day === 8) return "S345";
  return null;
}

function schoolInfo(iso) {
  const manual = localDB.overrides?.[iso];
  if (manual === "none") return { isSchoolDay: false, reason: "Aucun cours — correction manuelle" };
  if (manual && /^[1-9]$/.test(manual)) {
    const cycleDay = Number(manual);
    return { isSchoolDay: true, cycleDay, level: getLevel(cycleDay), manual: true };
  }
  const d = parseDate(iso), start = parseDate(SCHOOL_START), end = parseDate(SCHOOL_END);
  if (d < start || d > end) return { isSchoolDay: false, reason: "Hors de l’année scolaire" };
  if (d.getDay() === 0 || d.getDay() === 6) return { isSchoolDay: false, reason: "Fin de semaine" };
  if (specialCycle[iso]) {
    const cycleDay = specialCycle[iso];
    return { isSchoolDay: true, cycleDay, level: getLevel(cycleDay), special: true };
  }
  if (iso === "2027-06-23") return { isSchoolDay: false, reason: "Jour-cycle à confirmer dans Gestion" };
  if (fixedNoSchool.has(iso)) return { isSchoolDay: false, reason: fixedNoSchool.get(iso) };
  if (floatingPed.has(iso)) return { isSchoolDay: false, reason: floatingPed.get(iso) };

  let cycle = 1, cursor = new Date(start);
  while (cursor <= d) {
    const key = fmt(cursor);
    const weekday = cursor.getDay() !== 0 && cursor.getDay() !== 6;
    if (weekday) {
      if (fixedNoSchool.has(key)) {
      } else if (floatingPed.has(key)) {
        cycle = cycle % 9 + 1;
      } else {
        if (key === iso) return { isSchoolDay: true, cycleDay: cycle, level: getLevel(cycle) };
        cycle = cycle % 9 + 1;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return { isSchoolDay: false, reason: "Date non reconnue" };
}

function recordKey(date, level) { return `${date}_${level}`; }

function blankRecord(date, info) {
  return {
    date,
    cycleDay: info.cycleDay,
    level: info.level,
    submitted: false,
    gymSubmissions: { A: false, B: false },
    matches: Object.fromEntries(DAILY_MATCHES.map(m => [`m${m.id}`, { ...m, result: null }])),
    bonuses: Object.fromEntries(TEAM_ORDER.map(t => [t, { attendance: false, shirts: false, spirit: false }]))
  };
}

function normalizeRecord(r) {
  if (!r) return r;
  if (!r.gymSubmissions || typeof r.gymSubmissions !== "object") {
    const oldSubmitted = r.submitted === true;
    r.gymSubmissions = { A: oldSubmitted, B: oldSubmitted };
  } else {
    r.gymSubmissions.A = r.gymSubmissions.A === true;
    r.gymSubmissions.B = r.gymSubmissions.B === true;
  }
  r.submitted = r.gymSubmissions.A && r.gymSubmissions.B;
  return r;
}

function getRecord(date, level) {
  if (!level) return null;
  const key = recordKey(date, level);
  return normalizeRecord(cloudRecords[key] || localDB.records[key] || null);
}

async function ensureRecord(date, info) {
  const key = recordKey(date, info.level), blank = blankRecord(date, info);
  if (firebaseLive) {
    await runTransaction(ref(realtimeDB, `tournoi/records/${key}`), cur => cur || blank);
    return;
  }
  if (!localDB.records[key]) {
    localDB.records[key] = blank;
    persistLocal();
  }
}

function gymSubmitted(r, gym) { return !!normalizeRecord(r)?.gymSubmissions?.[gym]; }
function daySubmitted(r) { return gymSubmitted(r, "A") && gymSubmitted(r, "B"); }
function otherGym(gym) { return gym === "A" ? "B" : "A"; }
function gymCompletedCount(r, gym) { return normalizedMatches(r).filter(m => m.gym === gym && !!m.result).length; }
function completedCount(r) { return normalizedMatches(r).filter(m => !!m.result).length; }

async function renderToday() {
  const info = schoolInfo(selectedDate), dateLabel = pretty(selectedDate);
  if (!info.isSchoolDay) {
    els.competitionArea.hidden = true;
    els.dayStatus.innerHTML = `<div class="big-day"><span class="cycle-badge">—</span></div><h2>Aucune compétition</h2><p>${esc(dateLabel)} · ${esc(info.reason || "Aucun cours")}</p>`;
    return;
  }
  if (!info.level) {
    els.competitionArea.hidden = true;
    els.dayStatus.innerHTML = `<div class="big-day"><span class="cycle-badge">Jour ${info.cycleDay}</span></div><h2>Aucune compétition aujourd’hui</h2><p>${esc(dateLabel)} · Compétitions aux jours 2, 3, 4, 6, 7 et 8.</p>`;
    return;
  }

  await ensureRecord(selectedDate, info);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  const full = daySubmitted(r);
  const submittedCount = ["A", "B"].filter(g => gymSubmitted(r, g)).length;
  const statusText = full ? "✓ Journée validée" : submittedCount === 1 ? "✓ 1 gym soumis" : "● En cours";
  const statusClass = full ? "submitted" : "draft";

  els.competitionArea.hidden = !selectedGym;
  els.dayStatus.innerHTML = `<div class="big-day"><span class="cycle-badge">Jour ${info.cycleDay}</span>${selectedGym ? `<span class="cycle-badge">Gym ${selectedGym}</span>` : ""}<span class="status-badge ${statusClass}">${statusText}</span></div><h2>${esc(LEVELS[info.level])}</h2><p>${esc(dateLabel)} · 11 h 30 à midi · ${full ? "Les points comptent au classement général." : "Chaque arbitre peut soumettre son gym après ses 3 matchs. Les bonus sont facultatifs."}</p>`;

  if (!selectedGym) {
    openGymGate();
    return;
  }
  renderMatches();
  renderBonuses();
  renderDayPoints();
  renderSubmitCard();
}

function normalizedMatches(r) {
  if (!r) return [];
  if (Array.isArray(r.matches)) return r.matches;
  return Object.values(r.matches || {}).sort((a, b) => a.id - b.id);
}

function renderMatches() {
  const info = schoolInfo(selectedDate);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  const locked = gymSubmitted(r, selectedGym);
  const ms = normalizedMatches(r).filter(m => m.gym === selectedGym);

  els.matches.innerHTML = ms.map(m => `<section><p class="slot-time">${m.time}</p><article class="match-card"><div class="match-meta"><span class="gym-badge">GYM ${m.gym}</span><span class="live-badge">Match ${m.slot} sur 3${locked ? " · verrouillé" : ""}</span></div><div class="matchup"><div class="team-pill team-${m.a}">${TEAMS[m.a].label}</div><span class="vs">VS</span><div class="team-pill team-${m.b}">${TEAMS[m.b].label}</div></div><div class="result-buttons"><button ${locked ? "disabled" : ""} class="result-btn team-result team-${m.a} ${m.result === m.a ? "selected" : ""}" data-match-id="${m.id}" data-result="${m.a}">${TEAMS[m.a].label}</button><button ${locked ? "disabled" : ""} class="result-btn ${m.result === "draw" ? "selected" : ""}" data-match-id="${m.id}" data-result="draw">Nulle</button><button ${locked ? "disabled" : ""} class="result-btn team-result team-${m.b} ${m.result === m.b ? "selected" : ""}" data-match-id="${m.id}" data-result="${m.b}">${TEAMS[m.b].label}</button></div></article></section>`).join("");

  els.matches.querySelectorAll("[data-match-id]").forEach(b => {
    b.onclick = () => saveMatch(Number(b.dataset.matchId), b.classList.contains("selected") ? null : b.dataset.result);
  });
}

async function saveMatch(id, result) {
  const info = schoolInfo(selectedDate), key = recordKey(selectedDate, info.level);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  const match = normalizedMatches(r).find(m => m.id === id);
  if (!match) return;
  if (gymSubmitted(r, match.gym)) {
    showToast(`Rouvre le gym ${match.gym} avant de modifier`);
    return;
  }

  const path = `tournoi/records/${key}/matches/m${id}`;
  if (firebaseLive) {
    await update(ref(realtimeDB, path), { result, updatedAt: serverTimestamp() });
  } else {
    const lr = localDB.records[key] || blankRecord(selectedDate, info);
    lr.matches[`m${id}`].result = result;
    localDB.records[key] = lr;
    persistLocal();
    renderAll();
  }
  showToast(result === null ? "Sélection retirée" : "Résultat enregistré ✓");
}

function renderBonuses() {
  const info = schoolInfo(selectedDate);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  const locked = daySubmitted(r);
  const labels = {
    attendance: ["👥", "80 % et +"],
    shirts: ["👕", "Chandails"],
    spirit: ["👏", "Esprit d’équipe"]
  };

  els.bonusGrid.innerHTML = TEAM_ORDER.map(t => `<article class="bonus-card"><div class="bonus-title team-${t}">${TEAMS[t].label}</div><div class="bonus-options">${Object.entries(labels).map(([k, [icon, label]]) => {
    const on = !!r.bonuses?.[t]?.[k];
    return `<button ${locked ? "disabled" : ""} class="bonus-toggle ${on ? "active" : ""}" data-team="${t}" data-bonus="${k}"><span><span class="icon">${on ? "✓" : icon}</span>${label}</span></button>`;
  }).join("")}</div></article>`).join("");

  els.bonusGrid.querySelectorAll("[data-bonus]").forEach(b => {
    b.onclick = () => saveBonus(b.dataset.team, b.dataset.bonus, !b.classList.contains("active"));
  });
}

async function saveBonus(team, bonus, value) {
  const info = schoolInfo(selectedDate), key = recordKey(selectedDate, info.level);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  if (daySubmitted(r)) {
    showToast("Rouvre un gym avant de modifier les bonus");
    return;
  }

  if (firebaseLive) {
    await update(ref(realtimeDB, `tournoi/records/${key}/bonuses/${team}`), { [bonus]: value, updatedAt: serverTimestamp() });
  } else {
    const lr = localDB.records[key] || blankRecord(selectedDate, info);
    lr.bonuses[team][bonus] = value;
    localDB.records[key] = lr;
    persistLocal();
    renderAll();
  }
  showToast("Bonus mis à jour");
}

function pointsFor(r) {
  const s = Object.fromEntries(TEAM_ORDER.map(t => [t, { matches: 0, wins: 0, draws: 0, losses: 0, matchPoints: 0, bonusPoints: 0, total: 0 }]));
  normalizedMatches(r).forEach(m => {
    if (!m.result) return;
    s[m.a].matches++;
    s[m.b].matches++;
    if (m.result === "draw") {
      s[m.a].draws++;
      s[m.b].draws++;
      s[m.a].matchPoints++;
      s[m.b].matchPoints++;
    } else if (m.result === m.a) {
      s[m.a].wins++;
      s[m.b].losses++;
      s[m.a].matchPoints += 2;
    } else if (m.result === m.b) {
      s[m.b].wins++;
      s[m.a].losses++;
      s[m.b].matchPoints += 2;
    }
  });
  TEAM_ORDER.forEach(t => {
    const b = r?.bonuses?.[t] || {};
    s[t].bonusPoints = ["attendance", "shirts", "spirit"].filter(k => !!b[k]).length;
    s[t].total = s[t].matchPoints + s[t].bonusPoints;
  });
  return s;
}

function renderDayPoints() {
  const info = schoolInfo(selectedDate);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  const p = pointsFor(r);
  els.dayPoints.innerHTML = TEAM_ORDER.map(t => `<div class="point-card team-${t}"><small>${TEAMS[t].label.toUpperCase()}</small><strong>${p[t].total} pts</strong><small>${p[t].matchPoints} match + ${p[t].bonusPoints} bonus</small></div>`).join("");
}

function renderSubmitCard() {
  const info = schoolInfo(selectedDate);
  const r = getRecord(selectedDate, info.level) || blankRecord(selectedDate, info);
  const gym = selectedGym;
  const other = otherGym(gym);
  const done = gymCompletedCount(r, gym);
  const complete = done === 3;
  const mineSubmitted = gymSubmitted(r, gym);
  const otherSubmitted = gymSubmitted(r, other);
  const full = daySubmitted(r);

  if (mineSubmitted) {
    els.submitCard.className = `submit-card ${full ? "submitted" : ""}`;
    els.submitCard.innerHTML = `<div class="submit-top"><h3>${full ? "Journée validée ✓" : `Gymnase ${gym} enregistré ✓`}</h3><span class="progress-pill complete">3 / 3 matchs</span></div><p>${full ? "Les deux gymnases ont soumis leurs 3 matchs. Les points et les bonus cochés sont maintenant inclus dans le classement général." : `Tes 3 résultats sont enregistrés. En attente du gymnase ${other}. Les bonus non cochés valent simplement 0 point et ne bloquent jamais la soumission.`}</p><div class="submit-actions"><button id="reopenGymBtn" class="secondary-btn" type="button">Rouvrir le gymnase ${gym}</button></div>`;
    $("reopenGymBtn").onclick = reopenGym;
    return;
  }

  els.submitCard.className = "submit-card";
  els.submitCard.innerHTML = `<div class="submit-top"><h3>Soumettre le gymnase ${gym}</h3><span class="progress-pill ${complete ? "complete" : ""}">${done} / 3 matchs</span></div><p>${complete ? `Tes 3 matchs sont complétés. Tu peux les soumettre maintenant${otherSubmitted ? `; le gymnase ${other} a déjà soumis, donc la journée deviendra officielle.` : "."}` : `Il reste ${3 - done} résultat${3 - done > 1 ? "s" : ""} de match à entrer dans le gymnase ${gym}.`} <b>Les bonus sont facultatifs</b> : chandails, esprit d’équipe et présence 80 % peuvent tous rester décochés.</p><button id="submitGymBtn" class="primary-btn" type="button" ${complete ? "" : "disabled"}>Soumettre les 3 matchs du gym ${gym}</button>`;
  $("submitGymBtn").onclick = submitGym;
}

async function submitGym() {
  const info = schoolInfo(selectedDate), key = recordKey(selectedDate, info.level), gym = selectedGym;
  const r = getRecord(selectedDate, info.level);
  if (!r || gymCompletedCount(r, gym) !== 3) {
    showToast(`Les 3 matchs du gym ${gym} doivent être complétés`);
    return;
  }
  if (gymSubmitted(r, gym)) {
    showToast(`Gym ${gym} déjà soumis`);
    return;
  }
  if (!confirm(`Soumettre les 3 matchs du gymnase ${gym}? Les bonus non cochés resteront à 0 point.`)) return;

  let becameOfficial = false;
  if (firebaseLive) {
    const result = await runTransaction(ref(realtimeDB, `tournoi/records/${key}`), cur => {
      if (!cur) return cur;
      if (!cur.gymSubmissions || typeof cur.gymSubmissions !== "object") {
        const oldSubmitted = cur.submitted === true;
        cur.gymSubmissions = { A: oldSubmitted, B: oldSubmitted };
      }
      cur.gymSubmissions[gym] = true;
      cur.gymSubmittedAt = cur.gymSubmittedAt || {};
      cur.gymSubmittedAt[gym] = Date.now();
      cur.submitted = cur.gymSubmissions.A === true && cur.gymSubmissions.B === true;
      if (cur.submitted) cur.submittedAt = cur.submittedAt || Date.now();
      return cur;
    });
    becameOfficial = !!result.snapshot.val()?.submitted;
  } else {
    const lr = normalizeRecord(localDB.records[key] || blankRecord(selectedDate, info));
    lr.gymSubmissions[gym] = true;
    lr.gymSubmittedAt = lr.gymSubmittedAt || {};
    lr.gymSubmittedAt[gym] = Date.now();
    lr.submitted = lr.gymSubmissions.A && lr.gymSubmissions.B;
    if (lr.submitted) lr.submittedAt = lr.submittedAt || Date.now();
    localDB.records[key] = lr;
    persistLocal();
    renderAll();
    becameOfficial = lr.submitted;
  }
  showToast(becameOfficial ? "Journée complète — classement mis à jour ✓" : `Gym ${gym} enregistré ✓`);
}

async function reopenGym() {
  const info = schoolInfo(selectedDate), key = recordKey(selectedDate, info.level), gym = selectedGym;
  if (!confirm(`Rouvrir le gymnase ${gym}? Ses 3 matchs pourront être corrigés. La journée sera retirée du classement général jusqu’à ce que les deux gyms soient de nouveau soumis.`)) return;

  if (firebaseLive) {
    await runTransaction(ref(realtimeDB, `tournoi/records/${key}`), cur => {
      if (!cur) return cur;
      if (!cur.gymSubmissions || typeof cur.gymSubmissions !== "object") {
        const oldSubmitted = cur.submitted === true;
        cur.gymSubmissions = { A: oldSubmitted, B: oldSubmitted };
      }
      cur.gymSubmissions[gym] = false;
      cur.submitted = false;
      cur.reopenedAt = Date.now();
      return cur;
    });
  } else {
    const lr = normalizeRecord(localDB.records[key] || blankRecord(selectedDate, info));
    lr.gymSubmissions[gym] = false;
    lr.submitted = false;
    lr.reopenedAt = Date.now();
    localDB.records[key] = lr;
    persistLocal();
    renderAll();
  }
  showToast(`Gym ${gym} rouvert`);
}

function activeRecords() { return firebaseLive ? cloudRecords : localDB.records; }

function aggregate(filter) {
  const a = Object.fromEntries(TEAM_ORDER.map(t => [t, { matches: 0, wins: 0, draws: 0, losses: 0, matchPoints: 0, bonusPoints: 0, total: 0 }]));
  Object.values(activeRecords()).forEach(raw => {
    const r = normalizeRecord(raw);
    if (!r || !daySubmitted(r)) return;
    if (filter !== "all" && r.level !== filter) return;
    const p = pointsFor(r);
    TEAM_ORDER.forEach(t => Object.keys(a[t]).forEach(k => a[t][k] += p[t][k]));
  });
  return a;
}

function renderRanking() {
  const a = aggregate(rankingFilter);
  const ranked = TEAM_ORDER.map((team, i) => ({ team, i, ...a[team] }))
    .sort((x, y) => y.total - x.total || y.matchPoints - x.matchPoints || y.wins - x.wins || x.i - y.i);
  els.rankingCards.innerHTML = ranked.map((r, i) => `<article class="rank-card"><div class="rank-pos">${i + 1}</div><div><div class="rank-name"><span class="color-dot team-${r.team}"></span>${TEAMS[r.team].label}</div><div class="rank-stats">${r.matches} matchs · ${r.wins} V · ${r.draws} N · ${r.losses} D<br>${r.matchPoints} pts matchs + ${r.bonusPoints} bonus</div></div><div class="rank-total"><strong>${r.total}</strong><span>points</span></div></article>`).join("");
}

function renderHistory() {
  const rs = Object.values(activeRecords()).map(normalizeRecord).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  if (!rs.length) {
    els.historyList.innerHTML = `<div class="empty-state"><strong>Aucune journée enregistrée</strong>Les journées apparaîtront ici dès les premiers résultats.</div>`;
    return;
  }
  els.historyList.innerHTML = rs.map(r => {
    const p = pointsFor(r), done = completedCount(r), full = daySubmitted(r);
    const aStatus = gymSubmitted(r, "A") ? "A ✓" : `A ${gymCompletedCount(r, "A")}/3`;
    const bStatus = gymSubmitted(r, "B") ? "B ✓" : `B ${gymCompletedCount(r, "B")}/3`;
    return `<article class="history-card"><div class="history-top"><div><h3>${esc(pretty(r.date))}</h3><p>Jour ${r.cycleDay} · ${esc(LEVELS[r.level])} · ${done}/6 matchs · ${aStatus} · ${bStatus}</p><span class="history-status ${full ? "submitted" : "draft"}">${full ? "✓ Validée" : "● En cours"}</span></div><button class="edit-link" data-edit="${r.date}">Ouvrir</button></div><div class="history-points">${TEAM_ORDER.map(t => `<div class="history-team team-${t}">${TEAMS[t].label}<br>${p[t].total} pts</div>`).join("")}</div></article>`;
  }).join("");
  els.historyList.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
    setDate(b.dataset.edit);
    showView("today");
  });
}

function saveOverride() {
  const date = els.overrideDate.value, val = els.overrideCycle.value;
  if (!date) return;
  if (!val) delete localDB.overrides[date];
  else localDB.overrides[date] = val;
  persistLocal();
  renderAll();
  showToast("Calendrier mis à jour");
}

function renderOverrides() {
  const es = Object.entries(localDB.overrides || {}).sort(([a], [b]) => a.localeCompare(b));
  els.overrideList.innerHTML = es.length ? es.map(([d, v]) => `<div class="override-row"><span>${esc(pretty(d))} — ${v === "none" ? "Aucun cours" : `Jour ${v}`}</span><button data-remove="${d}">Retirer</button></div>`).join("") : `<p class="helper">Aucune correction manuelle.</p>`;
  els.overrideList.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => {
    delete localDB.overrides[b.dataset.remove];
    persistLocal();
    renderAll();
  });
}

function resetLocal() {
  if (prompt('Écris EFFACER pour confirmer') !== "EFFACER") return;
  localDB = { records: {}, overrides: {} };
  persistLocal();
  renderAll();
  showToast("Copie locale effacée");
}

function renderAll() {
  renderToday();
  renderRanking();
  renderHistory();
  renderOverrides();
  updateGymUI();
}

function loadLocal() {
  try {
    const x = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (x?.records) return { records: x.records || {}, overrides: x.overrides || {} };
  } catch {}
  return { records: {}, overrides: {} };
}
function persistLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(localDB)); }
function parseDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); }
function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function pretty(iso) { return new Intl.DateTimeFormat("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseDate(iso)); }
function esc(v) { return String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function showToast(msg) {
  clearTimeout(toastTimer);
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2000);
}
