# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

F45 Bingo is a Cloudflare Workers application for managing an F45 fitness challenge bingo game. Players mark squares on a 5x5 bingo card, can scan paper cards with OpenAI vision API, and compete on a weekly leaderboard. Includes a TV display mode for gym screens.

## Commands

```bash
# Local development
npx wrangler dev

# Deploy to Cloudflare
npx wrangler deploy

# Initialize/update database schema
npx wrangler d1 execute f45-bingo --file=worker/schema.sql

# Set production secrets
wrangler secret put STUDIO_CODE
wrangler secret put OPENAI_API_KEY
```

## Architecture

**Tech Stack:** Cloudflare Workers, D1 (SQLite), vanilla JS frontend, OpenAI Vision API

**Structure:**
- `worker/index.js` - Main API server with all endpoints and business logic
- `worker/schema.sql` - D1 database schema (submissions, ratelimits tables)
- `pages/` - Static frontend files served alongside the worker
  - `index.html` + `app.js` - Player UI with bingo grid and leaderboard
  - `tv.html` + `tv.js` - TV display mode for gym screens (auto-polling)

**API Endpoints:**
- `GET /api/geo` - Cloudflare geolocation data
- `GET /api/leaderboard?week=week1` - Top 50 submissions for a week
- `POST /api/submit` - Submit/update board state (requires x-device-id, x-studio-code headers)
- `POST /api/scan` - Upload image for OpenAI vision cell detection

**Key Business Logic:**
- Bingo scoring in `computeBingo()`: +1 per square, +3 per completed line, +5 bonus for full card
- Grid state stored as 25-bit BigInt bitmask (row-major order, cell = row * 5 + col)
- Geo-restricted to Indiana via Cloudflare headers (bypass with `ALLOW_ALL_GEO=true` in .dev.vars)
- Rate limiting stored in D1 with window-based counters

## Configuration

**wrangler.toml:** Worker name, D1 binding, environment defaults (SCANNING_ENABLED, OPENAI_MODEL, MAX_IMAGE_BYTES)

**.dev.vars (local only):**
```
ALLOW_ALL_GEO=true
OPENAI_API_KEY=sk-proj-...
```

**Week IDs:** Legacy format `week1`-`week8` or ISO format `YYYY-WXX` (e.g., `2026-W05`)
