import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { fetchMe, getCachedToken, signInWithGoogle } from "../lib/api";
import { ApiRequestError } from "../lib/api/client";

export function LoginRoute() {
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!getCachedToken()) return;

    let active = true;
    let inFlight = false;
    let retryTimer: ReturnType<typeof setInterval> | null = null;

    const stopRetry = () => {
      if (retryTimer) {
        clearInterval(retryTimer);
        retryTimer = null;
      }
    };

    const probeSession = async () => {
      if (!active || inFlight) return;
      inFlight = true;

      try {
        const user = await fetchMe();
        if (!active) return;

        if (user) {
          stopRetry();
          await navigate({ to: "/workspace" });
          return;
        }

        // Request reached backend successfully; no more retry needed.
        stopRetry();
      } catch (error) {
        if (
          error instanceof ApiRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          stopRetry();
        }
        // Keep retrying while backend/network is unavailable.
      } finally {
        inFlight = false;
      }
    };

    retryTimer = setInterval(() => {
      void probeSession();
    }, 5_000);
    void probeSession();

    return () => {
      active = false;
      stopRetry();
    };
  }, [navigate]);

  async function handleGoogleSignIn(): Promise<void> {
    setMessage("Complete sign-in in your browser...");

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await signInWithGoogle(controller.signal);

      if (result.ok && "awaiting" in result) {
        // PROD: deep link will handle navigation, just keep the message
        return;
      }
      if (result.ok) {
        navigate({ to: "/workspace" });
        return;
      }
      if (result.reason === "timeout") {
        setMessage("Sign in timed out. Please try again.");
      } else {
        setMessage(result.message ?? "Sign in failed");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed");
    }
  }

  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <div className="auth-logo">
          <img src="/icon.png" alt="App logo" />
        </div>
        <h1>Log in to your account</h1>
        <div className="auth-form">
          <button
            type="button"
            className="auth-google-btn"
            onClick={handleGoogleSignIn}
          >
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>
        {message && <p className="auth-message">{message}</p>}
      </section>
    </main>
  );
}
