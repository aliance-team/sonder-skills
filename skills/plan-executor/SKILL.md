---
name: plan-executor
description: >-
  Use this skill whenever the user wants to execute, implement, or work through an existing *markdown* plan file with checkbox tasks and gates — e.g. "execute this plan", "let's start implementing plan-refund-handling.md", "work through the roadmap we made", "continue the plan from where we left off", "implement phase 2, phase 1's gate already passed". Expects the plan-generator format — phases, `- [ ]` checkbox tasks, and `**Gate:**` verification lines (handwritten plans in the same shape also work). Walks phases in dependency waves, dispatching independent phases to parallel subagents, ticking tasks, actually verifying each gate before continuing, and closing out with the plan's own deletion once its reference docs are written. Not for planning itself (use plan-generator if no plan file exists yet), not for reviewing/critiquing a plan without executing it, and not for non-software plans (infra rollout stages, deployment plans not in this markdown checkbox format) — ask the user to confirm the artifact if it's unclear whether it matches this shape.
license: MIT
metadata:
  pairs_with: plan-generator
  input_type: markdown-plan
  contract_version: "1.2"
---

# Plan Executor

## When to use me

Trigger on: a request to execute, implement, resume, or continue a plan that already exists as a markdown checkbox file — with or without a filename given.

Do NOT trigger on: implementation requests that explicitly skip planning ("just do it directly, no plan doc"), explaining/walking-through requests with no plan file involved, reviewing a plan without executing it, or plans belonging to a different domain/format (e.g. an infra rollout stage list that isn't in this checkbox+gate markdown shape — confirm the format with the user rather than assuming).

## Why this exists

A plan only earns its keep if execution actually respects it. The main failure mode this skill guards against is silent drift: skipping ahead past a phase that didn't really finish, or treating a gate as a formality instead of an actual checkpoint. Verified progress beats fast progress that quietly breaks phase 2 while working on phase 4 — and phases that share no files and no dependencies don't need to wait for each other, so they run side by side instead.

## Expected input

A markdown file matching the `plan-generator` contract: phases, `- [ ]` tasks, ending in `- [ ] **Gate:** ...`. Each phase may declare `**Depends on:**` and `**Files:**` directly under its heading; plans without those lines are serial (each phase depends on the previous one). Test gates may take the `adversarial-testing` skill forms:

- `**Gate:** adversarial review → no P0/P1 findings open` — run as a fresh-context reviewer with break-it rules, not as a self-check.
- `**Gate:** property: <invariant> holds over <N> generated inputs`
- `**Gate:** fuzz: <target> survives <N> malformed inputs with no uncaught exception`

If the plan given isn't in this shape — no checkboxes, no gates, just prose — don't force it. Either help reformat it into checkboxes first, or execute more loosely while telling the user the gate discipline below doesn't fully apply.

## Process

Read the whole plan before touching anything, then compute waves and print them in one line: `Waves: 1 → {2,3} → 4`.

1. **Read the whole plan.** Later phases inform earlier ones (e.g. phase 3 needs a specific interface, so build phase 1 to support it).
2. **Compute the waves.** A wave is every phase whose `**Depends on:**` phases are already done and whose `**Files:**` set doesn't overlap another phase in the same wave. Phases without `**Depends on:**` lines are serial: each depends on the one before it. Work the waves in order; merge phases into one wave only when their file sets are disjoint.
3. **Dispatch a wave.** A wave with 2+ phases: one subagent per phase, in a **single message** (parallel tool calls). Each prompt is self-contained — plan path, phase number and its tasks verbatim, its owned `**Files:**` list, edit only those files, do not edit the plan file (the Closeout phase is the exception: it deletes it), do not run the deferred Verification, and return a short report (files changed, per-task outcome, blockers). A one-phase wave runs inline or in one subagent.
4. **Tick checkboxes yourself, as orchestrator.** Never delegate checkbox writes: concurrent writers to the plan file lose ticks and the file stops being an accurate record. The file stays a live progress record for a resumed session.
5. **Verify every gate yourself, after the wave returns.** Run the stated condition per phase — the tests, the endpoint, the migration. Never mark a gate `[x]` on the assumption that the preceding tasks probably worked.
6. **On gate failure:**
   - Attempt one fix, using what you know about why it failed. Worth doing — many failures are small (typo, missed import, off-by-one).
   - Re-run the same verification.
   - Passes now → mark `[x]`, continue normally.
   - Still fails → **stop and tell the user**: what failed, what you tried, why the retry didn't fix it. Do not attempt a second autonomous fix — a failure surviving one informed retry is telling you something about the plan or approach, not just a typo.
7. **Contain failures.** A failed phase blocks only the phases that depend on it. Independent phases in the same wave finish and keep their work.
8. **Check scope.** If a subagent edited files outside its `**Files:**` set, stop and flag it — report which files and which phase. Do not absorb the extra edits silently.
9. **Verification phase: run its strategies concurrently.** Adversarial review is a fresh-context subagent with break-it rules that never sees the implementer's reasoning; property and fuzz suites run in parallel alongside it. Deferred gates from earlier phases are checked here, in one place.
10. **Closeout phase: execute it like any other phase.** It runs last, as its own one-phase wave (inline, since deleting the plan is the orchestrator's own write), and it writes or updates the agent-optimized reference doc for the feature, adds the context pointer (reference index / AGENTS.md), updates stale docs, deletes the plan file, and gates on: plan file gone, doc exists with valid cited paths, pointer resolves.

    **Docs phases are write-first and read-budgeted.** A phase whose deliverable is prose (Closeout, reference docs, issues register) must produce its first file before it is allowed to read broadly. Two failure modes to design out: an unbounded "verify everything you document" mandate sends the agent into a read pass over every changed file and it writes nothing (observed: a closeout phase burned its whole budget reading ~30 files and produced zero artifacts until it was pinged); and a silent read-only stall is invisible to the orchestrator. So the prompt must say: write the doc skeleton first, cap source reads (a small number, e.g. 6, unless a specific claim is unverifiable), check each cited path exists at the moment you cite it rather than pre-verifying in bulk, and report "files written so far" in the reply. On the orchestrator side, if a delegated phase goes idle with no filesystem delta (glob the expected output paths and find nothing new), send one "stop reading, write now" follow-up before waiting further.

11. **If the plan itself turns out to be wrong** mid-execution (a phase's premise is false, a task no longer makes sense given what's been learned) — stop and flag it. Don't push through or silently reinterpret the plan out from under the user.

## Definition of done

Every checkbox in the file is `- [x]`, the Closeout gate has passed, and the plan file is deleted. Deletion is the formal close: the feature's reference doc exists with valid cited paths, the context pointer resolves, and stale docs are updated. Prose deliverables are written incrementally, not after a bulk read pass.

If execution stops partway (gate failure, session end), leave the file exactly as-is — accurate checkbox state is the resumption point. That rule covers interrupted runs only; once Closeout passes, the plan is deleted rather than kept as a record.

On finishing a phase, a short one-line note to the user is worth it before moving on — not a full stop-and-ask, just enough that they're not surprised by how far execution has gone if they check back in.
