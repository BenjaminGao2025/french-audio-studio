// Tiny i18n: zh-CN default, en toggle. French learning content is never translated.
import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en";

const KEY = "1000h.locale";
let listeners: (() => void)[] = [];

export function getLocale(): Locale {
  if (typeof window === "undefined") return "zh";
  return (window.localStorage.getItem(KEY) as Locale) || "zh";
}

export function setLocale(l: Locale) {
  window.localStorage.setItem(KEY, l);
  document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  listeners.forEach((fn) => fn());
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.push(cb);
      return () => {
        listeners = listeners.filter((f) => f !== cb);
      };
    },
    getLocale,
    () => "zh" as Locale,
  );
}

const dict = {
  en: {
    today: "Today",
    hours: "Hours",
    decisions: "Decisions",
    itemBank: "Item bank",
    modules: "Modules",
    intensiveReading: "Intensive reading",
    speakingExam: "Speaking exam",
    writingExam: "Writing exam",
    listen: "Listen",
    cards: "Cards",
    speak: "Speak",
    me: "Me",
    more: "More",
    legacyPages: "Legacy pages",
    settings: "Settings",
    startToday: "Start today",
    finishBlock: "Finish block",
    skipLogged: "Skip (just logged)",
    exitBlock: "Exit block",
    bestOnDesktop: "Best on desktop",
    loading: "Loading…",
    tryAgain: "Try again",
    nothingHere: "Nothing here yet",
    login: "Sign in",
    logout: "Sign out",
    email: "Email",
    password: "Password",
    notAvailable: "Not available on this server yet",
    notAvailableHint: "The backend for this feature has not been deployed.",
    focus: "Focus",
    focusTitle: "Focus for a while",
    focusStart: "Start focus",
    focusPause: "Pause",
    focusResume: "Resume",
    focusGiveUp: "Give up",
    focusPlus5: "5 min",
    focusRunning: "Focusing",
    focusOnBreak: "On a break",
    focusPaused: "Paused",
    focusSkipBreak: "Skip break",
    focusDoneTitle: "One focus session done",
    focusTakeBreak: "Take a break",
    focusAgain: "One more",
    focusClose: "Close",
    focusToday: "Today",
    focusSessions: "sessions",
    focusMinutes: "min",
    focusLogTitle: "Log to the hours ledger",
    focusLogHint: "Only for study outside this app; blocks here are timed automatically.",
    focusLogged: "Logged",
    focusNotifyOn: "Turn on end-of-session alerts",
    focusNotifyBlocked: "Notifications are blocked in this browser; the chime still plays.",
    focusNotifyTitle: "Focus done",
    focusNotifyBody: "Stand up, drink some water, then take a break.",
    focusBreakOverTitle: "Break over",
    focusBreakOverBody: "Ready for the next session?",
    focusOpen: "Focus timer",
    laneListening: "Listening",
    laneReading: "Reading",
    laneSpeaking: "Speaking",
    laneWriting: "Writing",
    laneReview: "Review",
  },
  zh: {
    today: "今日",
    hours: "小时账本",
    decisions: "决策",
    itemBank: "题库",
    modules: "模块",
    intensiveReading: "精读",
    speakingExam: "口语考试",
    writingExam: "写作考试",
    listen: "收听",
    cards: "卡片",
    speak: "口语",
    me: "我的",
    more: "更多",
    legacyPages: "旧版页面",
    settings: "设置",
    startToday: "开始今天",
    finishBlock: "完成本块",
    skipLogged: "跳过（仅记录）",
    exitBlock: "退出本块",
    bestOnDesktop: "桌面端体验更佳",
    loading: "加载中…",
    tryAgain: "重试",
    nothingHere: "暂无内容",
    login: "登录",
    logout: "退出登录",
    email: "邮箱",
    password: "密码",
    notAvailable: "此功能的后端尚未上线",
    notAvailableHint: "服务器尚未部署这个功能的后端。",
    focus: "专注",
    focusTitle: "专注一会儿",
    focusStart: "开始专注",
    focusPause: "暂停",
    focusResume: "继续",
    focusGiveUp: "放弃",
    focusPlus5: "5 分钟",
    focusRunning: "专注中",
    focusOnBreak: "休息中",
    focusPaused: "已暂停",
    focusSkipBreak: "跳过休息",
    focusDoneTitle: "完成一个番茄",
    focusTakeBreak: "休息",
    focusAgain: "再来一个",
    focusClose: "关闭",
    focusToday: "今天",
    focusSessions: "个番茄",
    focusMinutes: "分钟",
    focusLogTitle: "记入小时账本",
    focusLogHint: "只在站外学习时记（比如 tcfcan 刷题）；站内练习块会自动计时。",
    focusLogged: "已记入",
    focusNotifyOn: "开启结束提醒",
    focusNotifyBlocked: "浏览器屏蔽了通知；结束时仍会响铃。",
    focusNotifyTitle: "专注结束",
    focusNotifyBody: "起来走走、喝口水，再开始休息。",
    focusBreakOverTitle: "休息结束",
    focusBreakOverBody: "准备好下一个番茄了吗？",
    focusOpen: "番茄钟",
    laneListening: "听力",
    laneReading: "阅读",
    laneSpeaking: "口语",
    laneWriting: "写作",
    laneReview: "复习",
  },
} as const;

export type TKey = keyof (typeof dict)["en"];

export function t(key: TKey, locale: Locale = getLocale()): string {
  return dict[locale][key];
}

export function useT() {
  const locale = useLocale();
  return (key: TKey) => dict[locale][key];
}
