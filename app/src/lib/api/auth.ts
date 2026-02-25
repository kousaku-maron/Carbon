import { request, setSessionToken } from "./client";

export type User = {
  id: string;
  name: string;
  email: string;
};

export async function signIn(
  email: string,
  password: string,
): Promise<string> {
  const result = await request<{ token: string }>(
    "/api/auth/sign-in/email",
    { method: "POST", body: JSON.stringify({ email, password }) },
  );
  await setSessionToken(result.token);
  return result.token;
}

export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<string> {
  const result = await request<{ token: string }>(
    "/api/auth/sign-up/email",
    { method: "POST", body: JSON.stringify({ name, email, password }) },
  );
  await setSessionToken(result.token);
  return result.token;
}

export async function signOut(): Promise<void> {
  try {
    await request("/api/auth/sign-out", { method: "POST", body: "{}" });
  } catch {
    /* ignore sign-out errors */
  }
  await setSessionToken(null);
}

export async function fetchMe(): Promise<User | null> {
  const result = await request<{ user: User | null }>("/api/me", {
    method: "GET",
  });
  return result.user;
}
