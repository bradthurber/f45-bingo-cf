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

function getAvailableWeeks() {
  const current = getCurrentChallengeWeek();
  const match = current.match(/week(\d+)/);
  const num = match ? parseInt(match[1], 10) : 1;
  const weeks = [];
  for (let i = 1; i <= num; i++) {
    weeks.push(`week${i}`);
  }
  return weeks;
}

function loadWeek() {
  const saved = localStorage.getItem(LS_WEEK);
  if (saved && getAvailableWeeks().includes(saved)) {
    currentWeek = saved;
  } else {
    currentWeek = getCurrentChallengeWeek();
  }
}

function saveWeek(week) {
  currentWeek = week;
  localStorage.setItem(LS_WEEK, week);
  loadMask();
}

function renderWeekPicker() {
  const picker = qs("weekPicker");
  const weeks = getAvailableWeeks();
  picker.innerHTML = "";
  for (const week of weeks) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-tab" + (week === currentWeek ? " active" : "");
    btn.textContent = formatWeek(week);
    btn.addEventListener("click", () => switchWeek(week));
    picker.appendChild(btn);
  }
}

async function switchWeek(week) {
  if (week === currentWeek) return;
  saveWeek(week);
  renderWeekPicker();
  renderGrid();
  renderTickets();
  await fetchCardDefinition(week);
  await refreshLeaderboard();
  await refreshStats();
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
  const total = markedCount + (bingoCount * 3) + (fullCard ? 5 : 0);
  return { markedCount, bingoCount, fullCard, total };
}

function renderTickets() {
  const { markedCount, bingoCount, fullCard, total } = countTickets();
  const el = qs("ticketCount");
  const prev = parseInt(el.textContent, 10) || 0;
  el.textContent = total;

  // Theme the ticket to match team color
  const wrap = qs("ticketSection");
  wrap.classList.remove("team-red", "team-blue");
  if (currentTeam === "red") wrap.classList.add("team-red");
  else if (currentTeam === "blue") wrap.classList.add("team-blue");

  if (total !== prev) {
    el.classList.remove("bump");
    void el.offsetWidth;
    el.classList.add("bump");
  }

  const parts = [];
  if (markedCount > 0) parts.push(`${markedCount} square${markedCount !== 1 ? "s" : ""}`);
  if (bingoCount > 0) parts.push(`${bingoCount} bingo${bingoCount !== 1 ? "s" : ""} (+${bingoCount * 3})`);
  if (fullCard) parts.push("full card bonus (+5)");
  qs("ticketBreakdown").textContent = parts.join(" \u00b7 ");

  updateStickyButton();
}

function updateStickyButton() {
  const stickySubmit = qs("stickySubmit");
  // Show sticky button if there are marked cells
  if (markedMask > 0n) {
    stickySubmit.classList.remove("hidden");
  } else {
    stickySubmit.classList.add("hidden");
  }
}

/* ===========================
   CELEBRATION
=========================== */

function fireConfetti() {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const colors = ["#dc2626", "#2563eb", "#f59e0b", "#10b981", "#8b5cf6", "#ec4899"];
  const particles = [];

  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height * -0.5,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 3 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 8 + 4,
      rotation: Math.random() * 360,
      rSpeed: (Math.random() - 0.5) * 10,
      wobble: Math.random() * Math.PI * 2,
      wSpeed: Math.random() * 0.1 + 0.05
    });
  }

  let frame = 0;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    for (const p of particles) {
      p.wobble += p.wSpeed;
      p.x += p.vx + Math.sin(p.wobble) * 2;
      p.y += p.vy;
      p.rotation += p.rSpeed;

      if (p.y > canvas.height + 20) continue;
      alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }

    frame++;
    if (alive && frame < 300) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  }

  requestAnimationFrame(animate);
}

function showCelebration() {
  fireConfetti();
  const toast = document.createElement("div");
  toast.className = "submit-toast";
  const { total } = countTickets();
  toast.textContent = `Submitted! ${total} tickets earned!`;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  }, 2500);
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
    showCelebration();
    await refreshLeaderboard();
    await refreshStats();
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
    await refreshStats();

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

async function refreshStats() {
  if (!currentWeek) return;

  try {
    const res = await fetch(`${API_BASE}/api/stats?week=${encodeURIComponent(currentWeek)}`);
    if (!res.ok) return;
    const data = await res.json();

    // Team battle
    if (data.teams) {
      qs("redTickets").textContent = data.teams.red.tickets;
      qs("redCount").textContent = `${data.teams.red.count} member${data.teams.red.count !== 1 ? 's' : ''}`;
      qs("blueTickets").textContent = data.teams.blue.tickets;
      qs("blueCount").textContent = `${data.teams.blue.count} member${data.teams.blue.count !== 1 ? 's' : ''}`;
    }

    // Challenge stats
    const easiestEl = qs("easiestList");
    const hardestEl = qs("hardestList");

    if (!data.cells || data.total_submissions === 0) {
      easiestEl.textContent = "No data yet";
      hardestEl.textContent = "No data yet";
      return;
    }

    const sorted = [...data.cells].filter(c => c.label).sort((a, b) => b.pct - a.pct);
    const easiest = sorted.slice(0, 10);
    const hardest = sorted.slice(-10).reverse();

    easiestEl.innerHTML = easiest.map(c => `
      <div class="stat-item">
        <span class="stat-pct">${c.pct}%</span>
        <span class="stat-label">${escapeHtml(c.label)}</span>
      </div>
    `).join("");

    hardestEl.innerHTML = hardest.map(c => `
      <div class="stat-item">
        <span class="stat-pct">${c.pct}%</span>
        <span class="stat-label">${escapeHtml(c.label)}</span>
      </div>
    `).join("");
  } catch {
    // Ignore stats errors
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
      renderWeekPicker();
      await fetchCardDefinition(data.week);
      await refreshLeaderboard();
      await refreshStats();
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

  renderWeekPicker();
  renderTeamSelector();

  document.querySelectorAll(".cell").forEach((cell, idx) => {
    cell.addEventListener("click", () => toggleCell(idx));
  });

  qs("stickySubmitBtn").addEventListener("click", submitBoard);

  qs("scanInput").addEventListener("change", e => {
    if (e.target.files[0]) scanImage(e.target.files[0]);
  });

  qs("deleteBtn").addEventListener("click", deleteSubmission);

  qs("teamRed").addEventListener("click", () => {
    saveTeam("red");
    renderTeamSelector();
    renderTickets();
  });

  qs("teamBlue").addEventListener("click", () => {
    saveTeam("blue");
    renderTeamSelector();
    renderTickets();
  });

  renderGrid();
  renderTickets();

  if (currentWeek) {
    fetchCardDefinition(currentWeek);
    refreshLeaderboard();
    refreshStats();
  }
});
