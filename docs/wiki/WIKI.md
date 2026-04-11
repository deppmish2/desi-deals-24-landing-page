# DesiDeals24 Wiki — Schema & Maintenance Guide

This file defines how Claude maintains the wiki. Read it before any ingest, query, or lint operation.

---

## Page Conventions

Every wiki page begins with frontmatter:

```markdown
---
title: <Page Title>
last_updated: YYYY-MM-DD
source_count: N
---
```

**`source_count`** is the number of distinct source artifacts (files, sessions, docs) used to build the page. Increment it when you add new source material.

After frontmatter: a **one-paragraph synthesis** that stands alone as a summary, followed by headed sections (`##`). Cross-references use relative markdown links: `[decisions](../decisions.md)`, `[jamoona](stores/jamoona.md)`.

Keep pages factual and concise. Prefer bullets over prose for lists of facts. Do not add speculative future content — only record what is implemented or explicitly decided.

---

## Three Workflows

### 1. Auto-Update (triggered after significant tasks)

After completing any task that changes code, schema, or architecture, silently:

1. Append an entry to `log.md`
2. Update the relevant domain page(s) with the new information
3. If a new concept/area was introduced, create a new page and add it to `index.md`

A **significant task** includes:
- Adding or modifying a store adapter
- Changing the DB schema
- Adding an API route
- Changing crawler logic, display order, or pricing logic
- Adding a frontend page or hook
- Any architectural decision made in session

A **non-significant task** (no auto-update needed): typo fixes, minor style tweaks, adding a comment.

### 2. Deep Ingest (user-triggered)

When the user says **"ingest [source]"** (e.g., a session summary, git diff, external doc):

1. Read the source carefully
2. Discuss key takeaways with the user (one exchange, not a long interview)
3. Write or update domain pages with the extracted knowledge
4. Update `index.md` if any new pages were created
5. Append an entry to `log.md`

One source may touch many pages. That's expected — touch all of them.

### 3. Lint (user-triggered)

When the user says **"lint the wiki"**:

1. Read `index.md` to get the full page list
2. Read each page (or sample for large wikis)
3. Report findings:
   - Contradictions between pages
   - Stale claims newer code has superseded
   - Orphan pages with no inbound links
   - Important concepts mentioned without a dedicated page
   - Missing cross-references between clearly related pages
4. Fix issues with user approval — don't auto-fix contradictions, ask first

---

## Log Format

`log.md` is append-only. Add entries at the **bottom**. Format:

```
## [YYYY-MM-DD] <type> | <description>
Pages touched: page1.md, page2.md
```

Types: `bootstrap`, `auto-update`, `ingest`, `lint`, `query`

Parseable shortcut: `grep "^## \[" docs/wiki/log.md | tail -10`

---

## Index Format

`index.md` is the navigation entry point — read it first when answering any query about the project. Each entry is one line:

```
- [Title](relative/path.md) — one-line description of what the page covers
```

Organized by section: Overview, Domain, Stores. Update it whenever a page is created or significantly restructured.

---

## Query Workflow

When answering a project question:

1. Read `index.md` to find relevant pages
2. Read those pages
3. Synthesize the answer with citations (e.g., "per `crawler.md`")
4. If the answer is non-obvious or took synthesis effort, offer to file it as a new wiki page

---

## What NOT to put in the wiki

- Code that already lives in source files (link to the file instead)
- Git history or who made a change (use `git log` for that)
- Ephemeral session state or in-progress task notes
- Speculation about future features not yet decided
