import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";

import { ApiError } from "#api/client";
import { NotFound, RouteError } from "#features/shell/fallbacks";

import { routeTree } from "./routeTree.gen";

export type RouterContext = { queryClient: QueryClient };

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        // A 4xx won't fix itself; retrying only delays the error the person needs to see.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Caught at the route that failed, so a page inside the app keeps its sidebar.
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    Wrap: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}
