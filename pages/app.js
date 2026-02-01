/* ===========================
   CONFIG
=========================== */

const API_BASE = "https://f45-bingo.f45-bingo.workers.dev";

const LS_NAME = "f45_display_name";
const LS_MASK = "f45_marked_mask";
const LS_WEEK = "f45_week_id";

/* ===========================
   STATE
=========================== */

let markedMask = 0n;

/* ===========================
   HELPERS
=========================== */

function qs(id) {
  return document.getElementById(id);
}

function corsJson(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ===========================
   WEEK HANDLING
=========================== */

function getWeekId() {
  const sel = qs("weekSelect");
  return sel?.value || "week1";
}

function loadWeekId() {
  const saved = localStorage.getItem(LS_WEEK);
  if (saved && qs("weekSelect")) {
    qs("weekSelect").value = saved;
  }
}

function saveWeekId() {
  localStorage.setItem(LS_WEEK, getWeekId());
}

/* ===========================
   NAME
=========================== */

function loadName() {
  const saved = localStorage.getItem(LS_NAME);
  if (saved) qs("displayName").value = saved;
}

function saveName() {
  localStorage.setItem(LS_NAME, qs("displayName").value.trim());
}

/* ===========================
   GRID / MASK
=========================== */

function loadMask() {
  const saved = localStorage.getItem(LS_MASK);
  markedMask = saved ? BigInt(saved) : 0n;
}

function persistMask() {
  localStorage.setItem(LS_MASK, markedMask.toString());
}

function clearGridMarks() {
  markedMask = 0n;
  persistMask();
}

function toggleCell(idx) {
  markedMask ^= 1n << BigInt(idx);
  persistMask();
  renderGrid();
  renderTickets();
}

function isMarked(idx) {
  return (markedMask & (1n << BigInt(idx))) !== 0n;
}

/* ===========================
   RENDERING
=========================== */

function renderGrid() {
  const cells = document.querySelectorAll(".cell");
  cells.forEach((cell, i) => {
    cell.classList.toggle("marked", isMarked(i));
  });
}

function countTickets() {
  // very simple: 1 per square + bonuses handled server-side
  let count = 0;
  for (let i = 0; i < 25; i++) {
    if (isMarked(i)) count++;
  }
  return count;
}

function renderTickets() {
  qs("ticketCount").textContent = countTickets();
}

/* ===========================
   API CALLS
=========================== */

async function submitBoard() {
  saveName();

  const payload = {
    week_id: getWeekId(),
    display_name: qs("displayName").value.trim(),
    marked_mask: markedMask.toString()
  };

  const res = await fetch(`${API_BASE}/api/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  await corsJson(res);
  await refreshLeaderboard();
}

async function refreshLeaderboard() {
  const week = encodeURIComponent(getWeekId());
  const res = await fetch(`${API_BASE}/api/leaderboard?week=${week}`);
  const data = await corsJson(res);

  const tbody = qs("leaderboardBody");
  tbody.innerHTML = "";

  data.rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.display_name}</td>
      <td>${r.tickets}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===========================
   SCAN
=========================== */

async function scanImage(file) {
  const fd = new FormData();
  fd.append("image", file);

  const res = await fetch(`${API_BASE}/api/scan`, {
    method: "POST",
    body: fd
  });

  const data = await corsJson(res);

  if (data.marked_mask) {
    markedMask = BigInt(data.marked_mask);
    persistMask();
    renderGrid();
    renderTickets();
  }
}

/* ===========================
   INIT
=========================== */

window.addEventListener("DOMContentLoaded", () => {
  // Load persisted state
  loadWeekId();
  loadName();
  loadMask();

  // Wire grid
  document.querySelectorAll(".cell").forEach((cell, idx) => {
    cell.addEventListener("click", () => toggleCell(idx));
  });

  // Week change
  qs("weekSelect").addEventListener("change", () => {
    saveWeekId();
    clearGridMarks();
    renderGrid();
    renderTickets();
    refreshLeaderboard();
  });

  // Submit
  qs("submitBtn").addEventListener("click", submitBoard);

  // Scan
  qs("scanInput").addEventListener("change", e => {
    if (e.target.files[0]) scanImage(e.target.files[0]);
  });

  renderGrid();
  renderTickets();
  refreshLeaderboard();
});
