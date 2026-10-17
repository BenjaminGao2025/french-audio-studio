// API entry point: mock adapter in Lovable preview / dev, real adapter in production.
import { mock } from "./mock";
import { real, type Api } from "./real";

export const USE_MOCK = import.meta.env["VITE_USE_MOCK"] === "1" || import.meta.env.DEV;

export const api: Api = USE_MOCK ? mock : real;

export { ApiError, getToken, setToken, tzOffset, TOKEN_KEY } from "./client";
export type { Api };
export type * from "./types";
