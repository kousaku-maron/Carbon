import { useEffect } from "react";
import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  createHashHistory,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { fetchMe, persistToken, restoreToken } from "./lib/api";
import { LoginRoute } from "./routes/login-route";
import { WorkspaceRoute } from "./routes/workspace-route";

let tokenRestored = false;

function extractTokenFromDeepLink(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "carbon:") return null;
    return parsed.searchParams.get("token");
  } catch {
    return null;
  }
}

function RootComponent() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleUrls = async (urls: string[]) => {
      for (const url of urls) {
        const token = extractTokenFromDeepLink(url);
        if (token) {
          await persistToken(token);
          navigate({ to: "/workspace" });
          return;
        }
      }
    };

    // Check for URLs that launched the app
    getCurrent().then((urls) => {
      if (urls?.length) handleUrls(urls);
    });

    // Listen for future deep links
    const unlisten = onOpenUrl(handleUrls);
    return () => {
      unlisten.then((f) => f());
    };
  }, [navigate]);

  return <Outlet />;
}

const rootRoute = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (!tokenRestored) {
      await restoreToken();
      tokenRestored = true;
    }

    const isLoginPage = location.pathname === "/login";
    const isWorkspacePage = location.pathname === "/workspace";
    let user: Awaited<ReturnType<typeof fetchMe>>;

    try {
      user = await fetchMe();
    } catch {
      if (!isLoginPage) {
        throw redirect({ to: "/login" });
      }
      return;
    }

    if (user && !isWorkspacePage) {
      throw redirect({ to: "/workspace" });
    }
    if (!user && !isLoginPage) {
      throw redirect({ to: "/login" });
    }
  },
  component: RootComponent,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginRoute,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace",
  component: WorkspaceRoute,
});

const routeTree = rootRoute.addChildren([loginRoute, workspaceRoute]);

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
