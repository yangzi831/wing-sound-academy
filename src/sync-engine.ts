import type { AcademyData, Artifact } from "./types";
import {
  compose,
  dirtyKeys,
  entities,
  equal,
  freshState,
  keyOf,
  reconcile,
  resolveConflict,
  splitKey,
} from "./sync-model";
import type { CloudRow, Payload, Rows, SyncState } from "./sync-model";
import { validateData } from "./storage";
import { createInitialData } from "./data";

export interface Transport {
  read(): Promise<CloudRow[]>;
  write(
    kind: CloudRow["kind"],
    id: string,
    payload: Payload | null,
    expected: number,
  ): Promise<{ ok: boolean; row: CloudRow }>;
  upload(a: Artifact): Promise<Artifact>;
}
export interface Recovery {
  id: string;
  at: string;
  reason: string;
  state: SyncState;
  raw?: string;
}
const cacheKey = (uid: string) => `wing-sound-sync:v1:${uid}`;
export function loadSync(uid: string, legacy: AcademyData): SyncState {
  const raw = localStorage.getItem(cacheKey(uid));
  if (!raw) return freshState(legacy);
  const state = JSON.parse(raw) as SyncState;
  if (
    state.version !== 1 ||
    typeof state.initialized !== "boolean" ||
    !state.base ||
    !state.conflicts
  )
    throw new Error("同步缓存损坏，已暂停写入。请先导出原始缓存。");
  validateData(state.data);
  for (const row of Object.values(state.base))
    if (!Number.isSafeInteger(row.revision) || row.revision < 1)
      throw new Error("缓存版本号无效");
  return state;
}
export const rawSync = (uid: string) =>
  localStorage.getItem(cacheKey(uid)) || "";
export async function recoverBrokenCache(uid: string, data: AcademyData) {
  validateData(data);
  await recoveries(uid, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    reason: "恢复损坏缓存前的原始数据",
    state: freshState(createInitialData()),
    raw: JSON.stringify({
      cache: rawSync(uid),
      legacy: localStorage.getItem("wing-sound-academy:v1"),
    }),
  });
  localStorage.setItem(cacheKey(uid), JSON.stringify(freshState(data)));
}
async function recoveryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("wing-sound-sync-recovery", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function recoveries(
  uid: string,
  entry?: Recovery,
): Promise<Recovery[]> {
  const db = await recoveryDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", entry ? "readwrite" : "readonly"),
        store = tx.objectStore("snapshots");
      if (entry) store.put(entry, `${uid}:${entry.id}`);
      const values = store.getAll(),
        keys = store.getAllKeys();
      tx.oncomplete = () =>
        resolve(
          (values.result as Recovery[])
            .filter((_, i) => String(keys.result[i]).startsWith(`${uid}:`))
            .sort((a, b) => b.at.localeCompare(a.at)),
        );
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export class SyncEngine {
  state: SyncState;
  preview: CloudRow[] | null = null;
  status = "未同步";
  error = "";
  uploading = "";
  audioErrors: Record<string, string> = {};
  stopped = false;
  private busy = false;
  private saveFailed = false;
  constructor(
    readonly uid: string,
    state: SyncState,
    readonly transport: Transport,
    readonly changed: () => void,
  ) {
    this.state = state;
  }
  private commit(next: SyncState) {
    this.state = next;
    try {
      localStorage.setItem(cacheKey(this.uid), JSON.stringify(next));
      this.saveFailed = false;
    } catch {
      this.saveFailed = true;
      this.error =
        "本地缓存写入失败，请立即导出备份；云同步已暂停以避免丢失未保存内容。";
      throw new Error(this.error);
    } finally {
      this.changed();
    }
  }
  edit(change: AcademyData | ((data: AcademyData) => AcademyData)) {
    const data =
      typeof change === "function" ? change(this.state.data) : change;
    validateData(data);
    const conflicts = structuredClone(this.state.conflicts);
    const local = entities(data);
    for (const [k, c] of Object.entries(conflicts)) c.local = local[k] ?? null;
    this.status = "未同步";
    this.commit({ ...this.state, data, conflicts });
  }
  async snapshot(reason: string) {
    await recoveries(this.uid, {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      reason,
      state: structuredClone(this.state),
    });
  }
  async initialize(choice: "local" | "cloud" | "merge") {
    if (!this.preview || this.state.initialized) return;
    await this.snapshot("首次云同步前（原始本机记录与音频仍保留）");
    const base: Rows = Object.fromEntries(
      this.preview.map((r) => [keyOf(r), r]),
    );
    const cloud = compose(
      Object.fromEntries(this.preview.map((r) => [keyOf(r), r.payload])),
    );
    let state = { ...this.state, base, initialized: true };
    if (choice === "cloud") state = { ...state, data: cloud };
    if (choice === "merge") {
      // Treat every differing populated entity as a conflict; never guess from timestamps.
      state = reconcile({ ...state, base: {} }, this.preview);
    }
    this.commit(state);
    await this.sync();
  }
  async resolve(
    key: string,
    choice: "local" | "remote",
    merged?: Payload | null,
  ) {
    await this.snapshot(`处理冲突 ${key} 前`);
    this.commit(resolveConflict(this.state, key, choice, merged));
    await this.sync();
  }
  async restore(data: AcademyData) {
    await this.snapshot("导入或恢复记录前");
    this.edit(data);
  }
  async sync() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    this.status = "同步中";
    this.error = "";
    this.changed();
    try {
      // Persist pending edits before sending any remote mutation.
      if (this.saveFailed) this.commit(this.state);
      const rows = await this.transport.read();
      if (this.stopped) return;
      if (!this.state.initialized) {
        compose(Object.fromEntries(rows.map((r) => [keyOf(r), r.payload])));
        this.preview = rows;
        this.status = "待确认迁移";
        return;
      }
      if (
        Object.keys(this.state.base).some(
          (k) => !rows.some((r) => keyOf(r) === k),
        )
      )
        throw new Error(
          "云端记录异常缺失。已暂停同步并保留本机数据，请检查项目地址或从历史恢复。",
        );
      this.commit(reconcile(this.state, rows));
      this.audioErrors = {};
      // Upload immutable blobs before publishing their metadata to other devices.
      for (const a of [...this.state.data.artifacts]) {
        if (
          a.fileId &&
          !a.remotePath &&
          !this.state.conflicts[`artifact:${a.id}`]
        ) {
          this.uploading = a.fileName || a.title;
          this.changed();
          let uploaded: Artifact;
          try {
            uploaded = await this.transport.upload(a);
          } catch (e) {
            this.audioErrors[a.id] = (e as Error).message;
            this.uploading = "";
            continue;
          }
          if (this.stopped) return;
          const current = this.state.data.artifacts.find((v) => v.id === a.id);
          if (current?.fileId === a.fileId)
            this.edit((d) => ({
              ...d,
              artifacts: d.artifacts.map((v) =>
                v.id === a.id
                  ? {
                      ...v,
                      remotePath: uploaded.remotePath,
                      fileSize: uploaded.fileSize,
                      fileHash: uploaded.fileHash,
                    }
                  : v,
              ),
            }));
          this.uploading = "";
        }
      }
      const rank = (k: string) =>
        k.startsWith("critique:") ? 3 : k.startsWith("artifact:") ? 2 : 1;
      const keys = dirtyKeys(this.state).sort((a, b) => rank(a) - rank(b));
      for (const k of keys) {
        if (this.stopped) return;
        if (this.state.conflicts[k]) continue;
        const [kind, id] = splitKey(k);
        const payload = structuredClone(entities(this.state.data)[k] ?? null);
        if (kind === "artifact" && payload?.fileId && !payload.remotePath)
          continue;
        if (
          kind === "critique" &&
          payload?.versionId &&
          this.state.data.artifacts.some(
            (a) => a.id === payload.versionId && a.fileId && !a.remotePath,
          )
        )
          continue;
        const expected = this.state.base[k]?.revision ?? 0;
        const result = await this.transport.write(kind, id, payload, expected);
        if (this.stopped) return;
        if (!result.ok) this.commit(reconcile(this.state, [result.row]));
        else {
          // Edits typed while awaiting the request remain dirty against the acknowledged base.
          const base = { ...this.state.base, [k]: result.row };
          this.commit({ ...this.state, base });
        }
      }
      const verification = await this.transport.read();
      if (this.stopped) return;
      if (
        Object.keys(this.state.base).some(
          (k) => !verification.some((r) => keyOf(r) === k),
        )
      )
        throw new Error("云端完整性核验失败，本机数据已保留");
      this.commit(reconcile(this.state, verification));
      if (
        !dirtyKeys(this.state).length &&
        !Object.keys(this.state.conflicts).length
      ) {
        this.commit({ ...this.state, verifiedAt: new Date().toISOString() });
        this.status = "已同步";
      } else
        this.status = Object.keys(this.state.conflicts).length
          ? "存在冲突"
          : "未同步";
      if (Object.keys(this.audioErrors).length) {
        this.status = "同步失败";
        this.error = Object.values(this.audioErrors).join("；");
      }
    } catch (e) {
      this.status =
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "未同步（离线）"
          : "同步失败";
      this.error = e instanceof Error ? e.message : "同步失败，请重试";
    } finally {
      this.busy = false;
      this.uploading = "";
      if (!this.stopped) this.changed();
    }
  }
}

export function describeData(d: AcademyData) {
  const defaults = entities(createInitialData()),
    records = entities(d);
  return `${d.sessions.filter((s) => s.status === "已完成").length}/16 周已完成 · ${d.artifacts.length} 档案 · ${d.critiques.length} 讲评 · ${Object.keys(records).filter((k) => !equal(records[k], defaults[k])).length} 条非默认记录`;
}
