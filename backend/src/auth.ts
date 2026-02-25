import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Database } from "./db";

type AuthEnv = {
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
};

function parseOrigins(input: string): string[] {
  return input
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function createAuth(env: AuthEnv, db: Database) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: parseOrigins(env.CORS_ORIGINS),
    account: {
      // Desktop app: sign-in (internal request) and callback (browser) run in
      // different cookie contexts, so the state cookie can't be verified.
      // State is still validated via the database verification table.
      skipStateCookieCheck: true,
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    plugins: [
      bearer(),
    ],
  });
}
