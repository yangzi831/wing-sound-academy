import type {
  AcademyCache,
  AcademyDocument,
  AcademySnapshot,
  Value,
} from "./academy-model";
import {
  freshAcademy,
  mergeAcademy,
  pendingDocuments,
  electronicData,
  electronicPersonal,
  validateAcademyBackup,
} from "./academy-model";
import type { AcademyTransport } from "./academy-api";
import { equal } from "./sync-model";
import { audioStore, createBackup, readBackup, validateData } from "./storage";
import { getAudio } from "./cloud-audio";
import type { AcademyData, Artifact } from "./types";
export const academyCacheKey = (uid: string, aid: string) =>
  `wing-academy:v2:${aid}:${uid}`;
export async function academyRecovery(
  uid: string,
  aid: string,
  reason: string,
  state: unknown,
) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("wing-academy-recovery", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("snapshots");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put(
        { uid, aid, reason, at: new Date().toISOString(), state },
        `${aid}:${uid}:${crypto.randomUUID()}`,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function academyRecoveryList(
  uid: string,
  aid: string,
): Promise<
  { reason: string; at: string; state: AcademyCache | { raw: string } }[]
> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("wing-academy-recovery", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("snapshots");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("snapshots", "readonly"),
        r = tx.objectStore("snapshots").getAll();
      tx.oncomplete = () =>
        resolve(
          r.result
            .filter((x) => x.uid === uid && x.aid === aid)
            .sort((a, b) => b.at.localeCompare(a.at)),
        );
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export function loadAcademy(
  uid: string,
  snapshot: AcademySnapshot,
): AcademyCache {
  const raw = localStorage.getItem(academyCacheKey(uid, snapshot.academy.id));
  if (!raw) return freshAcademy(uid, snapshot);
  const c = JSON.parse(raw) as AcademyCache;
  if (
    c.version !== 2 ||
    c.uid !== uid ||
    c.academyId !== snapshot.academy.id ||
    !c.documents ||
    !c.base ||
    !c.conflicts
  )
    throw new Error("学院缓存损坏。原始内容未覆盖，请导出后恢复。");
  return mergeAcademy(c, snapshot);
}
export class AcademyEngine {
  state: AcademyCache;
  status = "未同步";
  error = "";
  uploading = "";
  busy = false;
  stopped = false;
  denied = false;
  private persistenceFailed = false;
  constructor(
    state: AcademyCache,
    readonly transport: AcademyTransport,
    readonly changed: () => void,
  ) {
    this.state = state;
  }
  save(next: AcademyCache) {
    this.state = next;
    try {
      localStorage.setItem(
        academyCacheKey(next.uid, next.academyId),
        JSON.stringify(next),
      );
      this.persistenceFailed = false;
    } catch {
      this.persistenceFailed = true;
      this.status = "同步失败";
      this.error = "本机保存失败，云写入已暂停，请导出当前完整备份。";
      throw new Error(this.error);
    } finally {
      this.changed();
    }
  }
  private assertEditable(doc: AcademyDocument) {
    if (this.denied || this.stopped) throw new Error("成员权限已失效");
    if (doc.author_id && doc.author_id !== this.state.uid)
      throw new Error("只能编辑自己的学习记录或反馈");
    const current = this.state.documents[doc.id];
    if (
      current &&
      (current.kind !== doc.kind ||
        current.course_id !== doc.course_id ||
        current.author_id !== doc.author_id)
    )
      throw new Error("不能修改记录归属");
    const memberCourseEdit =
      doc.kind === "course" &&
      current?.payload &&
      doc.payload &&
      equal(
        Object.fromEntries(
          Object.entries(current.payload).filter(
            ([k]) => !["description", "goals"].includes(k),
          ),
        ),
        Object.fromEntries(
          Object.entries(doc.payload).filter(
            ([k]) => !["description", "goals"].includes(k),
          ),
        ),
      );
    if (
      !doc.author_id &&
      (doc.course_id === "electronic" ||
        (doc.kind === "course" &&
          this.state.snapshot.members.find((m) => m.user_id === this.state.uid)
            ?.role !== "admin" &&
          !memberCourseEdit))
    )
      throw new Error("固定课程只读，或此操作需要学院管理员");
  }
  edit(doc: AcademyDocument) {
    this.assertEditable(doc);
    const conflicts = { ...this.state.conflicts };
    if (conflicts[doc.id])
      conflicts[doc.id] = { ...conflicts[doc.id], local: doc };
    this.status = "未同步";
    this.save({
      ...this.state,
      documents: { ...this.state.documents, [doc.id]: doc },
      conflicts,
    });
  }
  async snapshot(reason: string) {
    await academyRecovery(
      this.state.uid,
      this.state.academyId,
      reason,
      structuredClone(this.state),
    );
  }
  async resolve(id: string, choice: "local" | "remote", merged?: Value | null) {
    await this.snapshot("处理冲突前");
    const c = this.state.conflicts[id];
    if (!c) return;
    const documents = {
      ...this.state.documents,
      [id]:
        choice === "remote"
          ? c.remote
          : {
              ...c.local,
              payload: merged !== undefined ? merged : c.local.payload,
            },
    };
    const conflicts = { ...this.state.conflicts };
    delete conflicts[id];
    this.save({ ...this.state, documents, conflicts });
    await this.sync();
  }
  async sync() {
    if (this.busy || this.stopped || this.denied) return;
    this.busy = true;
    this.status = "同步中";
    this.error = "";
    this.changed();
    try {
      if (this.persistenceFailed) this.save(this.state);
      const snapshot = await this.transport.read();
      if (this.stopped) return;
      this.save(mergeAcademy(this.state, snapshot));
      const failures: string[] = [];
      for (const d of pendingDocuments(this.state)) {
        if (
          this.state.conflicts[d.id] ||
          !d.payload?.fileId ||
          d.payload.remotePath
        )
          continue;
        this.uploading = String(
          d.payload.fileName || d.payload.title || "音频",
        );
        this.changed();
        try {
          const uploaded = await this.transport.upload(d);
          if (this.stopped) return;
          const now = this.state.documents[d.id];
          if (now?.payload?.fileId === d.payload.fileId)
            this.edit({
              ...now,
              payload: {
                ...now.payload,
                remotePath: uploaded.payload?.remotePath,
                fileHash: uploaded.payload?.fileHash,
                fileSize: uploaded.payload?.fileSize,
              },
            });
        } catch (e) {
          failures.push((e as Error).message);
        }
      }
      const rank = (d: AcademyDocument) =>
        d.kind === "course"
          ? 0
          : ["lesson", "project"].includes(d.kind)
            ? 1
            : d.kind === "critique" || d.kind === "feedback"
              ? 3
              : 2;
      for (const pending of pendingDocuments(this.state).sort(
        (a, b) => rank(a) - rank(b),
      )) {
        if (this.stopped) return;
        const d = structuredClone(this.state.documents[pending.id]);
        if (
          this.state.conflicts[d.id] ||
          (d.payload?.fileId && !d.payload.remotePath)
        )
          continue;
        if (
          d.kind === "critique" &&
          d.payload?.versionId &&
          Object.values(this.state.documents).some(
            (a) =>
              a.kind === "artifact" &&
              a.author_id === d.author_id &&
              a.payload?.id === d.payload!.versionId &&
              a.payload?.fileId &&
              !a.payload?.remotePath,
          )
        )
          continue;
        const result = await this.transport.write(
          d,
          this.state.base[d.id]?.revision ?? 0,
        );
        if (this.stopped) return;
        if (!result.ok)
          this.save(
            mergeAcademy(this.state, {
              ...this.state.snapshot,
              documents: Object.values({
                ...this.state.base,
                [d.id]: result.row,
              }),
            }),
          );
        else
          this.save({
            ...this.state,
            base: { ...this.state.base, [d.id]: result.row },
            documents: {
              ...this.state.documents,
              [d.id]: {
                ...this.state.documents[d.id],
                revision: result.row.revision,
                updated_at: result.row.updated_at,
              },
            },
          });
      }
      const verified = await this.transport.read();
      if (this.stopped) return;
      this.save(mergeAcademy(this.state, verified));
      this.status = Object.keys(this.state.conflicts).length
        ? "存在冲突"
        : pendingDocuments(this.state).length
          ? "未同步"
          : "已同步";
      if (failures.length) {
        this.error = failures.join("；");
        this.status = "同步失败";
      }
      if (this.status === "已同步")
        this.save({ ...this.state, verifiedAt: new Date().toISOString() });
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "42501") {
        this.denied = true;
        this.status = "访问已移除";
      } else
        this.status =
          navigator.onLine === false ? "未同步（离线）" : "同步失败";
      this.error = err.message;
    } finally {
      this.uploading = "";
      this.busy = false;
      this.changed();
    }
  }
  async importElectronic(data: AcademyData) {
    validateData(data);
    await this.snapshot("导入旧版个人备份前");
    const mine = electronicPersonal(data, this.state.uid);
    // Only personal fields are imported; immutable curriculum remains server-owned.
    for (const d of mine) {
      const current = this.state.documents[d.id];
      if (current?.payload && !equal(current.payload, d.payload)) {
        const remote = this.state.base[d.id] || current;
        this.save({
          ...this.state,
          documents: { ...this.state.documents, [d.id]: d },
          conflicts: { ...this.state.conflicts, [d.id]: { local: d, remote } },
        });
      } else this.edit(d);
    }
    // Omitted records are not silently deleted by an imported backup.
    this.save({ ...this.state, legacyImported: true });
  }
  async exportBackup() {
    const documents = structuredClone(Object.values(this.state.documents)),
      audio: Record<string, string> = {};
    for (const d of documents) {
      if (!d.payload?.fileId) continue;
      const a = d.payload as unknown as Artifact;
      const blob = await getAudio(a);
      audio[a.fileId!] = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }
    return {
      format: "wing-academy-backup",
      version: 2,
      exportedAt: new Date().toISOString(),
      academyId: this.state.academyId,
      documents,
      audio,
    };
  }
  async exportLegacy() {
    return createBackup(electronicData(this.state.documents, this.state.uid));
  }
  async importRaw(raw: string, restoreShared = false) {
    const b = JSON.parse(raw);
    if (b.format === "wing-sound-backup") {
      await this.importElectronic(await readBackup(raw, false));
      return;
    }
    const docs = validateAcademyBackup(b);
    if (b.academyId !== this.state.academyId)
      throw new Error("此备份属于另一学院，请勿合并身份与课程");
    await this.snapshot("导入学院备份前");
    const prepared: AcademyDocument[] = [],
      files = new Map<string, Blob>(),
      fileIds = new Map<string, string>();
    for (const original of docs) {
      if (
        original.author_id !== this.state.uid &&
        !(
          restoreShared &&
          original.author_id === null &&
          original.course_id !== "electronic"
        )
      )
        continue;
      if (
        restoreShared &&
        this.state.snapshot.members.find((m) => m.user_id === this.state.uid)
          ?.role !== "admin"
      )
        throw new Error("恢复共同课程框架需要管理员");
      const d = structuredClone(original);
      this.assertEditable(d);
      if (d.payload?.fileId) {
        const encoded = b.audio?.[String(d.payload.fileId)];
        if (
          typeof encoded !== "string" ||
          !/^data:[^,]*;base64,[A-Za-z0-9+/=]*$/.test(encoded)
        )
          throw new Error("完整备份缺少音频");
        const [head, body] = encoded.split(",");
        const originalId = String(d.payload.fileId);
        const id = fileIds.get(originalId) || crypto.randomUUID();
        fileIds.set(originalId, id);
        files.set(
          id,
          new Blob([Uint8Array.from(atob(body), (c) => c.charCodeAt(0))], {
            type: head.slice(5).split(";")[0],
          }),
        );
        d.payload.fileId = id;
        delete d.payload.remotePath;
        delete d.payload.fileHash;
      }
      prepared.push(d);
    }
    // Validate all files first. Public curriculum and other authors are never overwritten.
    const next = structuredClone(this.state);
    for (const d of prepared) {
      const current = next.documents[d.id],
        remote = next.base[d.id] || current;
      next.documents[d.id] = d;
      if (remote && !equal(current?.payload, d.payload))
        next.conflicts[d.id] = { local: d, remote };
    }
    const written: string[] = [];
    try {
      for (const [id, blob] of files) {
        await audioStore("put", id, blob);
        written.push(id);
      }
    } catch (e) {
      await Promise.all(written.map((id) => audioStore("delete", id)));
      throw e;
    }
    this.status = "未同步";
    this.save(next);
  }
}
