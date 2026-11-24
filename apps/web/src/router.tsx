import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { fetchSession, logout, sessionQueryKey } from "./api/auth";
import { Button } from "./components/ui/button";
import { HomePage } from "./pages/home";
import { LoginPage } from "./pages/login";

interface RouterContext {
  queryClient: QueryClient;
}

const getSession = (queryClient: QueryClient) =>
  queryClient.fetchQuery({ queryKey: sessionQueryKey, queryFn: fetchSession, staleTime: 30_000 });

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="min-h-svh bg-background text-foreground">
      <Outlet />
    </div>
  ),
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: async ({ context }) => {
    if ((await getSession(context.queryClient)).authenticated) throw redirect({ to: "/" });
  },
  component: () => (
    <main className="p-6 pt-24">
      <LoginPage />
    </main>
  ),
});

// 所有者页面的布局：未登录时跳转到登录页。
const ownerRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "owner",
  beforeLoad: async ({ context }) => {
    if (!(await getSession(context.queryClient)).authenticated) throw redirect({ to: "/login" });
  },
  component: OwnerLayout,
});

function OwnerLayout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    queryClient.clear();
    await navigate({ to: "/login" });
  }

  return (
    <>
      <header className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="font-heading text-lg font-semibold">Novarium 归藏</h1>
        <Button variant="ghost" size="sm" onClick={onLogout}>
          退出登录
        </Button>
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <Outlet />
      </main>
    </>
  );
}

const homeRoute = createRoute({
  getParentRoute: () => ownerRoute,
  path: "/",
  component: HomePage,
});

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree: rootRoute.addChildren([loginRoute, ownerRoute.addChildren([homeRoute])]),
    context: { queryClient },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
