---
name: sonder-sharp-batch
description: Plan-then-implement workflow for several code changes, especially when some depend on others (migration before model, model before endpoint, endpoint before UI). Use this skill whenever the user lists 3 or more changes, mentions "in order", "depends on", "first... then...", or asks for a batch of fixes/tweaks to be done together, even if they don't ask for a plan. Builds on sonder-sharp-implementation. Do NOT use for a single change, or for more than 8 changes at once (split into batches).
---

# Sonder Sharp Implementation: Batch

Plan all changes, get approval, then implement each one with the sharp skill, in dependency order.

**Core rule:** nothing is written before the plan is approved. Each change stays as small as if it were alone.

Each change is implemented following `sonder-sharp-implementation` (steps 1–7 and the Four Cuts). If that skill is unavailable, apply these cuts inline: no scope creep, no comments on untouched code, no defensive code for impossible cases, no abstractions for one-time operations.

---

## Steps

### 1. Split the request into numbered changes

Write each as one line: `#N Change X so that Y.` If one item hides two changes, split it.

**Why:** Dependencies and approval work per change. A fuzzy item can't be ordered or verified.

### 2. Read only the files each change touches

Open them once. Note what each change needs from the others (a column, a route, a prop, a type).

**Why:** Dependencies are found in the code, not guessed from the wording.

### 3. Map dependencies and order

Mark `#B needs #A` only when B breaks or can't be verified without A. Order by dependency; keep the user's order for independent items.

**Why:** Wrong order causes failures that look like bugs in the later change. Inventing dependencies makes the plan slower and harder to review.

### 4. Present the plan, then STOP

| #   | Change | Files | Needs | Verify by |
| --- | ------ | ----- | ----- | --------- |
| 1   | …      | …     | –     | …         |
| 2   | …      | …     | #1    | …         |

Add below the table:

- **Assumptions:** one line each.
- **Out of scope:** anything noticed and not included.
- **Mode:** reply `go` to run all (stops on first failure), or `step` to confirm after each change.

**Why:** Wrong scope is cheapest to fix before any code is written. The mode choice lets the user pick speed or control.

### 5. Implement one change at a time

For each approved row, in order: run the sharp skill, verify with the row's check, then print one status line:
`#N done – <file:lines> – <verified how>`
In `step` mode, wait for confirmation before the next row.

**Why:** A verified change gives later changes solid ground. Failures stay traceable to a single row.

### 6. On failure or deviation, stop

Stop if a verify check fails, or if the code shows the plan was wrong (a missing dependency, a different file). Report: what happened, which rows are affected, proposed fix. Re-plan only the affected rows and get approval again.

**Why:** Continuing on a broken base compounds errors. Re-approving only the affected rows keeps the cost low.

### 7. Final report

```
Done: #1, #2, #3
Skipped/blocked: none
Changed files: <list>
Noticed, not touched: <max 3 bullets>
```

**Why:** The user needs the full picture in one place without rereading the diffs.

---

## Rules

- **No cross-change abstractions.** A shared helper is allowed only if it appears in the approved plan as its own row.
- **No plan drift.** Adding or widening a change means going back to step 4.
- **Cap of 8 changes.** Beyond that, propose splitting into batches and plan the first one.
- **Independent changes** don't wait on each other. Run them in listed order, and a failure in one doesn't block the rest.

---

## Example

**Request:** "Carnet: add `expires_at` to cards, show it in the card list, and hide expired cards from the public verify endpoint."

**Plan:**

| #   | Change                             | Files                                  | Needs | Verify by                            |
| --- | ---------------------------------- | -------------------------------------- | ----- | ------------------------------------ |
| 1   | Add nullable `expires_at` column   | new migration, `Card` model casts      | –     | `php artisan migrate`, column exists |
| 2   | Show `expires_at` in the card list | `CardController@index`, `CardList.jsx` | #1    | list renders the date                |
| 3   | Exclude expired cards in verify    | `VerifyController@show`                | #1    | expired card returns 404             |

Assumptions: null means "never expires". Out of scope: expiry notifications.
Mode: `go` or `step`?

**After `go`:** #1 → #2 → #3, one status line each. #2 and #3 don't depend on each other, so a failure in #2 doesn't stop #3.

---

## Pre-Delivery Checklist

- [ ] Plan was approved before any write
- [ ] Order respects every `Needs`
- [ ] Each change verified individually
- [ ] No helper or abstraction outside the approved plan
- [ ] Out-of-scope findings listed, not fixed
