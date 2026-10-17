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
    tutor: "Tutor & course",
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
    tutor: "外教与课程",
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
