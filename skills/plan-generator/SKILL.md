---
name: plan-generator
description: Use this skill whenever the user wants to plan a feature, break a task into implementation steps, or asks for a spec/roadmap before writing code — e.g. "plan out how to add X", "I need a spec for Y before we touch it", "break this down into steps", "let's think through the approach before coding", "I don't want to just jump into this, let's figure out the steps first". Produces a single markdown plan file (spec, phased roadmap, checkbox tasks, explicit verification gates) meant to be handed off to execution later, by a human or by the plan-executor skill. Prefer this over jumping straight into code whenever the task is non-trivial. Not for reviewing or critiquing a plan the user already wrote (just discuss it directly), and not for non-coding planning (schedules, business strategy, go-to-market) — this is specifically for software implementation plans.
license: MIT
metadata:
  pairs_with: plan-executor
  output_type: markdown-plan
  contract_version: "1.1"
---

# Plan Generator

## When to use me

Trigger on: a request to plan, spec, scope, or roadmap a non-trivial coding task before implementation starts. Also trigger on intent without keywords — "let's think this through before coding", "I don't want to just start typing" — not just literal matches to "plan" or "spec".

Do NOT trigger on: reviewing/critiquing a plan that already exists (discuss it directly instead), non-software planning (schedules, business strategy, go-to-market), or trivial single-step tasks that don't warrant the overhead.

## Why this exists

Code written straight from a request tends to encode a misunderstanding early, and that misunderstanding compounds — by the time it surfaces, there's a pile of code built on top of it. A short planning pass up front is cheap; discovering the wrong approach after three files are written is not.

The output of this skill is a real artifact, not a paragraph that evaporates: a markdown file the user can read, edit, and hand back — including to `plan-executor`, which parses the exact structure defined below. Don't drift from that structure; it's a contract, not a suggestion.

## Process (do these in order)

Don't skip to the roadmap. The roadmap is only as good as the spec underneath it.

### 1. Spec
State, in plain prose (a few sentences to a short paragraph — this is a shared-understanding check, not a requirements doc):
- The concrete goal: what works when this is done
- Explicit assumptions: anything inferred rather than told, named so the user can correct it before it's baked into ten steps
- What's out of scope, if that's ambiguous

If the request is ambiguous in a way that would change the roadmap (not a cosmetic detail), ask before writing the plan. Don't guess and silently encode the guess as fact in the spec.

### 2. Roadmap
Break the spec into phases. A phase is a coherent chunk of work ending in something checkable, not an arbitrary chop of a to-do list.
- Order phases so later ones depend on earlier ones actually working — don't front-load risk to the end
- Prefer more, smaller phases when there's real uncertainty — a wrong turn gets caught sooner
- A trivial task doesn't need multiple phases — one phase with a handful of tasks is fine

### 3. Test mode
Verification can live in two places. Settle which before writing the gates:
- **`tdd`** — each phase carries its own tests and ends with a test gate, so a wrong turn is caught phase by phase.
- **`deferred`** — implementation phases run no tests; one final Verification phase writes the tests and checks everything at once.

If the user already said which (e.g. "TDD", "test per phase", "test everything at the end"), use it and don't ask again. If not, wait until the implementation roadmap is complete — the answer only changes the verification structure, so don't interrupt earlier — then ask **one** question before writing the file: *"The implementation plan is ready. TDD (tests and a gate per phase) or deferred (build everything, then one verification phase writes the tests and checks all)?"* If you can't ask (non-interactive or running as a subagent), use `deferred` and say so in the Spec's assumptions.

### 4. Verification gates
Every phase ends with at least one gate: a concrete, checkable pass/fail condition — "existing tests pass", "endpoint returns 201 with a valid payload", "migration runs cleanly on a fresh DB". Not "review the code" — that isn't checkable. If a gate can't be stated concretely, the phase is probably too vague and needs breaking down further.

Gates are what let `plan-executor` (or a human) know it's safe to move forward, instead of discovering three phases later that phase 2 was silently broken.

**`tdd` mode:** every phase's gate is its own test run, as above.

**`deferred` mode:** implementation phases contain no task that runs tests, typecheck, lint, or a build, and each ends with `- [ ] **Gate:** deferred → Phase N`, where N is the Verification phase. The last phase is `## Phase N: Verification`: it writes the tests, runs the checks once, and holds all the real gates, each concrete and checkable as above.

## Output contract

Write ONE markdown file with this exact structure. This is machine-parsed by `plan-executor` — do not reformat, rename the gate marker, or use a different checkbox syntax.

```markdown
# Plan: <short title>

## Spec
<goal, assumptions, out-of-scope — prose>

## Phase 1: <name>
- [ ] <concrete task>
- [ ] <concrete task>
- [ ] **Gate:** <checkable condition>

## Phase 2: <name>
- [ ] <concrete task>
- [ ] **Gate:** <checkable condition>
```

For `deferred` mode, the same structure with this shape (implementation phases get a deferred gate; the last phase carries the real ones):

```markdown
## Phase 1: <name>
- [ ] <concrete task>
- [ ] **Gate:** deferred → Phase 3

## Phase 2: <name>
- [ ] <concrete task>
- [ ] **Gate:** deferred → Phase 3

## Phase 3: Verification
- [ ] Write the tests for everything built in Phases 1–2
- [ ] **Gate:** <checkable condition>
- [ ] **Gate:** <checkable condition>
```

Format rules:
- `- [ ]` for every task, including the gate — this is what makes progress trackable and lets execution flip boxes to `- [x]`
- `**Gate:**` prefix, always the last checkbox in its phase
- A phase may have more than one gate only if there are genuinely two independent conditions — don't split one condition into two just to pad the list
- `**Gate:** deferred → Phase N` is not run when reached: the executor leaves it unchecked and ticks all deferred gates once Phase N's gates pass. The Verification phase runs once, after every implementation phase, and not by the agents executing those phases.
- File name: descriptive (`plan-refund-handling.md`), not generic (`plan.md`), whenever the user might have more than one plan around

## After writing

Don't just report "done." Briefly walk the user through the phases and confirm the breakdown and gates look right (and which test mode it uses) before treating the plan as final — that confirmation is the point of writing it down instead of just starting to code.
