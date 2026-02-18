import { betterAuth } from "better-auth";
import type { User, Session } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db";

export type Auth = ReturnType<typeof createAuth>;

export type { User, Session };

interface AuthConfig {
  secret: string;
  baseURL: string;
  githubClientId?: string;
  githubClientSecret?: string;
  trustedOrigins?: string[];
}

function getLocalTrustedOrigins(baseURL: string) {
  const trustedOrigins = new Set<string>();

  try {
    const parsed = new URL(baseURL);
    trustedOrigins.add(parsed.origin);

    if (parsed.hostname === "localhost") {
      const localhostVariant = new URL(parsed.origin);
      localhostVariant.hostname = "127.0.0.1";
      trustedOrigins.add(localhostVariant.origin);
    } else if (parsed.hostname === "127.0.0.1") {
      const loopbackVariant = new URL(parsed.origin);
      loopbackVariant.hostname = "localhost";
      trustedOrigins.add(loopbackVariant.origin);
    }
  } catch {
    trustedOrigins.add(baseURL);
  }

  return [...trustedOrigins];
}

export function createAuth(config: AuthConfig, db: Database) {
  const githubClientId = config.githubClientId?.trim();
  const githubClientSecret = config.githubClientSecret?.trim();
  const trustedOrigins = new Set(getLocalTrustedOrigins(config.baseURL));

  for (const origin of config.trustedOrigins || []) {
    const trimmed = origin.trim();
    if (trimmed) {
      trustedOrigins.add(trimmed);
    }
  }

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [...trustedOrigins],
    ...(githubClientId && githubClientSecret
      ? {
          socialProviders: {
            github: {
              clientId: githubClientId,
              clientSecret: githubClientSecret,
            },
          },
        }
      : {}),
  });
}
