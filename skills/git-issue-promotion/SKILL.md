---
name: git-issue-promotion
description: Promote a deferred docs/issues entry into a GitHub Issue through a fixed developer gate. Use before any `gh issue create`, when asked to "create an issue", "file a ticket", "open a GitHub issue", "promote this", "add this to the backlog", or when triaging a docs/issues entry. Runs one batch of gate questions; deletes the local file in the same change so only one tracker exists.
---

# Issue promotion

A backlog entry becomes a GitHub Issue only after it passes the **gate**. The gate exists because a vague issue is worse than no issue: it costs a teammate a triage cycle and teaches them to ignore the tracker.

**One tracker per item.** `docs/issues/` is sketch paper; the GitHub Issue is the commitment. When the issue exists, the local file is deleted in the same change. Two lists that disagree are worse than one list.

## When this applies

- A defect, gap, or decision was found and deliberately deferred.
- A `docs/issues/*.md` entry should reach the team.
- Someone says "create an issue" for work that is not yet scheduled and owned.

Already-scheduled, already-owned work is a commitment, not backlog: create the issue directly. The gate still applies to anything that will sit unowned.

## Step 1 — Ground the entry

From the repository root:

```bash
git rev-parse --show-toplevel
ls docs/issues 2>/dev/null
```

**Done when:** you know the repo root, the exact entry path, and whether `.github/ISSUE_TEMPLATE/backlog.md` exists.

If `docs/issues/` does not exist, ask the developer whether this repo uses it before creating it. If the entry does not exist, draft it:

- File: `docs/issues/<area>-<short-slug>.md`
- First line: `# <Title>` — this becomes the issue title
- Sections: **What is wrong**, **Why it matters**, **How to reproduce**, **Definition of done**

Keep secrets, credentials, customer data, and internal-only URLs out of both the file and the issue.

## Step 2 — Run the gate

Ask every question below in **one batch**, numbered, each with your proposed answer. Use the `question` tool when available; otherwise send one numbered message. Wait for the developer's replies.

Do not run `gh issue create` until every answer is in and the developer explicitly approves creating the issue.

| # | Question | Blocks promotion when… |
|---|---|---|
| 1 | Is this still open? | already fixed, or `git log` shows the fix landed |
| 2 | Is it already tracked? | an open issue or existing entry covers it |
| 3 | Who owns it? | no owner and no decision to leave it unowned |
| 4 | Is it deferred or blocking? | it blocks current work — fix now, or schedule it with a milestone |
| 5 | Who is affected, and what breaks if it is never fixed? | impact is cosmetic with no consequence |
| 6 | How is it reproduced, or what is the evidence? | neither steps nor evidence exists |
| 7 | What is the definition of done? | a reviewer cannot check it |
| 8 | Is this one issue or several? | the scope hides independent items |
| 9 | Is it safe to publish? | it contains secrets, credentials, or customer data |
| 10 | Which repo, labels, assignee, milestone, project? | no target repo, or a label that does not exist |
| 11 | Delete the local entry after creating the issue? | the developer wants to keep it; record why |

Defaults for Q10: current `origin`, labels `backlog` and `needs-triage`, no assignee, no milestone, no project unless named.

Also check for duplicates before asking Q2:

```bash
gh issue list --state open --search "<keywords from the title>" --limit 10
```

**Done when:** Q1–Q9 are answered, Q9 is "safe", and the developer has approved creation. If any answer blocks, keep the entry local, record the blocking answer in the file, and stop. A blocked gate is a successful outcome.

## Step 3 — Preflight the tracker

```bash
gh auth status
gh repo view --json nameWithOwner,hasIssuesEnabled
gh label list --limit 100
```

**Done when:** authenticated, issues enabled, target repo known, and every label you will pass already exists.

Create a missing label only after the developer agrees:

```bash
gh label create backlog --force --color ededed \
  --description "Deferred work that is not yet scheduled, owned, or prioritised"
```

## Step 4 — Create the issue

Promote the named entry. Resolve "the latest" by modification time only when the developer says "the latest":

```bash
ENTRY=docs/issues/<area>-<slug>.md

gh issue create \
  --title "$(head -n1 "$ENTRY" | sed 's/^# *//')" \
  --body-file "$ENTRY" \
  --label backlog --label needs-triage
```

Add `--repo`, `--assignee`, `--milestone`, or `--project` only when the gate named them. `gh` does not apply `.github/ISSUE_TEMPLATE`; the body comes from the file, so keep the file's sections equal to the template's.

**Done when:** the command prints an issue URL and you have recorded its number.

## Step 5 — Close the local loop

```bash
git rm "$ENTRY"   # use rm if the entry was never committed
```

Commit only when the developer asked for a commit: one file, one commit, following the repo's git-atomic-commit workflow.

**Done when:** the entry is gone from `docs/issues/` and no other entry describes the same item.

## Step 6 — Report

Give the issue URL, labels, owner, definition of done, and the file deleted. If the gate blocked, report which question blocked it and what the entry is waiting on.

## Failure modes

- **Zombie entry** — issue created, local file kept. The folder becomes a list of done work and stops being trusted. Delete it in the same change.
- **Vague issue** — no reproduction and no checkable done. The gate blocks it or it does not exist.
- **Hidden scope** — three independent fixes in one issue. Split at Q8.
- **Secret leak** — customer data in the body. Q9 is a hard stop.
- **Duplicate tracker** — the file keeps being edited after the issue exists. Edit the issue instead.
- **Wrong repo** — `gh` targets the current remote. In a monorepo, pass `--repo` when the issue belongs elsewhere.

## Project-agnostic defaults

The skill assumes `docs/issues/` at the repo root and the labels `backlog` and `needs-triage`. Read `.github/ISSUE_TEMPLATE/backlog.md` for the repo's real defaults and use those when they differ. In a monorepo, resolve the root first and pass `--repo` when needed.
