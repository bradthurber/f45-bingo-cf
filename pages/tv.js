const API_BASE = ""; // set to Worker URL if different origin
const POLL_MS = 10000;
const TOP_N = 10;

const elWeek = document.getElementById("weekId");
const elLast = document.getElementById("lastUpdated");
const elRows = document.getElementById("rows");
const elTicker = document.getElementById("ticker");
const elQr = document.getElementById("qrImg");
const elJoin = document.getElementById("joinUrl");

let weekId = currentWeekId(new Date());
let lastSnapshot = new Map();
let lastLeader = null;
let lastTickMsg = "Waiting for updates...";

init();

function init() {
  elWeek.textContent = weekId;

  const joinUrl = computeJoinUrl();
  elJoin.textContent = joinUrl;
  elQr.src = makeQrUrl(joinUrl);

  pollOnce();
  setInterval(pollOnce, POLL_MS);

  setInterval(() => location.reload(), 60 * 60 * 1000);
}

async function pollOnce() {
  try {
    const resp = await fetch(API(`${API_BASE}/api/leaderboard?week=${encodeURIComponent(weekId)}`), { cache: "no-store" });
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || String(resp.status));

    const rows = Array.isArray(data.rows) ? data.rows.slice(0, TOP_N) : [];
    render(rows);
    elLast.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    elLast.textContent = "offline";
    elTicker.textContent = "Network issue. Retrying...";
  }
}

function render(rows) {
  const current = new Map();
  rows.forEach((r) => current.set(r.display_name, r.tickets_total));

  const leader = rows[0] ? rows[0].display_name : null;
  const leaderChanged = leader && leader !== lastLeader;

  elRows.innerHTML = "";

  rows.forEach((r, idx) => {
    const prevScore = lastSnapshot.get(r.display_name);
    const changed = typeof prevScore === "number" && prevScore !== r.tickets_total;

    const row = document.createElement("div");
    row.className = "row" + (idx === 0 && leaderChanged ? " newLeader" : "") + (changed ? " changed" : "");
    row.innerHTML = `
      <div class="rank">#${idx + 1}</div>
      <div>
        <div class="name">${escapeHtml(r.display_name || "")}</div>
        <div class="meta">squares ${r.marked_count}, bingos ${r.bingo_count}${r.full_card ? ", full card" : ""}</div>
      </div>
      <div class="score">${r.tickets_total}</div>
    `;
    elRows.appendChild(row);
  });

  const tick = computeTickerMessage(rows, leaderChanged);
  if (tick) {
    lastTickMsg = tick;
    elTicker.textContent = tick;
  } else {
    elTicker.textContent = lastTickMsg;
  }

  lastSnapshot = current;
  lastLeader = leader;
}

function computeTickerMessage(rows, leaderChanged) {
  if (!rows || rows.length === 0) return "No submissions yet. Scan your card to join!";

  const leader = rows[0];
  if (leaderChanged) return `New leader: ${leader.display_name} with ${leader.tickets_total} tickets!`;

  for (const r of rows) {
    const prev = lastSnapshot.get(r.display_name);
    if (typeof prev === "number" && r.tickets_total > prev) {
      const delta = r.tickets_total - prev;
      return `${r.display_name} gained +${delta} tickets (now ${r.tickets_total}).`;
    }
  }
  return "";
}

function computeJoinUrl() {
  const u = new URL(location.href);
  u.pathname = u.pathname.replace(/\/tv\.html$/, "/");
  u.search = "";
  return u.toString();
}

function makeQrUrl(targetUrl) {
  const encoded = encodeURIComponent(targetUrl);
  return `https://chart.googleapis.com/chart?cht=qr&chs=220x220&chl=${encoded}`;
}

function API(path) {
  if (!API_BASE) return path.replace(API_BASE, "");
  return path;
}

function currentWeekId(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  const year = date.getUTCFullYear();
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
