import { apiFetch } from "./client";
export interface WordNote { id: number; word_key: string; text: string; created_at: string; updated_at: string }
export const listWordNotes = (word: string) => apiFetch<{ notes: WordNote[] }>(`/api/word-notes?word=${encodeURIComponent(word)}`);
export const createWordNote = (word: string, text: string) => apiFetch<WordNote>("/api/word-notes", { body: { word, text } });
export const editWordNote = (id: number, text: string) => apiFetch<WordNote>(`/api/word-notes/${id}`, { method: "PATCH", body: { text } });
export const deleteWordNote = (id: number) => apiFetch(`/api/word-notes/${id}`, { method: "DELETE" });
