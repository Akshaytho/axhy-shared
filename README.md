# @axhy/shared

Shared state machines, Prisma schema, types, and utilities for the Axhy platform.

Consumed by:
- `axhy-admin` (Next.js 15 admin portal)
- `axhy-v2-b2b/backend` (Fastify + Prisma server — runs migrations)
- `axhy-v2-b2b/mobile` (Expo React Native worker app — state enums only)

## What lives here

**14 state machines** (`src/state-machines/`) — one file per entity:
Visit, AssignmentConfig, Worker, Device, Site, LeaveRequest, SwapRequest,
Subscription, PhotoEvidence, PaymentEntry, Complaint, FraudCase, AdminUser,
Company.

**Prisma schema** (`prisma/schema.prisma`) — the authoritative database schema
shared across admin + backend. Migrations live in `prisma/migrations/`.
Backend applies migrations on deploy; admin only reads via `prisma generate`.

**Types** (`src/types/`) — event payloads, API request/response contracts, domain DTOs.

**Utils** (`src/utils/`) — `canTransitionGeneric()`, `buildIdempotencyKey()`, etc.

## Why this package exists

If the Visit state enum is defined in two places (once per repo), it WILL drift.
Worker app sends a state the server doesn't recognize. Days of debugging.

This package is the single source of truth. Both repos import from here.
Version-locked. Bumping the package bumps both consumers together.

## Install (local)

In each consumer repo's `package.json`:

```json
{
  "dependencies": {
    "@axhy/shared": "file:../axhy-shared"
  }
}
```

Then `npm install`. The file reference creates a symlink — edits to shared
code are seen immediately by both repos after a rebuild.

## Build

```bash
npm install
npm run build        # compiles to dist/
npm run typecheck    # no emit, just verifies
```

## Versioning rule

When you change any state machine enum or add a transition, bump `version` in
`package.json` and re-run `npm install` in BOTH consumer repos in the same PR.
Never change one side without the other — that's the bug this package exists
to prevent.
