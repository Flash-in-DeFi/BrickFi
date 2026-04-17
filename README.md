# BrickFi

Fractional real estate investment platform for retail investors in Africa and the diaspora. Buy fractional units of real estate properties starting from $10, receive rental income in USDC on the Stellar network, and track your portfolio through a dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [How It Works](#how-it-works)
- [Data Model](#data-model)
- [API Reference](#api-reference)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Running Migrations](#running-migrations)
- [Running Tests](#running-tests)
- [Stellar Integration](#stellar-integration)
- [Key Design Decisions](#key-design-decisions)
- [Docs](#docs)

---

## Overview

BrickFi lets investors buy fractional units of vetted real estate properties. Each property is tokenized on the Stellar blockchain — the ledger is the authoritative record of who owns what. When rent is collected, the platform distributes proportional USDC payouts directly to investors' Stellar wallets.

**MVP scope:**
- Investor registration, login, and Freighter wallet connection
- Property listing and fractional investment
- Monthly rent recording and USDC distribution
- Investor dashboard with portfolio value, earnings, and withdrawal
- Admin panel for property management, rent entry, distribution, and audit logging
- On-chain token balance reconciliation against the PostgreSQL mirror

All Stellar operations run on **testnet** by default, switchable to mainnet via env var.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│              Frontend (Next.js + TailwindCSS)        │
│   Investor Dashboard  │  Admin Panel  │  Freighter   │
└────────────────────────┬────────────────────────────┘
                         │ HTTP / REST
┌────────────────────────▼────────────────────────────┐
│                  Backend (NestJS)                    │
│                                                      │
│  AuthModule      PropertyModule   InvestmentModule   │
│  RentModule      DistributionModule  WalletModule    │
│  AdminModule     StellarModule    QueueModule        │
└──────┬──────────────────────────────────┬───────────┘
       │                                  │
┌──────▼──────┐                  ┌────────▼────────┐
│ PostgreSQL  │                  │     Redis        │
│  (mirror)   │                  │  (BullMQ jobs)   │
└─────────────┘                  └─────────────────┘
                                          │
                         ┌────────────────▼────────────────┐
                         │         Stellar Network          │
                         │  Horizon API → Testnet/Mainnet   │
                         │  Property NFTs  │  Invest Tokens │
                         └─────────────────────────────────┘
```

### Modular monolith

All NestJS modules live in one application with clean boundaries. Each module owns its entities, service, controller, and tests. The structure is designed so any module can be extracted into a microservice later without major refactoring.

### On-chain ownership flow

```
Admin creates property
  → StellarService mints Property NFT (1 unit of BF-NFT-{CODE} asset)
  → nft_tx_hash stored on property record

Investor buys units
  → StellarService issues Investment_Tokens (BF-{CODE} asset) to investor wallet
  → Investment record upserted in PostgreSQL (mirror only)

Admin triggers distribution
  → StellarService.getTokenBalance queries Horizon for each investor's on-chain balance
  → Payout = (on_chain_balance / total_units) × net_rent
  → Distribution records created as "pending" in DB
  → BullMQ jobs send USDC to each investor wallet
  → Records updated to "sent" with tx_hash on confirmation
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend framework | NestJS 11 (TypeScript) |
| Database | PostgreSQL via TypeORM 0.3 |
| Queue | BullMQ 5 + Redis (via `@nestjs/bullmq`) |
| Blockchain | Stellar classic assets via `@stellar/stellar-sdk` 13 |
| Auth | JWT (`@nestjs/jwt`) + Passport + bcrypt |
| Validation | `class-validator` + `class-transformer` + Joi (env schema) |
| Testing | Jest + `fast-check` (property-based testing) |
| Frontend | Next.js (TypeScript) + TailwindCSS + `@stellar/freighter-api` |
| Linting | ESLint + Prettier |

---

## Repository Structure

```
/
├── brickfi-backend/          # NestJS API
│   ├── src/
│   │   ├── app.module.ts     # Root module — wires ConfigModule, TypeORM, BullMQ
│   │   ├── main.ts           # Bootstrap — ValidationPipe, global prefix /api
│   │   ├── data-source.ts    # TypeORM DataSource for migration CLI
│   │   ├── config/
│   │   │   └── configuration.ts  # Joi env validation + config factory
│   │   └── migrations/
│   │       └── 1713000000000-CreateInitialSchema.ts  # All 7 tables
│   ├── .env.example          # Required environment variables
│   ├── package.json
│   └── tsconfig.json
│
├── brickfi-frontend/         # Next.js app (to be scaffolded in task #13)
│
├── docs/
│   ├── github-issues.md      # Full GitHub issue specs for every task
│   └── requirements.md       # Product requirements reference
│
└── .kiro/specs/brickfi-platform/
    ├── requirements.md       # Formal requirements document
    ├── design.md             # Architecture and correctness properties
    └── tasks.md              # Implementation task list
```

---

## How It Works

### For investors

1. Register with email + password → receive JWT
2. Connect a Freighter Stellar wallet (`POST /auth/connect-wallet`)
3. Browse properties (`GET /properties`)
4. Buy fractional units (`POST /invest`) — Investment_Tokens are issued to your Stellar wallet
5. Receive USDC distributions automatically when the admin triggers payouts
6. View portfolio, earnings, and ROI on the dashboard (`GET /dashboard`)
7. Withdraw USDC to your Stellar wallet (`POST /withdraw`)

### For admins

1. List a property (`POST /properties`) — a Property NFT is minted on Stellar automatically
2. Record monthly rent (`POST /rent/add`)
3. Trigger USDC distribution to all investors (`POST /distribute`)
4. Retry any failed distributions (`POST /distribute/retry`)
5. Monitor the system via the admin dashboard (`GET /admin/dashboard`)
6. Run a reconciliation check to verify on-chain balances match the DB (`GET /admin/reconcile`)

### Token model

Each property gets two Stellar assets:

| Asset | Code format | Purpose |
|---|---|---|
| Property NFT | `BF-NFT-{SHORT_CODE}` | Unique proof of property on-chain, held by platform |
| Investment Token | `BF-{SHORT_CODE}` | Fungible fractional ownership units, held by investors |

Example for a property with `short_code = LAGOS01`:
- NFT asset code: `BF-NFT-LAGOS01`
- Investment token: `BF-LAGOS01`

---

## Data Model

Seven PostgreSQL tables, all created by a single migration:

```
users
  id, email, phone, password_hash, wallet_address, role, created_at

properties
  id, name, location, total_value_usd, total_units, price_per_unit,
  annual_yield, images, description, is_active, short_code,
  nft_asset_code, nft_tx_hash, token_asset_code, token_issuer, created_at

investments
  id, user_id → users, property_id → properties,
  units_owned, total_invested, created_at
  UNIQUE(user_id, property_id)

rent_payments
  id, property_id → properties, amount_usd, fee_percentage,
  net_amount_usd, period (YYYY-MM), created_at
  UNIQUE(property_id, period)

distributions
  id, user_id → users, property_id → properties,
  rent_payment_id → rent_payments, amount_usdc,
  status (pending|sent|failed), tx_hash, period, created_at

transactions
  id, user_id → users, type (deposit|withdrawal|payout),
  amount, tx_hash, status, created_at

audit_logs
  id, user_id → users, action, resource, resource_id, metadata (JSONB), created_at
```

### Key computed values

```
price_per_unit   = total_value_usd / total_units
net_amount_usd   = amount_usd × (1 - fee_percentage / 100)
investor_payout  = (on_chain_token_balance / total_units) × net_amount_usd
portfolio_value  = SUM(units_owned × price_per_unit)
total_roi        = (total_earnings / total_invested) × 100
available_usdc   = SUM(sent distributions) - SUM(completed withdrawals)
```

---

## API Reference

All routes are prefixed with `/api`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register with email + password |
| POST | `/auth/login` | — | Login, receive JWT |
| POST | `/auth/connect-wallet` | JWT | Connect Freighter wallet |

### Properties

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/properties` | JWT | List all active properties |
| GET | `/properties/:id` | JWT | Get property with available_units |
| POST | `/properties` | JWT + admin | Create property (mints NFT) |
| PATCH | `/properties/:id` | JWT + admin | Update property |

### Investments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/invest` | JWT | Buy fractional units |
| GET | `/investments` | JWT | Get your investments |

### Rent

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/rent/add` | JWT + admin | Record monthly rent |
| GET | `/rent/:propertyId` | JWT | Get rent history |

### Distribution

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/distribute` | JWT + admin | Trigger USDC distribution |
| POST | `/distribute/retry` | JWT + admin | Retry failed distributions |

### Wallet & Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/wallet` | JWT | Get USDC balance |
| POST | `/withdraw` | JWT | Withdraw USDC to Stellar wallet |
| GET | `/dashboard` | JWT | Portfolio summary + transaction history |

### Admin

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/dashboard` | JWT + admin | System summary stats |
| GET | `/admin/reconcile` | JWT + admin | On-chain vs DB balance check |

### HTTP error codes

| Code | Meaning |
|---|---|
| 400 | Invalid input / insufficient units / no wallet connected |
| 401 | Missing or invalid JWT |
| 403 | Insufficient role (investor hitting admin endpoint) |
| 404 | Resource not found |
| 409 | Duplicate (email, rent period, already-distributed period) |
| 503 | Stellar network unavailable |

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+
- A Stellar testnet account (get one at [Stellar Laboratory](https://laboratory.stellar.org))

### 1. Clone and install

```bash
git clone <repo-url>
cd brickfi-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see [Environment Variables](#environment-variables) below).

### 3. Create the database

```bash
createdb brickfi
```

### 4. Run migrations

```bash
npm run migration:run
```

### 5. Start the server

```bash
# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod
```

The API will be available at `http://localhost:3000/api`.

---

## Environment Variables

All variables are validated at startup via Joi. The server will refuse to start if any required variable is missing or invalid.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string — `postgres://user:pass@host:5432/dbname` |
| `REDIS_URL` | yes | Redis connection string — `redis://localhost:6379` |
| `JWT_SECRET` | yes | Secret key for signing JWTs — use a long random string in production |
| `STELLAR_NETWORK` | yes | `testnet` or `mainnet` |
| `STELLAR_PLATFORM_SECRET` | yes | Secret key of the platform's custodial Stellar account (signs all transactions) |
| `STELLAR_ISSUER_PUBLIC_KEY` | yes | Public key of the platform's issuer account (stored on property records) |

```bash
# .env.example
DATABASE_URL=postgres://user:password@localhost:5432/brickfi
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-to-a-long-random-string
STELLAR_NETWORK=testnet
STELLAR_PLATFORM_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
STELLAR_ISSUER_PUBLIC_KEY=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

To get a Stellar testnet keypair:
1. Go to [https://laboratory.stellar.org/#account-creator](https://laboratory.stellar.org/#account-creator)
2. Generate a keypair
3. Fund it with the Friendbot
4. Use the secret key as `STELLAR_PLATFORM_SECRET` and the public key as `STELLAR_ISSUER_PUBLIC_KEY`

---

## Running Migrations

```bash
# Apply all pending migrations
npm run migration:run

# Revert the last migration
npm run migration:revert

# Generate a new migration from entity changes
npm run migration:generate -- src/migrations/MigrationName
```

Migrations live in `src/migrations/`. The initial migration (`1713000000000-CreateInitialSchema.ts`) creates all 7 tables.

---

## Running Tests

```bash
# Run all tests once
npm test

# Run with coverage
npm run test:cov

# Run in watch mode (development)
npm run test:watch

# Run a single test file
npm test -- src/auth/auth.service.spec.ts
```

### Testing approach

The project uses a dual testing strategy:

**Unit tests** (Jest) — verify specific examples, error conditions, and edge cases:
- 409 on duplicate rent period
- 404 on missing property
- 400 when investor has no wallet
- 503 when Stellar is unavailable

**Property-based tests** (fast-check) — verify universal invariants hold across arbitrary inputs:
- `price_per_unit = total_value_usd / total_units` for any valid values
- `net_amount_usd = gross × (1 - fee/100)` for any gross and fee
- Payout proportionality: each investor's share sums to the total net rent
- Overdraft prevention: withdrawal > balance always returns 400
- Portfolio data isolation: user A never sees user B's data

Each property test runs a minimum of 100 iterations. Tests are tagged with the property they validate:

```typescript
// Feature: brickfi-platform, Property 7: price_per_unit invariant
it('price_per_unit equals total_value_usd / total_units', () => {
  fc.assert(
    fc.property(
      fc.float({ min: 1000, max: 10_000_000 }),
      fc.integer({ min: 1, max: 10000 }),
      (totalValue, totalUnits) => {
        const result = computePricePerUnit(totalValue, totalUnits)
        expect(result).toBeCloseTo(totalValue / totalUnits, 5)
      }
    ),
    { numRuns: 100 }
  )
})
```

---

## Stellar Integration

### Classic assets only

BrickFi uses Stellar's native classic asset model — no Soroban smart contracts. This keeps the MVP simple and fast to ship.

### Property NFT pattern

When a property is created, the platform issues exactly 1 unit of a unique asset from the issuer account to itself, then locks further issuance via auth flags. This is Stellar's standard NFT pattern using classic assets.

```
Asset code: BF-NFT-LAGOS01
Issuer:     GXXXXXXX... (platform issuer account)
Amount:     1 (exactly)
Held by:    platform issuer account itself
```

### Investment tokens

When an investor buys units, the platform sends fungible Investment_Tokens from the issuer account to the investor's Stellar wallet. The investor must have a trustline for the asset before tokens can be received.

```
Asset code: BF-LAGOS01
Issuer:     GXXXXXXX... (platform issuer account)
Amount:     number of units purchased
Held by:    investor's own Stellar wallet
```

### USDC distribution

Distributions use Stellar's native USDC asset. The platform sends USDC from its custodial account to each investor's wallet. Payout amounts are calculated using on-chain Investment_Token balances queried via the Horizon API — not the PostgreSQL mirror.

USDC issuer on testnet: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

### Horizon endpoints

| Network | Horizon URL |
|---|---|
| Testnet | `https://horizon-testnet.stellar.org` |
| Mainnet | `https://horizon.stellar.org` |

Switch between them by setting `STELLAR_NETWORK=testnet` or `STELLAR_NETWORK=mainnet`.

### Verifying transactions

All transaction hashes can be verified on Stellar Expert:
- Testnet: `https://stellar.expert/explorer/testnet/tx/{txHash}`
- Mainnet: `https://stellar.expert/explorer/public/tx/{txHash}`

---

## Key Design Decisions

**Stellar ledger as source of truth**
PostgreSQL `units_owned` is a fast-query mirror only. Distribution payouts are always calculated from on-chain Investment_Token balances via Horizon. If Horizon is unavailable, the system falls back to the DB mirror and logs a warning.

**Atomic investment flow**
Investment creation uses a TypeORM `QueryRunner` with `SELECT FOR UPDATE` to prevent race conditions on available units. The Stellar token issuance happens inside the transaction boundary — if it fails, the DB rolls back. If the DB commit fails after a successful Stellar call, the discrepancy is logged for manual reconciliation (the ledger remains authoritative).

**Queue-based distribution**
USDC distributions are processed asynchronously via BullMQ. Each investor's payout is a separate job with exponential backoff retry (3 attempts). This handles the reality that batch Stellar transactions can partially fail.

**Non-custodial investor wallets**
Investors hold their own Investment_Tokens in their own Stellar wallets. The platform never holds investor tokens on their behalf. Investors connect their Freighter wallet and the platform issues tokens directly to that address.

**Role-based access control**
Two roles: `investor` (default) and `admin`. Guards are applied at the controller level using `@Roles()` + `RolesGuard`. All admin endpoints return 403 for investor-role JWTs.

---

## Docs

| File | Description |
|---|---|
| `docs/github-issues.md` | Full GitHub issue specs for every implementation task — includes step-by-step instructions, acceptance criteria, and property test specs |
| `docs/requirements.md` | Product requirements reference |
| `.kiro/specs/brickfi-platform/requirements.md` | Formal requirements with acceptance criteria |
| `.kiro/specs/brickfi-platform/design.md` | Architecture, component interfaces, data models, and all 31 correctness properties |
| `.kiro/specs/brickfi-platform/tasks.md` | Implementation task list with status tracking |
