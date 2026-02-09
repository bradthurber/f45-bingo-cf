const API_BASE = "https://f45-bingo.f45-bingo.workers.dev";

// State
let participants = [];
let removedWinners = [];
let totalTickets = 0;
let currentWeek = null;
let isSpinning = false;
let currentWinner = null;

// Elements
const weekPicker = document.getElementById("weekPicker");
const canvas = document.getElementById("wheelCanvas");
const ctx = canvas.getContext("2d");
const spinBtn = document.getElementById("spinBtn");
const removeBtn = document.getElementById("removeBtn");
const winnerDiv = document.getElementById("winner");
const winnerName = document.getElementById("winnerName");
const winnerTickets = document.getElementById("winnerTickets");
const participantCount = document.getElementById("participantCount");
const participantList = document.getElementById("participantList");
const removedSection = document.getElementById("removedSection");
const removedList = document.getElementById("removedList");
const resetBtn = document.getElementById("resetBtn");
const refreshBtn = document.getElementById("refreshBtn");

// Colors for wheel segments
const COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#0ea5e9", "#3b82f6",
  "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899"
];

// Init
document.addEventListener("DOMContentLoaded", () => {
  currentWeek = getRaffleDefaultWeek();
  renderWeekPicker();

  spinBtn.addEventListener("click", spin);
  removeBtn.addEventListener("click", removeWinnerAndRespin);
  resetBtn.addEventListener("click", resetAll);
  refreshBtn.addEventListener("click", loadParticipants);

  loadParticipants();
});

function getRaffleDefaultWeek() {
  const current = getCurrentChallengeWeek();
  const match = current.match(/week(\d+)/);
  const num = match ? parseInt(match[1], 10) : 1;
  if (num <= 1) return "week1";
  return `week${num - 1}`;
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

function renderWeekPicker() {
  const weeks = getAvailableWeeks();
  weekPicker.innerHTML = "";
  for (const week of weeks) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "wheel-week-tab" + (week === currentWeek ? " active" : "");
    btn.textContent = "Week " + week.match(/\d+/)[0];
    btn.addEventListener("click", () => switchWeek(week));
    weekPicker.appendChild(btn);
  }
}

function switchWeek(week) {
  if (week === currentWeek) return;
  currentWeek = week;
  removedWinners = [];
  currentWinner = null;
  winnerDiv.classList.add("hidden");
  removeBtn.classList.add("hidden");
  removedSection.classList.add("hidden");
  renderWeekPicker();
  loadParticipants();
}

async function loadParticipants() {
  try {
    const res = await fetch(`${API_BASE}/api/leaderboard?week=${encodeURIComponent(currentWeek)}`, {
      cache: "no-store"
    });
    const data = await res.json();

    // Filter out removed winners and those with 0 tickets
    participants = (data.rows || [])
      .filter(r => r.tickets_total > 0)
      .filter(r => !removedWinners.includes(r.display_name));

    totalTickets = participants.reduce((sum, p) => sum + p.tickets_total, 0);

    renderParticipantList();
    drawWheel();
  } catch (err) {
    console.error("Failed to load participants:", err);
  }
}

function renderParticipantList() {
  participantCount.textContent = participants.length;

  if (participants.length === 0) {
    participantList.innerHTML = '<div class="participant-item">No participants yet</div>';
    spinBtn.disabled = true;
    return;
  }

  spinBtn.disabled = false;
  participantList.innerHTML = participants.map(p => {
    const pct = ((p.tickets_total / totalTickets) * 100).toFixed(1);
    return `
      <div class="participant-item">
        <span class="participant-name">${escapeHtml(p.display_name)}</span>
        <span class="participant-info">${p.tickets_total} tickets (${pct}%)</span>
      </div>
    `;
  }).join("");
}

function drawWheel(rotation = 0) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 10;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (participants.length === 0) {
    // Draw empty wheel
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#f5f5f5";
    ctx.fill();
    ctx.strokeStyle = "#e5e5e5";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#999";
    ctx.font = "16px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("No participants", centerX, centerY);
    return;
  }

  let startAngle = rotation;

  participants.forEach((p, i) => {
    const sliceAngle = (p.tickets_total / totalTickets) * Math.PI * 2;
    const endAngle = startAngle + sliceAngle;

    // Draw slice
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw label
    const midAngle = startAngle + sliceAngle / 2;
    const labelRadius = radius * 0.65;
    const x = centerX + Math.cos(midAngle) * labelRadius;
    const y = centerY + Math.sin(midAngle) * labelRadius;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(midAngle + Math.PI / 2);

    // Only show name if slice is big enough
    if (sliceAngle > 0.15) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Truncate long names
      let name = p.display_name;
      if (name.length > 12) name = name.slice(0, 10) + "...";
      ctx.fillText(name, 0, 0);
    }

    ctx.restore();

    startAngle = endAngle;
  });

  // Draw center circle
  ctx.beginPath();
  ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();
}

function spin() {
  if (isSpinning || participants.length === 0) return;

  isSpinning = true;
  spinBtn.disabled = true;
  removeBtn.classList.add("hidden");
  winnerDiv.classList.add("hidden");
  currentWinner = null;

  // Spin to a random position, then determine winner based on where it lands
  const spins = 5 + Math.random() * 3;
  const randomStop = Math.random() * Math.PI * 2;
  const totalRotation = spins * Math.PI * 2 + randomStop;

  // Animate
  const duration = 5000;
  const startTime = Date.now();
  const startRotation = 0;

  function animate() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Ease out cubic for natural deceleration
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentRotation = startRotation + totalRotation * eased;

    drawWheel(currentRotation);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Done spinning - determine winner based on where pointer lands
      isSpinning = false;
      spinBtn.disabled = false;

      const winner = getWinnerAtRotation(totalRotation);
      currentWinner = winner;
      showWinner(winner);
    }
  }

  animate();
}

function getWinnerAtRotation(rotation) {
  // Pointer is at top (3*PI/2 or -PI/2)
  // At this rotation, segment 0 starts at `rotation`
  // Find which segment contains the pointer angle

  const pointerAngle = Math.PI * 3 / 2; // top

  // Normalize rotation to 0-2PI range
  let normalizedRotation = rotation % (Math.PI * 2);
  if (normalizedRotation < 0) normalizedRotation += Math.PI * 2;

  // The pointer points to angle `pointerAngle`, but segments start at `rotation`
  // So relative to the wheel, the pointer is at: pointerAngle - rotation
  let relativePointer = pointerAngle - normalizedRotation;
  if (relativePointer < 0) relativePointer += Math.PI * 2;

  // Now find which segment contains relativePointer
  let angleSum = 0;
  for (const p of participants) {
    const sliceAngle = (p.tickets_total / totalTickets) * Math.PI * 2;
    if (relativePointer < angleSum + sliceAngle) {
      return p;
    }
    angleSum += sliceAngle;
  }

  // Fallback to last participant
  return participants[participants.length - 1];
}

function pickWeightedRandom() {
  const rand = Math.random() * totalTickets;
  let cumulative = 0;

  for (const p of participants) {
    cumulative += p.tickets_total;
    if (rand <= cumulative) {
      return p;
    }
  }

  return participants[participants.length - 1];
}

function showWinner(winner) {
  winnerName.textContent = winner.display_name;
  winnerTickets.textContent = `${winner.tickets_total} tickets`;
  winnerDiv.classList.remove("hidden");
  removeBtn.classList.remove("hidden");

  // Confetti!
  confetti({
    particleCount: 150,
    spread: 100,
    origin: { y: 0.6 },
    colors: ['#FFD700', '#FFA500', '#FF6347', '#22c55e', '#3b82f6']
  });

  setTimeout(() => {
    confetti({
      particleCount: 100,
      spread: 80,
      origin: { y: 0.5 }
    });
  }, 250);
}

function removeWinnerAndRespin() {
  if (!currentWinner) return;

  removedWinners.push(currentWinner.display_name);

  // Update removed list UI
  renderRemovedList();
  removedSection.classList.remove("hidden");

  // Reload participants (will filter out removed winners)
  loadParticipants();

  // Hide winner display
  winnerDiv.classList.add("hidden");
  removeBtn.classList.add("hidden");
  currentWinner = null;
}

function renderRemovedList() {
  removedList.innerHTML = removedWinners.map((name, i) => `
    <div class="removed-item">${i + 1}. ${escapeHtml(name)}</div>
  `).join("");
}

function resetAll() {
  removedWinners = [];
  removedSection.classList.add("hidden");
  winnerDiv.classList.add("hidden");
  removeBtn.classList.add("hidden");
  currentWinner = null;
  loadParticipants();
}

function getCurrentChallengeWeek() {
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

  if (today < schedule[0].start) return "week1";
  return "week6";
}

function formatWeek(weekId) {
  const match = weekId.match(/^week(\d+)$/i);
  return match ? match[1] : weekId;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
