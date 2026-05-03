# Remove Bookmarks / Saved Deals Feature

**Date:** 2026-05-03  
**Status:** Approved

## Context

The `/saved` route and bookmarks feature are no longer needed. Shopping functionality is fully consolidated into the cart (`/cart`). The `/list` route already redirects to `/cart`.

## Goal

Delete all bookmark/saved-deals code from frontend and backend. Leave the `bookmarks` DB table intact (no schema migration needed).

## Files to Delete

| File | Reason |
|------|--------|
| `client/src/pages/SavedDealsPage.jsx` | Entire page obsolete |
| `server/routes/bookmarks.js` | API route no longer needed |

## Files to Modify

### `client/src/App.jsx`
- Remove `SavedDealsPage` lazy import
- Remove `<Route path="/saved" element={<SavedDealsPage />} />`

### `client/src/utils/api.js`
- Remove `fetchBookmarks` function
- Remove `addBookmark` function
- Remove `removeBookmark` function
- Keep `fetchDealById` (used by `DealSharePage`)

### `server/index.js`
- Remove `require("./routes/bookmarks")`
- Remove `app.use("/api/v1/bookmarks", bookmarksRouter)`

### `client/src/pages/DealsPage.jsx`
Surgical removals across multiple sections:
- Remove `fetchBookmarks`, `addBookmark` imports from `../utils/api`
- Remove `BookmarksPanel` component (~lines 1333–1430)
- Remove state: `bookmarkedIds`, `bookmarkedDeals`, `bookmarksPanelOpen`
- Remove `bookmarkDealId` resume state logic (~lines 1723–1726)
- Remove bookmark toggle handler and all `addBookmark`/`removeBookmark` calls
- Remove bookmark icon button on deal cards
- Remove `/saved` nav link with bookmark count badge (~line 2167)

## Explicitly Out of Scope

- `bookmarks` DB table — keep as-is, no migration
- `fetchDealById` in `api.js` — keep, used by `DealSharePage`
- Any analytics events referencing bookmarks — leave in place (harmless orphans)

## Testing

After removal:
- `/saved` returns 404 (no route)
- `/deals` page has no bookmark icon or panel
- No console errors referencing bookmarks
- `DealSharePage` (`/share/deal/:id`) still works
