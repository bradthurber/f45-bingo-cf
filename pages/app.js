/* ===========================
   CONFIG
=========================== */

const API_BASE = "https://f45-bingo.f45-bingo.workers.dev";

const LS_NAME = "f45_display_name";
const LS_MASK = "f45_marked_mask";
const LS_WEEK = "f45_week_id";
const LS_DEVICE = "f45_device_id";
const LS_TEAM = "f45_team";

/* ===========================
   STATE
=========================== */

let markedMask = 0n;
let cardCells = null;
let currentWeek = null;
let currentTeam = null;

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

function formatWeek(weekId) {
  if (!weekId) return null;
  const match = weekId.match(/week(\d+)/i);
  if (match) return `Week ${match[1]}`;
  return weekId;
}

/* ===========================
   WEEK HANDLING
=========================== */

function getCurrentChallengeWeek() {
  // 2026 Challenge Schedule (Mon-Sun):
  // Week 1: Feb 2-8, Week 2: Feb 9-15, Week 3: Feb 16-22
  // Week 4: Feb 23-Mar 1, Week 5: Mar 2-8, Week 6: Mar 9-15
  const schedule = [
    { week: "week1", start: new Date(2026, 1, 2), end: new Date(2026, 1, 8) },
    { week: "week2", start: new Date(2026, 1, 9), end: new Date(2026, 1, 15) },
    { week: "week3", start: new Date(2026, 1, 16), end: new Date(2026, 1, 22) },
    { week: "week4", start: new Date(2026, 1, 23), end: new Date(2026, 2, 1) },
    { week: "week5", start: new Date(2026, 2, 2), end: new Date(2026, 2, 8) },
    { week: "week6", start: new Date(2026, 2, 9), end: new Date(2026, 2, 15) },
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const { week, start, end } of schedule) {
    if (today >= start && today <= end) {
      return week;
    }
  }

  // If before challenge, show week1; if after, show week6
  if (today < schedule[0].start) return "week1";
  return "week6";
}

function loadWeek() {
  const saved = localStorage.getItem(LS_WEEK);
  if (saved) {
    currentWeek = saved;
  } else {
    // Default to current challenge week if nothing saved
    currentWeek = getCurrentChallengeWeek();
  }
}

function saveWeek(week) {
  currentWeek = week;
  localStorage.setItem(LS_WEEK, week);
  loadMask(); // Load mask for the new week
}

function renderWeekDisplay() {
  const display = qs("weekDisplay");
  if (currentWeek) {
    display.textContent = formatWeek(currentWeek);
  } else {
    display.textContent = "";
  }
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
   TEAM
=========================== */

function loadTeam() {
  const saved = localStorage.getItem(LS_TEAM);
  if (saved) {
    currentTeam = saved;
  }
}

function saveTeam(team) {
  currentTeam = team;
  localStorage.setItem(LS_TEAM, team);
}

function renderTeamSelector() {
  qs("teamRed").classList.toggle("selected", currentTeam === "red");
  qs("teamBlue").classList.toggle("selected", currentTeam === "blue");
}

/* ===========================
   GRID / MASK
=========================== */

function getMaskKey() {
  return currentWeek ? `${LS_MASK}_${currentWeek}` : LS_MASK;
}

function loadMask() {
  const weekKey = getMaskKey();
  let saved = localStorage.getItem(weekKey);

  // Migrate old global mask to current week if needed
  if (!saved && currentWeek) {
    const oldGlobal = localStorage.getItem(LS_MASK);
    if (oldGlobal) {
      saved = oldGlobal;
      localStorage.setItem(weekKey, oldGlobal);
      localStorage.removeItem(LS_MASK);
    }
  }

  markedMask = saved ? BigInt(saved) : 0n;
}

function persistMask() {
  localStorage.setItem(getMaskKey(), markedMask.toString());
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
  if (!week) {
    cardCells = null;
    renderGrid();
    return;
  }
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
    const text = cardCells && cardCells[i] ? cardCells[i] : String(i + 1);
    cell.textContent = text;
    cell.title = cardCells && cardCells[i] ? cardCells[i] : "";
  });
}

function countTickets() {
  let markedCount = 0;
  for (let i = 0; i < 25; i++) {
    if (isMarked(i)) markedCount++;
  }

  // Count bingo lines (rows, columns, diagonals)
  let bingoCount = 0;

  // Rows
  for (let r = 0; r < 5; r++) {
    let complete = true;
    for (let c = 0; c < 5; c++) {
      if (!isMarked(r * 5 + c)) { complete = false; break; }
    }
    if (complete) bingoCount++;
  }

  // Columns
  for (let c = 0; c < 5; c++) {
    let complete = true;
    for (let r = 0; r < 5; r++) {
      if (!isMarked(r * 5 + c)) { complete = false; break; }
    }
    if (complete) bingoCount++;
  }

  // Diagonal top-left to bottom-right
  let diag1 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarked(i * 5 + i)) { diag1 = false; break; }
  }
  if (diag1) bingoCount++;

  // Diagonal top-right to bottom-left
  let diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!isMarked(i * 5 + (4 - i))) { diag2 = false; break; }
  }
  if (diag2) bingoCount++;

  const fullCard = markedCount === 25;
  return markedCount + (bingoCount * 3) + (fullCard ? 5 : 0);
}

function renderTickets() {
  qs("ticketCount").textContent = countTickets();
}

/* ===========================
   API CALLS
=========================== */

async function submitBoard() {
  if (!currentWeek) {
    alert("Please scan your card first to detect the week.");
    return;
  }

  saveName();

  const name = qs("displayName").value.trim();
  if (!name) {
    alert("Please enter your name.");
    return;
  }

  if (!currentTeam) {
    alert("Please select your team (Red or Blue).");
    return;
  }

  const payload = {
    week_id: currentWeek,
    display_name: name,
    team: currentTeam,
    marked_mask: markedMask.toString()
  };

  try {
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
  } catch (err) {
    alert("Submit failed. Please try again.");
  }
}

async function deleteSubmission() {
  if (!currentWeek) {
    alert("No week selected. Scan your card first.");
    return;
  }

  if (!confirm("Remove yourself from the leaderboard for this week?")) {
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-id": getDeviceId()
      },
      body: JSON.stringify({ week_id: currentWeek })
    });

    await corsJson(res);

    // Clear local state
    clearGridMarks();
    renderGrid();
    renderTickets();
    await refreshLeaderboard();

    alert("You have been removed from the leaderboard.");
  } catch (err) {
    alert("Failed to remove. Please try again.");
  }
}

async function refreshLeaderboard() {
  if (!currentWeek) {
    qs("leaderboardBody").innerHTML = "";
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?week=${encodeURIComponent(currentWeek)}`);
    const data = await corsJson(res);

    const tbody = qs("leaderboardBody");
    tbody.innerHTML = "";

    data.rows.forEach(r => {
      const tr = document.createElement("tr");
      const teamDot = r.team === "red" ? '<span class="team-dot red"></span>' :
                      r.team === "blue" ? '<span class="team-dot blue"></span>' : '';
      tr.innerHTML = `
        <td>${teamDot}${r.display_name}</td>
        <td>${r.tickets_total}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch {
    // Ignore leaderboard errors
  }
}

/* ===========================
   SCAN
=========================== */

async function scanImage(file) {
  const scanStatus = qs("scanStatus");
  const scanLabel = qs("scanLabel");
  const scanInput = qs("scanInput");

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

    // Handle detected week
    if (data.week && data.week !== currentWeek) {
      // New week detected - switch to it (masks are stored per-week)
      saveWeek(data.week);
      renderWeekDisplay();
      await fetchCardDefinition(data.week);
      await refreshLeaderboard();
    }

    if (Array.isArray(data.marked_cells)) {
      let m = 0n;
      for (const cell of data.marked_cells) {
        const r = Number(cell.r);
        const c = Number(cell.c);
        if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
        if (r < 0 || r > 4 || c < 0 || c > 4) continue;

        const idx = r * 5 + c;
        m |= 1n << BigInt(idx);
      }

      markedMask = markedMask | m;
      persistMask();
      renderGrid();
      renderTickets();

      const count = data.marked_cells.length;
      let statusMsg = "";
      if (data.week) {
        statusMsg = `${formatWeek(data.week)}: `;
      }
      statusMsg += count > 0
        ? `Found ${count} marked cell${count === 1 ? "" : "s"}`
        : "No marked cells found";
      scanStatus.textContent = statusMsg;
      scanStatus.className = "scan-status success";
    }
  } catch (err) {
    scanStatus.textContent = "Scan failed. Please try again.";
    scanStatus.className = "scan-status error";
  } finally {
    scanLabel.classList.remove("disabled");
    scanInput.disabled = false;
    scanInput.value = "";

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
  loadWeek();
  loadName();
  loadMask();
  loadTeam();

  renderWeekDisplay();
  renderTeamSelector();

  document.querySelectorAll(".cell").forEach((cell, idx) => {
    cell.addEventListener("click", () => toggleCell(idx));
  });

  qs("submitBtn").addEventListener("click", submitBoard);

  qs("scanInput").addEventListener("change", e => {
    if (e.target.files[0]) scanImage(e.target.files[0]);
  });

  qs("deleteBtn").addEventListener("click", deleteSubmission);

  qs("teamRed").addEventListener("click", () => {
    saveTeam("red");
    renderTeamSelector();
  });

  qs("teamBlue").addEventListener("click", () => {
    saveTeam("blue");
    renderTeamSelector();
  });

  renderGrid();
  renderTickets();

  if (currentWeek) {
    fetchCardDefinition(currentWeek);
    refreshLeaderboard();
  }
});
