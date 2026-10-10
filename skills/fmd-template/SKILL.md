---
name: fmd-template
description: >
  Onboard a new FMD tenant (client brand reskin) onto the zur.dataemergencia.com PHP
  platform in a single session. Use when adding a client FMD template/tenant, cloning an
  existing tenant such as insulmed, wiring brand colors and assets, editing the two
  registration whitelists, or creating the `empresas` row. Covers the exact per-tenant
  file set, the `getBranding()` alias/override recipe, the routing chain, and verification.
---

# FMD Template — New Tenant Onboarding

The platform renders one FMD (Ficha Médica Digital) per tenant. A tenant is a brand skin
over the shared FMD anatomy: the same sections, layouts, and modules, with the client's
colors, logos, banners, and stylesheet. This skill reproduces, from a client code plus a
palette and assets, the whole file set and DB row — no guessing.

Reference implementation to copy: **insulmed** (`qr/fmd/business-controllers/insulmed.php`
and its siblings). A pure brand reskin (no plans/affiliates/payments) is insulmed minus its
plan/affiliate code — see **gonzid** for that reduced shape.

## Architecture map — every file a tenant owns

| Purpose | Path |
|---|---|
| Tenant data + branding + template selection | `qr/fmd/business-controllers/<client>.php` |
| Page composition | `qr/fmd/templates/<client>.php` |
| Dynamic CSS variables (from DB, PHP) | `qr/fmd/templates/css-variables/<client>-vars.css.php` |
| Module list (only if it diverges) | `qr/fmd/templates/cuerpo-fie-<client>.php` |
| Static tenant CSS | `assets/css/empresas/<client>/<client>.css` |
| Brand assets | `assets/images/fmd/empresas/<client>/` |
| Optional plan/affiliate fields | `qr/fmd/templates/configs/<client>-form.php` |

> **Deprecated path:** `qr/fmd/templates/empresas-templates-stylesheets/<client>-stylesheets.php`
> is the legacy per-tenant stylesheet. New tenants use the `css-variables/` partial plus the
> `assets/css/empresas/<client>/` static stylesheet instead. Do not add new stylesheets there.

## Routing chain

1. `qr/fmd/fmdmodel.php` computes `$display = getCompanyDisplayMode($_SESSION['qr']['empresa'])`
   from `qr/config/fmd-display.php`.
2. `buscarEmpresa($_SESSION['qr']['empresa'])` reads the `empresas` row (`mysqli_fetch_assoc`).
3. If `modelo_fmd === 'pre-jvc'`, it requires `business-controllers/fmdmodelempresa.php`;
   otherwise it requires `business-controllers/<modelo_fmd>.php`.
4. The controller calls `BusinessControllerHelper::getStudentData()`,
   `getBranding($_empresa, $detect, $overrides)`, `getTemplate($_empresa, $producto_autonomo)`,
   then `require`s `templates/<plantilla>.php`.
5. The template pulls in `header.php`, the `<client>-vars.css.php` partial (unicode `:root`),
   `controles-fie.php`, `components/banner.php`, `components/emergency-buttons.php`, links the
   static `<client>.css` via `versionedAsset()`, and renders `layouts/personal-data.php` plus the
   shared `cuerpo-fie.php` (or `cuerpo-fie-corto.php` in short mode).

`getTemplate()` resolution order:

1. `plantilla_fmd` if non-empty (explicit override).
2. `force_single_template` contains `cod_empresa` → return `modelo_fmd`.
3. `producto_autonomo === true` → `autonomo-<modelo_fmd>`; otherwise `<modelo_fmd>`.

Because of step 3, the client **must** be in `force_single_template`, or any autónomo/student
context will ask for `autonomo-<client>.php`, which does not exist.

## Branding — `getBranding()` aliases and the override recipe

`BusinessControllerHelper::getBranding()` is shared and **must not be edited**. It derives some
locals from cross-cutting aliases, so for a tenant whose five DB colors differ you correct them
through the `$overrides` argument (or, for `color_encabezado`/`color_cargo`, the DB value already
wins when non-empty).

| Local (`$branding[...]`) | Source |
|---|---|
| `emp_nombre` | `nombre` |
| `emp_logo` | `logo_fmd` if non-empty, else `logo` |
| `emp_banner` | `banner`; replaced by `banner_mobile` on mobile when non-empty |
| `emp_banner_mobile` | `banner_mobile` if non-empty, else `banner` |
| `emp_fondo` | `color_fondo` |
| `emp_color_titulos` | **alias → `color_fondo`** |
| `emp_color_principal` | `color_principal` |
| `emp_color_encabezado` | **alias → `color_principal`**, but `color_encabezado` wins when non-empty |
| `emp_color_cargo` | `#000000` unless `color_cargo` is non-empty |
| `emp_color_sec` | `color_titulos` |
| `emp_color_btn` | **alias → `color_cargo`** |
| `emp_rutaweb` | `ruta_web` |

The `<client>-vars.css.php` partial does not hardcode colors — it maps locals to CSS custom
properties: `--color-principal`←`emp_color_principal`, `--color-titulos`←`emp_color_titulos`,
`--color-btn`←`emp_color_btn`, `--color-encabezado`/`--color-header`←`emp_color_encabezado`,
`--color-cargo`←`emp_color_cargo`, `--color-sec`←`emp_color_sec`, `--color-terc`←`emp_fondo`,
`--color-fondo`←`emp_banner`, `--color-fondo-mobile`←`emp_banner_mobile`.

**Override recipe** (titles ← the DB titles color, buttons ← the DB primary color), used by
`gonzid`:

```php
$overrides = [
    'emp_color_titulos' => $_empresa['color_titulos'],   // module title bars
    'emp_color_btn'     => $_empresa['color_principal'], // primary actions
];

$branding = BusinessControllerHelper::getBranding($_empresa, $detect, $overrides);
```

The five DB color fields (`color_principal`, `color_encabezado`, `color_fondo`, `color_titulos`,
`color_cargo`) are the source of truth. No brand hex may live in the controller, the template, or
the `css-variables` partial — only in the tenant's `assets/css/empresas/<client>/<client>.css`
and the DB row.

## Registration — the two whitelists

| File | Key | Effect |
|---|---|---|
| `qr/config/fmd-display.php` | `visible_by_default[]` | `getCompanyDisplayMode()` returns `flex` for listed codes; otherwise `default_display` (`none`). Controls whether FIE content renders by default. |
| `qr/fmd/config/fmd-template.php` | `force_single_template[]` | Makes `getTemplate()` return `modelo_fmd` directly, skipping `autonomo-<modelo_fmd>`. |

Add the **company code** (e.g. `GONZID`) to both.

## The `empresas` row

Create it in the admin at `configuracioncodigos?tab=empresas`
(`ConfigCodigosController` → `ConfigCodigosService` → the `empresas` API), or with an
equivalent idempotent seeder (see `utils/seeders/empresa-gonzid.php`). Fields:

`cod_empresa`, `nombre`, `tipo_empresa`, `app_name`, `rif`, `logo`, `logo_2`, `logo_fmd`,
`banner`, `banner_mobile`, `color_fondo`, `color_titulos`, `color_principal`,
`color_encabezado`, `color_cargo`, `plantilla_act`, `plantilla_fmd`, `prefijo_fmd`,
`redireccion`, `modelo_fmd`, `facturacion`, `estado_empresa`, `puntos_contacto`,
`panel_emergencias`, `ruta_web`, `telefonoBTN`, `ruta_desc`.

- Set `modelo_fmd` to the client code and leave `plantilla_fmd` empty (the whitelist handles
  resolution).
- `banner` / `banner_mobile` are **CSS backgrounds**, not bare paths:
  `url(/assets/images/fmd/empresas/<client>/<file>.png)`.
- `logo`, `logo_2`, `logo_fmd` are relative paths without a leading slash, e.g.
  `assets/images/fmd/empresas/<client>/<file>.png`.

**Assets must already exist on disk before the row is saved.** There is no upload endpoint
today: the admin only stores path strings, so a typed path that points at a missing file renders
a broken image with no error.

URL helpers: `sitePrivateConfig()` prefixes the site root (`/` locally,
`https://zur.dataemergencia.com/` in prod); `versionedAsset('<relative>')` appends `?v=<mtime>`
and is used for the tenant stylesheet link.

## Single-session checklist

1. **Collect inputs:** company code (`cod_empresa`/`modelo_fmd`), display name, five brand colors,
   and the logo/logo-2/banner/banner-mobile files.
2. **Assets:** create `assets/images/fmd/empresas/<client>/` with the files at their final names
   (placeholders are fine to wire the flow end-to-end early). Note `.gitignore` excludes
   `assets/images` and `*.png`/`*.jpg`, so brand assets live on disk (deployed) and are not
   tracked — the insulmed assets are untracked for the same reason. Use `git add -f` only if the
   team explicitly decides to version them.
3. **Stylesheet:** create `assets/css/empresas/<client>/<client>.css`; express the brand through
   the CSS variables, not through hardcoded hex scattered in shared files.
4. **Controller:** create `qr/fmd/business-controllers/<client>.php` — `getStudentData()`,
   `getBranding($_empresa, $detect, $overrides)`, `getTemplate()`, then require the template.
   Copy insulmed and delete its plan/affiliate code for a pure reskin.
5. **Template:** create `qr/fmd/templates/<client>.php` + `css-variables/<client>-vars.css.php`.
   Add `cuerpo-fie-<client>.php` only if the module list genuinely differs; otherwise reuse
   `cuerpo-fie.php`. Add `configs/<client>-form.php` only if plan/affiliate fields are needed.
6. **Whitelists:** add the company code to `visible_by_default` and `force_single_template`.
7. **DB row:** create the `empresas` row (admin or seeder) with the asset paths already on disk.
8. **Verify.**

## Verification

- `getTemplate()` returns `<modelo_fmd>` (e.g. `gonzid`), never `autonomo-<client>`.
- `getCompanyDisplayMode('<CODE>') === 'flex'`.
- The page renders all 14 sections at desktop and mobile widths.
- The computed `--color-*` values match the mapping table, and no brand hex exists outside
  `assets/css/empresas/<client>/<client>.css` and the DB row.
- `composer test` and `pnpm test` pass; no presentation assertion was added.
