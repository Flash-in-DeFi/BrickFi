# BrickFi Platform — GitHub Issues

Generated from the spec at `.kiro/specs/brickfi-platform/`. Each issue is self-contained with full context, acceptance criteria, implementation steps, and definition of done. Optional tasks are labeled `optional` and can be skipped for a faster MVP.

---

## Issue #1 — Scaffold NestJS project with core infrastructure

**Labels:** `infrastructure`, `done`
**Status:** Completed
**Requirements:** 9.1, 10.5

### Context

This is the foundation for the entire backend. Every subsequent issue depends on the project structure, database connection, queue connection, and environment config established here.

### What was done

- NestJS project initialized at `brickfi-backend/` with TypeScript, ESLint, and Prettier
- All runtime dependencies installed: `@nestjs/typeorm`, `typeorm`, `pg`, `@nestjs/bullmq`, `bullmq`, `@nestjs/config`, `joi`, `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `bcrypt`, `class-validator`, `class-transformer`, `@stellar/stellar-sdk`
- Dev dependencies: `fast-check`, `jest`, `ts-jest`, `@nestjs/testing`
- `src/config/configuration.ts` — Joi validation schema enforcing all 6 required env vars
- `src/app.module.ts` — global `ConfigModule`, async `TypeOrmModule` (postgres), async `BullModule` (redis)
- `src/data-source.ts` — standalone `DataSource` for TypeORM CLI migrations
- `src/migrations/1713000000000-CreateInitialSchema.ts` — single migration creating all 7 tables

### Tables created by the migration

| Table | Key columns |
|---|---|
| `users` | `id`, `email`, `phone`, `password_hash`, `wallet_address`, `role` |
| `properties` | `id`, `name`, `location`, `total_value_usd`, `total_units`, `price_per_unit`, `annual_yield`, `is_active`, `short_code`, `nft_asset_code`, `nft_tx_hash`, `token_asset_code`, `token_issuer` |
| `investments` | `id`, `user_id`, `property_id`, `units_owned`, `total_invested` — UNIQUE(`user_id`, `property_id`) |
| `rent_payments` | `id`, `property_id`, `amount_usd`, `fee_percentage`, `net_amount_usd`, `period` — UNIQUE(`property_id`, `period`) |
| `distributions` | `id`, `user_id`, `property_id`, `rent_payment_id`, `amount_usdc`, `status`, `tx_hash`, `period` |
| `transactions` | `id`, `user_id`, `type`, `amount`, `tx_hash`, `status` |
| `audit_logs` | `id`, `user_id`, `action`, `resource`, `resource_id`, `metadata` |

### Environment variables required (see `.env.example`)

```
DATABASE_URL=postgres://user:password@localhost:5432/brickfi
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key
STELLAR_NETWORK=testnet
STELLAR_PLATFORM_SECRET=S...
STELLAR_ISSUER_PUBLIC_KEY=G...
```

### Running migrations

```bash
npm run migration:run
```

---

## Issue #2 — Implement Auth Module

**Labels:** `backend`, `auth`
**Requirements:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 9.1, 9.4
**Blocks:** Issues #3, #4, #6, #8, #9, #10

### Context

All protected endpoints depend on the JWT guard and roles guard built here. The `User` entity and `AuthModule` must be complete before any other module can enforce authentication or RBAC.

### Sub-issues

- #2.1 — Implement user registration and login endpoints *(required)*
- #2.2 — Write property tests for Auth Module *(optional)*
- #2.3 — Implement Freighter wallet connection endpoint *(required)*
- #2.4 — Write property test for wallet connection *(optional)*

---

## Issue #2.1 — Implement user registration and login endpoints

**Labels:** `backend`, `auth`
**Requirements:** 1.1, 1.2, 1.3, 1.4, 1.6, 1.7, 9.1
**Depends on:** #1

### Context

Core auth endpoints. Every other module uses `JwtAuthGuard` and `RolesGuard` from this issue. The `User` entity is also referenced as a foreign key in every other table.

### File structure to create

```
src/auth/
  auth.module.ts
  auth.controller.ts
  auth.service.ts
  auth.service.spec.ts
  dto/
    register.dto.ts
    login.dto.ts
  entities/
    user.entity.ts
  guards/
    jwt-auth.guard.ts
    roles.guard.ts
  decorators/
    roles.decorator.ts
  strategies/
    jwt.strategy.ts
```

### Implementation steps

**1. Create `User` entity** (`src/auth/entities/user.entity.ts`)

Map to the `users` table. Fields: `id` (UUID, PK), `email` (unique), `phone`, `password_hash`, `wallet_address` (nullable), `role` (`'investor' | 'admin'`, default `'investor'`), `created_at`.

**2. Create DTOs with validation**

`RegisterDto`: `email` (IsEmail), `phone` (IsString, optional), `password` (IsString, MinLength 8).
`LoginDto`: `email` (IsEmail), `password` (IsString).

**3. Implement `AuthService`**

```typescript
// register: hash password with bcrypt (saltRounds=10), save user, return JWT
async register(dto: RegisterDto): Promise<AuthResponse>

// login: find user by email, compare password with bcrypt.compare, return JWT
// throw UnauthorizedException if credentials invalid
async login(dto: LoginDto): Promise<AuthResponse>
```

- Use `@nestjs/jwt` `JwtService.sign({ sub: user.id, email: user.email, role: user.role })`
- Throw `ConflictException` (409) if email already exists
- Throw `UnauthorizedException` (401) for invalid credentials
- Never return `password_hash` in any response

**4. Implement `JwtStrategy`** (`src/auth/strategies/jwt.strategy.ts`)

Extend `PassportStrategy(Strategy)`. Read secret from `ConfigService`. Validate payload and return `{ userId, email, role }`.

**5. Implement `JwtAuthGuard`** (`src/auth/guards/jwt-auth.guard.ts`)

Extend `AuthGuard('jwt')`. Use as `@UseGuards(JwtAuthGuard)` on protected routes.

**6. Implement `RolesGuard` + `@Roles` decorator**

`@Roles('admin')` sets metadata. `RolesGuard` reads it and compares against `request.user.role`. Throw `ForbiddenException` (403) if role doesn't match.

**7. Implement `AuthController`**

```
POST /auth/register  → AuthService.register(dto)
POST /auth/login     → AuthService.login(dto)
```

**8. Wire `AuthModule`**

Import `TypeOrmModule.forFeature([User])`, `JwtModule.registerAsync(...)` (secret from ConfigService, expiresIn `'7d'`), `PassportModule`.

### Acceptance criteria

- `POST /auth/register` with valid body → 201 + `{ accessToken, user: { id, email, role } }`
- `POST /auth/register` with duplicate email → 409 Conflict
- `POST /auth/register` with missing fields → 400 Bad Request
- `POST /auth/login` with valid credentials → 200 + `{ accessToken, user }`
- `POST /auth/login` with wrong password → 401 Unauthorized
- Any protected endpoint with no/invalid JWT → 401 Unauthorized
- Any admin endpoint called by investor JWT → 403 Forbidden
- `password_hash` in DB never equals the plaintext password

---

## Issue #2.2 — Write property tests for Auth Module *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 1.1, 1.2, 1.4, 1.6, 1.7
**Depends on:** #2.1

### Context

Property-based tests using `fast-check` to verify auth invariants hold across arbitrary valid inputs. Tests live in `src/auth/auth.service.spec.ts` alongside unit tests.

### Testing conventions

- Use `fc.assert(fc.property(...), { numRuns: 100 })`
- Tag each test: `// Feature: brickfi-platform, Property N: <name>`
- Mock the TypeORM repository and JwtService — do not hit a real DB
- Use `@nestjs/testing` `Test.createTestingModule`

### Properties to implement

**Property 1 — Registration produces a valid JWT**
```
// Feature: brickfi-platform, Property 1: Registration produces a valid JWT
```
Generator: `fc.record({ email: fc.emailAddress(), phone: fc.string(), password: fc.string({ minLength: 8 }) })`
Assert: `register(dto)` returns `{ accessToken }` where `accessToken` is a non-empty string matching JWT format (`/^[\w-]+\.[\w-]+\.[\w-]+$/`).

**Property 2 — Register-then-login round trip**
```
// Feature: brickfi-platform, Property 2: Register-then-login round trip
```
Generator: same as Property 1.
Assert: after `register(dto)`, calling `login({ email, password })` returns a non-empty `accessToken`.

**Property 3 — Invalid credentials always return 401**
```
// Feature: brickfi-platform, Property 3: Invalid credentials always return 401
```
Generator: `fc.record({ email: fc.emailAddress(), password: fc.string({ minLength: 8 }) })` + a different `wrongPassword`.
Assert: after registering with `password`, calling `login({ email, password: wrongPassword })` throws `UnauthorizedException`.

**Property 5 — Invalid JWT always returns 401 on protected endpoints**
```
// Feature: brickfi-platform, Property 5: Invalid JWT always returns 401 on protected endpoints
```
Generator: `fc.string()` (arbitrary non-JWT strings).
Assert: `JwtAuthGuard` rejects the token and the guard throws `UnauthorizedException`.

**Property 6 — Passwords are never stored in plaintext**
```
// Feature: brickfi-platform, Property 6: Passwords are never stored in plaintext
```
Generator: `fc.string({ minLength: 8 })`.
Assert: after `register`, the `password_hash` saved to the repository never equals the plaintext password.

---

## Issue #2.3 — Implement Freighter wallet connection endpoint

**Labels:** `backend`, `auth`, `stellar`
**Requirements:** 1.5, 9.4
**Depends on:** #2.1, #7.1

### Context

Investors must connect a Stellar wallet before they can invest (Issue #4.1 checks for `wallet_address`). This endpoint verifies the Freighter signature and persists the wallet address on the user record.

### Implementation steps

**1. Add `connectWallet` to `AuthService`**

```typescript
async connectWallet(userId: string, walletAddress: string, signature: string): Promise<void>
```

- Call `StellarService.verifySignature(walletAddress, message, signature)` where `message` is a deterministic string e.g. `"BrickFi wallet verification"`.
- If verification fails → throw `UnauthorizedException` (401).
- Update `users.wallet_address = walletAddress` for the given `userId`.

**2. Add endpoint to `AuthController`**

```
POST /auth/connect-wallet   (requires JwtAuthGuard)
Body: { wallet_address: string, signature: string }
```

- Extract `userId` from `request.user.userId`.
- Return 200 on success.

**3. DTO**

`ConnectWalletDto`: `wallet_address` (IsString, IsNotEmpty), `signature` (IsString, IsNotEmpty).

### Acceptance criteria

- `POST /auth/connect-wallet` with valid JWT + valid signature → 200, user's `wallet_address` updated in DB
- Invalid or forged signature → 401 Unauthorized
- No JWT → 401 Unauthorized
- Subsequent `GET /profile` (or any endpoint returning user) reflects the new `wallet_address`

---

## Issue #2.4 — Write property test for wallet connection *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 1.5
**Depends on:** #2.3

### Property to implement

**Property 4 — Wallet connection associates address with user**
```
// Feature: brickfi-platform, Property 4: Wallet connection associates address with user
```
Generator: `fc.record({ walletAddress: fc.string({ minLength: 56, maxLength: 56 }) })` (Stellar addresses are 56 chars).
Mock `StellarService.verifySignature` to return `true`.
Assert: after `connectWallet(userId, walletAddress, signature)`, fetching the user from the repository shows `wallet_address === walletAddress`.

---

## Issue #3 — Implement Property Module

**Labels:** `backend`, `property`
**Requirements:** 2.1–2.10, 8.2
**Depends on:** #2.1, #7.2
**Blocks:** #4, #6, #8

### Sub-issues

- #3.1 — Implement property CRUD endpoints *(required)*
- #3.2 — Write property tests for Property Module *(optional)*

---

## Issue #3.1 — Implement property CRUD endpoints

**Labels:** `backend`, `property`, `stellar`
**Requirements:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 8.2
**Depends on:** #2.1, #7.2

### Context

Properties are the core asset of the platform. Each property gets a Property NFT minted on Stellar at creation time. The `token_asset_code` derived here is used by the Investment Module to issue fractional tokens to investors.

### File structure to create

```
src/property/
  property.module.ts
  property.controller.ts
  property.service.ts
  property.service.spec.ts
  dto/
    create-property.dto.ts
    update-property.dto.ts
  entities/
    property.entity.ts
```

### Implementation steps

**1. Create `Property` entity** (`src/property/entities/property.entity.ts`)

Map to the `properties` table. All columns from the schema including: `nft_asset_code`, `nft_tx_hash`, `token_asset_code`, `token_issuer`, `short_code`. Add a virtual/computed getter `available_units` that is populated by the service (not stored).

**2. Create DTOs**

`CreatePropertyDto`:
- `name` (IsString, IsNotEmpty)
- `location` (IsString, IsNotEmpty)
- `total_value_usd` (IsNumber, Min 1)
- `total_units` (IsInt, Min 1)
- `annual_yield` (IsNumber, Min 0, Max 100)
- `images` (IsArray, IsString each, optional)
- `description` (IsString, optional)
- `short_code` (IsString, MaxLength 8, matches `/^[A-Z0-9]+$/`) — used to derive asset codes

`UpdatePropertyDto`: `PartialType(CreatePropertyDto)` — all fields optional.

**3. Implement `PropertyService`**

```typescript
async createProperty(dto: CreatePropertyDto): Promise<Property>
```
Steps:
1. Compute `price_per_unit = total_value_usd / total_units`
2. Derive `token_asset_code = "BF-" + short_code` (max 12 chars total — validate)
3. Derive `nft_asset_code = "BF-NFT-" + short_code`
4. Call `StellarService.mintPropertyNFT(tempId, nft_asset_code)` — **before** saving to DB
5. If mint fails → throw `ServiceUnavailableException` (503), do not persist
6. Save property with `nft_tx_hash`, `token_asset_code`, `token_issuer` (= `STELLAR_ISSUER_PUBLIC_KEY`)
7. Return saved property

```typescript
async listProperties(): Promise<Property[]>
// WHERE is_active = true

async getProperty(id: string): Promise<Property>
// Include computed available_units = total_units - SUM(investments.units_owned)
// Throw NotFoundException (404) if not found

async updateProperty(id: string, dto: UpdatePropertyDto): Promise<Property>
// Throw NotFoundException if not found
// Do NOT allow updating short_code, token_asset_code, nft_asset_code after creation
```

**4. Implement `PropertyController`**

```
POST   /properties        @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
GET    /properties        @UseGuards(JwtAuthGuard)
GET    /properties/:id    @UseGuards(JwtAuthGuard)
PATCH  /properties/:id    @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
```

**5. Wire `PropertyModule`**

Import `TypeOrmModule.forFeature([Property])`, `StellarModule`, `AuthModule` (for guards).

### Derived value formulas

```
price_per_unit  = total_value_usd / total_units
token_asset_code = "BF-" + short_code          // e.g. "BF-LAGOS01"
nft_asset_code   = "BF-NFT-" + short_code      // e.g. "BF-NFT-LAGOS01"
available_units  = total_units - SUM(investments.units_owned WHERE property_id = id)
```

### Acceptance criteria

- `POST /properties` by admin with valid body → 201 + property record with non-null `nft_tx_hash`, `token_asset_code`, `token_issuer`
- `POST /properties` by investor → 403 Forbidden
- `POST /properties` with missing required fields → 400 Bad Request with field errors
- `POST /properties` when Stellar mint fails → 503, no DB record created
- `GET /properties` → 200 + array of active properties
- `GET /properties/:id` → 200 + property with `available_units` computed
- `GET /properties/:nonexistent` → 404 Not Found
- `PATCH /properties/:id` by admin → 200 + updated property
- `PATCH /properties/:id` by investor → 403 Forbidden

---

## Issue #3.2 — Write property tests for Property Module *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 2.2, 2.3, 2.4, 2.5, 2.7, 2.8, 2.10, 8.2
**Depends on:** #3.1

### Testing setup

File: `src/property/property.service.spec.ts`
Mock `StellarService.mintPropertyNFT` to return `{ txHash: 'mock-hash', success: true }` by default.
Use TypeORM in-memory test utilities or mock the repository.

### Properties to implement

**Property 7 — price_per_unit invariant**
```
// Feature: brickfi-platform, Property 7: price_per_unit invariant
```
Generator: `fc.float({ min: 1000, max: 10_000_000 })` × `fc.integer({ min: 1, max: 10000 })`.
Assert: `property.price_per_unit` is within floating-point tolerance of `total_value_usd / total_units`.

**Property 8 — Property list completeness**
```
// Feature: brickfi-platform, Property 8: Property list completeness
```
Generator: `fc.integer({ min: 1, max: 20 })` (N properties to create).
Assert: after creating N properties, `listProperties()` returns exactly N items.

**Property 9 — Property fetch round trip**
```
// Feature: brickfi-platform, Property 9: Property fetch round trip
```
Generator: valid `CreatePropertyDto` with arbitrary field values.
Assert: `getProperty(created.id)` returns an object where all input fields match.

**Property 10 — Non-admin cannot create property (RBAC)**
```
// Feature: brickfi-platform, Property 10: Non-admin cannot create property (RBAC)
```
Generator: arbitrary `CreatePropertyDto`.
Assert: calling the controller's `createProperty` with an investor-role user context always throws `ForbiddenException`.

**Property 11 — available_units invariant**
```
// Feature: brickfi-platform, Property 11: available_units invariant
```
Generator: `fc.integer({ min: 10, max: 1000 })` (total_units T) + `fc.integer({ min: 0, max: T })` (invested S).
Assert: `getProperty(id).available_units === T - S`.

**Property 26 — Property update round trip**
```
// Feature: brickfi-platform, Property 26: Property update round trip
```
Generator: arbitrary `UpdatePropertyDto` (subset of fields).
Assert: after `updateProperty(id, dto)`, `getProperty(id)` reflects all updated fields.

**Property 27 — Property NFT minted on property creation**
```
// Feature: brickfi-platform, Property 27: Property NFT minted on property creation
```
Assert: `mintPropertyNFT` is called exactly once per `createProperty` call, and the returned `nft_tx_hash` is stored on the property record.

**Property 30 — NFT minting failure rolls back property creation**
```
// Feature: brickfi-platform, Property 30: NFT minting failure rolls back property creation
```
Mock `mintPropertyNFT` to throw. Assert: `createProperty` throws `ServiceUnavailableException` and no record exists in the repository.

---

## Issue #4 — Implement Investment Module

**Labels:** `backend`, `investment`
**Requirements:** 3.1–3.10
**Depends on:** #2.1, #3.1, #7.2
**Blocks:** #8, #9

### Sub-issues

- #4.1 — Implement investment endpoints *(required)*
- #4.2 — Write property tests for Investment Module *(optional)*

---

## Issue #4.1 — Implement investment endpoints

**Labels:** `backend`, `investment`, `stellar`
**Requirements:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
**Depends on:** #2.1, #3.1, #7.2

### Context

Investment is the most critical transactional flow. It must be atomic: either the DB record is created AND the on-chain tokens are issued, or neither happens. The Stellar ledger is the source of truth — if the DB commit fails after a successful token issuance, the discrepancy is logged for manual reconciliation.

### File structure to create

```
src/investment/
  investment.module.ts
  investment.controller.ts
  investment.service.ts
  investment.service.spec.ts
  dto/
    invest.dto.ts
  entities/
    investment.entity.ts
```

### Implementation steps

**1. Create `Investment` entity**

Map to `investments` table. Columns: `id`, `user_id`, `property_id`, `units_owned`, `total_invested`, `created_at`. Add `@Unique(['user_id', 'property_id'])`. Add `@ManyToOne` relations to `User` and `Property`.

**2. Create `InvestDto`**

- `property_id` (IsUUID)
- `units` (IsInt, Min 1)

**3. Implement `InvestmentService.invest`**

```typescript
async invest(userId: string, dto: InvestDto): Promise<Investment>
```

Atomic two-phase flow using a TypeORM `QueryRunner`:

```
1. queryRunner.startTransaction()
2. SELECT property FOR UPDATE (lock row)
3. Compute available_units = total_units - SUM(units_owned) for this property
4. If units > available_units → throw BadRequestException (400)
5. Fetch user; if user.wallet_address is null → throw BadRequestException (400) with message "Connect a Stellar wallet before investing"
6. Call StellarService.issueInvestmentTokens(user.wallet_address, property.token_asset_code, units.toString())
7. If issueInvestmentTokens fails → rollback, throw ServiceUnavailableException (503)
8. UPSERT investment record:
   - If record exists for (user_id, property_id): units_owned += units, total_invested += units * price_per_unit
   - Else: INSERT new record
9. queryRunner.commitTransaction()
10. Return investment record
```

If step 9 fails after step 6 succeeded: log a critical warning with `userId`, `propertyId`, `units`, `txHash` for manual reconciliation.

```typescript
async getUserInvestments(userId: string): Promise<InvestmentWithProperty[]>
// JOIN with properties table, return all investments for this user
```

**4. Implement `InvestmentController`**

```
POST /invest          @UseGuards(JwtAuthGuard)   → invest(req.user.userId, dto)
GET  /investments     @UseGuards(JwtAuthGuard)   → getUserInvestments(req.user.userId)
```

**5. Wire `InvestmentModule`**

Import `TypeOrmModule.forFeature([Investment, Property, User])`, `StellarModule`.

### Acceptance criteria

- `POST /invest` with valid body + wallet registered → 201 + investment record with correct `total_invested = units × price_per_unit`
- `POST /invest` for same property twice → single record with cumulative `units_owned`
- `POST /invest` requesting more units than available → 400 Bad Request
- `POST /invest` for non-existent property → 404 Not Found
- `POST /invest` when user has no wallet → 400 Bad Request with wallet instruction message
- `POST /invest` when Stellar token issuance fails → 503, no DB record created
- `GET /investments` → 200 + all investments for the authenticated user with property details
- No JWT → 401 Unauthorized

---

## Issue #4.2 — Write property tests for Investment Module *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 3.2, 3.5, 3.6, 3.7, 3.8, 3.10
**Depends on:** #4.1

### Properties to implement

**Property 12 — total_invested invariant**
```
// Feature: brickfi-platform, Property 12: total_invested invariant
```
Generator: `fc.integer({ min: 1, max: 100 })` (units U) × `fc.float({ min: 1, max: 10000 })` (price_per_unit P).
Assert: `investment.total_invested` is within tolerance of `U × P`.

**Property 13 — Investment accumulation (no duplicate records)**
```
// Feature: brickfi-platform, Property 13: Investment accumulation
```
Generator: `fc.array(fc.integer({ min: 1, max: 10 }), { minLength: 2, maxLength: 5 })` (multiple unit purchase amounts).
Assert: after N purchases on the same property by the same user, exactly one `Investment` record exists with `units_owned = sum of all purchases`.

**Property 14 — User investments fetch completeness**
```
// Feature: brickfi-platform, Property 14: User investments fetch completeness
```
Generator: `fc.integer({ min: 1, max: 10 })` (N distinct properties to invest in).
Assert: `getUserInvestments(userId)` returns exactly N records.

**Property 28 — Investment token balance matches DB units_owned**
```
// Feature: brickfi-platform, Property 28: Investment token balance matches DB units_owned
```
Mock `StellarService.getTokenBalance` to return the same value as `units_owned`.
Assert: for any investment, `getTokenBalance(wallet, assetCode) == investment.units_owned`.

**Property 29 — Token issuance is atomic with investment record**
```
// Feature: brickfi-platform, Property 29: Token issuance is atomic with investment record
```
Scenario A: mock `issueInvestmentTokens` to throw → assert no DB record created.
Scenario B: mock `issueInvestmentTokens` to succeed → assert DB record exists.
Assert: no intermediate state where one exists without the other.

---

## Issue #5 — Checkpoint: Ensure all tests pass (mid-project)

**Labels:** `checkpoint`, `testing`
**Depends on:** #2.1, #2.3, #3.1, #4.1

### Instructions

1. Run the full test suite: `npm test -- --runInBand`
2. All tests in `src/auth/`, `src/property/`, `src/investment/` must pass
3. Fix any failures before proceeding to Issue #6
4. If optional property tests (#2.2, #2.4, #3.2, #4.2) were implemented, they must also pass
5. Check TypeScript compiles cleanly: `npx tsc --noEmit`

### Definition of done

- `npm test` exits with code 0
- `npx tsc --noEmit` exits with code 0
- No skipped or pending tests

---

## Issue #6 — Implement Rent Module

**Labels:** `backend`, `rent`
**Requirements:** 4.1–4.4
**Depends on:** #2.1, #3.1
**Blocks:** #8

### Sub-issues

- #6.1 — Implement rent payment endpoints *(required)*
- #6.2 — Write property tests for Rent Module *(optional)*

---

## Issue #6.1 — Implement rent payment endpoints

**Labels:** `backend`, `rent`
**Requirements:** 4.1, 4.2, 4.3, 4.4
**Depends on:** #2.1, #3.1

### Context

Rent payments are the input to the distribution calculation. The `net_amount_usd` stored here is what gets distributed to investors. The unique constraint on `(property_id, period)` prevents double-entry.

### File structure to create

```
src/rent/
  rent.module.ts
  rent.controller.ts
  rent.service.ts
  rent.service.spec.ts
  dto/
    add-rent.dto.ts
  entities/
    rent-payment.entity.ts
```

### Implementation steps

**1. Create `RentPayment` entity**

Map to `rent_payments` table. Columns: `id`, `property_id`, `amount_usd`, `fee_percentage` (default 2.0), `net_amount_usd`, `period`, `created_at`. Add `@Unique(['property_id', 'period'])`.

**2. Create `AddRentDto`**

- `property_id` (IsUUID)
- `amount_usd` (IsNumber, Min 0.01)
- `period` (IsString, matches `/^\d{4}-(0[1-9]|1[0-2])$/` — format `YYYY-MM`)
- `fee_percentage` (IsNumber, Min 1, Max 3, optional — defaults to 2.0)

**3. Implement `RentService`**

```typescript
async addRentPayment(dto: AddRentDto): Promise<RentPayment>
```
- Verify property exists → 404 if not
- Check for existing record with same `(property_id, period)` → throw `ConflictException` (409) if found
- Compute `net_amount_usd = amount_usd * (1 - fee_percentage / 100)`
- Save and return record

```typescript
async getRentPayments(propertyId: string): Promise<RentPayment[]>
// Return all rent payments for the property ordered by period DESC

async getNetRent(propertyId: string, period: string): Promise<number>
// Used internally by DistributionService
```

**4. Implement `RentController`**

```
POST /rent/add              @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
GET  /rent/:propertyId      @UseGuards(JwtAuthGuard)
```

### Acceptance criteria

- `POST /rent/add` by admin with valid body → 201 + rent record with correct `net_amount_usd`
- `POST /rent/add` for same `(property_id, period)` twice → 409 Conflict
- `POST /rent/add` for non-existent property → 404 Not Found
- `POST /rent/add` by investor → 403 Forbidden
- `POST /rent/add` with invalid period format → 400 Bad Request
- `GET /rent/:propertyId` → 200 + array of rent records

### Fee formula

```
net_amount_usd = amount_usd × (1 - fee_percentage / 100)
// Example: $10,000 gross at 2% fee → $9,800 net
```

---

## Issue #6.2 — Write property tests for Rent Module *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 4.3, 4.4
**Depends on:** #6.1

### Properties to implement

**Property 15 — Net rent fee invariant**
```
// Feature: brickfi-platform, Property 15: Net rent fee invariant
```
Generator: `fc.float({ min: 100, max: 1_000_000 })` (gross G) × `fc.float({ min: 1, max: 3 })` (fee F).
Assert: `rentPayment.net_amount_usd` is within tolerance of `G × (1 - F / 100)`.

**Property 10 (RBAC) — Investor cannot add rent**
```
// Feature: brickfi-platform, Property 10: Non-admin cannot add rent (RBAC)
```
Generator: arbitrary `AddRentDto`.
Assert: calling `addRentPayment` via the controller with an investor-role context always throws `ForbiddenException`.

---

## Issue #7 — Implement Stellar Module

**Labels:** `backend`, `stellar`
**Requirements:** 10.1–10.9
**Depends on:** #1
**Blocks:** #2.3, #3.1, #4.1, #8.1, #8.3, #9.1, #11.1

### Context

The Stellar Module is a shared service used by almost every other module. It wraps `@stellar/stellar-sdk` and abstracts all Horizon API interactions. All other modules depend on this — implement it early and mock it in all other module tests.

### Sub-issues

- #7.1 — Implement Stellar service — USDC and signature methods *(required)*
- #7.2 — Implement Stellar service — NFT minting and token issuance methods *(required)*
- #7.3 — Write unit tests for Stellar Module *(optional)*

---

## Issue #7.1 — Implement Stellar service — USDC and signature methods

**Labels:** `backend`, `stellar`
**Requirements:** 10.1, 10.2, 10.3, 10.5
**Depends on:** #1

### File structure to create

```
src/stellar/
  stellar.module.ts
  stellar.service.ts
  stellar.service.spec.ts
```

### Implementation steps

**1. Bootstrap `StellarService`**

Inject `ConfigService`. In the constructor:
- Load `STELLAR_NETWORK` → set `Networks.TESTNET` or `Networks.PUBLIC`
- Load `STELLAR_PLATFORM_SECRET` → create `Keypair.fromSecret(...)`
- Load `STELLAR_ISSUER_PUBLIC_KEY`
- Instantiate `new Horizon.Server(horizonUrl)` where `horizonUrl` is `https://horizon-testnet.stellar.org` for testnet

**2. Implement `sendUSDC`**

```typescript
async sendUSDC(destination: string, amount: string, memo?: string): Promise<StellarTxResult>
```
- Load platform account via `server.loadAccount(platformKeypair.publicKey())`
- Build transaction:
  - `new TransactionBuilder(account, { fee, networkPassphrase })`
  - `.addOperation(Operation.payment({ destination, asset: new Asset('USDC', USDC_ISSUER), amount }))`
  - Optionally `.addMemo(Memo.text(memo))`
  - `.setTimeout(30).build()`
- Sign with `platformKeypair`
- Submit via `server.submitTransaction(tx)`
- Return `{ txHash: result.hash, success: true }`
- On error: return `{ txHash: '', success: false, error: e.message }`

USDC issuer on testnet: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`

**3. Implement `verifySignature`**

```typescript
async verifySignature(address: string, message: string, signature: string): Promise<boolean>
```
- Use `Keypair.fromPublicKey(address)`
- `keypair.verify(Buffer.from(message), Buffer.from(signature, 'base64'))`
- Return `true` if valid, `false` otherwise (never throw)

**4. Implement `getBalance`**

```typescript
async getBalance(address: string): Promise<string>
```
- `server.loadAccount(address)` → find balance entry where `asset_code === 'USDC'`
- Return the balance string, or `"0"` if no USDC trustline

**5. Wire `StellarModule`**

Export `StellarService`. Mark as `@Global()` so all modules can inject it without re-importing.

### Acceptance criteria

- `sendUSDC` builds a signed payment transaction and submits to Horizon; returns `txHash` on success
- `verifySignature` returns `true` for a valid Stellar keypair signature, `false` for any invalid input
- `getBalance` returns the USDC balance string for an account, `"0"` if no trustline
- Network (testnet/mainnet) is determined solely by `STELLAR_NETWORK` env var

---

## Issue #7.2 — Implement Stellar service — NFT minting and token issuance methods

**Labels:** `backend`, `stellar`
**Requirements:** 10.6, 10.7, 10.8, 10.9
**Depends on:** #7.1

### Implementation steps

**1. Implement `mintPropertyNFT`**

```typescript
async mintPropertyNFT(propertyId: string, assetCode: string): Promise<StellarTxResult>
```

Stellar classic NFT pattern — issue exactly 1 unit to the issuer itself, then lock:

```
1. Load issuer account from Horizon
2. Create asset: new Asset(assetCode, issuerKeypair.publicKey())
3. Build transaction with two operations:
   a. ChangeTrust: issuer trusts its own asset (limit "1")
   b. Payment: issuer sends 1 unit to itself
4. Sign with issuerKeypair
5. Submit to Horizon
6. (Optional) SetOptions to lock further issuance: set AUTH_REQUIRED + AUTH_REVOCABLE flags
7. Return { txHash: result.hash, success: true }
```

On any Horizon error: return `{ txHash: '', success: false, error: e.message }`.

**2. Implement `issueInvestmentTokens`**

```typescript
async issueInvestmentTokens(destination: string, assetCode: string, amount: string): Promise<StellarTxResult>
```

- Create asset: `new Asset(assetCode, issuerKeypair.publicKey())`
- Load issuer account
- Build payment transaction: issuer → destination, asset, amount
- Sign and submit
- Handle trustline error (`op_no_trust`): return `{ success: false, error: 'Investor wallet has no trustline for this asset. Ask investor to add trustline.' }`
- Return `{ txHash, success: true }` on success

**3. Implement `getTokenBalance`**

```typescript
async getTokenBalance(walletAddress: string, assetCode: string): Promise<string>
```

- `server.loadAccount(walletAddress)`
- Find balance entry where `asset_code === assetCode` AND `asset_issuer === STELLAR_ISSUER_PUBLIC_KEY`
- Return balance string, or `"0"` if no trustline or account not found

### Acceptance criteria

- `mintPropertyNFT` issues exactly 1 unit of the NFT asset and returns a non-empty `txHash`
- `issueInvestmentTokens` sends the correct amount of the correct asset to the investor wallet
- `issueInvestmentTokens` returns a descriptive error (not a throw) when the investor has no trustline
- `getTokenBalance` returns the correct balance for a known asset, `"0"` for unknown/no trustline

---

## Issue #7.3 — Write unit tests for Stellar Module *(optional)*

**Labels:** `testing`, `optional`
**Requirements:** 10.1, 10.2, 10.6, 10.7, 10.8, 10.9
**Depends on:** #7.1, #7.2

### Testing approach

File: `src/stellar/stellar.service.spec.ts`

Mock the Horizon `Server` class entirely — do not make real network calls. Use `jest.mock` or inject a mock server via the NestJS testing module.

### Tests to implement

**`sendUSDC`**
- Builds a payment operation with correct `destination`, `asset`, `amount`
- Signs the transaction with the platform keypair
- Calls `server.submitTransaction` exactly once
- Returns `{ txHash, success: true }` on success
- Returns `{ success: false, error }` when `submitTransaction` throws

**`verifySignature`**
- Returns `true` when signature is valid for the given address and message
- Returns `false` for a tampered message
- Returns `false` for a signature from a different keypair
- Never throws — returns `false` on any error

**`mintPropertyNFT`**
- Calls `server.submitTransaction` with a transaction containing a payment of exactly `"1"` unit
- Returns `{ txHash: 'mock-hash', success: true }` on success
- Returns `{ success: false }` when Horizon throws

**`issueInvestmentTokens`**
- Builds a payment to the correct `destination` with the correct `assetCode` and `amount`
- Returns descriptive error string when Horizon returns `op_no_trust`

**`getTokenBalance`**
- Returns the balance string from a mocked account response
- Returns `"0"` when the account has no balance entry for the asset
- Returns `"0"` when `loadAccount` throws (account not found)

---

## Issue #8 — Implement Distribution Module

**Labels:** `backend`, `distribution`
**Requirements:** 5.1–5.8, 11.3
**Depends on:** #2.1, #3.1, #4.1, #6.1, #7.1
**Blocks:** #9

### Sub-issues

- #8.1 — Implement distribution calculation and record creation *(required)*
- #8.2 — Write property tests for distribution calculation *(optional)*
- #8.3 — Implement distribution Stellar sending via BullMQ queue *(required)*
- #8.4 — Write property tests for distribution idempotency and status updates *(optional)*

---

## Issue #8.1 — Implement distribution calculation and record creation

**Labels:** `backend`, `distribution`, `stellar`
**Requirements:** 5.1, 5.2, 5.5, 5.8, 11.3
**Depends on:** #2.1, #3.1, #4.1, #6.1, #7.1

### Context

The distribution trigger is the most complex endpoint. It must: query on-chain balances (with DB fallback), calculate proportional payouts, create all pending records atomically, then hand off to the BullMQ queue (Issue #8.3) for async Stellar sending.

### File structure to create

```
src/distribution/
  distribution.module.ts
  distribution.controller.ts
  distribution.service.ts
  distribution.service.spec.ts
  distribution.processor.ts      (BullMQ processor — Issue #8.3)
  dto/
    trigger-distribution.dto.ts
  entities/
    distribution.entity.ts
```

### Implementation steps

**1. Create `Distribution` entity**

Map to `distributions` table. Columns: `id`, `user_id`, `property_id`, `rent_payment_id`, `amount_usdc`, `status` (`'pending' | 'sent' | 'failed'`), `tx_hash`, `period`, `created_at`.

**2. Create `TriggerDistributionDto`**

- `property_id` (IsUUID)
- `period` (IsString, matches `YYYY-MM`)

**3. Implement `DistributionService.triggerDistribution`**

```typescript
async triggerDistribution(propertyId: string, period: string): Promise<DistributionSummary>
```

Step-by-step:

```
1. Fetch rent_payment for (property_id, period) → 404 if not found
2. Fetch all investments for the property (JOIN users to get wallet_address)
3. Check if all distributions for this (property_id, period) are already "sent" → 409 Conflict
4. For each investor:
   a. Try: balance = await StellarService.getTokenBalance(investor.wallet_address, property.token_asset_code)
   b. Catch (Horizon unavailable): balance = investment.units_owned.toString(); log WARNING "Horizon unavailable, using DB fallback for userId=..."
5. Compute payout: (parseFloat(balance) / property.total_units) × rent_payment.net_amount_usd
6. In a SINGLE DB transaction, create all Distribution records with status "pending"
7. After DB commit, enqueue each record as a BullMQ job (Issue #8.3)
8. Return DistributionSummary
```

**4. Implement `DistributionController`**

```
POST /distribute          @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
POST /distribute/retry    @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)  (Issue #8.3)
```

### Payout formula

```
investor_payout = (on_chain_balance / property.total_units) × rent_payment.net_amount_usd
```

On-chain balance is primary. DB `units_owned` is fallback only when Horizon is unavailable.

### Acceptance criteria

- `POST /distribute` by admin → 201 + `DistributionSummary` with all records as `"pending"`
- All `Distribution` records exist in DB before any Stellar call is made
- Payout amounts are proportional to on-chain token balances
- When Horizon is unavailable, falls back to DB `units_owned` and logs a warning
- `POST /distribute` for a fully-sent period → 409 Conflict
- `POST /distribute` by investor → 403 Forbidden

---

## Issue #8.2 — Write property tests for distribution calculation *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 5.1, 5.2, 11.3
**Depends on:** #8.1

### Properties to implement

**Property 16 — Payout proportionality and conservation**
```
// Feature: brickfi-platform, Property 16: Payout proportionality and conservation
```
Generator: `fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 10 })` (investor balances) × `fc.float({ min: 100, max: 100_000 })` (net rent R).
Assert:
- Each `payout_i = (balance_i / total_units) × R` within tolerance
- `SUM(all payouts) ≈ R` within floating-point tolerance (use `toBeCloseTo`)

**Property 17 — Distribution records created before Stellar calls**
```
// Feature: brickfi-platform, Property 17: Distribution records created before Stellar calls
```
Use a spy on `StellarService` and the BullMQ queue.
Assert: all `Distribution` records with status `"pending"` exist in the repository before `queue.add` is called.

**Property 31 — On-chain balance used for distribution calculation**
```
// Feature: brickfi-platform, Property 31: On-chain balance used for distribution calculation
```
Set up: investor has `units_owned = 5` in DB but `getTokenBalance` returns `"10"`.
Assert: payout is calculated using `10`, not `5`.

---

## Issue #8.3 — Implement distribution Stellar sending via BullMQ queue

**Labels:** `backend`, `distribution`, `queue`
**Requirements:** 5.3, 5.4, 5.6, 5.7
**Depends on:** #8.1, #7.1

### Implementation steps

**1. Create `DistributionProcessor`** (`src/distribution/distribution.processor.ts`)

```typescript
@Processor('distribution')
export class DistributionProcessor extends WorkerHost {
  async process(job: Job<{ distributionId: string }>): Promise<void> {
    // 1. Fetch Distribution record by id
    // 2. If status is already "sent" → skip (idempotency)
    // 3. Fetch user wallet_address
    // 4. Call StellarService.sendUSDC(wallet, amount.toString(), `dist-${distributionId}`)
    // 5. On success: update status = "sent", tx_hash = result.txHash
    // 6. On failure: update status = "failed", log error
  }
}
```

**2. Configure BullMQ retry in `DistributionModule`**

```typescript
BullModule.registerQueue({
  name: 'distribution',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  },
})
```

**3. Implement `DistributionService.retryFailedDistributions`**

```typescript
async retryFailedDistributions(propertyId: string, period: string): Promise<void>
```
- Fetch all `Distribution` records with `status = "failed"` for `(property_id, period)`
- Re-enqueue each as a new BullMQ job
- Return count of re-enqueued jobs

**4. Add retry endpoint to `DistributionController`**

```
POST /distribute/retry
Body: { property_id, period }
@Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
```

### Acceptance criteria

- Each BullMQ job calls `sendUSDC` and updates the `Distribution` record to `"sent"` + stores `tx_hash`
- Failed Stellar calls update record to `"failed"` without throwing
- Jobs are retried up to 3 times with exponential backoff before being marked `"failed"`
- `POST /distribute/retry` re-enqueues only `"failed"` records, not `"sent"` ones
- Re-triggering a fully `"sent"` period does not submit any new Stellar transactions (idempotency check in processor)

---

## Issue #8.4 — Write property tests for distribution idempotency and status updates *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 5.4, 5.7
**Depends on:** #8.3

### Properties to implement

**Property 18 — Distribution status updated after confirmation**
```
// Feature: brickfi-platform, Property 18: Distribution status updated after confirmation
```
Mock `StellarService.sendUSDC` to return `{ txHash: 'abc123', success: true }`.
Assert: after the BullMQ job processes, the `Distribution` record has `status = "sent"` and `tx_hash = "abc123"`.

**Property 19 — Distribution idempotency**
```
// Feature: brickfi-platform, Property 19: Distribution idempotency
```
Set up: all `Distribution` records for a period already have `status = "sent"`.
Assert: calling `triggerDistribution` again returns 409 and `sendUSDC` is never called.

---

## Issue #9 — Implement Wallet Module and Dashboard Service

**Labels:** `backend`, `wallet`, `dashboard`
**Requirements:** 6.1–6.4, 7.1–7.5
**Depends on:** #2.1, #4.1, #8.1, #7.1

### Sub-issues

- #9.1 — Implement wallet balance and withdrawal endpoints *(required)*
- #9.2 — Write property tests for Wallet Module *(optional)*
- #9.3 — Implement investor dashboard endpoint *(required)*
- #9.4 — Write property tests for Dashboard Service *(optional)*

---

## Issue #9.1 — Implement wallet balance and withdrawal endpoints

**Labels:** `backend`, `wallet`, `stellar`
**Requirements:** 7.1, 7.2, 7.3, 7.4, 7.5
**Depends on:** #2.1, #8.1, #7.1

### File structure to create

```
src/wallet/
  wallet.module.ts
  wallet.controller.ts
  wallet.service.ts
  wallet.service.spec.ts
  dto/
    withdraw.dto.ts
  entities/
    transaction.entity.ts
```

### Implementation steps

**1. Create `Transaction` entity**

Map to `transactions` table. Columns: `id`, `user_id`, `type` (`'deposit' | 'withdrawal' | 'payout'`), `amount`, `tx_hash`, `status` (`'pending' | 'completed' | 'failed'`), `created_at`.

**2. Create `WithdrawDto`**

- `amount` (IsNumber, Min 0.0000001)

**3. Implement `WalletService.getBalance`**

```typescript
async getBalance(userId: string): Promise<WalletBalance>
```

```
available_usdc = SUM(distributions.amount_usdc WHERE user_id = userId AND status = "sent")
               - SUM(transactions.amount WHERE user_id = userId AND type = "withdrawal" AND status = "completed")

pending_usdc   = SUM(distributions.amount_usdc WHERE user_id = userId AND status = "pending")
total_earned   = SUM(distributions.amount_usdc WHERE user_id = userId AND status = "sent")
```

**4. Implement `WalletService.withdraw`**

```typescript
async withdraw(userId: string, dto: WithdrawDto): Promise<Transaction>
```

```
1. Compute available_usdc (same as getBalance)
2. If dto.amount > available_usdc → throw BadRequestException (400) "Insufficient balance"
3. Fetch user.wallet_address → if null → throw BadRequestException (400) "Connect a wallet first"
4. Call StellarService.sendUSDC(user.wallet_address, dto.amount.toString(), `withdrawal-${userId}`)
5. If sendUSDC fails → throw ServiceUnavailableException (503)
6. Create Transaction record: { user_id, type: "withdrawal", amount, tx_hash, status: "completed" }
7. Return transaction record
```

Balance is deducted only after the Stellar transaction is confirmed (step 6 creates the record that reduces available_usdc).

**5. Implement `WalletController`**

```
GET  /wallet      @UseGuards(JwtAuthGuard)  → getBalance(req.user.userId)
POST /withdraw    @UseGuards(JwtAuthGuard)  → withdraw(req.user.userId, dto)
```

### Acceptance criteria

- `GET /wallet` → 200 + `{ available_usdc, pending_usdc, total_earned }`
- `POST /withdraw` with amount ≤ balance → 201 + transaction record with `status: "completed"` and `tx_hash`
- `POST /withdraw` with amount > balance → 400 Bad Request
- `POST /withdraw` with no wallet connected → 400 Bad Request
- `POST /withdraw` when Stellar fails → 503, no transaction record created
- Balance is unchanged until Stellar confirms (no optimistic deduction)

---

## Issue #9.2 — Write property tests for Wallet Module *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 7.2, 7.5
**Depends on:** #9.1

### Properties to implement

**Property 23 — Overdraft prevention**
```
// Feature: brickfi-platform, Property 23: Overdraft prevention
```
Generator: `fc.float({ min: 0.01, max: 10000 })` (balance B) × `fc.float({ min: B + 0.01, max: B + 10000 })` (withdrawal A where A > B).
Assert: `withdraw(userId, { amount: A })` throws `BadRequestException`.

**Property 24 — Balance deducted only after confirmation**
```
// Feature: brickfi-platform, Property 24: Balance deducted only after confirmation
```
Mock `StellarService.sendUSDC` to throw on first call.
Assert: `getBalance` returns the same value before and after the failed withdrawal attempt.

---

## Issue #9.3 — Implement investor dashboard endpoint

**Labels:** `backend`, `dashboard`
**Requirements:** 6.1, 6.2, 6.3, 6.4
**Depends on:** #2.1, #4.1, #8.1, #9.1

### Implementation steps

Add `getDashboard` to `WalletService` (or a dedicated `DashboardService`):

```typescript
async getDashboard(userId: string): Promise<DashboardData>
```

Compute and return:

```typescript
interface DashboardData {
  portfolio_value: number        // SUM(investment.units_owned × property.price_per_unit)
  investments: Array<{
    property_id: string
    property_name: string
    units_owned: number
    price_per_unit: number
    value: number                // units_owned × price_per_unit
    monthly_earnings: number     // most recent sent distribution amount for this property
  }>
  total_roi: number              // (total_earnings_received / total_invested) × 100
  total_invested: number         // SUM(investment.total_invested)
  total_earnings: number         // SUM(distributions.amount_usdc WHERE status = "sent")
  recent_transactions: Array<{   // last 20, ordered by created_at DESC
    id: string
    type: string
    amount: number
    tx_hash: string
    status: string
    created_at: Date
  }>
}
```

All queries must be scoped to `userId` — never leak another user's data.

**Add endpoint to `WalletController`**

```
GET /dashboard    @UseGuards(JwtAuthGuard)  → getDashboard(req.user.userId)
```

### Acceptance criteria

- `GET /dashboard` → 200 + correct `portfolio_value`, `total_roi`, per-property breakdown
- `total_roi = (total_earnings / total_invested) × 100`
- `recent_transactions` ordered by `created_at` DESC
- Data is strictly scoped to the authenticated user — no cross-user data leakage

---

## Issue #9.4 — Write property tests for Dashboard Service *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 6.1, 6.2, 6.3, 6.4
**Depends on:** #9.3

### Properties to implement

**Property 20 — Portfolio value calculation correctness**
```
// Feature: brickfi-platform, Property 20: Portfolio value calculation correctness
```
Generator: `fc.array(fc.record({ units: fc.integer({ min: 1, max: 100 }), price: fc.float({ min: 1, max: 10000 }) }), { minLength: 1, maxLength: 10 })`.
Assert: `dashboard.portfolio_value ≈ SUM(units × price)` and `total_roi ≈ (total_earnings / total_invested) × 100`.

**Property 21 — Transaction history ordering**
```
// Feature: brickfi-platform, Property 21: Transaction history ordering
```
Generator: `fc.integer({ min: 2, max: 20 })` (N transactions with random timestamps).
Assert: `recent_transactions[i].created_at >= recent_transactions[i+1].created_at` for all i.

**Property 22 — Portfolio data isolation**
```
// Feature: brickfi-platform, Property 22: Portfolio data isolation
```
Set up two users A and B with different investments.
Assert: `getDashboard(userA.id)` never contains any investment, distribution, or transaction belonging to userB.

---

## Issue #10 — Implement Admin Module

**Labels:** `backend`, `admin`
**Requirements:** 8.1, 8.3, 8.4, 9.5
**Depends on:** #2.1, #3.1, #4.1, #6.1, #8.1

### Sub-issues

- #10.1 — Implement admin dashboard and audit logging *(required)*
- #10.2 — Write property tests for Admin Module *(optional)*

---

## Issue #10.1 — Implement admin dashboard and audit logging

**Labels:** `backend`, `admin`
**Requirements:** 8.1, 8.3, 8.4, 9.5
**Depends on:** #2.1, #3.1, #4.1, #6.1, #8.1

### File structure to create

```
src/admin/
  admin.module.ts
  admin.controller.ts
  admin.service.ts
  admin.service.spec.ts
  audit/
    audit-log.entity.ts
    audit-log.service.ts
```

### Implementation steps

**1. Create `AuditLog` entity**

Map to `audit_logs` table. Columns: `id`, `user_id`, `action`, `resource`, `resource_id` (nullable UUID), `metadata` (JSONB), `created_at`.

**2. Implement `AuditLogService`**

```typescript
@Injectable()
export class AuditLogService {
  async log(
    userId: string,
    action: string,
    resource: string,
    resourceId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>
  // INSERT into audit_logs — fire and forget (do not await in callers if performance matters)
}
```

**3. Wire `AuditLogService` into all admin actions**

Inject `AuditLogService` into:
- `PropertyService.createProperty` → log `action: 'property.create'`, `resource: 'property'`, `resourceId: property.id`
- `PropertyService.updateProperty` → log `action: 'property.update'`
- `RentService.addRentPayment` → log `action: 'rent.add'`, `resource: 'rent_payment'`
- `DistributionService.triggerDistribution` → log `action: 'distribution.trigger'`, `resource: 'distribution'`

**4. Implement `AdminService.getDashboard`**

```typescript
async getDashboard(): Promise<AdminDashboard>
```

```typescript
interface AdminDashboard {
  total_properties: number       // COUNT(properties WHERE is_active = true)
  total_investors: number        // COUNT(DISTINCT investments.user_id)
  total_usdc_distributed: number // SUM(distributions.amount_usdc WHERE status = "sent")
  pending_distributions: number  // COUNT(distributions WHERE status = "pending")
}
```

**5. Implement `AdminController`**

```
GET /admin/dashboard    @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
```

### Acceptance criteria

- `GET /admin/dashboard` by admin → 200 + correct summary stats
- `GET /admin/dashboard` by investor → 403 Forbidden
- Every admin action (property create/update, rent add, distribution trigger) creates an `audit_log` entry with correct `user_id`, `action`, `resource`, and `created_at`
- `AuditLog` entries are never deleted

---

## Issue #10.2 — Write property tests for Admin Module *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 8.3, 8.4
**Depends on:** #10.1

### Properties to implement

**Property 25 — Audit log completeness**
```
// Feature: brickfi-platform, Property 25: Audit log completeness
```
Generator: arbitrary admin actions (property create, rent add, distribution trigger).
Assert: for each action, exactly one `AuditLog` record exists with matching `user_id`, `action`, `resource`, and a non-null `created_at`.

**Property 10 (RBAC) — All admin endpoints return 403 for investors**
```
// Feature: brickfi-platform, Property 10: Non-admin cannot access admin endpoints (RBAC)
```
Generator: arbitrary request bodies for each admin endpoint.
Assert: calling any admin endpoint with an investor-role JWT always throws `ForbiddenException`.

---

## Issue #11 — Implement token balance reconciliation

**Labels:** `backend`, `admin`, `stellar`
**Requirements:** 11.2, 11.4
**Depends on:** #4.1, #7.2, #10.1

### Sub-issues

- #11.1 — Implement reconciliation check endpoint *(required)*
- #11.2 — Write property tests for reconciliation *(optional)*

---

## Issue #11.1 — Implement reconciliation check endpoint

**Labels:** `backend`, `admin`, `stellar`
**Requirements:** 11.4
**Depends on:** #4.1, #7.2, #10.1

### Context

The Stellar ledger is the source of truth. This endpoint detects drift between the DB mirror (`units_owned`) and the actual on-chain balance. Discrepancies indicate a bug in the atomicity logic of Issue #4.1 and must be surfaced for manual resolution.

### Implementation steps

**1. Add `reconcile` method to `AdminService`**

```typescript
async reconcile(): Promise<ReconciliationReport>
```

```typescript
interface ReconciliationReport {
  checked: number
  discrepancies: Array<{
    investor_id: string
    property_id: string
    db_units_owned: number
    on_chain_balance: string
    delta: number
  }>
}
```

Steps:
```
1. Fetch all Investment records (JOIN users for wallet_address, JOIN properties for token_asset_code)
2. For each investment:
   a. Call StellarService.getTokenBalance(user.wallet_address, property.token_asset_code)
   b. Compare parseFloat(on_chain_balance) vs investment.units_owned
   c. If they differ → add to discrepancies list
3. For each discrepancy → call AuditLogService.log(systemUserId, 'reconciliation.discrepancy', 'investment', investment.id, { db_units_owned, on_chain_balance })
4. Return report
```

**2. Add endpoint to `AdminController`**

```
GET /admin/reconcile    @Roles('admin') @UseGuards(JwtAuthGuard, RolesGuard)
```

### Acceptance criteria

- `GET /admin/reconcile` by admin → 200 + report with `checked` count and `discrepancies` array
- When all on-chain balances match DB → `discrepancies` is empty
- When a discrepancy exists → it appears in the report with correct `delta`
- All discrepancies are logged to `audit_logs`
- `GET /admin/reconcile` by investor → 403 Forbidden

---

## Issue #11.2 — Write property tests for reconciliation *(optional)*

**Labels:** `testing`, `property-based-test`, `optional`
**Requirements:** 11.2, 11.4
**Depends on:** #11.1

### Properties to implement

**Property 28 — No discrepancy when balances match**
```
// Feature: brickfi-platform, Property 28: Investment token balance matches DB units_owned
```
Generator: `fc.integer({ min: 1, max: 100 })` (units U).
Mock `getTokenBalance` to return `U.toString()`. Set `investment.units_owned = U`.
Assert: `reconcile()` returns `{ discrepancies: [] }`.

**Discrepancy detection test**
Set `investment.units_owned = 5`, mock `getTokenBalance` to return `"10"`.
Assert: `reconcile()` returns one discrepancy with `db_units_owned: 5`, `on_chain_balance: "10"`, `delta: 5`.
Assert: `AuditLogService.log` was called once with `action: 'reconciliation.discrepancy'`.

---

## Issue #12 — Checkpoint: Ensure all tests pass (pre-frontend)

**Labels:** `checkpoint`, `testing`
**Depends on:** #7, #8, #9, #10, #11

### Instructions

1. Run the full test suite: `npm test -- --runInBand`
2. All tests across all backend modules must pass
3. Fix any failures before starting frontend work (Issue #13)
4. Check TypeScript compiles cleanly: `npx tsc --noEmit`
5. Verify no circular dependencies: `npx madge --circular src/`

### Definition of done

- `npm test` exits with code 0
- `npx tsc --noEmit` exits with code 0
- All 7 modules have at least unit test coverage for their service layer

---

## Issue #13 — Build Next.js frontend — Investor Dashboard

**Labels:** `frontend`, `investor`
**Requirements:** 1.1, 1.2, 1.5, 2.3, 2.4, 3.1–3.3, 3.9, 6.1–6.3, 7.1–7.3
**Depends on:** #12

### Sub-issues

- #13.1 — Set up Next.js project with TailwindCSS and Freighter wallet integration *(required)*
- #13.2 — Implement property listing and detail pages *(required)*
- #13.3 — Implement investment flow UI *(required)*
- #13.4 — Implement investor dashboard page *(required)*

---

## Issue #13.1 — Set up Next.js project with TailwindCSS and Freighter wallet integration

**Labels:** `frontend`, `investor`
**Requirements:** 1.1, 1.2, 1.5

### Setup instructions

```bash
npx create-next-app@latest brickfi-frontend --typescript --tailwind --app --src-dir
npm install @stellar/freighter-api axios
```

### File structure to create

```
brickfi-frontend/src/
  lib/
    api.ts           # axios instance with JWT interceptor
    auth.ts          # login/register helpers
  hooks/
    useAuth.ts       # auth state (JWT in localStorage or httpOnly cookie)
  components/
    Navbar.tsx
    ProtectedRoute.tsx
  app/
    login/page.tsx
    register/page.tsx
    layout.tsx
```

### Implementation steps

**1. API client** (`src/lib/api.ts`)

```typescript
import axios from 'axios'

const api = axios.create({ baseURL: process.env.NEXT_PUBLIC_API_URL })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('brickfi_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export default api
```

**2. Auth pages**

`/login` — email + password form → `POST /auth/login` → store JWT → redirect to `/dashboard`
`/register` — email + phone + password form → `POST /auth/register` → store JWT → redirect to `/dashboard`

Both pages: client-side validation (required fields, email format, password min 8 chars), display API error messages inline.

**3. `ProtectedRoute` component**

Reads JWT from storage, decodes expiry, redirects to `/login` if missing or expired.

**4. Environment variable**

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

### Acceptance criteria

- `/login` submits to `POST /auth/login`, stores JWT, redirects on success
- `/register` submits to `POST /auth/register`, stores JWT, redirects on success
- Invalid credentials show inline error message (not an alert)
- `ProtectedRoute` redirects unauthenticated users to `/login`

---

## Issue #13.2 — Implement property listing and detail pages

**Labels:** `frontend`, `investor`
**Requirements:** 2.3, 2.4
**Depends on:** #13.1

### Pages to create

**`/properties`** — Property listing page

Fetch `GET /properties` on load. Display each property as a card with:
- Property name and location
- Total value (USD)
- Price per unit
- Available units / total units
- Expected annual yield (%)
- Link to `/properties/[id]`

Show loading skeleton while fetching. Show error state if API fails.

**`/properties/[id]`** — Property detail page

Fetch `GET /properties/:id`. Display full details:
- All listing card fields plus description and images
- `available_units` prominently displayed
- Investment form (Issue #13.3)

### Acceptance criteria

- `/properties` lists all active properties returned by the API
- Each property card links to its detail page
- `/properties/[id]` shows full property details
- Both pages redirect to `/login` if not authenticated

---

## Issue #13.3 — Implement investment flow UI

**Labels:** `frontend`, `investor`
**Requirements:** 3.1, 3.2, 3.3, 3.9
**Depends on:** #13.2

### Implementation steps

Add an investment form to `/properties/[id]`:

**Form fields:**
- Unit count input (integer, min 1, max = `available_units`)
- Read-only total cost preview: `units × price_per_unit` (updates live as user types)
- Submit button: "Invest Now"

**On submit:**
1. Call `POST /invest` with `{ property_id, units }`
2. On success → show success toast/banner, refresh `available_units`
3. On 400 "insufficient units" → show inline error
4. On 400 "connect wallet" → show banner: "You need to connect a Stellar wallet before investing. Go to Dashboard → Connect Wallet."
5. On 503 → show "Blockchain temporarily unavailable. Please try again."

### Acceptance criteria

- Total cost preview updates in real time as unit count changes
- Submit is disabled when unit count is 0 or exceeds `available_units`
- All API error cases show user-friendly inline messages
- Success state refreshes the available units count

---

## Issue #13.4 — Implement investor dashboard page

**Labels:** `frontend`, `investor`
**Requirements:** 6.1, 6.2, 6.3, 7.1, 7.2, 7.3
**Depends on:** #13.1

### Page: `/dashboard`

Fetch `GET /dashboard` and `GET /wallet` on load.

**Sections to build:**

**Portfolio summary** (top of page)
- Total portfolio value (USD)
- Total ROI (%)
- Total invested (USD)
- Total earnings received (USDC)

**Per-property breakdown** (table or cards)
- Property name, units owned, current value, monthly earnings

**Wallet section**
- Available USDC balance
- Pending USDC
- Withdrawal form: amount input + "Withdraw" button
  - On submit: `POST /withdraw`
  - On 400 → show "Insufficient balance"
  - On success → refresh wallet balance

**Wallet connect button**
- If `user.wallet_address` is null → show "Connect Freighter Wallet" button
- On click:
  1. Call `isConnected()` from `@stellar/freighter-api`
  2. Call `getPublicKey()` to get the wallet address
  3. Call `signTransaction` or `signMessage` to get a signature
  4. Call `POST /auth/connect-wallet` with `{ wallet_address, signature }`
  5. On success → show "Wallet connected: G..." and hide the button

**Transaction history** (table, last 20)
- Columns: Date, Type, Amount (USDC), Status, Tx Hash (truncated, links to Stellar Expert)
- Ordered by date descending

### Acceptance criteria

- All dashboard data is scoped to the authenticated user
- Wallet connect flow calls Freighter API and then `POST /auth/connect-wallet`
- Withdrawal form validates amount > 0 and ≤ available balance client-side before submitting
- Transaction history is ordered newest first
- Tx hash links open `https://stellar.expert/explorer/testnet/tx/{txHash}`

---

## Issue #14 — Build Next.js frontend — Admin Panel

**Labels:** `frontend`, `admin`
**Requirements:** 2.1, 4.1, 5.1, 8.1, 8.2, 11.4
**Depends on:** #13.1

### Sub-issues

- #14.1 — Implement admin property management UI *(required)*
- #14.2 — Implement admin rent and distribution UI *(required)*

---

## Issue #14.1 — Implement admin property management UI

**Labels:** `frontend`, `admin`
**Requirements:** 2.1, 8.2
**Depends on:** #13.1

### Pages to create

**`/admin/properties`**

- Table listing all properties (name, location, total value, total units, price per unit, yield, status, token_asset_code)
- "Add Property" button → opens modal or navigates to `/admin/properties/new`
- Each row has an "Edit" button → opens edit form

**Add property form fields:**
- `name` (text, required)
- `location` (text, required)
- `total_value_usd` (number, required)
- `total_units` (integer, required)
- `annual_yield` (number, required)
- `short_code` (text, required, max 8 chars, uppercase alphanumeric — auto-derives `BF-{short_code}` token code shown as preview)
- `description` (textarea, optional)
- `images` (comma-separated URLs, optional)

On submit: `POST /properties`. Show loading state during NFT minting (can take a few seconds). On 503 → "Blockchain temporarily unavailable. Property was not created."

**Edit property form:** pre-populated with existing values. On submit: `PATCH /properties/:id`.

### Acceptance criteria

- Only accessible to admin-role users (redirect investor to `/dashboard`)
- Add form shows `token_asset_code` preview as user types `short_code`
- Submit button disabled during API call
- Success → refresh property list

---

## Issue #14.2 — Implement admin rent and distribution UI

**Labels:** `frontend`, `admin`
**Requirements:** 4.1, 5.1, 8.1, 11.4
**Depends on:** #14.1

### Pages to create

**`/admin/rent`**

Form fields: property (dropdown from `GET /properties`), `amount_usd` (number), `period` (month picker, format `YYYY-MM`), `fee_percentage` (number, 1–3, default 2).
On submit: `POST /rent/add`. On 409 → "Rent already recorded for this period."

**`/admin/distribute`**

- Property + period selector
- "Trigger Distribution" button → `POST /distribute`
- Results table: investor email, wallet address, payout amount, status, tx hash
- "Retry Failed" button → `POST /distribute/retry` (only shown if any records are `"failed"`)

**`/admin/dashboard`**

Fetch `GET /admin/dashboard`. Display:
- Total properties (number)
- Total investors (number)
- Total USDC distributed (formatted)
- Pending distributions (number, highlighted if > 0)

**`/admin/reconcile`**

- "Run Reconciliation" button → `GET /admin/reconcile`
- Results table: investor ID, property ID, DB units owned, on-chain balance, delta
- Show "No discrepancies found" if report is empty
- Show count of discrepancies prominently if any exist

### Acceptance criteria

- All pages redirect non-admin users to `/dashboard`
- Distribute page shows real-time status of each distribution record
- Reconcile page clearly highlights discrepancies in red
- All forms show loading state during API calls and display API errors inline

---

## Issue #15 — Final checkpoint: Ensure all tests pass

**Labels:** `checkpoint`, `testing`
**Depends on:** #14

### Instructions

1. Run the full backend test suite: `npm test -- --runInBand` (from `brickfi-backend/`)
2. All tests must pass — no skipped, no pending
3. TypeScript must compile cleanly: `npx tsc --noEmit` (both `brickfi-backend/` and `brickfi-frontend/`)
4. Manually smoke-test the critical flows end-to-end on testnet:
   - Register → login → connect Freighter wallet
   - Admin creates a property (verify NFT minted on Stellar testnet)
   - Investor invests (verify Investment_Token issued on testnet)
   - Admin adds rent → triggers distribution → verify USDC sent on testnet
   - Investor withdraws → verify USDC sent on testnet
5. Run reconciliation check → verify empty discrepancy report

### Definition of done

- `npm test` exits with code 0
- `npx tsc --noEmit` exits with code 0 for both projects
- All 5 smoke-test flows complete successfully on Stellar testnet
- No open critical bugs

---

## Labels Reference

| Label | Description |
|---|---|
| `infrastructure` | Project setup, config, migrations |
| `backend` | NestJS backend implementation |
| `frontend` | Next.js frontend implementation |
| `auth` | Authentication and authorization |
| `property` | Property management |
| `investment` | Investment and token issuance |
| `rent` | Rent collection |
| `distribution` | USDC distribution |
| `wallet` | Wallet and withdrawals |
| `dashboard` | Investor dashboard |
| `admin` | Admin panel and audit logging |
| `stellar` | Stellar blockchain integration |
| `queue` | BullMQ queue processing |
| `testing` | Test implementation |
| `property-based-test` | fast-check property-based tests |
| `checkpoint` | Test verification milestones |
| `optional` | Can be skipped for faster MVP |
| `done` | Completed |

## Dependency Graph

```
#1 (scaffold)
  └─ #2.1 (auth)
       ├─ #2.3 (wallet connect)
       └─ #7.1 (stellar USDC)
            └─ #7.2 (stellar NFT/tokens)
                 ├─ #3.1 (property CRUD)
                 │    └─ #4.1 (investment)
                 │         └─ #8.1 (distribution calc)
                 │              └─ #8.3 (distribution queue)
                 │                   └─ #9.1 (wallet/withdraw)
                 │                        └─ #9.3 (dashboard)
                 │                             └─ #10.1 (admin)
                 │                                  └─ #11.1 (reconcile)
                 └─ #6.1 (rent)
#5  checkpoint (after #2, #3, #4)
#12 checkpoint (after #7–#11)
#13 frontend investor (after #12)
#14 frontend admin (after #13.1)
#15 final checkpoint
```
