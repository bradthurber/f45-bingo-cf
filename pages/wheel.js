const API_BASE = "https://f45-bingo.f45-bingo.workers.dev";

// State
let participants = [];
let removedWinners = [];
let totalTickets = 0;
let currentWeek = null;
let isSpinning = false;
let currentWinner = null;

// Elements
const authGate = document.getElementById("authGate");
const wheelSection = document.getElementById("wheelSection");
const studioCodeInput = document.getElementById("studioCode");
const authBtn = document.getElementById("authBtn");
const authError = document.getElementById("authError");
const weekDisplay = document.getElementById("weekDisplay");
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
  currentWeek = getCurrentChallengeWeek();
  weekDisplay.textContent = `Week ${formatWeek(currentWeek)}`;

  authBtn.addEventListener("click", authenticate);
  studioCodeInput.addEventListener("keypress", e => {
    if (e.key === "Enter") authenticate();
  });

  spinBtn.addEventListener("click", spin);
  removeBtn.addEventListener("click", removeWinnerAndRespin);
  resetBtn.addEventListener("click", resetAll);
  refreshBtn.addEventListener("click", loadParticipants);
});

async function authenticate() {
  const code = studioCodeInput.value.trim();
  if (!code) {
    authError.textContent = "Please enter the studio code.";
    return;
  }

  authError.textContent = "";
  authBtn.disabled = true;
  authBtn.textContent = "Checking...";

  try {
    // Verify code by trying to access stats endpoint with it
    const res = await fetch(`${API_BASE}/api/leaderboard?week=${encodeURIComponent(currentWeek)}`, {
      headers: { "x-studio-code": code }
    });

    if (!res.ok) {
      throw new Error("Invalid code");
    }

    // Store code for future requests
    sessionStorage.setItem("wheel_studio_code", code);

    // Show wheel section
    authGate.classList.add("hidden");
    wheelSection.classList.remove("hidden");

    await loadParticipants();
  } catch (err) {
    authError.textContent = "Invalid studio code. Please try again.";
    authBtn.disabled = false;
    authBtn.textContent = "Enter";
  }
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

  // Pick winner (weighted random)
  const winner = pickWeightedRandom();
  currentWinner = winner;

  // Find winner's index and calculate angle to their segment center
  const winnerIndex = participants.indexOf(winner);
  let angleToWinnerCenter = 0;
  for (let i = 0; i < winnerIndex; i++) {
    angleToWinnerCenter += (participants[i].tickets_total / totalTickets) * Math.PI * 2;
  }
  angleToWinnerCenter += (winner.tickets_total / totalTickets) * Math.PI * 2 / 2;

  // Pointer is at top. To land winner there, we need to rotate so winner center ends at top.
  // At rotation=0, winner center is at angleToWinnerCenter (measured clockwise from right).
  // Top is at -PI/2 (or 3*PI/2). We need to spin so that winner moves to top.
  // Final rotation R means first segment starts at R, so winner center is at R + angleToWinnerCenter.
  // We want: R + angleToWinnerCenter ≡ -PI/2 (mod 2*PI)
  // But wheel spins multiple times, landing at that spot.
  const spins = 5 + Math.random() * 3;
  const targetStop = (Math.PI * 3 / 2) - angleToWinnerCenter; // equivalent to -PI/2 - angleToWinnerCenter
  const totalRotation = spins * Math.PI * 2 + targetStop;

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
      // Done spinning
      isSpinning = false;
      spinBtn.disabled = false;
      showWinner(winner);
    }
  }

  animate();
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
