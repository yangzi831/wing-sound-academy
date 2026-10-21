import type { AcademyData } from "./types";
import { createInitialData } from "./data";
import { validateData } from "./storage";

export type Kind = "semester" | "session" | "project" | "artifact" | "critique";
export type Payload = Record<string, unknown>;
export interface CloudRow {
  kind: Kind;
  id: string;
  payload: Payload | null;
  revision: number;
  updated_at: string;
}
export type Rows = Record<string, CloudRow>;
export interface Conflict {
  local: Payload | null;
  remote: CloudRow;
}
export interface SyncState {
  version: 1;
  initialized: boolean;
  verifiedAt?: string;
  data: AcademyData;
  base: Rows;
  conflicts: Record<string, Conflict>;
}
export const keyOf = (r: { kind: Kind; id: string }) => `${r.kind}:${r.id}`;
export const splitKey = (key: string): [Kind, string] => [
  key.slice(0, key.indexOf(":")) as Kind,
  key.slice(key.indexOf(":") + 1),
];
export const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== "object" || typeof b !== "object")
    return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) => Object.hasOwn(b, k) && equal((a as Payload)[k], (b as Payload)[k]),
    )
  );
};
export function entities(d: AcademyData): Record<string, Payload> {
  return Object.fromEntries([
    ["semester:main", d.semester],
    ...d.sessions.map((s) => [`session:${s.id}`, s]),
    ...d.projects.map((p) => [`project:${p.id}`, p]),
    ...d.artifacts.map((a) => [`artifact:${a.id}`, a]),
    ...d.critiques.map((c) => [`critique:${c.id}`, c]),
  ]) as Record<string, Payload>;
}
export function compose(records: Record<string, Payload | null>): AcademyData {
  const d = createInitialData();
  for (const [key, p] of Object.entries(records)) {
    const [kind, id] = splitKey(key);
    if (kind === "semester" && p)
      d.semester = p as unknown as AcademyData["semester"];
    const field = (
      {
        session: "sessions",
        project: "projects",
        artifact: "artifacts",
        critique: "critiques",
      } as const
    )[kind as Exclude<Kind, "semester">];
    if (!field) continue;
    const list = d[field] as unknown as Payload[];
    const index = list.findIndex((v) => v.id === id);
    if (index >= 0) {
      if (p) list[index] = p;
      else throw new Error("云端课程基准记录不可删除");
    } else if (p) list.push(p);
  }
  d.sessions.sort((a, b) => a.week - b.week);
  d.projects.sort((a, b) => a.id.localeCompare(b.id));
  return validateData(d);
}
export function dirtyKeys(s: SyncState): string[] {
  const local = entities(s.data);
  return [...new Set([...Object.keys(local), ...Object.keys(s.base)])].filter(
    (k) => !equal(local[k] ?? null, s.base[k]?.payload ?? null),
  );
}
// A changed server revision never replaces a locally edited entity without a choice.
export function reconcile(s: SyncState, rows: CloudRow[]): SyncState {
  const next = structuredClone(s),
    local = entities(s.data);
  const records: Record<string, Payload | null> = { ...local };
  for (const r of rows) {
    const k = keyOf(r),
      before = s.base[k];
    if (before && r.revision < before.revision)
      throw new Error("云端版本倒退，已暂停同步，请检查项目配置");
    if (before?.revision === r.revision) continue;
    const edited = !equal(local[k] ?? null, before?.payload ?? null);
    if ((edited || s.conflicts[k]) && !equal(local[k] ?? null, r.payload)) {
      next.conflicts[k] = { local: local[k] ?? null, remote: r };
    } else {
      records[k] = r.payload;
      delete next.conflicts[k];
    }
    next.base[k] = r;
  }
  // A remote audio deletion/reclassification can intersect a local review edit.
  // Keep the related local audio descriptor as a second conflict instead of
  // clearing the timecoded review's association or rejecting the whole snapshot.
  for (const [k, p] of Object.entries(records)) {
    if (!k.startsWith("critique:") || !p?.versionId) continue;
    const ak = `artifact:${p.versionId}`,
      a = records[ak];
    if (a?.kind === "音频版本" && a.projectId === p.projectId) continue;
    const la = local[ak],
      lc = local[k];
    if (
      lc?.versionId === p.versionId &&
      la?.kind === "音频版本" &&
      la.projectId === p.projectId &&
      next.base[ak]
    ) {
      records[ak] = la;
      next.conflicts[ak] = { local: la, remote: next.base[ak] };
    } else {
      records[k] = lc ?? null;
      if (next.base[k])
        next.conflicts[k] = { local: lc ?? null, remote: next.base[k] };
    }
  }
  next.data = compose(records);
  return next;
}
export function freshState(data: AcademyData): SyncState {
  return { version: 1, initialized: false, data, base: {}, conflicts: {} };
}
export function resolveConflict(
  s: SyncState,
  key: string,
  choice: "local" | "remote",
  merged?: Payload | null,
): SyncState {
  const n = structuredClone(s),
    c = n.conflicts[key];
  if (!c) return n;
  const records: Record<string, Payload | null> = entities(s.data);
  records[key] =
    merged !== undefined
      ? merged
      : choice === "local"
        ? (records[key] ?? null)
        : c.remote.payload;
  try {
    n.data = compose(records);
  } catch {
    throw new Error(
      "合并内容的格式或作品版本关联无效。请保留原字段，并先处理相关音频档案与讲评；现有冲突未更改。",
    );
  }
  delete n.conflicts[key];
  return n;
}
