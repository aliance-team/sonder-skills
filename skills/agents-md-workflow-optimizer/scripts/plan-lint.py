#!/usr/bin/env python3
"""Lint a plan-generator markdown plan against the v1.2 contract.

Deterministic, no LLM, no project commands. Rejects the structural mistakes that
make plan-executor drift, and warns on the two gate-command habits that cost the
most reruns in practice. Also lints the wave fields (`**Depends on:**`,
`**Files:**`) and the trailing Closeout phase.

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
DEPENDS_RE = re.compile(r"^\*\*Depends on:\*\*\s*(.*)$")
FILES_RE = re.compile(r"^\*\*Files:\*\*\s*(.*)$")
NUMBER_RE = re.compile(r"(\d+)")
PHASE_NUM_RE = re.compile(r"Phase\s+(\d+)", re.IGNORECASE)
CLOSEOUT_RE = re.compile(r"\bcloseout\b", re.IGNORECASE)
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
    depends: list[int] | None = None  # None = not declared (serial fallback)
    files: list[str] = field(default_factory=list)


def parse_depends(raw: str) -> list[int]:
    raw = raw.strip()
    if not raw or raw.lower().startswith("none"):
        return []
    # Per comma-separated token: "Phase N" wins, a bare number is accepted, and
    # a stray digit inside prose ("see issue #2") is not a dependency.
    deps: list[int] = []
    for token in raw.split(","):
        m = PHASE_NUM_RE.search(token)
        if m:
            deps.append(int(m.group(1)))
        elif token.strip().isdigit():
            deps.append(int(token.strip()))
    return deps


def parse_files(raw: str) -> list[str]:
    return [f.strip().strip("`") for f in raw.split(",") if f.strip().strip("`")]


def parse(text: str) -> tuple[list[Phase], list[tuple[int, str]]]:
    phases: list[Phase] = []
    pre_phase: list[tuple[int, str]] = []  # checkboxes before any phase heading
    current: Phase | None = None
    meta_open = False  # wave fields only count directly under the heading
    for i, raw in enumerate(text.splitlines(), start=1):
        m = PHASE_RE.match(raw)
        if m:
            current = Phase(number=int(m.group(1)), title=m.group(2).strip(), line=i)
            phases.append(current)
            meta_open = True
            continue
        if current and meta_open:
            dm = DEPENDS_RE.match(raw)
            if dm:
                current.depends = parse_depends(dm.group(1))
                continue
            fm = FILES_RE.match(raw)
            if fm:
                current.files = parse_files(fm.group(1))
                continue
        cb = CHECKBOX_RE.match(raw)
        if cb:
            if current:
                current.checkboxes.append((i, cb.group(2).strip()))
                meta_open = False
            else:
                pre_phase.append((i, cb.group(2).strip()))
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

    # waves: dependencies must point backwards at existing phases
    for p in phases:
        for dep in p.depends or []:
            if dep == p.number:
                errors.append(f"Phase {p.number}: '**Depends on:**' references itself")
            elif dep not in by_number:
                errors.append(f"Phase {p.number}: '**Depends on:**' references missing Phase {dep}")
            elif dep > p.number:
                errors.append(f"Phase {p.number}: '**Depends on:**' references later Phase {dep} — dependencies only point backwards")

    def deps_of(p: Phase) -> list[int]:
        """Declared dependencies, or the serial fallback: undeclared phases depend on the one before."""
        if p.depends is not None:
            return p.depends
        earlier = [q.number for q in phases if q.number < p.number]
        return [max(earlier)] if earlier else []

    def ancestors(number: int) -> set[int]:
        seen: set[int] = set()
        stack = list(deps_of(by_number[number]))
        while stack:
            dep = stack.pop()
            if dep in seen or dep not in by_number:
                continue
            seen.add(dep)
            stack.extend(deps_of(by_number[dep]))
        return seen

    def overlap(a: str, b: str) -> bool:
        a, b = a.rstrip("/"), b.rstrip("/")
        return a == b or a.startswith(b + "/") or b.startswith(a + "/")

    for x, left in enumerate(phases):
        for right in phases[x + 1 :]:
            shared = [(fa, fb) for fa in left.files for fb in right.files if overlap(fa, fb)]
            if not shared:
                continue
            if right.number in ancestors(left.number) or left.number in ancestors(right.number):
                continue
            warnings.append(
                f"Phase {left.number} and Phase {right.number} both own '{shared[0][0]}' but neither depends on the other — they cannot share a wave"
            )

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

    # closeout: the trailing phase that retires the plan and its docs
    last_phase = phases[-1]
    closeout = last_phase if CLOSEOUT_RE.search(last_phase.title) else None
    if closeout is None:
        warnings.append("plan has no trailing '## Phase N: Closeout' phase — nothing retires the plan or writes its reference doc")
    end = max(by_number)
    if closeout is not None:
        others = [n for n in by_number if n != closeout.number]
        end = max(others) if others else end

    # deferred-gate structure
    if deferred_targets:
        targets = {t for _, t in deferred_targets}
        missing = sorted(t for t in targets if t not in by_number)
        if missing:
            errors.append(f"'deferred -> Phase N' points at missing phase(s): {missing}")
        for holder, target in deferred_targets:
            tp = by_number.get(target)
            if tp and tp is closeout:
                errors.append(f"Phase {holder}: deferred gate targets the Closeout phase — defer to the Verification phase instead")
            elif tp and not VERIFY_WORD_RE.search(tp.title):
                warnings.append(f"deferred gate in Phase {holder} points at Phase {target} ('{tp.title}'), which is not a Verification phase")
            if holder == target:
                errors.append(f"Phase {holder}: deferred gate points at its own phase")
            if tp and holder > target:
                errors.append(f"Phase {holder}: deferred gate points backwards to Phase {target}")
        for _, target in deferred_targets:
            if target != end:
                warnings.append(f"deferred gate targets Phase {target}, but Phase {end} is the last implementation phase — deferred plans should end in one Verification phase")
                break

    return report(errors, warnings, args.quiet)


def report(errors: list[str], warnings: list[str], quiet: bool) -> int:
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"FAIL  {e}")
    if not quiet and not errors:
        print("PASS  plan matches the v1.2 contract" + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
