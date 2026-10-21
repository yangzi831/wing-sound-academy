import type { Session } from "./types";
export const statuses = ["未开始", "进行中", "待评图", "已完成"] as const;
export const stages = [
  "创作立项",
  "阶段试听与反馈",
  "独立制作与深化",
  "期末作品预评",
  "作品展示与评审",
];
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function semesterClock(sessions: Session[], today = localDate()) {
  const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const next = sorted.find((s) => s.date >= today);
  const last = sorted.at(-1);
  const phase = !sorted.length
    ? "empty"
    : today < sorted[0].date
      ? "before"
      : last && today > last.date
        ? "after"
        : "active";
  const current =
    phase === "active"
      ? [...sorted].reverse().find((s) => s.date <= today)
      : undefined;
  return { next, current, phase };
}
export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "short",
    year: "numeric",
  },
) {
  return new Date(date + "T12:00:00+08:00").toLocaleDateString("en-GB", {
    ...options,
    timeZone: "Asia/Shanghai",
  });
}
export function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}
