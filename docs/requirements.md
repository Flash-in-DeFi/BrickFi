# Requirements Document

## Introduction

BrickFi is a fractional real estate investment platform targeting retail investors in Africa and the diaspora. It allows users to purchase fractional units of real estate properties starting from $10, receive rental income distributed in USDC on the Stellar network, and track their portfolio through a dashboard. The MVP uses on-chain ownership tracking via Stellar classic assets, with the Stellar ledger as the source of truth for unit ownership and on-chain USDC payouts via Stellar testnet.

## Glossary

- **Investor**: A retail user who purchases fractional units of a listed property
- **Property Manager**: An entity that lists properties and provides rent/occupancy data
- **Platform_Admin**: A privileged user who verifies properties, manages distributions, and monitors system health
- **Investment_Unit**: A fractional share of a property with a fixed USD price
- **Rent_Distribution**: The process of calculating and sending USDC payouts to investors proportional to their units owned
- **USDC**: USD Coin stablecoin on the Stellar network used for all payouts
- **Stellar_Wallet**: A Stellar network wallet address used to receive USDC payouts and hold investment unit tokens
- **Freighter**: A browser extension wallet for the Stellar network
- **Distribution_Record**: A database record tracking a payout to a specific investor for a specific property and period
- **Portfolio**: The collection of all investment units owned by an investor across all properties
- **Annual_Yield**: The expected percentage return on investment per year based on rental income
- **SPV**: Special Purpose Vehicle — a legal entity structure planned for future use
- **Horizon_API**: Stellar's REST API for submitting and querying transactions
- **JWT**: JSON Web Token used for session authentication
- **Property_NFT**: A non-fungible token on Stellar representing a specific property, minted once per property and held by the platform (issuing account issues exactly 1 unit of a unique asset)
- **Investment_Token**: A fungible Stellar classic asset representing fractional ownership units of a property; one asset type per property, identified by an asset code of the form `BF-{PROPERTY_SHORT_CODE}` issued from the platform's issuer account
- **Token_Issuer**: The platform's Stellar issuer account that creates and issues Investment_Tokens for each property
- **On_Chain_Balance**: The number of Investment_Tokens held by an investor's Stellar wallet as recorded on the Stellar ledger, which is the authoritative source of truth for unit ownership

---

## Requirements

### Requirement 1: User Registration and Authentication

**User Story:** As an investor, I want to register and log in securely, so that I can access my portfolio and make investments.

#### Acceptance Criteria

1. WHEN a user submits a registration request with a valid email, phone, and password, THE Authentication_Service SHALL create a new user account and return a JWT token
2. WHEN a user submits a login request with valid credentials, THE Authentication_Service SHALL return a JWT token valid for the session
3. IF a user submits a registration request with an email that already exists, THEN THE Authentication_Service SHALL return a 409 Conflict error with a descriptive message
4. IF a user submits a login request with invalid credentials, THEN THE Authentication_Service SHALL return a 401 Unauthorized error
5. WHEN a user connects a Freighter wallet, THE Authentication_Service SHALL verify the wallet signature and associate the wallet address with the user account
6. IF a JWT token is expired or invalid, THEN THE Authentication_Service SHALL return a 401 Unauthorized error on any protected endpoint
7. THE Authentication_Service SHALL hash all passwords using a cryptographic hashing algorithm before storing them

---

### Requirement 2: Property Listing

**User Story:** As a Platform_Admin, I want to list real estate properties on the platform, so that investors can discover and invest in them.

#### Acceptance Criteria

1. WHEN a Platform_Admin submits a valid property creation request, THE Property_Service SHALL create a property record with name, location, total valuation (USD), total units, price per unit, expected annual yield, images, and description
2. THE Property_Service SHALL calculate and store price_per_unit as total_value_usd divided by total_units
3. WHEN any authenticated user requests the property list, THE Property_Service SHALL return all active properties with their full details
4. WHEN any authenticated user requests a specific property by ID, THE Property_Service SHALL return that property's full details including current units available
5. IF a non-admin user attempts to create a property, THEN THE Property_Service SHALL return a 403 Forbidden error
6. IF a property creation request is missing required fields, THEN THE Property_Service SHALL return a 400 Bad Request error with field-level validation messages
7. THE Property_Service SHALL track available_units as total_units minus the sum of all units_owned across all investments for that property
8. WHEN a Platform_Admin creates a property, THE Stellar_Service SHALL mint a Property_NFT on Stellar by issuing exactly 1 unit of a unique asset from the platform's issuer account and store the resulting transaction hash in nft_tx_hash
9. WHEN a property is created, THE Property_Service SHALL generate a unique asset code of the form `BF-{PROPERTY_SHORT_CODE}` for the property's Investment_Token and store it in token_asset_code along with the platform issuer account address in token_issuer
10. IF the Property_NFT minting transaction fails, THEN THE Property_Service SHALL roll back the property record creation and return a 503 error

---

### Requirement 3: Fractional Investment

**User Story:** As an investor, I want to purchase fractional units of a property, so that I can earn proportional rental income.

#### Acceptance Criteria

1. WHEN an authenticated investor submits an investment request with a valid property_id and unit count, THE Investment_Service SHALL create an investment record and deduct the corresponding USD amount
2. THE Investment_Service SHALL calculate total_invested as units_requested multiplied by price_per_unit
3. IF an investor requests more units than are currently available for a property, THEN THE Investment_Service SHALL return a 400 Bad Request error indicating insufficient units available
4. IF an investor submits an investment request for a non-existent property, THEN THE Investment_Service SHALL return a 404 Not Found error
5. WHEN an investor purchases units in a property they already hold, THE Investment_Service SHALL increment their existing units_owned for that property rather than creating a duplicate record
6. THE Investment_Service SHALL record the investment atomically — either the investment record is created, units are reserved, and Investment_Tokens are issued to the investor's Stellar wallet, or none of these operations occur
7. WHEN an authenticated investor requests their investments, THE Investment_Service SHALL return all investment records for that user including property details, units owned, and total invested
8. WHEN an investment is confirmed, THE Stellar_Service SHALL issue the corresponding number of Investment_Tokens to the investor's registered Stellar wallet address
9. IF an investor does not have a registered Stellar wallet address, THEN THE Investment_Service SHALL return a 400 Bad Request error with instructions to connect a wallet before investing
10. IF the Investment_Token issuance transaction fails, THEN THE Investment_Service SHALL roll back the investment record and return a 503 error

---

### Requirement 4: Rent Collection

**User Story:** As a Platform_Admin, I want to record monthly rent payments for properties, so that the system can calculate and distribute investor payouts.

#### Acceptance Criteria

1. WHEN a Platform_Admin submits a rent payment record with a valid property_id, amount_usd, and period, THE Rent_Service SHALL create a rent payment record
2. IF a Platform_Admin submits a rent payment for a period that already has a record for the same property, THEN THE Rent_Service SHALL return a 409 Conflict error to prevent duplicate rent entries
3. IF a non-admin user attempts to add a rent payment, THEN THE Rent_Service SHALL return a 403 Forbidden error
4. THE Rent_Service SHALL apply a platform management fee of 1–3% to the rent amount before making it available for distribution, storing both the gross and net amounts

---

### Requirement 5: USDC Rent Distribution

**User Story:** As a Platform_Admin, I want to trigger USDC distributions to investors, so that they receive their proportional rental income.

#### Acceptance Criteria

1. WHEN a Platform_Admin triggers a distribution for a property and period, THE Distribution_Service SHALL calculate each investor's payout based on their On_Chain_Balance of Investment_Tokens queried via the Horizon_API, as (on_chain_balance / total_units) × net_rent_amount
2. THE Distribution_Service SHALL create a Distribution_Record for each investor with status "pending" before initiating any Stellar transactions
3. WHEN a distribution is triggered, THE Distribution_Service SHALL send USDC to each investor's registered Stellar wallet address via the Horizon_API
4. WHEN a Stellar transaction is confirmed, THE Distribution_Service SHALL update the corresponding Distribution_Record status from "pending" to "sent" and store the transaction hash
5. IF a distribution is triggered for a period that has already been fully distributed for that property, THEN THE Distribution_Service SHALL return a 409 Conflict error to prevent double payouts
6. IF a Stellar transaction fails, THEN THE Distribution_Service SHALL retain the Distribution_Record with status "failed" and log the error for retry
7. THE Distribution_Service SHALL process distributions idempotently — re-triggering a distribution for the same property and period SHALL only send payouts for Distribution_Records that are not already in "sent" status
8. IF the Horizon_API is unavailable when querying on-chain balances, THEN THE Distribution_Service SHALL fall back to the PostgreSQL units_owned values and log a warning indicating the fallback was used

---

### Requirement 6: Investor Dashboard

**User Story:** As an investor, I want to view my portfolio and earnings, so that I can track my investment performance.

#### Acceptance Criteria

1. WHEN an authenticated investor requests their dashboard data, THE Dashboard_Service SHALL return total portfolio value (sum of units_owned × price_per_unit across all properties), total units owned per property, monthly earnings per property, and total ROI
2. THE Dashboard_Service SHALL calculate total ROI as (total_earnings_received / total_invested) × 100
3. WHEN an authenticated investor requests their transaction history, THE Dashboard_Service SHALL return all Distribution_Records and withdrawal transactions for that user ordered by date descending
4. THE Dashboard_Service SHALL return portfolio data scoped strictly to the authenticated user's own investments

---

### Requirement 7: USDC Withdrawals

**User Story:** As an investor, I want to withdraw my USDC earnings to my Stellar wallet, so that I can access my income.

#### Acceptance Criteria

1. WHEN an authenticated investor submits a withdrawal request with a valid amount, THE Withdrawal_Service SHALL initiate a USDC transfer to the investor's registered Stellar wallet address
2. IF an investor requests a withdrawal amount greater than their available USDC balance, THEN THE Withdrawal_Service SHALL return a 400 Bad Request error
3. IF an investor does not have a registered Stellar wallet address, THEN THE Withdrawal_Service SHALL return a 400 Bad Request error with instructions to connect a wallet
4. WHEN a withdrawal transaction is confirmed on Stellar, THE Withdrawal_Service SHALL create a Transaction_Record with type "withdrawal", the transaction hash, and status "completed"
5. THE Withdrawal_Service SHALL deduct the withdrawal amount from the investor's available balance only after the Stellar transaction is confirmed

---

### Requirement 8: Admin Panel Operations

**User Story:** As a Platform_Admin, I want to manage properties, rent data, and distributions from an admin interface, so that I can operate the platform efficiently.

#### Acceptance Criteria

1. WHEN a Platform_Admin requests the admin dashboard, THE Admin_Service SHALL return a summary of total properties, total investors, total USDC distributed, and pending distributions
2. WHEN a Platform_Admin updates a property record, THE Admin_Service SHALL apply the changes and return the updated property
3. IF a non-admin user attempts to access any admin endpoint, THEN THE Admin_Service SHALL return a 403 Forbidden error
4. THE Admin_Service SHALL maintain an audit log entry for every admin action including the admin user ID, action type, target resource, and timestamp

---

### Requirement 9: Security and Access Control

**User Story:** As a platform operator, I want robust security controls, so that user funds and data are protected.

#### Acceptance Criteria

1. THE Authorization_Service SHALL enforce role-based access control with at minimum two roles: "investor" and "admin"
2. WHEN any request is made to a protected endpoint, THE Authorization_Service SHALL validate the JWT token before processing the request
3. THE Authorization_Service SHALL prevent any investor from accessing another investor's portfolio data or initiating actions on their behalf
4. WHEN a wallet signature verification is performed, THE Authentication_Service SHALL validate the signature against the claimed wallet address before associating it with the account
5. THE Audit_Logger SHALL record all distribution and withdrawal events with user ID, amount, transaction hash, and timestamp

---

### Requirement 10: Stellar Blockchain Integration

**User Story:** As a platform operator, I want reliable Stellar network integration, so that USDC transactions and on-chain tokenization are processed correctly.

#### Acceptance Criteria

1. WHEN sending USDC via Stellar, THE Stellar_Service SHALL use the Horizon_API to submit signed transactions
2. THE Stellar_Service SHALL sign all outgoing transactions with the platform's custodial Stellar keypair
3. WHEN a Stellar transaction is submitted, THE Stellar_Service SHALL poll or listen for transaction confirmation before marking it as complete
4. IF the Stellar network is unavailable, THEN THE Stellar_Service SHALL queue the transaction for retry and return an appropriate error to the caller
5. THE Stellar_Service SHALL operate against the Stellar testnet for the MVP and be configurable to switch to mainnet via environment variable
6. WHEN a property is created, THE Stellar_Service SHALL mint a Property_NFT by issuing exactly 1 unit of a unique Stellar asset from the platform's issuer account using classic Stellar assets (no Soroban smart contracts)
7. WHEN an investor purchases units, THE Stellar_Service SHALL issue the corresponding quantity of Investment_Tokens to the investor's Stellar wallet using the property's token_asset_code and token_issuer
8. WHEN querying investor balances for distribution calculation, THE Stellar_Service SHALL retrieve On_Chain_Balances via the Horizon_API using the investor's wallet address and the property's token_asset_code
9. THE Stellar_Service SHALL expose a getTokenBalance(walletAddress, assetCode) method that returns the investor's current on-chain Investment_Token balance for a given property

---

### Requirement 11: On-Chain Ownership as Source of Truth

**User Story:** As a platform operator, I want the Stellar ledger to be the authoritative record of unit ownership, so that investor holdings are transparent and verifiable independently of the platform database.

#### Acceptance Criteria

1. THE Platform SHALL treat the Stellar ledger as the source of truth for Investment_Token ownership; the PostgreSQL units_owned field is a mirror for fast queries only
2. WHEN an investment is recorded in PostgreSQL, THE Investment_Service SHALL ensure the on-chain Investment_Token balance for that investor and property equals the units_owned value stored in the database
3. WHEN a distribution payout is calculated, THE Distribution_Service SHALL use on-chain Investment_Token balances as the primary input, with the PostgreSQL mirror used only as a fallback when Horizon_API is unavailable
4. THE Platform SHALL provide a reconciliation check that compares PostgreSQL units_owned values against on-chain Investment_Token balances and reports any discrepancies
