const API_BASE = "https://f45-bingo.f45-bingo.workers.dev";
const STUDIO_CODE = ""; // optional


const NAME_KEY = "bingo_display_name";
const DEVICE_KEY = "bingo_device_id";
const MASK_KEY_PREFIX = "bingo_mask_";

const GRID = 5;

const elName = document.getElementById("displayName");
const elPhoto = document.getElementById("photo");
const elGrid = document.getElementById("grid");
const elStatus = document.getElementById("scanStatus");

const elMarkedCount = document.getElementById("markedCount");
const elBingoCount = document.getElementById("bingoCount");
const elFullCard = document.getElementById("fullCard");
const elTicketsTotal = document.getElementById("ticketsTotal");

const elSubmit = document.getElementById("submitBtn");
const elRefresh = document.getElementById("refreshBtn");
const elLeaderboard = document.getElementById("leaderboard");

let weekId = currentWeekId(new Date());
let deviceId = getOrCreateDeviceId();
let mask = loadMask(weekId);

init();

function init() {
  elName.value = loadName();
  elName.addEventListener("change", () => saveName(elName.value));

  renderGrid();
  renderTotals();
  refreshLeaderboard();

  elPhoto.addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    e.target.value = "";
    await scanPhoto(f);
  });

  elSubmit.addEventListener("click", submitScore);
  elRefresh.addEventListener("click", refreshLeaderboard);
}

function renderGrid() {
  elGrid.innerHTML = "";
  for (let i = 0; i < 25; i++) {
    const r = Math.floor(i / GRID);
    const c = i % GRID;
    const btn = document.createElement("button");
    btn.className = "cell" + (isMarked(mask, r, c) ? " on" : "");
    btn.textContent = isMarked(mask, r, c) ? "X" : "";
    btn.onclick = () => {
      mask = setMarked(mask, r, c, !isMarked(mask, r, c));
      saveMask(weekId, mask);
      renderGrid();
      renderTotals();
    };
    elGrid.appendChild(btn);
  }
}

function renderTotals() {
  const res = computeBingo(mask, true);
  elMarkedCount.textContent = res.markedCount;
  elBingoCount.textContent = res.bingoCount;
  elFullCard.textContent = res.fullCard ? "yes" : "no";
  elTicketsTotal.textContent = res.ticketsTotal;
}

async function scanPhoto(file) {
  elStatus.textContent = "Scanning...";

  const form = new FormData();
  form.append("image", file);

  const resp = await fetch(API(`${API_BASE}/api/scan`), {
    method: "POST",
    headers: { "x-device-id": deviceId },
    body: form
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    elStatus.textContent = data.error || "Scan failed";
    return;
  }

  let next = 0n;
  for (const cell of data.marked_cells || []) {
    next = setMarked(next, cell.r, cell.c, true);
  }

  mask = next;
  saveMask(weekId, mask);
  renderGrid();
  renderTotals();

  elStatus.textContent = `Scan ok (confidence ${Number(data.confidence || 0).toFixed(2)})`;
}

async function submitScore() {
  const name = elName.value.trim();
  if (!name) return alert("Enter your name");

  const resp = await fetch(API(`${API_BASE}/api/submit`), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-id": deviceId
    },
    body: JSON.stringify({
      week_id: weekId,
      display_name: name,
      marked_mask: mask.toString()
    })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return alert(data.error || "Submit failed");

  refreshLeaderboard();
  alert(`Submitted. Total tickets: ${data.computed.ticketsTotal}`);
}

async function refreshLeaderboard() {
  const resp = await fetch(API(`${API_BASE}/api/leaderboard?week=${weekId}`));
  const data = await resp.json().catch(() => ({}));

  elLeaderboard.innerHTML = "";
  for (const [i, r] of (data.rows || []).entries()) {
    const div = document.createElement("div");
    div.className = "lbrow";
    div.innerHTML = `
      <div class="rank">${i + 1}</div>
      <div>
        <div class="name">${r.display_name}</div>
        <div class="meta">squares ${r.marked_count}, bingos ${r.bingo_count}</div>
      </div>
      <div class="score">${r.tickets_total}</div>
    `;
    elLeaderboard.appendChild(div);
  }
}

function isMarked(m, r, c) {
  return (m & (1n << BigInt(r * GRID + c))) !== 0n;
}
function setMarked(m, r, c, v) {
  const bit = 1n << BigInt(r * GRID + c);
  return v ? (m | bit) : (m & ~bit);
}

function computeBingo(m, diagonals) {
  let markedCount = 0;
  for (let i = 0; i < 25; i++) if (m & (1n << BigInt(i))) markedCount++;

  let bingoCount = 0;
  for (let r = 0; r < GRID; r++) {
    if ([0,1,2,3,4].every(c => isMarked(m,r,c))) bingoCount++;
  }
  for (let c = 0; c < GRID; c++) {
    if ([0,1,2,3,4].every(r => isMarked(m,r,c))) bingoCount++;
  }
  if (diagonals) {
    if ([0,1,2,3,4].every(i => isMarked(m,i,i))) bingoCount++;
    if ([0,1,2,3,4].every(i => isMarked(m,i,4-i))) bingoCount++;
  }

  const fullCard = markedCount === 25;
  return {
    markedCount,
    bingoCount,
    fullCard,
    ticketsTotal: markedCount + 3 * bingoCount + (fullCard ? 5 : 0)
  };
}

function loadName() { return localStorage.getItem(NAME_KEY) || ""; }
function saveName(n) { localStorage.setItem(NAME_KEY, n); }

function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

function loadMask(w) {
  try { return BigInt(localStorage.getItem(MASK_KEY_PREFIX + w) || "0"); }
  catch { return 0n; }
}
function saveMask(w, m) {
  localStorage.setItem(MASK_KEY_PREFIX + w, m.toString());
}

function currentWeekId(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function API(p) { return p; }
