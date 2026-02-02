# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.
Treat this file as authoritative.

---

## Project Overview

F45 Bingo is a Cloudflare Workers + Pages application for running an F45 fitness challenge bingo game.

Players:
- Mark squares on a 5x5 bingo card
- Optionally scan a paper card using OpenAI Vision
- Earn raffle tickets based on squares and bingos
- Compete on a weekly leaderboard

Includes a TV leaderboard mode for gym displays.

This is an honor-system app:
- No authentication
- No user accounts
- Minimal PII (display name only)
- No image storage

---

## Tech Stack

- Backend: Cloudflare Workers (JavaScript)
- Frontend: Cloudflare Pages (vanilla HTML/CSS/JS)
- Database: Cloudflare D1 (SQLite)
- AI: OpenAI Vision API
- State model: 25-bit BigInt bitmask (row-major)

---

## Repository Structure

worker/
  index.js        - All API endpoints and business logic
  schema.sql      - D1 schema (submissions, ratelimits)

pages/
  index.html      - Player UI
  app.js          - Player logic (grid, scan, submit)
  styles.css
  tv.html         - TV leaderboard display
  tv.js

---

## Development & Deployment

Local development:
  npx wrangler dev

Production deployment:
- GitHub integration is enabled
- Pushing to main deploys automatically
- Manual npx wrangler deploy is only used when explicitly needed

Database:
  npx wrangler d1 execute f45-bingo --file=worker/schema.sql

---

## Secrets & Configuration

Production secrets:
  wrangler secret put STUDIO_CODE
  wrangler secret put OPENAI_API_KEY

Local-only vars (.dev.vars):
  ALLOW_ALL_GEO=true
  OPENAI_API_KEY=sk-proj-...

wrangler.toml defines:
- Worker name
- D1 binding
- Feature flags (SCANNING_ENABLED, OPENAI_MODEL, MAX_IMAGE_BYTES)

---

## API Contract (DO NOT CHANGE WITHOUT UPDATING FRONTEND)

Required headers (most POST requests):
  x-device-id: <uuid persisted in localStorage>
  x-studio-code: <shared studio code>

If x-device-id is missing:
  {"error":"missing_device_id"}

---

## API Endpoints

GET /api/geo
- Returns Cloudflare geolocation data.

GET /api/leaderboard?week=week1
- Returns leaderboard rows for the specified week.

POST /api/submit
Body:
  {"name":"Brad","week":"week1","marked_mask":"123456789"}

Notes:
- marked_mask is a decimal string representation of a BigInt
- Submissions overwrite previous entries for the same device + week

POST /api/scan
- multipart/form-data
- Field name MUST be image

Response:
  {"marked_cells":[{"r":2,"c":1}],"confidence":1,"notes":"..."}

Frontend MUST convert to bitmask:
  idx = r * 5 + c
  mask |= (1n << idx)

---

## Bingo Grid & Scoring

- Grid size: 5 x 5
- Indexing: zero-based, row-major
- Index formula: row * 5 + col
- State stored as a 25-bit BigInt

Scoring rules:
- +1 ticket per marked square
- +3 tickets per completed bingo line
- +5 bonus for full card

Scoring logic lives in computeBingo(mask). Do not refactor unless explicitly requested.

---

## Geo Restrictions

- Indiana-only access
- Enforced via Cloudflare request headers
- Local bypass: ALLOW_ALL_GEO=true

Error shape:
  {"error":"geo_blocked","message":"This tool is only available to Indiana users."}

---

## Frontend Notes

- Frontend is served via Cloudflare Pages
- Backend API runs on Cloudflare Workers
- Pages call the Worker at:
  https://f45-bingo.f45-bingo.workers.dev

Common pitfalls:
- Forgetting x-device-id
- Expecting /api/scan to return marked_mask (it returns marked_cells)
- Overwriting mask instead of merging
- Changing backend without updating frontend

---

## Week Identifiers

Accepted formats:
- week1 - week8
- YYYY-WXX (e.g. 2026-W05)

Week values are treated as opaque strings.

---

## Rate Limiting

- Stored in D1
- Window-based counters per device
- Applied to submit and scan endpoints

---

## Guardrails for Claude Code

- Make small, explicit changes
- Preserve API contracts exactly
- Preserve BigInt mask semantics
- Do not refactor frontend and backend together unless asked
- Ask before changing scoring, geo rules, schema, or rate limits
- Prefer surfacing real errors over guessing

---

## Non-Goals

- Authentication or accounts
- Persistent image storage
- OCR perfection
- User tracking beyond device ID
