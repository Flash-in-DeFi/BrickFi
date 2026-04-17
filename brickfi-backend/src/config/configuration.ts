import * as Joi from 'joi';

export const validationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  STELLAR_NETWORK: Joi.string().valid('testnet', 'mainnet').default('testnet'),
  STELLAR_PLATFORM_SECRET: Joi.string().required(),
  STELLAR_ISSUER_PUBLIC_KEY: Joi.string().required(),
});

export default () => ({
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    url: process.env.REDIS_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
  },
  stellar: {
    network: process.env.STELLAR_NETWORK ?? 'testnet',
    platformSecret: process.env.STELLAR_PLATFORM_SECRET,
    issuerPublicKey: process.env.STELLAR_ISSUER_PUBLIC_KEY,
  },
});
