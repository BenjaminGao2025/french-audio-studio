// TanStack Query hooks over the api adapter.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./index";
import type { Lane, SkipReason } from "./types";

export const qk = {
  today: ["today"] as const,
  gameState: ["game-state"] as const,
  srsQueue: (modes?: string) => ["srs-queue", modes ?? ""] as const,
  ledger: ["hours-ledger"] as const,
  todos: ["todos"] as const,
  checkpoints: ["checkpoints"] as const,
  itemsSummary: ["items-summary"] as const,
  items: (skill?: string | undefined, pool?: string) => ["items", skill ?? "", pool ?? ""] as const,
  episodes: ["episodes"] as const,
  tutorSessions: ["tutor-sessions"] as const,
  listeningGate: ["listening-gate"] as const,
  phase: ["phase"] as const,
  me: ["me"] as const,
};

export const useToday = () => useQuery({ queryKey: qk.today, queryFn: () => api.today.get() });
export const useGameState = () =>
  useQuery({ queryKey: qk.gameState, queryFn: () => api.game.state() });
export const useSrsQueue = (modes?: string | undefined, newLimit?: number) =>
  useQuery({
    queryKey: qk.srsQueue(modes),
    queryFn: () => api.srs.queue({ modes, new_limit: newLimit }),
  });
export const useHoursLedger = () =>
  useQuery({ queryKey: qk.ledger, queryFn: () => api.hours.ledger() });
export const useTodos = () => useQuery({ queryKey: qk.todos, queryFn: () => api.todos.list() });
export const useCheckpoints = () =>
  useQuery({ queryKey: qk.checkpoints, queryFn: () => api.checkpoints.list() });
export const useItemsSummary = () =>
  useQuery({ queryKey: qk.itemsSummary, queryFn: () => api.items.summary() });
export const useItems = (skill?: string | undefined, pool?: string) =>
  useQuery({ queryKey: qk.items(skill, pool), queryFn: () => api.items.list({ skill, pool }) });
export const useEpisodes = () =>
  useQuery({ queryKey: qk.episodes, queryFn: () => api.episodes.list() });
export const useTutorSessions = () =>
  useQuery({ queryKey: qk.tutorSessions, queryFn: () => api.tutor.sessions() });
export const useListeningGate = () =>
  useQuery({ queryKey: qk.listeningGate, queryFn: () => api.listening.gate() });
export const usePhase = () => useQuery({ queryKey: qk.phase, queryFn: () => api.phase.get() });
export const useMe = () => useQuery({ queryKey: qk.me, queryFn: () => api.auth.me() });

export function useBlockActions() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: qk.today });
  const start = useMutation({
    mutationFn: (id: string) => api.today.startBlock(id),
    onSuccess: invalidate,
  });
  const finish = useMutation({
    mutationFn: (id: string) => api.today.finishBlock(id),
    onSuccess: invalidate,
  });
  const skip = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: SkipReason }) =>
      api.today.skipBlock(id, reason),
    onSuccess: invalidate,
  });
  const minimal = useMutation({
    mutationFn: (on: boolean) => api.today.minimal(on),
    onSuccess: invalidate,
  });
  return { start, finish, skip, minimal };
}

export function useLogTime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ lane, minutes, note }: { lane: Lane; minutes: number; note: string }) =>
      api.game.log(lane, minutes, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.gameState });
      qc.invalidateQueries({ queryKey: qk.ledger });
    },
  });
}

export function useReviewCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      rating,
      durationMs,
      answer,
    }: {
      id: string;
      rating: 1 | 2 | 3 | 4;
      durationMs?: number | undefined;
      answer?: string | undefined;
    }) => api.srs.review(id, rating, durationMs, undefined, answer),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["srs-queue"] }),
  });
}

/** Follow position order, excluding the current block even before cache refresh. */
export function nextBlockRoute(
  blocks: { id: string; route: string; status: string; position: number }[],
  currentId?: string,
): string {
  const current = blocks.find((b) => b.id === currentId);
  const available = blocks
    .filter((b) => b.id !== currentId && (b.status === "planned" || b.status === "active"))
    .sort((a, b) => a.position - b.position);
  if (!current) return available[0]?.route ?? "/";
  return (available.find((b) => b.position > current.position) ?? available[0])?.route ?? "/";
}
