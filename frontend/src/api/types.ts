// TypeScript types mirroring the FastAPI pydantic models (see lovable-fix-prompt.md C4/C5).

export type Lane = "course" | "listening" | "reading" | "speaking" | "writing" | "review" | "car";
export type Skill = "listening" | "reading" | "writing" | "speaking";

export interface UserStatus {
  email?: string | undefined;
  plan?: string | undefined;
  status?: string | undefined;
  is_valid?: boolean | undefined;
  [k: string]: unknown;
}

export interface GameLog {
  id: string | number;
  lane: Lane;
  minutes: number;
  note: string;
}

export interface GameState {
  level: number;
  level_xp: number;
  next_level_xp: number;
  progress: number;
  xp: number;
  max_level: number;
  learning: unknown;
  hours_total: number;
  today: {
    day: string;
    minutes: number;
    target: number;
    family_day: boolean;
    weekend: boolean;
    by_lane: Record<Lane, number>;
    logs: GameLog[];
    kills: number;
    deaths: number;
    best_combo: number;
    combo: number;
    first_blood: boolean;
    wave_cleared: boolean;
  };
  week: {
    number: number;
    start: string;
    end: string;
    minutes: number;
    target: number;
    maintenance: boolean;
    by_lane: Record<Lane, number>;
    lane_targets: Record<Lane, number>;
    lane_weights: Record<Lane, number>;
    skills: Record<string, unknown>;
    focus_skill: string | { skill: string; link?: unknown; minutes: number; target: number };
  };
  streak_days: number;
}

export type CardMode = "listen" | "speak" | "cloze" | "recognize" | "grammar";
export type CardState = "new" | "learning" | "review" | "relearning";

export interface SrsCard {
  id: string;
  note_id: string;
  mode: CardMode;
  state: CardState;
  sentence: string;
  translation_en: string;
  translation_zh: string;
  importance: number;
  intervals: Record<"1" | "2" | "3" | "4", number>;
  /** Cloze/grammar: the text the learner has to type (the sentence shows a ___ blank). */
  answer?: string | undefined;
  /** Backend `target` (the word of a cloze/recognize card). */
  target?: string | undefined;
  [k: string]: unknown;
}

export interface SrsQueue {
  cards: SrsCard[];
  counts: { learning: number; review: number; new: number; total: number };
}

export interface CoachTask {
  kind: string;
  title?: string | undefined;
  done?: boolean | undefined;
  [k: string]: unknown;
}

export interface CoachDashboard {
  day: string;
  setup: boolean;
  tasks: CoachTask[];
  schedule: { day: string; tasks: CoachTask[] }[];
  progress: unknown;
  weekly_report: unknown;
  capacity?: unknown;
  profile?: unknown;
}

export interface JournalRecording {
  id: string;
  kind: "first" | "final";
  duration: number;
  [k: string]: unknown;
}

export interface Journal {
  id: string;
  native_text: string;
  french?: string | undefined;
  /** Empty for entries prepared before the server split text into parts. */
  parts: { source: string; french: string }[];
  recordings: JournalRecording[];
  /** "" until the reference audio exists. */
  reference_url?: string | undefined;
  reflection?: string | undefined;
  /** The server stores 0/1. */
  recalled?: boolean | number | undefined;
  status: string;
  complete: boolean;
  day?: string | undefined;
  created_at?: string | undefined;
  [k: string]: unknown;
}

export interface AnalyzeWord {
  word: string;
  ipa: string;
  lemma: string;
  pos: string;
  en: string;
  zh: string;
  why: string;
  english_link?: string | undefined;
  false_friend?: boolean | string | undefined;
}

export interface AnalyzeSentence {
  text: string;
  translation_en: string;
  translation_zh: string;
  alignment?: unknown;
  order_note?: string | undefined;
  build_up: string[];
  words: AnalyzeWord[];
  grammar_points: { title: string; explanation: string; hook?: string }[];
  pronunciation_tips?: string | undefined;
}

export interface AnalyzeResult {
  sentences: AnalyzeSentence[];
}

export interface SpeechResult {
  audio_url: string;
  srt_url?: string | undefined;
  audio_filename?: string | undefined;
  srt_filename?: string | undefined;
  voice?: string | undefined;
}

export interface WriteTaskSpec {
  task: string;
  word_range: [number, number];
  minutes: number;
  subjects: { id: string; prompt: string; level?: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface SpeakTaskSpec {
  task: string;
  seconds: number;
  prep_seconds?: number | undefined;
  subjects: { id: string; prompt: string; [k: string]: unknown }[];
  [k: string]: unknown;
}

export interface Attempt {
  id: string;
  status: "pending" | "ready" | "failed";
  feedback1?: unknown;
  feedback2?: {
    corrected_text: string;
    sentences: { original: string; corrected: string; explanation: string; chunk?: string }[];
    structures: unknown[];
  };
  wpm?: number | undefined;
  /** Why the background feedback failed (status "failed"). */
  error?: string | null | undefined;
  [k: string]: unknown;
}

export interface Episode {
  id: string;
  title: string;
  level: string;
  minutes: number;
  created_at: string;
  /** Absent in older payloads, which means ready. The audio exists only when ready. */
  status?: "generating" | "ready" | "failed" | undefined;
  error?: string | null | undefined;
  [k: string]: unknown;
}

// ---- New endpoints (C5) ----

export type BlockKind =
  | "warmup"
  | "journal"
  | "review"
  | "listening"
  | "reading"
  | "writing"
  | "speaking"
  | "course"
  | "checkpoint"
  | "minimal";
export type BlockStatus = "planned" | "active" | "done" | "skipped";
export type SkipReason = "no_time" | "too_hard" | "health" | "family";

export interface Block {
  id: string;
  position: number;
  kind: BlockKind;
  title: string;
  planned_min: number;
  actual_sec: number;
  status: BlockStatus;
  route: string;
  lane: Lane;
  material_ids: string[];
  start_time?: string | undefined;
}

export interface Todo {
  id: string;
  text: string;
  due?: string | undefined;
  done: boolean;
}

export interface Today {
  minimal: boolean;
  day: string;
  phase: {
    id: string;
    name: string;
    hours_from: number;
    hours_to: number;
    week_target_min: number;
  };
  blocks: Block[];
  materials_ready: boolean;
  fallback: boolean;
  todos: Todo[];
  yesterday: {
    blocks_done: number;
    blocks_total: number;
    active_minutes: number;
    listening_understood_pct?: number | undefined;
  };
  next_milestone: { hours: number; hours_to_go: number };
}

export interface HoursLedger {
  active_hours: number;
  manual_hours: number;
  input_hours: number;
  lanes: { lane: Lane; active: number; manual: number; input: number; week_target: number }[];
  milestones: number[];
  next_milestone: number;
  hours_to_go: number;
  phase: string;
}

export interface DailyReview {
  day: string;
  hard: string;
  solved: string;
  unsolved: string;
  tomorrow: string;
  mood?: number | undefined;
}

export type RateStage = "slow30" | "slow20" | "normal" | "real";

export interface ListeningSession {
  id: string;
  material: {
    text: string;
    words: { w: string; ipa: string; en: string; note?: string }[];
    breakdown?: string | undefined;
    question: { prompt: string; options: string[]; answer_index: number; evidence?: string };
  };
  rate_stage: RateStage;
  audio_url_normal: string;
  audio_url_slow: string;
  index: number;
  total: number;
  result?: { correct: boolean };
}

export interface ListeningGate {
  hours: { value: number; target: number };
  understood_pct: { value: number; target: number };
  unseen_quiz_pct: { value: number; target: number };
  unlocked: boolean;
}

export interface Passage {
  id: string;
  title: string;
  text: string;
  text_type: string;
  level: string;
  source: string;
  license: string;
  analysis: AnalyzeResult;
  questions: { kind: string; q: string; a: string; evidence?: string }[];
}

export interface Rubric {
  dims: { dim: string; cefr: "A1" | "A2" | "B1" | "B2" | "C1"; evidence?: string }[];
  score_low: number;
  score_high: number;
  confidence: "low" | "medium" | "high";
  hard_fail: null | "word_count" | "off_topic" | "order";
  calibration: "uncalibrated" | "calibrating" | "calibrated";
  prompt_version?: string | undefined;
}

export interface ReciteResult {
  similarity: number;
  sentences: { text: string; transcript: string; similarity: number; passed: boolean }[];
  passed_count: number;
  total: number;
  new_speak_cards: number;
}

export interface ItemsSummary {
  pools: {
    practice: Record<Skill, { total: number; by_source: Record<string, number> }>;
    validation: Record<Skill, { total: number; by_source: Record<string, number> }>;
  };
}

export interface ItemRow {
  id: string;
  skill: Skill;
  task: string;
  level: string;
  format: string;
  source: "official_sample" | "user" | "llm" | "imported";
  license: string;
  pool: "practice" | "validation";
  created_at: string;
  exposed_at?: string | undefined;
}

export interface Checkpoint {
  id: string;
  kind: string;
  status: "upcoming" | "open" | "decided";
  triggered_at?: string | undefined;
  hours_at: number;
  report?: {
    active_hours: number;
    process_metrics: Record<string, number | string>;
    skills: { skill: Skill; series: number[]; last: number }[];
    ai_human_gap?: number | undefined;
    tutor_status: string;
    recommendation: string;
    risks: string[];
  };
  decision?: string | undefined;
  decision_note?: string | undefined;
}

export interface TutorSession {
  id: string;
  day: string;
  minutes: number;
  tutor?: string | undefined;
  topics?: string | undefined;
  homework?: string | undefined;
  cost?: number | undefined;
}

export interface Phase {
  id: string;
  name: string;
  week_target_min: number;
  lane_targets: Record<Lane, number>;
  new_cards_per_day: number;
  gates: unknown;
}

export interface Calibration {
  samples: number;
  mean_gap: number;
  direction: string;
  state: "uncalibrated" | "calibrating" | "calibrated";
}

export interface ShadowSentence {
  text: string;
  ipa: string;
}
