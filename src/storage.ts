import type { AcademyData } from "./types";
import { createInitialData } from "./data";
export const STORAGE_KEY = "wing-sound-academy:v1";
export const repository = {
  load(): AcademyData {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? validateData(JSON.parse(raw)) : createInitialData();
  },
  save(data: AcademyData) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  },
};
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x: Record<string, unknown>, keys: string[]) =>
  keys.every((k) => typeof x[k] === "string");
const validDate = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !isNaN(Date.parse(v)) &&
  new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
const status = (v: unknown) =>
  ["未开始", "进行中", "待评图", "已完成"].includes(v as string);
export function validateData(x: unknown): AcademyData {
  const fail = () => {
    throw new Error("备份格式无效或数据关联不完整，现有记录未被更改。");
  };
  if (
    !object(x) ||
    x.schemaVersion !== 1 ||
    !object(x.semester) ||
    !strings(x.semester, ["name", "year", "title", "code", "timezone"]) ||
    !Array.isArray(x.sessions) ||
    !Array.isArray(x.projects) ||
    !Array.isArray(x.critiques) ||
    !Array.isArray(x.artifacts)
  )
    return fail();
  if (x.sessions.length !== 16 || x.projects.length !== 5) return fail();
  const unique = (items: unknown[]) =>
    items.every(object) &&
    new Set(items.map((v) => (v as Record<string, unknown>).id)).size ===
      items.length;
  if (![x.sessions, x.projects, x.critiques, x.artifacts].every(unique))
    return fail();
  const projectIds = new Set(x.projects.map((p) => p.id));
  if (!["P00", "P01", "P02", "P03", "P04"].every((id) => projectIds.has(id)))
    return fail();
  if (
    !x.projects.every(
      (p) =>
        object(p) &&
        strings(p, [
          "id",
          "name",
          "cn",
          "direction",
          "question",
          "brief",
          "constraints",
          "topics",
          "references",
          "idea",
          "log",
          "summary",
        ]) &&
        status(p.status) &&
        Array.isArray(p.weeks) &&
        p.weeks.length > 0 &&
        p.weeks.every((w) => Number.isInteger(w) && w >= 1 && w <= 16) &&
        Array.isArray(p.stages) &&
        p.stages.length === 5 &&
        p.stages.every((v) => typeof v === "boolean"),
    )
  )
    return fail();
  if (
    !x.sessions.every(
      (s) =>
        object(s) &&
        strings(s, [
          "id",
          "topic",
          "event",
          "projectId",
          "objectives",
          "task",
          "submission",
          "references",
          "notes",
          "progress",
        ]) &&
        validDate(s.date) &&
        status(s.status) &&
        projectIds.has(s.projectId) &&
        typeof s.week === "number" &&
        Number.isInteger(s.week) &&
        s.week >= 1 &&
        s.week <= 16 &&
        s.id === `W${String(s.week).padStart(2, "0")}`,
    )
  )
    return fail();
  if (
    !x.artifacts.every(
      (a) =>
        object(a) &&
        strings(a, [
          "id",
          "projectId",
          "kind",
          "title",
          "version",
          "url",
          "note",
          "createdAt",
        ]) &&
        projectIds.has(a.projectId) &&
        ["音频版本", "创作笔记", "声音素材", "参考音乐", "结题总结"].includes(
          a.kind as string,
        ) &&
        typeof a.final === "boolean" &&
        ["fileId", "fileName", "mime"].every(
          (k) => a[k] === undefined || typeof a[k] === "string",
        ) &&
        validDate((a.createdAt as string).slice(0, 10)),
    )
  )
    return fail();
  const artifacts = x.artifacts;
  if (
    !x.critiques.every(
      (c) =>
        object(c) &&
        strings(c, [
          "id",
          "projectId",
          "versionId",
          "date",
          "type",
          "statement",
          "listening",
          "strengths",
          "issues",
          "revisions",
          "next",
          "updatedAt",
        ]) &&
        validDate(c.date) &&
        projectIds.has(c.projectId) &&
        ["Concept Crit", "Midterm Crit", "Final Crit"].includes(
          c.type as string,
        ) &&
        typeof c.completed === "boolean" &&
        validDate((c.updatedAt as string).slice(0, 10)) &&
        (!c.versionId ||
          artifacts.some(
            (a: Record<string, unknown>) =>
              a.id === c.versionId &&
              a.projectId === c.projectId &&
              a.kind === "音频版本",
          )),
    )
  )
    return fail();
  const data = x as unknown as AcademyData;
  if (
    !data.sessions.every((s) =>
      data.projects.find((p) => p.id === s.projectId)?.weeks.includes(s.week),
    )
  )
    return fail();
  if (
    !data.sessions.every(
      (s, i) =>
        s.week === i + 1 &&
        new Date(s.date + "T12:00:00Z").getUTCDay() === 0 &&
        (i === 0 || s.date > data.sessions[i - 1].date),
    )
  )
    return fail();
  return data;
}
export function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("wing-sound-audio", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new Error("无法打开本地音频存储"));
  });
}
export async function audioStore(
  action: "get" | "put" | "delete",
  id: string,
  blob?: Blob,
): Promise<Blob | undefined> {
  const db = await openAudioDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        "files",
        action === "get" ? "readonly" : "readwrite",
      );
      const s = tx.objectStore("files");
      const r =
        action === "get"
          ? s.get(id)
          : action === "put"
            ? s.put(blob, id)
            : s.delete(id);
      tx.oncomplete = () => resolve(action === "get" ? r.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export interface Backup {
  format: "wing-sound-backup";
  version: 1;
  exportedAt: string;
  data: AcademyData;
  audio: Record<string, string>;
}
export async function createBackup(data: AcademyData): Promise<Backup> {
  const audio: Record<string, string> = {};
  for (const a of data.artifacts) {
    if (a.fileId) {
      const blob = await audioStore("get", a.fileId);
      if (!blob)
        throw new Error(`附件「${a.fileName}」缺失，无法生成完整备份。`);
      audio[a.fileId] = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    }
  }
  return {
    format: "wing-sound-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
    audio,
  };
}
export async function readBackup(raw: string): Promise<AcademyData> {
  const b = JSON.parse(raw);
  if (
    !object(b) ||
    b.format !== "wing-sound-backup" ||
    b.version !== 1 ||
    !object(b.audio)
  )
    throw new Error("请选择 WING SOUND ACADEMY 导出的完整备份。");
  const data = validateData(b.data);
  const files: Array<[string, Blob]> = [];
  for (const a of data.artifacts) {
    if (a.fileId) {
      const encoded = b.audio[a.fileId];
      if (
        typeof encoded !== "string" ||
        !/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(encoded)
      )
        throw new Error("备份音频不完整，现有数据未更改。");
      const [head, body] = encoded.split(",");
      const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
      const newId = crypto.randomUUID();
      files.push([
        newId,
        new Blob([bytes], { type: head.slice(5).split(";")[0] }),
      ]);
      a.fileId = newId;
    }
  }
  const written: string[] = [];
  try {
    for (const [id, blob] of files) {
      await audioStore("put", id, blob);
      written.push(id);
    }
    repository.save(data);
    return data;
  } catch (e) {
    await Promise.all(written.map((id) => audioStore("delete", id)));
    throw e;
  }
}
