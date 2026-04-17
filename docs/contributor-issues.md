# BrickFi — Contributor Issues

These are scoped, self-contained issues designed for open-source contributors. Each one has a clear boundary, enough context to get started without needing to understand the whole codebase, and a definition of done.

Issues are grouped by type and tagged with a difficulty level:
- `good first issue` — no prior codebase knowledge needed, isolated scope
- `intermediate` — requires reading 1–2 modules, some NestJS/TypeORM familiarity
- `advanced` — requires understanding the Stellar integration or cross-module flows

---

## Good First Issues

---

### [good first issue] Add `short_code` format validation to `CreatePropertyDto`

**Type:** Bug fix / validation
**File:** `src/property/dto/create-property.dto.ts`
**Effort:** ~1 hour

**Context:**
The `short_code` field on a property is used to derive both the Investment Token asset code (`BF-{short_code}`) and the NFT asset code (`BF-NFT-{short_code}`). Stellar asset codes have a hard limit of 12 characters. Currently there is no validation enforcing the format or length.

**Problem:**
A `short_code` like `toolongvalue` would produce `BF-NFT-toolongvalue` (19 chars), which Stellar will reject. The error surfaces as a 503 from the Stellar service instead of a clean 400 from the API.

**What to do:**
In `CreatePropertyDto`, add the following constraints to the `short_code` field:
- Max 8 characters (so `BF-NFT-{short_code}` stays within 12 chars)
- Only uppercase letters and digits (`/^[A-Z0-9]+$/`)
- Use `@Matches`, `@MaxLength`, and `@IsUppercase` from `class-validator`

**Acceptance criteria:**
- `POST /properties` with `short_code: "toolong1"` (9 chars) → 400 Bad Request
- `POST /properties` with `short_code: "lowercase"` → 400 Bad Request
- `POST /properties` with `short_code: "LAGOS01"` → passes validation
- Add a unit test in `property.service.spec.ts` covering the invalid cases

---

### [good first issue] Add `period` format validation to `AddRentDto`

**Type:** Bug fix / validation
**File:** `src/rent/dto/add-rent.dto.ts`
**Effort:** ~1 hour

**Context:**
The `period` field on rent payments uses the format `YYYY-MM` (e.g. `2024-03`). It's stored with a unique constraint on `(property_id, period)`. If a caller sends `period: "March 2024"` or `period: "2024-3"`, the constraint won't catch duplicates correctly and the data becomes inconsistent.

**What to do:**
Add a `@Matches(/^\d{4}-(0[1-9]|1[0-2])$/)` decorator to the `period` field in `AddRentDto` with a descriptive message: `"period must be in YYYY-MM format (e.g. 2024-03)"`.

**Acceptance criteria:**
- `POST /rent/add` with `period: "2024-3"` → 400 with descriptive message
- `POST /rent/add` with `period: "March 2024"` → 400 with descriptive message
- `POST /rent/add` with `period: "2024-03"` → passes validation
- Unit test covering both invalid and valid formats

---

### [good first issue] Return `available_units` on `GET /properties` list endpoint

**Type:** Feature (small)
**File:** `src/property/property.service.ts`
**Effort:** ~2 hours

**Context:**
`GET /properties/:id` returns `available_units` (computed as `total_units - SUM(investments.units_owned)`). But `GET /properties` (the list endpoint) does not include it, so the frontend property listing page can't show availability without making N+1 requests.

**What to do:**
Update `PropertyService.listProperties()` to include `available_units` for each property. Use a single query with a LEFT JOIN and GROUP BY rather than N separate queries.

```sql
SELECT p.*, COALESCE(SUM(i.units_owned), 0) AS available_units
FROM properties p
LEFT JOIN investments i ON i.property_id = p.id
WHERE p.is_active = true
GROUP BY p.id
```

**Acceptance criteria:**
- `GET /properties` response includes `available_units` on each property object
- Value is correct: `total_units - sum of all investments for that property`
- Properties with no investments return `available_units = total_units`
- Add a unit test verifying the computed value

---

### [good first issue] Add `GET /properties/:id` 404 unit test

**Type:** Testing
**File:** `src/property/property.service.spec.ts`
**Effort:** ~1 hour

**Context:**
The property service throws a `NotFoundException` when a property ID doesn't exist, but there's no test covering this case yet.

**What to do:**
In `property.service.spec.ts`, add a test:

```typescript
it('throws NotFoundException when property does not exist', async () => {
  // mock repository to return null/undefined
  await expect(service.getProperty('non-existent-uuid')).rejects.toThrow(NotFoundException)
})
```

Also add tests for:
- `updateProperty` with a non-existent ID → `NotFoundException`
- `getProperty` with a valid ID → returns the property

**Acceptance criteria:**
- All three tests pass
- No mocks return real data — use Jest mock functions

---

### [good first issue] Write unit tests for `RentService.addRentPayment`

**Type:** Testing
**File:** `src/rent/rent.service.spec.ts`
**Effort:** ~2 hours

**Context:**
The rent service has no tests yet. These are the most important cases to cover before the distribution module depends on it.

**What to do:**
Create `src/rent/rent.service.spec.ts` and write tests for:

1. Successfully creates a rent payment with correct `net_amount_usd`
   - Input: `amount_usd: 10000`, `fee_percentage: 2`
   - Expected: `net_amount_usd: 9800`

2. Throws `ConflictException` (409) when `(property_id, period)` already exists

3. Throws `NotFoundException` (404) when `property_id` doesn't exist

4. Default fee is 2% when `fee_percentage` is not provided

Mock the TypeORM repository — do not use a real database.

**Acceptance criteria:**
- All 4 tests pass
- `net_amount_usd` is computed correctly in the test assertions
- Uses `@nestjs/testing` `Test.createTestingModule`

---

### [good first issue] Document all API endpoints with JSDoc comments

**Type:** Documentation
**Files:** All `*.controller.ts` files
**Effort:** ~3 hours

**Context:**
The controllers have no inline documentation. Contributors and frontend developers have to read the service layer to understand what each endpoint does, what it expects, and what it returns.

**What to do:**
Add JSDoc comments above each controller method. Example:

```typescript
/**
 * Register a new investor account.
 *
 * @returns JWT access token and user profile
 * @throws 409 if email already exists
 * @throws 400 if required fields are missing or invalid
 */
@Post('register')
register(@Body() dto: RegisterDto) { ... }
```

Cover all endpoints across:
- `auth.controller.ts`
- `property.controller.ts`
- `investment.controller.ts`
- `rent.controller.ts`
- `distribution.controller.ts`
- `wallet.controller.ts`
- `admin.controller.ts`

**Acceptance criteria:**
- Every public controller method has a JSDoc comment
- Each comment includes: what the endpoint does, what it returns, and which HTTP errors it can throw
- No functional code changes — documentation only

---

## Intermediate Issues

---

### [intermediate] Implement `AuthService.register` and `AuthService.login`

**Type:** Feature
**Files:** `src/auth/auth.service.ts`, `src/auth/entities/user.entity.ts`, `src/auth/dto/`
**Effort:** ~4 hours
**Depends on:** Scaffold (task #1 — already done)

**Context:**
The auth module directory needs to be created. This is the core authentication service that every other module depends on for JWT validation and RBAC.

**What to do:**

1. Create `src/auth/entities/user.entity.ts` — TypeORM entity mapping to the `users` table
2. Create `src/auth/dto/register.dto.ts` and `login.dto.ts` with `class-validator` decorators
3. Implement `AuthService`:
   - `register(dto)` — hash password with `bcrypt` (saltRounds=10), save user, return JWT
   - `login(dto)` — find user by email, `bcrypt.compare`, return JWT
   - Throw `ConflictException` (409) on duplicate email
   - Throw `UnauthorizedException` (401) on wrong password
4. Implement `JwtStrategy` extending `PassportStrategy(Strategy)`
5. Implement `JwtAuthGuard` extending `AuthGuard('jwt')`
6. Implement `RolesGuard` + `@Roles()` decorator
7. Wire `AuthModule` with `TypeOrmModule.forFeature([User])`, `JwtModule`, `PassportModule`

**Acceptance criteria:**
- `POST /auth/register` → 201 + `{ accessToken, user: { id, email, role } }`
- `POST /auth/register` duplicate email → 409
- `POST /auth/login` valid credentials → 200 + JWT
- `POST /auth/login` wrong password → 401
- `password_hash` in DB never equals the plaintext password
- Unit tests cover all four cases above

**Reference:** `docs/github-issues.md` Issue #2.1 for full implementation steps.

---

### [intermediate] Implement property-based tests for `AuthService`

**Type:** Testing (property-based)
**File:** `src/auth/auth.service.spec.ts`
**Effort:** ~3 hours
**Depends on:** Auth module implementation

**Context:**
Property-based tests use `fast-check` to verify that invariants hold across arbitrary inputs — not just the specific examples in unit tests. The project uses `fast-check` v3 (already installed).

**What to do:**
Add the following property tests to `auth.service.spec.ts`:

**Property 1 — Registration always produces a valid JWT**
```typescript
// Feature: brickfi-platform, Property 1: Registration produces a valid JWT
fc.assert(fc.property(
  fc.record({ email: fc.emailAddress(), password: fc.string({ minLength: 8 }) }),
  async ({ email, password }) => {
    const result = await service.register({ email, password })
    expect(result.accessToken).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)
  }
), { numRuns: 100 })
```

**Property 2 — Register-then-login round trip**
```typescript
// Feature: brickfi-platform, Property 2: Register-then-login round trip
```
For any valid credentials, register then login with the same credentials returns a valid JWT.

**Property 3 — Wrong password always returns 401**
```typescript
// Feature: brickfi-platform, Property 3: Invalid credentials always return 401
```
For any registered user, login with a different password always throws `UnauthorizedException`.

**Property 6 — Password hash never equals plaintext**
```typescript
// Feature: brickfi-platform, Property 6: Passwords are never stored in plaintext
```
For any password string, the stored `password_hash` never equals the input.

Mock the TypeORM repository. Each property must run `{ numRuns: 100 }`.

**Acceptance criteria:**
- All 4 property tests pass
- Each test is tagged with the correct `// Feature: brickfi-platform, Property N:` comment
- Tests use `fc.assert(fc.property(...), { numRuns: 100 })`

---

### [intermediate] Implement `RentService` and `RentController`

**Type:** Feature
**Files:** `src/rent/` (full module)
**Effort:** ~4 hours
**Depends on:** Auth module, Property module

**Context:**
Rent payments are the input to the distribution calculation. The `net_amount_usd` stored here is what gets distributed to investors proportionally.

**What to do:**

1. Create `src/rent/entities/rent-payment.entity.ts`
2. Create `src/rent/dto/add-rent.dto.ts`
3. Implement `RentService`:
   - `addRentPayment(dto)` — verify property exists, check for duplicate `(property_id, period)`, compute `net_amount_usd = amount_usd * (1 - fee_percentage / 100)`, save
   - `getRentPayments(propertyId)` — return all payments ordered by period DESC
   - `getNetRent(propertyId, period)` — used internally by DistributionService
4. Implement `RentController`:
   - `POST /rent/add` — admin only
   - `GET /rent/:propertyId` — any authenticated user
5. Wire `RentModule`

**Fee formula:** `net_amount_usd = amount_usd × (1 - fee_percentage / 100)`

**Acceptance criteria:**
- `POST /rent/add` by admin → 201 + record with correct `net_amount_usd`
- `POST /rent/add` duplicate period → 409
- `POST /rent/add` by investor → 403
- `POST /rent/add` invalid period format → 400
- `GET /rent/:propertyId` → 200 + array ordered by period DESC
- Unit tests cover all error cases

**Reference:** `docs/github-issues.md` Issue #6.1

---

### [intermediate] Write property-based test for `price_per_unit` invariant

**Type:** Testing (property-based)
**File:** `src/property/property.service.spec.ts`
**Effort:** ~2 hours
**Depends on:** Property module implementation

**Context:**
`price_per_unit` is a derived value computed on property creation. It must always equal `total_value_usd / total_units`. This property test verifies that invariant holds for any valid combination of inputs.

**What to do:**

```typescript
// Feature: brickfi-platform, Property 7: price_per_unit invariant
it('price_per_unit equals total_value_usd / total_units for any valid inputs', () => {
  fc.assert(
    fc.property(
      fc.float({ min: 1000, max: 10_000_000, noNaN: true }),
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

Also add Property 11 (available_units invariant):
```typescript
// Feature: brickfi-platform, Property 11: available_units invariant
// For any property with T total units and S invested units, available_units = T - S
```

**Acceptance criteria:**
- Both property tests pass with `numRuns: 100`
- Tests are tagged with the correct property comment
- No real database calls — pure function tests or mocked repository

---

### [intermediate] Write property-based tests for `net_amount_usd` fee invariant

**Type:** Testing (property-based)
**File:** `src/rent/rent.service.spec.ts`
**Effort:** ~2 hours
**Depends on:** Rent module implementation

**Context:**
The platform fee is applied to every rent payment. The invariant `net_amount_usd = gross × (1 - fee/100)` must hold for any valid gross amount and fee percentage.

**What to do:**

```typescript
// Feature: brickfi-platform, Property 15: Net rent fee invariant
it('net_amount_usd equals gross × (1 - fee/100) for any valid inputs', () => {
  fc.assert(
    fc.property(
      fc.float({ min: 100, max: 1_000_000, noNaN: true }),
      fc.float({ min: 1, max: 3, noNaN: true }),
      (gross, fee) => {
        const result = computeNetAmount(gross, fee)
        expect(result).toBeCloseTo(gross * (1 - fee / 100), 5)
      }
    ),
    { numRuns: 100 }
  )
})
```

**Acceptance criteria:**
- Property test passes with `numRuns: 100`
- Tagged with `// Feature: brickfi-platform, Property 15: Net rent fee invariant`
- Edge cases covered as unit tests: fee=1 (min), fee=3 (max), gross=0.01 (min)

---

## Advanced Issues

---

### [advanced] Implement `StellarService.sendUSDC` and `verifySignature`

**Type:** Feature
**Files:** `src/stellar/stellar.service.ts`, `src/stellar/stellar.module.ts`
**Effort:** ~5 hours
**Depends on:** Scaffold (task #1)

**Context:**
The Stellar module is a shared global service used by Auth (wallet verification), Distribution (USDC sending), and Wallet (withdrawals). It wraps `@stellar/stellar-sdk` v13 which is already installed.

**What to do:**

1. Create `src/stellar/stellar.service.ts`
2. In the constructor, load config from `ConfigService`:
   - `STELLAR_NETWORK` → `Networks.TESTNET` or `Networks.PUBLIC`
   - `STELLAR_PLATFORM_SECRET` → `Keypair.fromSecret(...)`
   - Instantiate `new Horizon.Server(horizonUrl)`
3. Implement `sendUSDC(destination, amount, memo?)`:
   - Load platform account via `server.loadAccount`
   - Build transaction with `Operation.payment` using USDC asset
   - Sign with platform keypair, submit via `server.submitTransaction`
   - Return `{ txHash, success: true }` or `{ success: false, error }`
4. Implement `verifySignature(address, message, signature)`:
   - `Keypair.fromPublicKey(address).verify(Buffer.from(message), Buffer.from(signature, 'base64'))`
   - Return `true`/`false`, never throw
5. Implement `getBalance(address)`:
   - Query Horizon for USDC balance, return `"0"` if no trustline
6. Mark module as `@Global()`, export `StellarService`

USDC issuer on testnet: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

**Acceptance criteria:**
- `sendUSDC` builds a correctly signed payment transaction
- `verifySignature` returns `true` for valid signatures, `false` for invalid — never throws
- `getBalance` returns `"0"` when account has no USDC trustline
- Unit tests mock the Horizon `Server` class — no real network calls
- All tests pass

**Reference:** `docs/github-issues.md` Issue #7.1

---

### [advanced] Implement `StellarService.mintPropertyNFT` and `issueInvestmentTokens`

**Type:** Feature
**Files:** `src/stellar/stellar.service.ts`
**Effort:** ~5 hours
**Depends on:** Issue #7.1 (sendUSDC)

**Context:**
These are the two on-chain tokenization methods. `mintPropertyNFT` uses Stellar's classic asset NFT pattern (issue exactly 1 unit to self, lock further issuance). `issueInvestmentTokens` sends fungible fractional ownership tokens to investor wallets.

**What to do:**

`mintPropertyNFT(propertyId, assetCode)`:
- Create asset: `new Asset(assetCode, issuerKeypair.publicKey())`
- Build transaction: `ChangeTrust` (issuer trusts its own asset, limit "1") + `Payment` (1 unit to self)
- Sign and submit
- Return `{ txHash, success: true }`

`issueInvestmentTokens(destination, assetCode, amount)`:
- Build payment: issuer → destination, `amount` units of the asset
- Handle `op_no_trust` error gracefully — return `{ success: false, error: 'Investor wallet has no trustline...' }` instead of throwing
- Return `{ txHash, success: true }` on success

`getTokenBalance(walletAddress, assetCode)`:
- Query Horizon for the investor's account
- Find balance entry where `asset_code === assetCode` AND `asset_issuer === STELLAR_ISSUER_PUBLIC_KEY`
- Return balance string, or `"0"` if no trustline or account not found

**Acceptance criteria:**
- `mintPropertyNFT` issues exactly 1 unit and returns a non-empty `txHash`
- `issueInvestmentTokens` returns a descriptive error (not a throw) for missing trustline
- `getTokenBalance` returns `"0"` for unknown assets or missing accounts
- Unit tests mock Horizon — no real network calls
- All tests pass

**Reference:** `docs/github-issues.md` Issue #7.2

---

### [advanced] Implement distribution payout calculation with on-chain balance query

**Type:** Feature
**Files:** `src/distribution/distribution.service.ts`
**Effort:** ~6 hours
**Depends on:** Auth, Property, Investment, Rent, and Stellar modules

**Context:**
This is the most complex service in the platform. It must query on-chain Investment_Token balances for each investor, calculate proportional payouts, create all Distribution records atomically before any Stellar calls, then hand off to BullMQ for async sending.

**What to do:**

Implement `DistributionService.triggerDistribution(propertyId, period)`:

```
1. Fetch rent_payment for (property_id, period) → 404 if not found
2. Fetch all investments for the property (JOIN users for wallet_address)
3. Check if all distributions for this period are already "sent" → 409 Conflict
4. For each investor:
   a. Try: balance = await StellarService.getTokenBalance(wallet, token_asset_code)
   b. Catch: balance = investment.units_owned.toString(); log WARNING
5. Compute payout: (parseFloat(balance) / total_units) × net_rent_amount
6. In a SINGLE DB transaction, INSERT all Distribution records as "pending"
7. After commit, enqueue each record as a BullMQ job
8. Return DistributionSummary
```

Key constraint: all DB records must exist as "pending" **before** any Stellar call or queue job is created.

**Acceptance criteria:**
- All Distribution records are created as "pending" in one DB transaction before any queue jobs
- Payout uses on-chain balance when Horizon is available
- Falls back to DB `units_owned` when Horizon throws, logs a warning
- Returns 409 when all records for the period are already "sent"
- Returns 403 for non-admin callers
- Property-based test: payout proportionality — `SUM(all payouts) ≈ net_rent` within tolerance

**Reference:** `docs/github-issues.md` Issue #8.1

---

### [advanced] Implement overdraft prevention and balance isolation property tests

**Type:** Testing (property-based)
**Files:** `src/wallet/wallet.service.spec.ts`
**Effort:** ~3 hours
**Depends on:** Wallet module implementation

**Context:**
Two critical correctness properties for the wallet module. Overdraft prevention ensures investors can never withdraw more than their available balance. Balance isolation ensures user A's balance calculation never includes user B's distributions.

**What to do:**

**Property 23 — Overdraft prevention**
```typescript
// Feature: brickfi-platform, Property 23: Overdraft prevention
fc.assert(fc.property(
  fc.float({ min: 0.01, max: 10000, noNaN: true }),
  async (balance) => {
    // mock getBalance to return `balance`
    const overdraftAmount = balance + fc.sample(fc.float({ min: 0.01, max: 1000 }), 1)[0]
    await expect(service.withdraw(userId, { amount: overdraftAmount }))
      .rejects.toThrow(BadRequestException)
  }
), { numRuns: 100 })
```

**Property 22 — Portfolio data isolation**
```typescript
// Feature: brickfi-platform, Property 22: Portfolio data isolation
// Set up two users with different investments
// Assert: getDashboard(userA.id) never contains any data from userB
```

**Acceptance criteria:**
- Both property tests pass with `numRuns: 100`
- Overdraft test covers amounts just above balance (e.g. `balance + 0.01`) and far above
- Isolation test verifies investment records, distribution records, and transaction records are all scoped

---

## Documentation Issues

---

### [good first issue] Add `CONTRIBUTING.md`

**Type:** Documentation
**File:** `CONTRIBUTING.md` (new file at repo root)
**Effort:** ~2 hours

**What to include:**
- How to set up the dev environment (prerequisites, `.env` setup, migration, start)
- Branch naming convention: `feat/`, `fix/`, `test/`, `docs/`
- Commit message format (conventional commits: `feat:`, `fix:`, `test:`, `docs:`)
- How to run tests before submitting a PR
- PR checklist: tests pass, TypeScript compiles, no lint errors
- Where to find the spec files for context (`.kiro/specs/brickfi-platform/`)
- How issues are structured and what "definition of done" means

**Acceptance criteria:**
- File exists at `CONTRIBUTING.md`
- Covers all sections above
- Commands are accurate and tested

---

### [good first issue] Add inline comments to the database migration

**Type:** Documentation
**File:** `brickfi-backend/src/migrations/1713000000000-CreateInitialSchema.ts`
**Effort:** ~1 hour

**Context:**
The migration creates all 7 tables but has no comments explaining the design decisions — why certain fields exist, what the unique constraints prevent, and what the on-chain fields are for.

**What to do:**
Add inline comments above each `CREATE TABLE` block and above non-obvious columns. Example:

```typescript
// Properties table
// nft_asset_code / nft_tx_hash: set after Stellar NFT mint on property creation
// token_asset_code: "BF-{short_code}" — the fungible Investment_Token asset code
// token_issuer: platform's Stellar issuer account public key
await queryRunner.query(`CREATE TABLE "properties" ...`)
```

**Acceptance criteria:**
- Every table has a comment explaining its purpose
- Non-obvious columns (on-chain fields, computed fields, status enums) have inline comments
- No functional changes to the SQL

---

### [good first issue] Add `.env.example` validation instructions to README

**Type:** Documentation
**File:** `README.md`
**Effort:** ~30 minutes

**Context:**
The README explains what each env var does but doesn't explain what happens if one is wrong or missing. The Joi validation in `src/config/configuration.ts` will throw a descriptive error at startup — contributors should know this.

**What to do:**
Add a short section under "Environment Variables" explaining:
- The server validates all env vars at startup using Joi
- If a required var is missing, the server exits with a clear error message listing the missing var
- `STELLAR_NETWORK` must be exactly `testnet` or `mainnet` (not `TESTNET`, not `test`)
- `JWT_SECRET` should be at least 32 random characters in production (suggest `openssl rand -hex 32`)

**Acceptance criteria:**
- Section added to README under Environment Variables
- Includes the `openssl rand -hex 32` command for generating `JWT_SECRET`
- Mentions the startup validation behavior

---

## Issue Labels Quick Reference

| Label | Meaning |
|---|---|
| `good first issue` | Isolated scope, no deep codebase knowledge needed |
| `intermediate` | Requires reading 1–2 modules |
| `advanced` | Cross-module or Stellar integration work |
| `feature` | New functionality |
| `bug` | Something broken or producing wrong output |
| `testing` | Unit or property-based tests |
| `property-based-test` | fast-check property tests specifically |
| `documentation` | Docs, comments, README |
| `validation` | Input validation / DTO constraints |
| `stellar` | Involves Stellar SDK or Horizon API |
| `good first issue` | Suitable for first-time contributors |
