import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInitialSchema1713000000000 implements MigrationInterface {
  name = 'CreateInitialSchema1713000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Users table
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "email"         VARCHAR(255) UNIQUE NOT NULL,
        "phone"         VARCHAR(50),
        "password_hash" VARCHAR(255) NOT NULL,
        "wallet_address" VARCHAR(100),
        "role"          VARCHAR(20) NOT NULL DEFAULT 'investor',
        "created_at"    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Properties table (includes on-chain tokenization fields)
    await queryRunner.query(`
      CREATE TABLE "properties" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"             VARCHAR(255) NOT NULL,
        "location"         VARCHAR(255) NOT NULL,
        "total_value_usd"  NUMERIC(18,2) NOT NULL,
        "total_units"      INTEGER NOT NULL,
        "price_per_unit"   NUMERIC(18,2) NOT NULL,
        "annual_yield"     NUMERIC(5,2) NOT NULL,
        "images"           TEXT[],
        "description"      TEXT,
        "is_active"        BOOLEAN DEFAULT TRUE,
        "short_code"       VARCHAR(20) NOT NULL,
        "nft_asset_code"   VARCHAR(20),
        "nft_tx_hash"      VARCHAR(100),
        "token_asset_code" VARCHAR(20),
        "token_issuer"     VARCHAR(100),
        "created_at"       TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Investments table
    await queryRunner.query(`
      CREATE TABLE "investments" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"        UUID NOT NULL REFERENCES "users"("id"),
        "property_id"    UUID NOT NULL REFERENCES "properties"("id"),
        "units_owned"    INTEGER NOT NULL DEFAULT 0,
        "total_invested" NUMERIC(18,2) NOT NULL DEFAULT 0,
        "created_at"     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("user_id", "property_id")
      )
    `);

    // Rent payments table
    await queryRunner.query(`
      CREATE TABLE "rent_payments" (
        "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "property_id"    UUID NOT NULL REFERENCES "properties"("id"),
        "amount_usd"     NUMERIC(18,2) NOT NULL,
        "fee_percentage" NUMERIC(5,2) NOT NULL DEFAULT 2.0,
        "net_amount_usd" NUMERIC(18,2) NOT NULL,
        "period"         VARCHAR(7) NOT NULL,
        "created_at"     TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE("property_id", "period")
      )
    `);

    // Distributions table
    await queryRunner.query(`
      CREATE TABLE "distributions" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         UUID NOT NULL REFERENCES "users"("id"),
        "property_id"     UUID NOT NULL REFERENCES "properties"("id"),
        "rent_payment_id" UUID NOT NULL REFERENCES "rent_payments"("id"),
        "amount_usdc"     NUMERIC(18,7) NOT NULL,
        "status"          VARCHAR(20) NOT NULL DEFAULT 'pending',
        "tx_hash"         VARCHAR(100),
        "period"          VARCHAR(7) NOT NULL,
        "created_at"      TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Transactions table
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"    UUID NOT NULL REFERENCES "users"("id"),
        "type"       VARCHAR(20) NOT NULL,
        "amount"     NUMERIC(18,7) NOT NULL,
        "tx_hash"    VARCHAR(100),
        "status"     VARCHAR(20) NOT NULL DEFAULT 'pending',
        "created_at" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Audit logs table
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"     UUID NOT NULL REFERENCES "users"("id"),
        "action"      VARCHAR(100) NOT NULL,
        "resource"    VARCHAR(100),
        "resource_id" UUID,
        "metadata"    JSONB,
        "created_at"  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "transactions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "distributions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "rent_payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "investments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "properties"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}
