// API entry point: mock adapter only when VITE_USE_MOCK=1 (see .env.development), real otherwise.
import { mock } from "./mock";
import { real, type Api } from "./real";

// Dot access, so Vite replaces it at build time and the bundler drops mock.ts from production.
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === "1";

export const api: Api = USE_MOCK ? mock : real;

export { ApiError, getToken, setToken, tzOffset, TOKEN_KEY } from "./client";
export type { Api };
export type * from "./types";
