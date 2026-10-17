import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";

it.each([
  "/",
  "/cards",
  "/decisions",
  "/episodes",
  "/hours",
  "/items",
  "/journal",
  "/listening",
  "/login",
  "/me",
  "/reading",
  "/retell",
  "/settings",
  "/shadow",
  "/speaking",
  "/tutor",
  "/wrapup",
  "/writing",
])("matches %s", (path) => {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
  const matches = router.matchRoutes(path);
  expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  expect(matches.at(-1)?.pathname).toBe(path);
});
