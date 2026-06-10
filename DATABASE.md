# DATABASE.md — Saarlekha series: one shared database (binding)

> **Drop this file unchanged into every Saarlekha repo** (Operations, HR & Admin,
> Stores & Purchase, and any future module). Antigravity reads it alongside
> `AGENTS.md` and `GUARDRAILS.md`. **It overrides any per-module instruction —
> in any brief, scaffold, or prior session — that would create, migrate, or
> connect to a separate database.** All modules are one data platform.

## Per-repo declaration (the ONLY part that differs between repos)

Each repo sets these two facts at the top of its own copy. Everything else in
this file is identical everywhere.

```
SAARLEKHA_MODULE   = <ops | hr | stores | purchase>   # this repo's schema
SAARLEKHA_CORE_OWNER = <true | false>                 # EXACTLY ONE repo is true
```

`SAARLEKHA_CORE_OWNER = true` belongs to **one** repo only (recommended: the
Operations repo, or a dedicated `saarlekha-core` package). That repo owns the
shared `core` schema and its migrations. Every other repo treats `core` as
**externally owned** and never migrates it.

## 0. The rule

**Every Saarlekha module connects to the same PostgreSQL database (the same Neon
project + branch + database).** Isolation between companies is by `companyId` +
RLS (already built). Separation between modules is by **Postgres schema
namespaces inside that one database** — not by separate databases.

Do **not** create a database, Neon project, or Neon branch per module for
production. Do **not** duplicate the shared tables.

## 1. One connection, shared everywhere

Every repo reads the **same** connection strings from the shared secret store —
identical host, database name, and credentials across all modules:

```env
# Pooled (PgBouncer) — used by the running app
DATABASE_URL="postgresql://<user>:<pw>@<neon-pooler-host>/saarlekha?sslmode=require&pgbouncer=true"
# Direct — used ONLY by `prisma migrate` (no pooler)
DIRECT_URL="postgresql://<user>:<pw>@<neon-direct-host>/saarlekha?sslmode=require"
```

The app uses the pooled URL; migrations use the direct URL. These values are the
same in every module's environment — provisioned once, injected everywhere.

## 2. Schema namespacing (Prisma multi-schema)

The database has these Postgres schemas:

| Schema     | Owns                                                                 | Migrated by      |
|------------|----------------------------------------------------------------------|------------------|
| `core`     | Company, User, Department, AuditLog, DocSequence (shared foundation)  | core-owner repo  |
| `ops`      | Operations module tables                                             | ops repo         |
| `hr`       | HR & Admin module tables                                             | hr repo          |
| `stores`   | Stores module tables                                                 | stores repo      |
| `purchase` | Purchase + ERP integration tables                                    | purchase repo    |

Datasource and generator blocks (every repo):

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
  schemas   = ["core", "ops", "hr", "stores", "purchase"]
}

generator client {
  provider = "prisma-client-js"
  // multi-file schema is GA from Prisma 6.7. Multi-schema (DB namespaces) is GA
  // on recent Prisma 6; if `npx prisma -v` predates its promotion, keep the flag:
  previewFeatures = ["multiSchema"]
}
```

Every model and enum carries an explicit `@@schema(...)`:

```prisma
model Company { /* ... */  @@schema("core") }
model Item    { /* ... */  @@schema("stores") }
model PurchaseOrder { /* ... */ @@schema("purchase") }
```

Use the multi-file layout (`prisma/schema/`), one file per area:
`prisma/schema/core.prisma`, `prisma/schema/<module>.prisma`. The `core.prisma`
file is **byte-identical** across repos (ship it from the shared package — §3).

## 3. Single source of truth for `core`

The shared foundation models — **Company, User, Department, AuditLog,
DocSequence** — are defined **once** and consumed everywhere. Do not let each
module redeclare and re-migrate them; that is how they fork and drift.

**Prescribed implementation:** a shared package `@saarlekha/db` that owns the
**entire** Prisma schema (core + all module schemas via multi-file), the **single
migration history**, and exports the **one** Prisma client. Every module app
depends on it and imports the client; there is then literally one schema, one
migration timeline, one generated client, and the dueling-migration problem
cannot occur. This is the strongest form of "one database" and the target state.

**If the repos cannot yet share a package**, the hard invariants still hold:
- The `core` schema is migrated by the **core-owner repo only**.
- Non-owner repos include the `core` models in their schema **for the generated
  client / type-checking only**, and **baseline** them as already-applied
  (`prisma migrate resolve --applied <core_baseline>`). Non-owner repos **never
  author a migration that creates or alters a `core` table.**
- A non-owner's `prisma migrate dev` must produce a diff touching **only its own
  module schema**. If it wants to change a `core` table, that change goes into
  the core-owner repo.

## 4. Migration discipline

- **One migration owner per schema** (the table in §2). Two repos must never run
  migrations against the same schema.
- **Bootstrap order:** `core` first, then any module. A module migration assumes
  `core` already exists.
- Each repo's `prisma migrate` is scoped to its own schema's changes; the shared
  package (if used) runs the whole thing in order.
- Use a single shadow database for migrations; do not point migrations at the
  pooled URL.

## 5. Cross-module references

- Module tables may hold foreign keys **into `core`** freely (e.g. every table's
  `companyId`, created-by → `core.User`).
- Cross-**module** references are allowed (multi-schema supports cross-schema
  FKs), but keep coupling minimal: prefer referencing `core`, and route
  cross-module **writes** through the owning module's service rather than writing
  another module's tables directly. Reads across schemas are fine.
- Existing links stay as-is conceptually (e.g. a Stores `Issue` referencing an
  Operations job order) — now expressible as a real cross-schema relation instead
  of a loose string ref, once both live in this one database.

## 6. Tenancy & security (unchanged, reaffirmed)

- `companyId` is always taken from the **session on the server**, never the
  client. RLS is enforced on **every table in every schema**.
- The app connects with **one least-privilege role** (`NOSUPERUSER
  NOBYPASSRLS`) that does **not** own the tables. Grant it
  `USAGE` on all five schemas and table privileges within them; it must not be
  able to bypass RLS.
- No hard deletes of transactional rows (per each module's `GUARDRAILS.md`).

## 7. Do NOT

- Create a separate database / Neon project / production branch per module.
- Duplicate Company / User / Department / AuditLog into a module schema.
- Run migrations for the same schema from two repos.
- Connect any module to a different database than the one in §1.
- Put module tables in the default `public` schema unschemed (use the namespace).

## 8. Definition of done

- Every repo's `DATABASE_URL`/`DIRECT_URL` point at the **same** host + database.
- `psql \dn` (or Neon SQL editor) shows exactly: `core, ops, hr, stores,
  purchase`.
- There is exactly **one** `core."Company"` and **one** `core."User"` table; no
  module-local copies exist.
- A company created once is visible to every module without any sync.
- `core` is owned by a single migration source; each module migration diff
  touches only its own schema.
- The app connects as the least-privilege role and RLS denies cross-company reads
  in every schema.
