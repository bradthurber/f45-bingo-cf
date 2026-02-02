/* ===========================
   CONFIG
=========================== */

const API_BASE = "https://f45-bingo.f45-bingo.workers.dev";

const LS_NAME = "f45_display_name";
const LS_MASK = "f45_marked_mask";
const LS_WEEK = "f45_week_id";
const LS_DEVICE = "f45_device_id";

/* ===========================
   STATE
=========================== */

let markedMask = 0n;
let cardCells = null; // Array of 25 strings, or null if not loaded

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

function getDeviceId() {
  let id = localStorage.getItem(LS_DEVICE);
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
    localStorage.setItem(LS_DEVICE, id);
  }
  return id;
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
   CARD DEFINITION
=========================== */

async function fetchCardDefinition(week) {
  try {
    const res = await fetch(`${API_BASE}/api/card?week=${encodeURIComponent(week)}`);
    if (!res.ok) {
      cardCells = null;
      return;
    }
    const data = await res.json();
    if (Array.isArray(data.cells) && data.cells.length === 25) {
      cardCells = data.cells;
    } else {
      cardCells = null;
    }
  } catch {
    cardCells = null;
  }
  renderGrid();
}

/* ===========================
   RENDERING
=========================== */

function renderGrid() {
  const cells = document.querySelectorAll(".cell");
  cells.forEach((cell, i) => {
    cell.classList.toggle("marked", isMarked(i));
    // Display cell text if available, otherwise fall back to number
    const text = cardCells && cardCells[i] ? cardCells[i] : String(i + 1);
    cell.textContent = text;
    cell.title = cardCells && cardCells[i] ? cardCells[i] : "";
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
    headers: {
      "Content-Type": "application/json",
      "x-device-id": getDeviceId()
    },
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
      <td>${r.tickets_total}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ===========================
   SCAN
=========================== */

async function scanImage(file) {
  const scanStatus = qs("scanStatus");
  const scanLabel = qs("scanLabel");
  const scanInput = qs("scanInput");

  // Show loading state
  scanStatus.textContent = "Scanning your card...";
  scanStatus.className = "scan-status scanning";
  scanLabel.classList.add("disabled");
  scanInput.disabled = true;

  try {
    const fd = new FormData();
    fd.append("image", file);

    const res = await fetch(`${API_BASE}/api/scan`, {
      method: "POST",
      headers: { "x-device-id": getDeviceId() },
      body: fd
    });

    const data = await corsJson(res);

    if (Array.isArray(data.marked_cells)) {
      // Build a mask from r/c pairs (0-based)
      let m = 0n;
      for (const cell of data.marked_cells) {
        const r = Number(cell.r);
        const c = Number(cell.c);
        if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
        if (r < 0 || r > 4 || c < 0 || c > 4) continue;

        const idx = r * 5 + c; // 0..24
        m |= 1n << BigInt(idx);
      }

      markedMask = markedMask | m;
      persistMask();
      renderGrid();
      renderTickets();

      const count = data.marked_cells.length;
      scanStatus.textContent = count > 0
        ? `Found ${count} marked cell${count === 1 ? "" : "s"}`
        : "No marked cells found";
      scanStatus.className = "scan-status success";
    }
  } catch (err) {
    scanStatus.textContent = "Scan failed. Please try again.";
    scanStatus.className = "scan-status error";
  } finally {
    scanLabel.classList.remove("disabled");
    scanInput.disabled = false;
    scanInput.value = "";

    // Clear status after 4 seconds
    setTimeout(() => {
      scanStatus.textContent = "";
      scanStatus.className = "scan-status";
    }, 4000);
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
    fetchCardDefinition(getWeekId());
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
  fetchCardDefinition(getWeekId());
});
