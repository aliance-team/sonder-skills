---
name: ops-daily-report
description: >
  Generate a concise daily standup report in Spanish from git commit history.
  Use when the user asks for "daily report", "reporte diario", "today's report",
  "commit report", "what I did today", "gen report", or any request to summarize
  the day's changes. Output is a title plus a listing grouped by project, not a
  verbose changelog.
---

# Daily Report — Standup Style

Generate an ultra-compressed report in Spanish from today's git commits. The
result is a **title and a listing grouped by project** — nothing else.

## Scope

The report covers **only the repository in scope** — by default, the git
top-level of the session's working directory. Never read outside it.

- **Default scope is the current project.** Do not enumerate parent or sibling
  directories, do not scan the workspace root (`~/scaem/*`), and do not open any
  other repository to check whether something else was committed today.
- **Widen the scope only when the user names the other projects in the current
  request** (e.g. "including api", "revisa también cobranza", "all of
  ~/scaem"). Their words define the boundary; nothing else does. A previous
  report, a past habit, or a repository you happen to know about is not consent.
- One block per project inside that scope. Never mix commits from two projects
  inside one block.
- Label each block with the name the user uses for that project
  (`dataemergencia.com`, `api`, `cobranza`, …).
- A worktree, clone, or branch checkout of the same remote is the **same**
  project — merge its commits, never report it as a second block.
- Skip projects with no commits today. If nothing was committed in scope, say
  exactly that — do not invent work to fill the report, and do not pad it with
  work from repositories outside the scope.

## Process

### 1. Gather Commit Data

Resolve the in-scope repository first and log inside it only:

```bash
git rev-parse --show-toplevel
git log --oneline --since="YYYY-MM-DD 00:00:00" --until="YYYY-MM-DD 23:59:59" \
  --no-merges --format="%h %s"
```

Use today's date. Do not pass extra paths, and do not run `git log` in any
directory outside the scope resolved above.

### 2. Group by Project

Bucket the commits by project, then order the blocks the way the day happened.
A project appears once, even if its commits came from several branches.

Projects are derived from what you actually read inside the scope: a standalone
repository is a single block, and a monorepo may split into blocks along its
`apps/<name>` or `libs/<name>` directories. Never add a block whose commits sit
outside the scope — if you did not read it, it is not in the report.

### 3. Compress Into Features

Group related commits into logical features. For each feature, write ONE line:
what was done and why it matters. No implementation details, no jargon.

**Distillation rule:** If you need more than 200 characters to explain a
feature, you're including implementation details. Cut to the essence.

### 4. Write the Report

Use this **exact** shape:

```
# Reporte de Carlos — <Month in Spanish> <Day>, <Year>

Pendientes
- <open item>.
- <open item>.

1. ✅ <project> - <Feature>: <what it does and why it matters>.
2. ✅ <project> - <Feature>: <what it does and why it matters>.

1. ✅ <project> - <Feature>: <what it does and why it matters>.
2. ✅ <project> - <Feature>: <what it does and why it matters>.
```

**Rules:**
- Title first, nothing before it. No greeting, no preamble, no sign-off, no
  "Saludos, Carlos". The report ends on the last item.
- Listing only: no commit hashes, counts, percentages, or technical details.
- Numbering restarts at 1 in each project block; blocks separated by one blank
  line. Every item of a block uses the same project label.
- Format is intended for plain text / WhatsApp: never add backslashes (`\`) or
  HTML comments (`<!-- -->`), write standard numbers (`1.`, `2.`).
- `Pendientes` is optional and comes before the blocks, as plain bullets
  without numbers. Include it only when real work is left open — never invent
  pending items.
- Fixed bugs are ordinary ✅ items under their project. There is no separate
  "Bugs corregidos" section.
- Max 200 chars per line including prefix — if you need more, compress harder.
- Plain Spanish, no English jargon unless unavoidable.
- No sub-bullets, no nested lists.

### 5. Month Names in Spanish

enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre,
noviembre, diciembre

### 6. Output

Output directly in the chat response. Do NOT write to a file or create a commit.

### Example Output

Default scope, one repository — a single block:

```
# Reporte de Carlos — Octubre 30, 2026

Pendientes
- Ejecutar el plan de checkout al API y el retiro completo de tarjetas.

1. ✅ dataemergencia.com - Limpieza de tarjetas: se retiró código de tarjetas sin uso junto con sus pruebas.
2. ✅ dataemergencia.com - Planes de migración: quedó documentado el traspaso de base de datos al API.
```

Additional blocks appear only when the user explicitly asked to include those
projects in this request. Without that instruction, one project in scope means
one block.
