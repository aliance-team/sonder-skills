#!/usr/bin/env python3
"""Deterministic checks for a delivery manifest. No LLM involved.

Usage:
  verify_manifest.py delivery.yaml            # pre-build: coverage, graph, tiers, test changes
  verify_manifest.py delivery.yaml --head REF # post-build: also prove the stack head == snapshot

Exit codes: 0 ok | 1 hard error | 2 needs a human decision (protected paths / test weakening)
Requires: python3, pyyaml, git.
"""
import fnmatch, subprocess, sys
import yaml

DEFAULT_PROTECTED = [
    ".github/**", ".githooks/**", "**/vitest.config.*", "**/vite.config.*",
    "**/eslint.config.*", "**/.eslintrc*", "**/phpunit.xml*", "**/pest.php",
    "**/phpstan*.neon*", "**/tsconfig*.json", "**/database/migrations/**",
    "CODEOWNERS", ".github/CODEOWNERS", "AGENTS.md",
]
TEST_GLOBS = ["**/tests/**", "**/*.test.*", "**/*.spec.*", "**/*Test.php"]


def git(*a):
    return subprocess.check_output(["git", *a], text=True).strip()


def match(path, pats):
    """gitignore-style match: a leading '**/' also matches the repo root.

    fnmatch requires the literal '/' inside '**/', so '**/vitest.config.*' would
    miss a root-level vitest.config.ts. Strip the prefix and retry, which is
    what '**/foo' means to git and to CODEOWNERS.
    """
    for p in pats:
        if fnmatch.fnmatch(path, p):
            return True
        if p.startswith("**/") and fnmatch.fnmatch(path, p[3:]):
            return True
    return False


def topo_cycle(units):
    deps = {u["id"]: u.get("depends_on", []) for u in units}
    state, errs = {}, []

    def visit(n, stack):
        if state.get(n) == 2:
            return
        if state.get(n) == 1:
            errs.append("dependency cycle: " + " -> ".join(stack + [n]))
            return
        state[n] = 1
        for d in deps.get(n, []):
            if d not in deps:
                errs.append(f"unit '{n}' depends on unknown unit '{d}'")
            else:
                visit(d, stack + [n])
        state[n] = 2

    for n in deps:
        visit(n, [])
    return errs


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    m = yaml.safe_load(open(sys.argv[1]))
    head = sys.argv[sys.argv.index("--head") + 1] if "--head" in sys.argv else None
    base, snap = m["base"]["sha"], m["snapshot"]["sha"]
    units = m["units"]
    protected = m.get("policy", {}).get("protected_paths", DEFAULT_PROTECTED)

    status = {}
    for line in git("diff", "--name-status", "--no-renames", f"{base}..{snap}").splitlines():
        s, p = line.split("\t", 1)
        status[p] = s
    changed = set(status)

    owners, errors, human = {}, [], []
    for u in units:
        for p in u.get("paths", []):
            owners.setdefault(p, []).append(u["id"])
    overlaps = {o["path"]: o for o in m.get("overlaps", [])}

    for p in sorted(changed - set(owners)):
        errors.append(f"UNASSIGNED: {p}")
    for p in sorted(set(owners) - changed):
        errors.append(f"NOT IN SNAPSHOT DIFF (typo or stale manifest): {p}")
    for p, us in sorted(owners.items()):
        if len(us) > 1:
            o = overlaps.get(p)
            if not o or o.get("decision") != "split-patches":
                errors.append(f"UNDECLARED OVERLAP: {p} in {us} (declare in overlaps with decision split-patches, or colocate)")
    errors += topo_cycle(units)

    for u in units:
        hit = [p for p in u.get("paths", []) if match(p, protected)]
        if hit and u.get("tier") != 2:
            human.append(f"unit '{u['id']}' touches protected paths but tier={u.get('tier')} (must be 2): {hit}")
        if u.get("tier") is None:
            errors.append(f"unit '{u['id']}' has no tier")
        if u.get("deploy_safety") not in ("additive", "flagged", "breaking"):
            errors.append(f"unit '{u['id']}' needs deploy_safety: additive|flagged|breaking")
        if u.get("deploy_safety") == "breaking" and u.get("tier") != 2:
            human.append(f"unit '{u['id']}' is breaking but not tier 2")

    ack = set(m.get("approvals", {}).get("test_changes", []))
    for p, s in sorted(status.items()):
        if match(p, TEST_GLOBS) and s == "D" and p not in ack:
            human.append(f"TEST DELETED without approval entry: {p}")

    if head:
        diff = git("diff", "--name-only", snap, head)
        if diff:
            errors.append("STACK HEAD != SNAPSHOT for:\n  " + diff.replace("\n", "\n  "))

    for e in errors: print("ERROR ", e)
    for h in human: print("HUMAN ", h)
    if errors: sys.exit(1)
    if human: sys.exit(2)
    print(f"OK: {len(changed)} changed paths, {len(units)} units" + (", head == snapshot" if head else ""))


if __name__ == "__main__":
    main()
