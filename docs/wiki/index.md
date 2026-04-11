---
title: Wiki Index
last_updated: 2026-04-11
---

DesiDeals24 wiki — compiled project knowledge maintained by Claude. Read this before exploring the codebase. See [WIKI.md](WIKI.md) for maintenance conventions.

## Overview

- [Overview](overview.md) — what the project does, current state, key constraints, tech stack

## Domain

- [Backend](backend.md) — Express routes, DB schema (all tables), auth flow, OG meta injection, scheduling
- [Frontend](frontend.md) — React routing, `useDeals` hook, API client, filter URL-sync, analytics
- [Crawler](crawler.md) — two-pass orchestrator, display ordering, category mapping, price/weight parsing, canonical auto-mapping
- [Decisions](decisions.md) — architecture decisions with rationale: CommonJS, Turso, GitHub Actions crawl, sequential crawl, Dookan exclusion, Real Savings two-pass, price format dual support

## Stores

- [Jamoona](stores/jamoona.md) — Shopify JSON API; collections: weekly-deals, value-deals, save-food
- [Dookan](stores/dookan.md) — Shopify JSON API; excluded from homepage display; BBD title cleaning
- [Grocera](stores/grocera.md) — Typesense API (public search key); deal tag filter; best-before from expires_at
- [Little India](stores/little-india.md) — WooCommerce HTML + Cheerio; pagination /page/N/; link discovery
- [Namma Markt](stores/namma-markt.md) — Shopify JSON API; single on-sale collection

## Log

See [log.md](log.md) for the chronological record of wiki updates.
