---
name: test-vitest
description: >
  Expert in Vitest testing for JavaScript/TypeScript frontends and backends.
  Activates when writing tests, debugging failures, implementing TDD,
  working with React components, hooks, services, or when the user mentions
  Vitest, Jest, testing-library, unit test, component test, mock, spy,
  coverage, snapshot, E2E, Playwright, or needs to verify frontend logic.
  Also when configuring vitest.config, vite.config, or test infrastructure.
  CRITICAL: Never writes fake tests — always tests real behavior.
---

# Vitest Testing Expert

> **Core**: 500 lines — always loaded. **Detailed guidance** below the divider — load on demand.

## Core Philosophy

**Test behavior, not implementation.** A test that breaks when you refactor internals without changing behavior is a liability. Every test must prove something a user or system would notice if it broke.

| Test This | Skip This |
|-----------|-----------|
| Business logic, component rendering, user interactions, API services, hook state transitions, error states, edge cases | Framework internals, library wrappers, generated code, trivial getters/setters, config values |

## Quick Reference

| Concept | Rule |
|---------|------|
| Runner | Vitest (never Jest for new projects) |
| Structure | `describe()` / `it()` / `expect()` |
| Component testing | `@testing-library/react` — `getByRole` first, `getByTestId` last |
| Mocking | `vi.fn()`, `vi.mock()`, `vi.spyOn()` — hoisted automatically |
| Async | `findBy*`, `waitFor`, native async/await |
| Coverage | v8 provider, enforce minimum thresholds |
| E2E | Playwright in separate `e2e/` dir |
| Config | `globals: true`, `environment: 'jsdom'`, `setupFiles` |

## Installation & Configuration

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

### Config (in `vitest.config.ts` or inline in `vite.config.ts`)

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{js,ts,jsx,tsx}'],
    exclude: ['**/node_modules/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: { branches: 80, functions: 80, lines: 80 },
    },
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```

### Setup File

```typescript
// src/test-setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(() => cleanup());
```

### Running Tests

```bash
pnpm vitest              # Watch mode (default)
pnpm vitest run          # Single run (CI)
pnpm vitest run --coverage
pnpm vitest run --testNamePattern="renders with"
# In monorepo (Nx):
pnpm nx run scaem.app:vitest
pnpm nx run shared:test
```

## Test Organization

```
src/
├── components/Button.tsx
├── components/__tests__/Button.test.tsx   # Co-located in __tests__/
├── hooks/useAuth.ts
├── hooks/useAuth.test.ts                  # Side-by-side
├── services/api.ts
├── services/__tests__/api.test.ts         # Co-located
└── utils/format.test.ts
```

**Conventions from this codebase:**
- `__tests__/` subdirectory with `pure/`, `dom/`, `integration/` sub-folders (scaem.app)
- `.test.ts` / `.test.tsx` side-by-side with source (nexovial.net)
- `.spec.tsx` side-by-side for shared lib components (libs/shared)
- Playwright E2E in `e2e/` root directory (nexovial.net)

## Writing Tests

### Basic Structure

```typescript
import { describe, it, expect } from 'vitest';

describe('calculateTotal', () => {
  it('sums item prices correctly', () => {
    const items = [{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }];
    expect(calculateTotal(items)).toBe(25);
  });
  it('returns 0 for empty cart', () => {
    expect(calculateTotal([])).toBe(0);
  });
});
```

### Key Matchers

| Matcher | Use Case |
|---------|----------|
| `toBe(value)` | Strict equality (`===`) |
| `toEqual(value)` | Deep equality (objects, arrays) |
| `toBeNull()` / `toBeUndefined()` / `toBeDefined()` | Null/undefined checks |
| `toBeGreaterThan(n)` / `toBeLessThan(n)` | Numeric comparisons |
| `toContain(item)` | Array/string inclusion |
| `toHaveLength(n)` | Array length |
| `toMatch(regex)` | String pattern |
| `toThrow(error)` | Exception testing |
| `toMatchObject({})` | Partial object matching |
| `not.toBeNull()` | Negation |

## Component Testing (React Testing Library)

### Query Priority (highest to lowest)

1. `getByRole` — accessible semantic queries
2. `getByLabelText` — form fields with labels
3. `getByPlaceholderText` — input placeholders
4. `getByText` — visible text
5. `getByDisplayValue` — current form values
6. `getByTestId` — **last resort** only

### Patterns

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

// Basic render + assert
it('renders with text', () => {
  render(<Button>Click me</Button>);
  expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
});

// Click interaction (prefer userEvent over fireEvent)
it('calls onClick when clicked', async () => {
  const handleClick = vi.fn();
  render(<Button onClick={handleClick}>Click</Button>);
  await userEvent.click(screen.getByRole('button'));
  expect(handleClick).toHaveBeenCalledTimes(1);
});

// Loading state
it('is disabled when loading', () => {
  render(<Button loading>Save</Button>);
  expect(screen.getByRole('button')).toBeDisabled();
});
```

### Async Queries

```typescript
// Wait for element to appear
const alert = await screen.findByRole('alert');
expect(alert).toHaveTextContent('Saved');

// Wait for element to disappear
await waitForElementToBeRemoved(() => screen.queryByText('Loading...'));

// General wait
await waitFor(() => {
  expect(screen.getByRole('status')).toHaveTextContent('Done');
});
```

### Hook Testing

```typescript
import { renderHook, act } from '@testing-library/react';

it('increments counter', () => {
  const { result } = renderHook(() => useCounter(0));
  act(() => result.current.increment());
  expect(result.current.count).toBe(1);
});
```

## Mocking

### `vi.fn()` — Function Mocks

```typescript
const mockFn = vi.fn();
mockFn('hello');
expect(mockFn).toHaveBeenCalledWith('hello');
expect(mockFn).toHaveBeenCalledTimes(1);

vi.fn().mockReturnValue('default');
vi.fn().mockResolvedValue(Promise.resolve('async'));
vi.fn().mockRejectedValue(new Error('fail'));
```

### `vi.mock()` — Module-Level Mocking

```typescript
// Fully hoisted (factory can't reference outer scope)
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));
vi.mock('../services/api', () => ({ fetchReports: mockFn }));

// Partial mock
vi.mock(import('../utils/format'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, formatDate: vi.fn(() => '2026-01-15') };
});
```

### `vi.spyOn()` — Spy on Existing Methods

```typescript
const spy = vi.spyOn(service, 'fetch');
spy.mockResolvedValue({ data: [] });
const result = await service.getReports();
expect(spy).toHaveBeenCalledWith('/api/reports');
spy.mockRestore(); // Clean up
```

### `vi.stubGlobal()` — Mock Globals

```typescript
vi.stubGlobal('fetch', vi.fn());
fetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
vi.unstubAllGlobals(); // Clean up
```

### Fake Timers

```typescript
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('debounces input', () => {
  const handler = vi.fn();
  const debounced = debounce(handler, 300);
  debounced(); debounced(); debounced();
  expect(handler).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(handler).toHaveBeenCalledTimes(1);
});
```

**Critical rule**: `vi.mock` factory cannot reference outer scope variables directly. Use `vi.hoisted()` to lift values.

---

<!-- ======================================================================== -->
<!-- DETAILED GUIDANCE — load on demand when deeper reference is needed -->
<!-- ======================================================================== -->

## Detailed Guidance (Load on Demand)

### All Vitest Matchers

```typescript
// Values
expect(value).toBe(1);           // Object.is strict
expect(value).toEqual({a: 1});   // Deep equality
expect(value).toBeNull();
expect(value).toBeUndefined();
expect(value).toBeDefined();
expect(value).toBeTruthy();
expect(value).toBeFalsy();
expect(value).toBeNaN();

// Numbers
expect(value).toBeGreaterThan(5);
expect(value).toBeGreaterThanOrEqual(5);
expect(value).toBeLessThan(5);
expect(value).toBeLessThanOrEqual(5);
expect(value).toBeCloseTo(0.3, 5); // Float precision

// Strings
expect(value).toContain('hello');
expect(value).toMatch(/^hello/);
expect(value).toHaveLength(5);

// Arrays
expect(value).toContain('item');
expect(value).toHaveLength(3);
expect(value).toContainEqual({a: 1});

// Objects
expect(value).toHaveProperty('key');
expect(value).toHaveProperty('key', 'value');
expect(value).toMatchObject({partial: 'match'});

// Exceptions
expect(() => { throw new Error('fail'); }).toThrow();
expect(() => { throw new Error('fail'); }).toThrow('fail');
expect(() => { throw new Error('fail'); }).toThrow(Error);

// Snapshots
expect(value).toMatchSnapshot();
expect(value).toMatchInlineSnapshot();
```

### Testing Errors

```typescript
it('displays error on API failure', async () => {
  vi.spyOn(api, 'fetchUser').mockRejectedValue(new Error('Network error'));
  render(<UserProfile userId={42} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/network error/i);
});
```

### Testing Context Providers

```typescript
it('toggles theme', () => {
  render(
    <ThemeProvider initialTheme="dark">
      <TestComponent />
    </ThemeProvider>
  );
  expect(screen.getByTestId('theme')).toHaveTextContent('dark');
});
```

### Testing Stores (Zustand)

```typescript
beforeEach(() => useStore.setState(initialState));
it('adds item', () => {
  useStore.getState().addItem({ id: 1 });
  expect(useStore.getState().items).toHaveLength(1);
});
```

### E2E Testing (Playwright)

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8000', headless: true },
  webServer: process.env.CI ? {
    command: 'npx vite --port 5174', port: 5174, timeout: 30000,
  } : undefined,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

```typescript
test('shows and dismisses modal', async ({ page }) => {
  await page.goto('/reports');
  await page.getByRole('button', { name: /cache/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
```

### Vitest in CI

```yaml
# GitHub Actions sharding
strategy:
  matrix:
    shardIndex: [1, 2, 3, 4]
    shardTotal: [4]
steps:
  - run: vitest run --reporter=blob --shard=${{ matrix.shardIndex }}/${{ matrix.shardTotal }}
  - uses: actions/upload-artifact@v4
```

### Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| `getByTestId` as default query | Use `getByRole` for accessibility |
| Testing internal state | Test what user sees, not `component.state()` |
| Over-mocking | Mock only at system boundaries (API, browser APIs) |
| Large snapshots for components | Explicit assertions on what matters |
| `fireEvent` when `userEvent` works | Prefer `userEvent` for realistic interaction |
| `toBeDisabled` on non-interactive elements | Assert on actual button, not text |
| `vi.mock` referencing outer scope | Use `vi.hoisted()` to lift values |
| Snapshot races in `test.concurrent` | Keep snapshots sequential |

### Project-Specific (DataEmergencia)

| App | Location | Pattern | Tech |
|-----|----------|---------|------|
| `scaem.app` | `app/resources/js/**/__tests__/**/*.test.js` | `pure/`/`dom/`/`integration/` subdirs | Vitest 4.1.7, jsdom |
| `nexovial.net` | `resources/js/**/*.test.{ts,tsx}` | Side-by-side with src | Vitest 4.1.7, RTL, Playwright |
| `nexovial.net` | `e2e/*.spec.ts` | E2E in separate dir | Playwright |
| `libs/shared` | `src/**/*.spec.tsx` | Side-by-side spec files | Vitest 4.1.7, RTL |
| `carnets.qrnet.app` | `resources/js/**/*.test.ts` | Side-by-side | Vitest 4.1.7 |

**Common config across all apps**: `globals: true`, `environment: 'jsdom'`, `coverage.provider: 'v8'`.
