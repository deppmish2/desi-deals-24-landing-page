# Quantity Combination Engine — Exact Match, Strict Replacement, and Cart Behavior Specification

## Purpose
Implement a pricing and quantity engine that finds the **cheapest exact combination of package sizes** matching a **user requested quantity exactly**.

The system must:

- never exceed the requested quantity
- never fall below the requested quantity
- apply consistently across all products, brands, stores, and categories
- automatically translate the chosen pack combination into the **same quantities added to cart**

---

# 1. Core Principle

For every search item:

1. Identify the requested product, brand if specified, and target quantity.
2. Normalize all quantities into a single unit.
3. Find matching products across stores.
4. Generate combinations of available package sizes that **sum exactly to the requested quantity**.
5. Compute total price for each valid combination.
6. Select the cheapest exact combination.
7. Present that combination in search results.
8. When the user adds that result, add the **same pack breakdown and quantities** into the cart automatically.

If no exact combination exists, return **No Exact Match Available**.

---

# 2. Units and Normalization

All quantities must be normalized before evaluation.

Examples:

| Input | Normalized |
|---|---|
| 1kg | 1000g |
| 500g | 500g |
| 250g | 250g |
| 5kg | 5000g |
| 1L | 1000ml |
| 500ml | 500ml |

Example:

```text
Requested quantity: 5kg
target_quantity = 5000g
````

---

# 3. Exact Combination Rule

A combination is valid only if:

```text
sum(package_size_i * quantity_i) == target_quantity
```

Only exact equality is allowed.

Reject all combinations where:

* total quantity is less than target
* total quantity is greater than target

No approximation, overflow, or nearest fit logic is allowed.

---

# 4. Automatic Repetition of Pack Counts

If the requested total quantity can be satisfied by repeating the same exact pack multiple times, the system must do that automatically.

Example:

```text
Search: Basmati Rice
Requested Quantity: 5kg
Available exact pack: 1kg
```

Valid result:

```text
1kg × 5 = 5kg
```

The system must:

* show **1kg × 5** in results
* compute total price as `price(1kg) * 5`
* when added to cart, add **5 units of the 1kg product**
* preserve that exact quantity breakdown in cart and checkout

This same rule applies to all products.

Examples:

* 500g × 4 for 2kg
* 250g × 8 for 2kg
* 1L × 3 for 3L
* 200g × 5 for 1kg

---

# 5. Cart Behavior

The selected combination is not only for display. It must directly drive cart quantity.

If the cheapest exact match is:

```text
Basmati Rice 1kg × 5
```

then cart behavior must be:

```text
Add 5 units of Basmati Rice 1kg SKU to cart
```

If the cheapest exact match is mixed packs:

```text
500g × 2 + 1kg × 1
```

then cart behavior must be:

```text
Add 2 units of 500g SKU
Add 1 unit of 1kg SKU
```

The cart must reflect the exact selected decomposition.

---

# 6. Strict Replacement Search Logic

Replacement matching must be strict and follow a clear priority order.

## Priority 1 — Exact Brand + Base Product + Exact Total Size

If the requested brand is available, search strictly using:

* same brand
* same base product
* exact total requested quantity

Example:

```text
Request: Schani Toor Dal 2kg
```

Preferred matches:

* Schani Toor Dal 2kg
* Schani Toor Dal 1kg × 2
* Schani Toor Dal 500g × 4

Do not switch to another brand while the requested brand can satisfy the exact target quantity.

---

## Priority 2 — Base Product + Exact Total Size

If the requested brand is not available at all, or no exact brand-based combination can satisfy the target quantity, then fallback to:

* same base product
* exact total requested quantity
* any brand

Example:

```text
Request: Schani Toor Dal 2kg
No Schani exact combination available
```

Fallback search:

* Toor Dal 2kg
* Toor Dal 1kg × 2
* Toor Dal 500g × 4
* across other brands

---

## Strictness Rules

Replacement search must be strict on:

1. brand, when brand is explicitly requested
2. base product identity
3. exact total size

Do not replace with:

* different product families
* fuzzy semantic substitutes
* loosely related grocery items
* partial quantity matches
* larger or smaller totals

Example:

If user asks for:

```text
Schani Toor Dal 2kg
```

Allowed fallback:

* another brand of Toor Dal totaling exactly 2kg

Not allowed:

* Chana Dal
* Masoor Dal
* Arhar-like fuzzy substitutions if they are not mapped as the same base product
* 1.5kg or 2.5kg totals

---

# 7. Base Product Matching

The engine must separate the product into structured dimensions:

* brand
* base product
* package size
* quantity multiplier

Example:

```text
Schani Toor Dal 1kg
```

Structured as:

* brand: Schani
* base_product: Toor Dal
* pack_size: 1kg

Another example:

```text
India Gate Basmati Rice 5kg
```

Structured as:

* brand: India Gate
* base_product: Basmati Rice
* pack_size: 5kg

Combination and fallback logic must operate on these structured fields, not just raw string matching.

---

# 8. Base Product Vocabulary Source

The system must use the base product list from:

```text
/Users/depppmish/Desktop/desi-deals-deepak-fork/desi-deals-24/data/Most Popular Indian Groceries - indian_grocery_1000_items.csv
```

Use this file to determine canonical base products and matching families.

Expected use:

* extract canonical base product names
* map product titles to a normalized base product
* enforce strict fallback within the same base product only
* prevent unrelated substitutions

Important:

* do not rely only on raw title similarity
* do not use broad fuzzy matching without base product normalization
* fallback is allowed only within the same normalized base product

Note: this path is referenced as the source of truth for base products. The implementation should read and use it directly in the project environment.

---

# 9. Example — Schani Toor Dal 2kg

Search:

```text
Schani Toor Dal
Requested Quantity: 2kg
```

Available packs:

| Product         | Pack Size | Price |
| --------------- | --------- | ----- |
| Schani Toor Dal | 500g      | €1.40 |
| Schani Toor Dal | 1kg       | €2.80 |
| Schani Toor Dal | 2kg       | €5.90 |

Valid exact combinations:

| Combination | Total Quantity | Total Price |
| ----------- | -------------- | ----------- |
| 500g × 4    | 2kg            | €5.60       |
| 1kg × 2     | 2kg            | €5.60       |
| 2kg × 1     | 2kg            | €5.90       |

Return cheapest exact result:

```text
Schani Toor Dal
Best Exact Match: 500g × 4
Total Price: €5.60
```

Cart action:

```text
Add 4 units of Schani Toor Dal 500g
```

---

# 10. Example — Basmati Rice 5kg

Search:

```text
Basmati Rice
Requested Quantity: 5kg
```

Available exact pack:

| Product                 | Pack Size | Price |
| ----------------------- | --------- | ----- |
| India Gate Basmati Rice | 1kg       | €3.00 |

Valid exact combination:

| Combination | Total Quantity | Total Price |
| ----------- | -------------- | ----------- |
| 1kg × 5     | 5kg            | €15.00      |

System must show:

```text
India Gate Basmati Rice
Combination: 1kg × 5
Total Price: €15.00
```

Cart action:

```text
Add 5 units of India Gate Basmati Rice 1kg
```

---

# 11. Generic Product Search Across Brands

If the user searches a generic product without specifying a brand:

Example:

```text
Search: Toor Dal
Quantity: 1kg
```

System must:

1. search all brands and stores for normalized base product = Toor Dal
2. compute exact combinations per brand/store
3. return cheapest exact combination for each result
4. rank by total price

Example output:

| Brand  | Store   | Combination | Price |
| ------ | ------- | ----------- | ----- |
| TRS    | Store A | 500g × 2    | €2.40 |
| Schani | Store B | 1kg × 1     | €2.50 |
| Heera  | Store C | 500g × 2    | €2.55 |

---

# 12. No Exact Match Handling

If no exact combination exists, return:

```text
No Exact Match Available
```

Example:

```text
Requested: 1kg
Available packs: 750g only
```

Result:

```text
No Exact Match Available
```

Do not:

* round up
* round down
* suggest nearest match
* exceed quantity
* partially fill quantity

---

# 13. Matching Priority Summary

The search engine must use this exact priority order:

## If brand is specified

1. exact brand + exact base product + exact total quantity
2. fallback to exact base product + exact total quantity across any brand only if step 1 fails

## If brand is not specified

1. exact base product + exact total quantity across all brands

At every stage, only exact quantity combinations are valid.

---

# 14. Performance Guidelines

Implementation should avoid uncontrolled brute force.

Recommended approach:

* dynamic programming
* bounded knapsack style exact-sum search
* memoization for repeated pack combinations
* early pruning when partial sum exceeds target
* structured normalization of brand and base product before combination generation

The system must scale across thousands of products and stores.

---

# 15. Output Format

Example success:

```text
Product: Schani Toor Dal
Requested Quantity: 2kg

Best Exact Match
Store: Store A
Combination: 500g × 4
Total Price: €5.60
Price per kg: €2.80
Cart Action: Add 4 units of Schani Toor Dal 500g
```

Example fallback:

```text
Product: Schani Toor Dal
Requested Quantity: 2kg

Requested brand unavailable for exact match
Fallback Result: TRS Toor Dal
Combination: 1kg × 2
Total Price: €5.20
Cart Action: Add 2 units of TRS Toor Dal 1kg
```

Example failure:

```text
Product: Toor Dal
Requested Quantity: 1kg

Result: No Exact Match Available
```

---

# 16. Acceptance Criteria

Implementation is correct when:

1. exact combinations only are generated
2. repeated same-pack multiplication is supported automatically
3. results show the exact pack breakdown
4. cart receives the same pack quantities as selected in result
5. brand-specific requests stay brand-strict first
6. fallback happens only to the same normalized base product
7. total requested size must always match exactly
8. unrelated substitutions are never allowed
9. generic searches evaluate all brands for the same base product
10. base product normalization is driven by the CSV source file listed above
11. performance remains stable on large catalogs
