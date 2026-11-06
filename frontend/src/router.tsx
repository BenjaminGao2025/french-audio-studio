import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { shouldRetry } from "./api/client";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: shouldRetry } } });

  const router = createRouter({
    routeTree,
    basepath: import.meta.env.BASE_URL.replace(/\/$/, "") || "/",
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
