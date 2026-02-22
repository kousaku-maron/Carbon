import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { fetchMe } from "./lib/api";
import { LoginRoute } from "./routes/LoginRoute";
import { SignUpRoute } from "./routes/SignUpRoute";
import { WorkspaceRoute } from "./routes/WorkspaceRoute";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});

const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/auth",
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async () => {
    const user = await fetchMe();
    if (user) {
      throw redirect({ to: "/workspace" });
    }
  },
  component: LoginRoute,
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  beforeLoad: async () => {
    const user = await fetchMe();
    if (user) {
      throw redirect({ to: "/workspace" });
    }
  },
  component: SignUpRoute,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/workspace",
  beforeLoad: async () => {
    const user = await fetchMe();
    if (!user) {
      throw redirect({ to: "/login" });
    }
    return { user };
  },
  component: WorkspaceRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  authRoute,
  loginRoute,
  signUpRoute,
  workspaceRoute,
]);

export const router = createRouter({
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
