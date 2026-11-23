# Scope catalog and doc template

Create a doc only when the repo shows evidence. Name files in UPPERCASE: `docs/<SCOPE>.md`.

| Scope         | Evidence to look for                    | Typical contents                                                 |
| ------------- | --------------------------------------- | ---------------------------------------------------------------- |
| ARCHITECTURE  | multiple apps/services, layered folders | Domain concepts, boundaries, data flow (capabilities, not paths) |
| TYPESCRIPT    | `tsconfig.json`, eslint ts rules        | Strictness, type vs interface, error handling patterns           |
| REACT         | `react` dep, component folders          | Component patterns, state, data fetching, styling approach       |
| LARAVEL / PHP | `artisan`, `composer.json`              | Controllers vs actions/services, validation, Eloquent patterns   |
| PYTHON        | `pyproject.toml`                        | Typing, formatting, project layout                               |
| TESTING       | jest/vitest/pest/pytest config          | Runner, single-test command, fixtures, what to mock              |
| API           | routes, OpenAPI, GraphQL schema         | Naming, error format, versioning, auth                           |
| DATABASE      | migrations, ORM config                  | Migration rules, naming, seeding, multi-tenancy                  |
| GIT           | commit hooks, CI, CONTRIBUTING          | Branching, commit style, PR checks                               |
| BUILD         | bundler config, Dockerfile, CI          | Build pipeline, env vars, release steps                          |

## Doc template

```markdown
# <Scope> conventions

<One line: when this doc applies.>

## Rules

- <Specific, verifiable rule>. Why: <short reason>.

## Examples

<Short good/bad snippet from the repo's own style.>

## Related

- See docs/<OTHER>.md for <topic>
- External: <official spec or docs URL>
```

## Quality bar per rule

Keep a rule only if it is (1) specific enough to check, (2) not something the model already does by default, (3) true today in the repo. Prefer the real-life example over abstract advice.
