# Search Matching Specification

## Indian Grocery Categories and Brands

## Purpose

Define a robust search matching strategy that correctly maps user queries to Indian grocery categories, brands, and products even when queries contain spelling mistakes, phonetic variations, or incomplete words.

The system must prioritize **user intent and what the word sounds like**, not only exact spelling.

---

# 1. Core Principles

### 1. Typo Tolerant Matching

The search system must tolerate minor spelling errors, repeated characters, and small variations.

| User Input  | Expected Match |
| ----------- | -------------- |
| baasmati    | basmati        |
| basmti      | basmati        |
| toordal     | toor dal       |
| garam masla | garam masala   |

---

### 2. Phonetic Matching (What It Sounds Like)

Matching must also consider **phonetic similarity** so that words that _sound the same_ match even if spelled differently.

Examples

| User Input | Expected Match |
| ---------- | -------------- |
| baasmati   | basmati        |
| basmati    | basmati        |
| basmatti   | basmati        |
| jirra      | jeera          |
| haldee     | haldi          |

The system should treat **similar sounding words as the same search intent**.

Recommended techniques

• phonetic hashing (Soundex / Metaphone)  
• phonetic similarity scoring  
• pronunciation based matching

---

### 3. Intent Based Matching

Matches should reflect the **intended product, category, and brand**, not only string similarity.

---

### 4. Multi Field Matching

Queries may match across

• Product name  
• Category  
• Brand  
• Synonyms  
• Phonetic variations

---

### 5. Graceful Degradation

If an exact match is unavailable, return the **closest valid match ranked by similarity and phonetic closeness**.
