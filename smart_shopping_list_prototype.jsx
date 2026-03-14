# Agentic AI Smart Shopping – Tech Spec PRD (Token-Efficient)

## 1. Objective
Build an agent-driven smart shopping system that:
- Creates list via text + speech
- Optimizes store selection by price + availability
- Resolves missing items via store-constrained replacement
- Minimizes LLM token usage via structured reasoning + tool calls

---

## 2. System Architecture

### 2.1 Components
- UI (React, 2 pages)
- Pricing Engine (deterministic)
- Agent Orchestrator (LLM + tools)
- Product DB
- Store Catalog DB
- User Behavior Store (recency + frequency)

### 2.2 Agent Model
Agent = Planner + Tool Caller
LLM used ONLY for:
- Intent parsing (speech/text → product match)
- Replacement semantic matching
- Ambiguous query resolution

All math, ranking, sorting = deterministic functions.

---

## 3. Core Flows

### 3.1 Create Smart Shopping List (Page 1)
Inputs:
- Text input
- Microphone (speech → text)

Suggestion priority:
1. Last ordered (sorted by recency)
2. Frequent items
3. Global product DB

Tags:
- Recent
- Frequent

Row structure:
| Item | Qty (- n +) | X |
- Zebra striping
- Qty inline
- Remove via icon

CTA: "Find best prices"

---

### 3.2 Best Prices (Page 2)
For each store compute:
- Item subtotal
- Shipping
- Missing items
- Final total

Ranking modes:
- Total € (default)
- Availability (fewest missing)

Card Layout:
Store Name | Total €
Breakdown:
Q × Item @ Unit = Line Total
Shipping
Missing:
Item | Search replacement
CTA: "Buy on <Store>"

---

## 4. Replacement Flow (Agent-Constrained)
Trigger: Missing item in store

Modal:
- Store-locked search
- Search only within that store catalog
- Show name + € price

On select:
- Replace item in master list
- Preserve quantity
- Recompute rankings
- Close modal

Agent Role:
- If search query ambiguous → semantic match
- Otherwise deterministic filter

---

## 5. Agent Tool Design

### Tools
1. match_product(query)
2. semantic_replacement(query, store_catalog)
3. normalize_speech(text)

### Token Strategy
- Never send full store DB to LLM
- Send top 20 candidate matches only
- Use embeddings for similarity
- Cache user product vectors

Math + ranking never handled by LLM.

---

## 6. Data Models

### ShoppingItem
{ id, name, quantity }

### StoreOffer
{ storeName, breakdown[], missing[], shipping, total }

### Suggestion
{ name, isRecent, isFrequent }

---

## 7. Intelligence Roadmap

Phase 1: Deterministic ranking
Phase 2: Price similarity highlighting
Phase 3: Budget-aware auto-optimization
Phase 4: Autonomous basket completion agent

---

## 8. Design System

### Layout
Page 1 → Input-first minimal
Page 2 → Card ranking grid

### Visual Rules
- Subtle row striping
- Bold total pricing
- Small price breakdown text
- Primary CTA full-width
- Modal centered with dark overlay

### UX Principles
- Commit to one store at a time
- Fix missing before checkout
- Quantities always visible
- No clutter

---

## 9. Non-Goals
- No LLM-based price calculation
- No cross-store automatic splitting (v1)
- No uncontrolled open search across all stores during replacement

---

## 10. Success Metrics
- % lists completed in one store
- Replacement usage rate
- Avg tokens per session
- Conversion to Buy click

---

End of spec.
