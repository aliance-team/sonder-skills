#!/usr/bin/env python3
"""Lint a plan-generator markdown plan against the v1.1 contract.

Deterministic, no LLM, no project commands. Rejects the structural mistakes that
make plan-executor drift, and warns on the two gate-command habits that cost the
most reruns in practice.

Usage:
    python3 plan-lint.py [--quiet] path/to/plan.md
Exit code: 0 = pass (warnings allowed), 1 = errors, 2 = usage/no file.
"""
from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field

PHASE_RE = re.compile(r"^##\s+Phase\s+(\d+)\b(.*)$")
CHECKBOX_RE = re.compile(r"^-\s+\[( |x|X)\]\s+(.*)$")
DEFERRED_RE = re.compile(r"^\*\*Gate:\*\*\s*deferred\s*(?:→|->|-->)\s*Phase\s+(\d+)\s*$")
GATE_RE = re.compile(r"^\*\*Gate:\*\*")
PIPE_TAIL_RE = re.compile(r"\|\s*(tail|head)\b")
VERIFY_WORD_RE = re.compile(r"\bverif", re.IGNORECASE)
# whole-suite runners that take a path/filter to become scoped
BARE_RUNNERS = [
    re.compile(r"\bvitest\s+run\s*$"),
    re.compile(r"\beslint\s+\.\s*$"),
    re.compile(r"\bphp\s+artisan\s+test\s*$"),
    re.compile(r"\bpytest\s*$"),
    re.compile(r"\bnx\s+run-many\b.*--all\b"),
]


@dataclass
class Phase:
    number: int
    title: str
    line: int
    checkboxes: list[tuple[int, str]] = field(default_factory=list)


def parse(text: str) -> tuple[list[Phase], list[tuple[int, str]]]:
    phases: list[Phase] = []
    pre_phase: list[tuple[int, str]] = []  # checkboxes before any phase heading
    current: Phase | None = None
    for i, raw in enumerate(text.splitlines(), start=1):
        m = PHASE_RE.match(raw)
        if m:
            current = Phase(number=int(m.group(1)), title=m.group(2).strip(), line=i)
            phases.append(current)
            continue
        cb = CHECKBOX_RE.match(raw)
        if cb:
            (current.checkboxes if current else pre_phase).append((i, cb.group(2).strip()))
    return phases, pre_phase


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("plan")
    ap.add_argument("--quiet", action="store_true", help="suppress per-check PASS lines")
    args = ap.parse_args()

    try:
        text = open(args.plan, encoding="utf-8").read()
    except OSError as exc:
        print(f"FAIL  cannot read {args.plan}: {exc}")
        return 2

    errors: list[str] = []
    warnings: list[str] = []
    phases, pre_phase = parse(text)

    if pre_phase:
        warnings.append(f"{len(pre_phase)} checkbox(es) outside any phase (line {pre_phase[0][0]}): ignored, move them under a phase")

    if not phases:
        errors.append("no '## Phase N' heading found — not a plan-generator plan")
        return report(errors, warnings, args.quiet)

    by_number = {p.number: p for p in phases}
    deferred_targets: list[tuple[int, int]] = []  # (phase holding gate, target phase)

    for p in phases:
        if not p.checkboxes:
            errors.append(f"Phase {p.number} (line {p.line}) has no '- [ ]' tasks")
            continue
        last_line, last_body = p.checkboxes[-1]
        if not GATE_RE.match(last_body):
            errors.append(f"Phase {p.number}: last checkbox (line {last_line}) is not a '**Gate:**'")
        gate_idx = [j for j, (_, body) in enumerate(p.checkboxes) if GATE_RE.match(body)]
        if gate_idx:
            first_gate = gate_idx[0]
            for j in range(first_gate + 1, len(p.checkboxes)):
                line, body = p.checkboxes[j]
                if not GATE_RE.match(body):
                    errors.append(f"Phase {p.number}: task at line {line} comes after a '**Gate:**' — gates must end the phase")
                    break
        for j, (line, body) in enumerate(p.checkboxes):
            if not GATE_RE.match(body):
                continue
            d = DEFERRED_RE.match(body)
            if d:
                deferred_targets.append((p.number, int(d.group(1))))
            if PIPE_TAIL_RE.search(body):
                warnings.append(f"line {line}: gate piped through tail/head — the pass/fail line can be pushed out of view; redirect to a log instead")
            for rx in BARE_RUNNERS:
                if rx.search(body):
                    warnings.append(f"line {line}: bare whole-suite runner in a gate — prefer the scoped form (single file / related), or confirm discovery first")
                    break

    # deferred-gate structure
    if deferred_targets:
        targets = {t for _, t in deferred_targets}
        missing = sorted(t for t in targets if t not in by_number)
        if missing:
            errors.append(f"'deferred -> Phase N' points at missing phase(s): {missing}")
        for holder, target in deferred_targets:
            tp = by_number.get(target)
            if tp and VERIFY_WORD_RE.search(tp.title):
                continue
            if tp and not VERIFY_WORD_RE.search(tp.title):
                warnings.append(f"deferred gate in Phase {holder} points at Phase {target} ('{tp.title}'), which is not a Verification phase")
            if holder == target:
                errors.append(f"Phase {holder}: deferred gate points at its own phase")
            if tp and holder > target:
                errors.append(f"Phase {holder}: deferred gate points backwards to Phase {target}")
        last = max(by_number)
        for _, target in deferred_targets:
            if target != last:
                warnings.append(f"deferred gate targets Phase {target}, but Phase {last} is the last phase — deferred plans should end in one Verification phase")
                break

    return report(errors, warnings, args.quiet)


def report(errors: list[str], warnings: list[str], quiet: bool) -> int:
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"FAIL  {e}")
    if not quiet and not errors:
        print("PASS  plan matches the v1.1 contract" + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
