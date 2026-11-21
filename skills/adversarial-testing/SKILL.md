---
name: adversarial-testing
description: Use this skill when defining or running test gates in a plan — "adversarial testing", "property-based testing", "fuzzing", "try to break this code", hardening a Verification phase, or when a gate that says "tests pass" is not enough evidence. Defines the three-strategy flow (fresh-context adversarial review, generated-invariant properties, malformed-input fuzzing), the selection rules for which strategy applies, and the exact gate lines plan-generator must emit. Loaded by plan-generator when it writes gates and by plan-executor when it runs them.
license: MIT
metadata:
  pairs_with: plan-generator, plan-executor
  output_type: test-gates
  contract_version: "1.0"
---

# Adversarial Testing

A test that was written by the same agent that wrote the code answers the question "does this do what I meant?" It never answers "what does this do that I did not intend?" Adversarial testing is the second question, asked three ways: a hostile reviewer, generated inputs, and malformed inputs.

## When to use me

- `plan-generator` is writing gates and the phase has logic beyond wiring.
- `plan-executor` reached a gate carrying one of the three gate lines below.
- The user asks to harden, stress, break, or verify a change rather than just test it.

Each strategy below is a run, not a review: it produces a pass/fail with an artifact (findings list, failing seed, crashing input) that the gate reads.

## Strategy 1 — Adversarial review

A second agent with different rules tries to break the first agent's code.

**Fresh context is the point.** Run it as a subagent that never sees the implementer's reasoning, plan, or self-assessment — those rationalise the bug. Give it only the diff or the full changed files, plus the spec and the acceptance criteria.

**Rules for the reviewer:**
- Assume the code is wrong; your job is to show where.
- Hunt edge cases, invariant breaks, security holes, concurrency and ordering, error paths, partial failures, and resource leaks.
- Every finding needs a concrete failing input or a numbered reproduction path. A finding without one is dropped, not softened.
- Severity: **P0** data loss, security, corruption; **P1** wrong result or crash on a realistic path; **P2** wrong result on an unlikely path; **P3** style and hygiene.

**Model:** prefer a different model than the implementer. Same-family agreement is the blind spot you are trying to escape.

**Completion criterion:** every finding has a severity and a repro, and every P0/P1 has been either fixed or explicitly dispositioned by the user. Each confirmed finding becomes a regression test that fails before the fix and passes after.

Ready-to-paste prompt:

```
Review this change adversarially. You did not write it and should assume it is
wrong. You get the diff and the spec only — no author explanation.

Goal: find real defects, not style opinions.

Hunt: edge cases, broken invariants, security (authz, injection, path traversal),
concurrency and ordering, error paths, partial failure, unbounded growth.

Rules:
- Every finding: severity P0-P3, the file:line, and a concrete input or numbered
  repro path that makes it fail. No repro, no finding.
- Rank by severity, hardest-hitting first.
- End with: SHIP or DO NOT SHIP.

Diff:
<diff>

Spec and acceptance criteria:
<spec>
```

## Strategy 2 — Property-based testing

State one general rule the code must satisfy, then generate thousands of odd inputs that try to violate it. The generator finds the input you would never type; shrinking reduces it to the smallest failing case.

**Invariants worth trying, in order of payoff:**

| Shape | Claim |
| --- | --- |
| Round-trip | `decode(encode(x)) == x` |
| Idempotence | `f(f(x)) == f(x)` |
| Preserved invariant | total, sortedness, uniqueness, balance, checksum survive the operation |
| Oracle | the fast implementation agrees with a slow, obviously correct one |
| Never throws on valid input | any well-typed value returns a value, not an exception |

**Run it:** default **N ≥ 1000** generated cases. Pin a **fixed seed** so a red gate reproduces and a green gate is not luck. Let the library shrink the first failure, then **pin that shrunk case as an ordinary example test** in the suite — the property guards the general rule, the pinned example names the bug in one line and survives a shrinking or seed regression.

**Tooling:** JS/TS — `fast-check` with Vitest (`fc.assert(fc.property(...))`); PHP — `giorgiosironi/eris` or a generator loop inside Pest/PHPUnit; Python — Hypothesis.

**Completion criterion:** the invariant holds for N generated inputs at a fixed seed, the property is committed alongside its pinned failing example, and a deliberately broken implementation makes it go red.

## Strategy 3 — Fuzzing

Send large volumes of random or malformed input until something throws, hangs, or returns the wrong class of response. Property tests ask "is the rule true?"; fuzzing asks "does it survive garbage?"

**Targets:** parsers, request handlers, form and QR payloads, file uploads, deserializers, anything that touches user-shaped input.

**Inputs to throw:** malformed JSON, oversized strings (1 MB keys, 10k-deep nesting), wrong types (`null`, number where string expected, array where object expected), unicode and control characters, injection payloads (SQL, shell, path traversal, template), truncated and binary data.

**Pass:** no uncaught exception, no 5xx, no crash or hang inside a stated time budget. Record the seed and every crashing input as a **regression fixture** in the suite.

**Completion criterion:** N malformed inputs against the target with a clean pass or every crash captured as a fixture, and the time budget stated in the plan.

## Which strategy, when

| Situation | Strategy |
| --- | --- |
| Every non-trivial diff | adversarial review |
| Pure functions, codecs, serializers, reducers, validators | property |
| Input boundaries: parsers, handlers, payloads, uploads | fuzz |
| `deferred` mode Verification phase | **all three** |
| `tdd` mode phase gate with logic | review + whichever of property/fuzz the phase owns |

All three are the default for a Verification phase. A strategy is skipped only by writing a one-line reason into the plan next to that phase's gates, e.g. `property skipped: phase adds no pure function`. Silence is not a skip.

## Gate contract

plan-generator emits these lines **verbatim**; plan-executor runs them. Do not reword, reorder the placeholders, or drop the marker.

```markdown
- [ ] **Gate:** adversarial review → no P0/P1 findings open
- [ ] **Gate:** property: <invariant> holds over <N> generated inputs
- [ ] **Gate:** fuzz: <target> survives <N> malformed inputs with no uncaught exception
```

Substitute real values for the placeholders (`<invariant>`, `<N>`, `<target>`); the surrounding words are fixed.

## Running the gates

The three run **concurrently**: dispatch the review subagent, then start the property suite and the fuzz suite in parallel in the same turn. They share no state, and the review is usually the long pole.

Behavioural tests assert **observable behaviour only** — a return value, a status code, a thrown error, a database row, a rendered string. Never a stylesheet, a `style` attribute, or a presentational class name; those break on every intentional restyle. The one exception is rendered email HTML, where the inline CSS *is* the observable output.

Shell is **zsh**. Run each check as `cmd > log 2>&1; echo EXIT=$?` and read the exit code, then read the log when it fails. Never pipe a check through `tail` or `head` — a banner line pushes the real result out of the window.

**Completion criterion for the whole skill:** every gate line for the phase is ticked or explicitly failed with its artifact attached — findings list, failing seed, or crashing input — and no gate is ticked on a green that was never actually observed.
