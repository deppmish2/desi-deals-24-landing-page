---
title: Project Overview
last_updated: 2026-04-11
source_count: 3
---

DesiDeals24 is a Node.js/React full-stack app that crawls Indian grocery stores in Germany, aggregates their current deals, and displays them in a filterable frontend. The current codebase covers 32 store adapters (well beyond the initial 5-store test version), with a production architecture designed around Vercel serverless + Turso (libSQL) as the persistent DB, and GitHub Actions as the crawl trigger.

## What it does

- Runs a daily crawl across 32 Indian grocery stores in Germany (sequential, with 2–5s delays between stores)
- Normalizes deals into a unified schema: price, discount %, weight, category, availability
- Computes `price_per_kg` for weight-bearing products (enables comparison shopping)
- Assigns `display_order` to deals using a deterministic daily seed with quality floor and store-cap constraints
- Serves deals via a paginated REST API with filter support (category, store, price range, search)
- React frontend with URL-synced filters, deal cards, bookmarks, and an admin dashboard

## Current state (as of April 2026)

- **Active branch:** `real-savings-feature` — adds "Real Savings" deal rating (two-pass crawler + `price_per_kg`-based comparison)
- **Recent features:** brand-level canonical products, priority canonical seeding from CSV, deal quality floor on pages 1–2, Instagram ad landing page
- **Infrastructure:** Deployed on Vercel; Turso for DB (SQLite-compatible); GitHub Actions for crawl scheduling

## Target users

Germans of South Asian origin seeking deals on staples (atta, dal, rice, spices, oils) from online desi grocery stores.

## Key constraints

- CommonJS only in server/crawler (`require`/`module.exports`) — no ES module syntax
- `better-sqlite3` is synchronous — no `await` on DB calls (local dev); Turso client in production is async
- `node-fetch` v2 — require pattern only, not ESM import
- No headless browser — all crawlers use fetch + Cheerio or Typesense API

## Related pages

- [Backend](backend.md) — Express routes, DB schema, auth
- [Crawler](crawler.md) — orchestrator, store adapters, scheduling
- [Frontend](frontend.md) — React routing, hooks, API client
- [Decisions](decisions.md) — architecture decisions and trade-offs
- [Stores](stores/) — per-store adapter pages
