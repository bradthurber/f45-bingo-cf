class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/geo" && request.method === "GET") {
        return json({
          ip: request.headers.get("CF-Connecting-IP") || null,
          cf: request.cf || null
        });
      }

      if (url.pathname === "/api/leaderboard" && request.method === "GET") {
        return await handleLeaderboard(env, url);
      }
      if (url.pathname === "/api/submit" && request.method === "POST") {
        return await handleSubmit(request, env);
      }
      if (url.pathname === "/api/scan" && request.method === "POST") {
        return await handleScan(request, env);
      }
      if (url.pathname === "/api/admin/define-card" && request.method === "POST") {
        return await handleDefineCard(request, env);
      }
      if (url.pathname === "/api/card" && request.method === "GET") {
        return await handleGetCard(env, url);
      }
      if (url.pathname === "/api/stats" && request.method === "GET") {
        return await handleStats(env, url);
      }
      if (url.pathname === "/api/delete" && request.method === "POST") {
        return await handleDelete(request, env);
      }

      return json({ error: "not_found" }, 404);
    } catch (e) {
      if (e instanceof RateLimitError) {
        return json({ error: "rate_limited" }, 429);
      }
      return json({ error: "unhandled", details: String(e) }, 500);
    }
  }
};

function corsPreflight() {
  return new Response("", {
    status: 204,
    headers: corsHeaders()
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-device-id,x-studio-code"
  };
}


function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

// Indiana-only gate.
// NOTE: in local dev, Cloudflare geo fields are often empty.
// Set ALLOW_ALL_GEO=true in .dev.vars to bypass in dev only.
function enforceIndianaOnly(request, env) {
  // Dev bypass if you ever enable it later
  if (env && env.ALLOW_ALL_GEO === "true") return null;

  const cf = request.cf || {};
  const country = String(cf.country || "").toUpperCase();
  const regionCode = String(cf.regionCode || "").toUpperCase();
  const region = String(cf.region || "");

  const isIndiana =
    (country === "US" && regionCode === "IN") ||
    (country === "US" && region.toLowerCase() === "indiana");

  if (!isIndiana) {
    return json(
      {
        error: "geo_blocked",
        message: "This tool is only available to Indiana users.",
        // TEMP DEBUG: remove once confirmed
        debug: {
          country: cf.country || null,
          region: cf.region || null,
          regionCode: cf.regionCode || null,
          colo: cf.colo || null
        }
      },
      403
    );
  }

  return null;
}

async function handleLeaderboard(env, url) {
  const week = (url.searchParams.get("week") || "").trim();
  if (!week) return json({ error: "missing_week" }, 400);

  const stmt = env.DB.prepare(
    "SELECT week_id, display_name, tickets_total, marked_count, bingo_count, full_card, updated_at " +
    "FROM submissions WHERE week_id = ? " +
    "ORDER BY tickets_total DESC, updated_at DESC LIMIT 50"
  ).bind(week);

  const res = await stmt.all();
  return json({ week_id: week, rows: res.results || [] });
}

async function handleSubmit(request, env) {
  const geoBlock = enforceIndianaOnly(request, env);
  if (geoBlock) return geoBlock;

  const deviceId = request.headers.get("x-device-id") || "";
  if (!deviceId) return json({ error: "missing_device_id" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await enforceRateLimit(env, `submit:ip:${ip}`, 60, 20);
  await enforceRateLimit(env, `submit:dev:${deviceId}`, 60, 10);

  const body = await request.json();
  const weekId = safeText(body.week_id, 32);
  const displayName = safeText(body.display_name, 40);
  const markedMask = safeText(body.marked_mask, 64);

  if (!weekId || !displayName || !markedMask) {
    return json({ error: "missing_fields" }, 400);
  }

  const maskBig = parseMaskBigInt(markedMask);
  if (maskBig === null) return json({ error: "bad_mask" }, 400);

  const result = computeBingo(maskBig, true);
  const updatedAt = new Date().toISOString();

  const stmt = env.DB.prepare(
    "INSERT INTO submissions " +
    "(week_id, device_id, display_name, marked_mask, marked_count, bingo_count, full_card, tickets_total, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) " +
    "ON CONFLICT(week_id, device_id) DO UPDATE SET " +
    "display_name = excluded.display_name, " +
    "marked_mask = excluded.marked_mask, " +
    "marked_count = excluded.marked_count, " +
    "bingo_count = excluded.bingo_count, " +
    "full_card = excluded.full_card, " +
    "tickets_total = excluded.tickets_total, " +
    "updated_at = excluded.updated_at"
  ).bind(
    weekId,
    deviceId,
    displayName,
    markedMask,
    result.markedCount,
    result.bingoCount,
    result.fullCard ? 1 : 0,
    result.ticketsTotal,
    updatedAt
  );

  await stmt.run();

  return json({
    ok: true,
    week_id: weekId,
    device_id: deviceId,
    computed: result,
    updated_at: updatedAt
  });
}

async function handleScan(request, env) {
  const geoBlock = enforceIndianaOnly(request, env);
  if (geoBlock) return geoBlock;

  if (env.SCANNING_ENABLED === "false") return json({ error: "scanning_disabled" }, 503);
  if (!env.OPENAI_API_KEY) return json({ error: "missing_openai_key" }, 500);

  const deviceId = request.headers.get("x-device-id") || "";
  if (!deviceId) return json({ error: "missing_device_id" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await enforceRateLimit(env, `scan:ip:${ip}`, 60, 6);
  await enforceRateLimit(env, `scan:dev:${deviceId}`, 60, 3);
  await enforceRateLimit(env, `scan:devday:${deviceId}:${todayKey()}`, 86400, 30);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) return json({ error: "expected_multipart" }, 400);

  const form = await request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return json({ error: "missing_image" }, 400);

  const maxBytes = env.MAX_IMAGE_BYTES ? parseInt(env.MAX_IMAGE_BYTES, 10) : 6000000;
  if (file.size > maxBytes) return json({ error: "image_too_large", max_bytes: maxBytes }, 413);

  const buf = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  const prompt =
    "You are given a photo of a paper bingo card. " +
    "The card contains a 5x5 grid of squares. " +
    "TASK 1: Find the week identifier on the card. Look for text like 'Week 1', 'Week 2', 'WEEK 3', etc. " +
    "Return the week as 'week1', 'week2', etc. (lowercase, no space). If not found, use null. " +
    "TASK 2: Detect which grid cells contain a clear handwritten mark such as an X, checkmark, or filled/scribbled area. " +
    "Ignore printed text, titles, logos, cell borders, and shadows. " +
    "Be CONSERVATIVE: only report marks you are confident about. " +
    "If a cell has no obvious handwritten mark, do NOT include it. " +
    "Shadows, glare, printing artifacts, and smudges are NOT marks. " +
    "If the card appears blank or you see no clear marks, return an empty marked_cells array. " +
    "Return JSON only with schema: { week: string|null, marked_cells: [{r:0..4,c:0..4}], confidence: 0..1, notes: string }. " +
    "Use 0-based row and column indices with top-left as r=0,c=0. " +
    "Do not include any extra keys.";

  const openaiResp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:${file.type || "image/jpeg"};base64,${base64}` }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  if (!openaiResp.ok) {
    const errText = await openaiResp.text();
    return json({ error: "openai_error", details: errText }, 502);
  }

  const data = await openaiResp.json();

  const outTextRaw = extractResponseText(data);
  const outText = stripJsonFences(outTextRaw);

  let parsed;
  try {
    parsed = JSON.parse(outText);
  } catch {
    return json(
      {
        error: "bad_openai_json",
        raw: String(outTextRaw).slice(0, 2000),
        cleaned: String(outText).slice(0, 2000)
      },
      502
    );
  }

  const cells = Array.isArray(parsed.marked_cells) ? parsed.marked_cells : [];
  const normalized = [];
  for (const cell of cells) {
    const r = Number(cell && cell.r);
    const c = Number(cell && cell.c);
    if (Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < 5 && c >= 0 && c < 5) {
      normalized.push({ r, c });
    }
  }

  const confidence = typeof parsed.confidence === "number" ? clamp(parsed.confidence, 0, 1) : 0.5;
  const notes = typeof parsed.notes === "string" ? parsed.notes.slice(0, 200) : "";
  const week = typeof parsed.week === "string" ? parsed.week.toLowerCase().replace(/\s+/g, "") : null;

  return json({ week, marked_cells: normalized, confidence, notes });
}

async function handleDefineCard(request, env) {
  // No geo restriction for admin endpoint
  if (!env.STUDIO_CODE) return json({ error: "studio_code_not_configured" }, 500);

  const code = request.headers.get("x-studio-code") || "";
  if (code !== env.STUDIO_CODE) return json({ error: "bad_studio_code" }, 403);

  if (!env.OPENAI_API_KEY) return json({ error: "missing_openai_key" }, 500);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  await enforceRateLimit(env, `define:ip:${ip}`, 60, 5);

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) return json({ error: "expected_multipart" }, 400);

  const form = await request.formData();
  const file = form.get("image");
  const weekId = safeText(form.get("week") || "", 32);

  if (!weekId) return json({ error: "missing_week" }, 400);
  if (!(file instanceof File)) return json({ error: "missing_image" }, 400);

  const maxBytes = env.MAX_IMAGE_BYTES ? parseInt(env.MAX_IMAGE_BYTES, 10) : 6000000;
  if (file.size > maxBytes) return json({ error: "image_too_large", max_bytes: maxBytes }, 413);

  const buf = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);

  const prompt =
    "You are given an image of a bingo card with a 5x5 grid. " +
    "Extract the text from each cell, reading left-to-right, top-to-bottom. " +
    "Return JSON: {\"cells\": [\"cell 0 text\", \"cell 1 text\", ..., \"cell 24 text\"]} " +
    "Include exactly 25 strings. If a cell is empty or unreadable, use an empty string.";

  const openaiResp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: `data:${file.type || "image/jpeg"};base64,${base64}` }
          ]
        }
      ],
      text: { format: { type: "json_object" } }
    })
  });

  if (!openaiResp.ok) {
    const errText = await openaiResp.text();
    return json({ error: "openai_error", details: errText }, 502);
  }

  const data = await openaiResp.json();
  const outTextRaw = extractResponseText(data);
  const outText = stripJsonFences(outTextRaw);

  let parsed;
  try {
    parsed = JSON.parse(outText);
  } catch {
    return json(
      {
        error: "bad_openai_json",
        raw: String(outTextRaw).slice(0, 2000),
        cleaned: String(outText).slice(0, 2000)
      },
      502
    );
  }

  if (!Array.isArray(parsed.cells) || parsed.cells.length !== 25) {
    return json({ error: "invalid_cells_array", got: parsed.cells }, 502);
  }

  const cells = parsed.cells.map(c => (typeof c === "string" ? c : String(c || "")));
  const cellsJson = JSON.stringify(cells);
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    "INSERT INTO card_definitions (week_id, cells_json, created_at) VALUES (?, ?, ?) " +
    "ON CONFLICT(week_id) DO UPDATE SET cells_json = excluded.cells_json, created_at = excluded.created_at"
  ).bind(weekId, cellsJson, createdAt).run();

  return json({ ok: true, week_id: weekId, cells, created_at: createdAt });
}

async function handleGetCard(env, url) {
  const week = (url.searchParams.get("week") || "").trim();
  if (!week) return json({ error: "missing_week" }, 400);

  const row = await env.DB.prepare(
    "SELECT week_id, cells_json FROM card_definitions WHERE week_id = ?"
  ).bind(week).first();

  if (!row) return json({ error: "not_found" }, 404);

  let cells;
  try {
    cells = JSON.parse(row.cells_json);
  } catch {
    return json({ error: "corrupt_data" }, 500);
  }

  return json({ week_id: row.week_id, cells });
}

async function handleStats(env, url) {
  const week = (url.searchParams.get("week") || "").trim();
  if (!week) return json({ error: "missing_week" }, 400);

  // Get all submissions for this week
  const submissions = await env.DB.prepare(
    "SELECT marked_mask FROM submissions WHERE week_id = ?"
  ).bind(week).all();

  const rows = submissions.results || [];
  const totalSubmissions = rows.length;

  // Count how many times each cell is marked
  const cellCounts = new Array(25).fill(0);

  for (const row of rows) {
    const mask = parseMaskBigInt(row.marked_mask);
    if (mask === null) continue;

    for (let i = 0; i < 25; i++) {
      if ((mask & (1n << BigInt(i))) !== 0n) {
        cellCounts[i]++;
      }
    }
  }

  // Get card definition for cell labels
  let cellLabels = null;
  const cardRow = await env.DB.prepare(
    "SELECT cells_json FROM card_definitions WHERE week_id = ?"
  ).bind(week).first();

  if (cardRow) {
    try {
      cellLabels = JSON.parse(cardRow.cells_json);
    } catch {}
  }

  // Build response with counts and percentages
  const cells = cellCounts.map((count, idx) => ({
    idx,
    label: cellLabels ? cellLabels[idx] : null,
    count,
    pct: totalSubmissions > 0 ? Math.round((count / totalSubmissions) * 100) : 0
  }));

  return json({
    week_id: week,
    total_submissions: totalSubmissions,
    cells
  });
}

async function handleDelete(request, env) {
  const deviceId = request.headers.get("x-device-id") || "";
  if (!deviceId) return json({ error: "missing_device_id" }, 400);

  const body = await request.json();
  const weekId = safeText(body.week_id, 32);

  if (!weekId) return json({ error: "missing_week_id" }, 400);

  await env.DB.prepare(
    "DELETE FROM submissions WHERE week_id = ? AND device_id = ?"
  ).bind(weekId, deviceId).run();

  return json({ ok: true, week_id: weekId });
}

async function enforceRateLimit(env, key, windowSeconds, limit) {
  const now = Math.floor(Date.now() / 1000);

  const row = await env.DB.prepare("SELECT k, count, reset_at FROM ratelimits WHERE k = ?")
    .bind(key)
    .first();

  if (!row) {
    await env.DB.prepare("INSERT INTO ratelimits (k, count, reset_at) VALUES (?, ?, ?)")
      .bind(key, 1, now + windowSeconds)
      .run();
    return;
  }

  const resetAt = Number(row.reset_at);
  if (now >= resetAt) {
    await env.DB.prepare("UPDATE ratelimits SET count = ?, reset_at = ? WHERE k = ?")
      .bind(1, now + windowSeconds, key)
      .run();
    return;
  }

  const nextCount = Number(row.count) + 1;
  if (nextCount > limit) throw new RateLimitError(`rate_limited:${key}`);

  await env.DB.prepare("UPDATE ratelimits SET count = ? WHERE k = ?").bind(nextCount, key).run();
}

function computeBingo(maskBig, countDiagonals) {
  const GRID = 5;

  const isMarked = (r, c) => {
    const bit = BigInt(r * GRID + c);
    return (maskBig & (1n << bit)) !== 0n;
  };

  let markedCount = 0;
  for (let i = 0; i < 25; i++) {
    if ((maskBig & (1n << BigInt(i))) !== 0n) markedCount++;
  }

  let bingoCount = 0;

  for (let r = 0; r < GRID; r++) {
    let ok = true;
    for (let c = 0; c < GRID; c++) {
      if (!isMarked(r, c)) {
        ok = false;
        break;
      }
    }
    if (ok) bingoCount++;
  }

  for (let c = 0; c < GRID; c++) {
    let ok = true;
    for (let r = 0; r < GRID; r++) {
      if (!isMarked(r, c)) {
        ok = false;
        break;
      }
    }
    if (ok) bingoCount++;
  }

  if (countDiagonals) {
    let ok0 = true;
    for (let i = 0; i < GRID; i++) {
      if (!isMarked(i, i)) {
        ok0 = false;
        break;
      }
    }
    if (ok0) bingoCount++;

    let ok1 = true;
    for (let i = 0; i < GRID; i++) {
      if (!isMarked(i, GRID - 1 - i)) {
        ok1 = false;
        break;
      }
    }
    if (ok1) bingoCount++;
  }

  const fullCard = markedCount === 25;
  const ticketsTotal = markedCount + 3 * bingoCount + (fullCard ? 5 : 0);
  return { markedCount, bingoCount, fullCard, ticketsTotal };
}

function safeText(v, maxLen) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s) return "";
  return s.slice(0, maxLen);
}

function parseMaskBigInt(s) {
  try {
    if (!/^[0-9]+$/.test(s)) return null;
    return BigInt(s);
  } catch {
    return null;
  }
}

function extractResponseText(data) {
  // Some Responses return a convenience string, some do not
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  // Otherwise walk the output array
  if (Array.isArray(data.output)) {
    let chunks = [];
    for (const item of data.output) {
      if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        // Common part types seen in Responses API:
        // - {type:"output_text", text:"..."}
        // - sometimes {type:"text", text:"..."}
        if (part && typeof part.text === "string") {
          chunks.push(part.text);
        }
      }
    }
    const joined = chunks.join("").trim();
    return joined || "";
  }

  return "";
}

function stripJsonFences(s) {
  let t = String(s || "").trim();

  // Remove ```json ... ``` or ``` ... ```
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "");
    t = t.replace(/```\s*$/, "");
    t = t.trim();
  }

  // Some models return multiple JSON objects separated by newlines.
  // If that happens, keep the first object-looking block.
  // (Best effort, still safe.)
  const firstBrace = t.indexOf("{");
  const lastBrace = t.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    t = t.slice(firstBrace, lastBrace + 1);
  }

  return t;
}


function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function todayKey() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
