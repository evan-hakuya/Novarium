import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { HomePage } from "./pages/home";

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b px-6 py-4">
        <h1 className="font-heading text-lg font-semibold">Novarium 归藏</h1>
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <Outlet />
      </main>
    </div>
  ),
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
