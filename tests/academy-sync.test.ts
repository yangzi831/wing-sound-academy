import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  AcademyEngine,
  loadAcademy,
  academyCacheKey,
  academyRecoveryList,
} from "../src/academy-engine";
import {
  freshAcademy,
  makeDoc,
  electronicData,
  electronicPersonal,
  patchElectronic,
  mergeAcademy,
  pendingDocuments,
  completedLessons,
} from "../src/academy-model";
import type { AcademyDocument, AcademySnapshot } from "../src/academy-model";
import type { AcademyTransport } from "../src/academy-api";
import { createInitialData } from "../src/data";
import { ElectronicAdapter } from "../src/electronic-adapter";
import { audioStore } from "../src/storage";
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v),
});
beforeEach(() => memory.clear());
const uid = "owner",
  friend = "friend";
class Server implements AcademyTransport {
  online = true;
  writes = 0;
  denied = false;
  snapshot: AcademySnapshot = {
    academy: { id: "aid", name: "WSA" },
    members: [
      { user_id: uid, display_name: "Owner", role: "admin", active: true },
      { user_id: friend, display_name: "Friend", role: "member", active: true },
    ],
    invitations: [],
    documents: [
      {
        ...makeDoc(
          "course",
          "electronic",
          null,
          {
            fixed: true,
            roles: {},
            adminRole: "共同学习者",
            memberRole: "共同学习者",
          },
          "course/electronic",
        ),
        revision: 1,
      },
      {
        ...makeDoc(
          "course",
          "keyboard",
          null,
          {
            name: "键盘",
            fixed: false,
            description: "",
            goals: "",
            roles: {},
            adminRole: "老师",
            memberRole: "学生",
          },
          "course/keyboard",
        ),
        revision: 1,
      },
    ],
  };
  async read() {
    if (this.denied)
      throw Object.assign(new Error("membership removed"), { code: "42501" });
    if (!this.online) throw new Error("network disconnected");
    return structuredClone(this.snapshot);
  }
  async write(d: AcademyDocument, expected: number) {
    if (!this.online) throw new Error("offline");
    this.writes++;
    const old = this.snapshot.documents.find((x) => x.id === d.id);
    if ((old?.revision ?? 0) !== expected)
      return { ok: false, row: structuredClone(old!) };
    const row = {
      ...structuredClone(d),
      revision: expected + 1,
      updated_at: new Date().toISOString(),
    };
    this.snapshot.documents = [
      ...this.snapshot.documents.filter((x) => x.id !== d.id),
      row,
    ];
    return { ok: true, row };
  }
  async upload(d: AcademyDocument) {
    return {
      ...d,
      payload: {
        ...d.payload,
        remotePath: `aid/${d.author_id}/${d.payload!.fileId}`,
      },
    };
  }
}
async function client(server: Server, id: string) {
  return new AcademyEngine(
    loadAcademy(id, await server.read()),
    server,
    () => {},
  );
}
describe("academy synchronization and legacy projection", () => {
  it("complete v2 restore preserves authors, validates before applying, and remaps audio without touching originals", async () => {
    const s = new Server(),
      e = await client(s, uid);
    const mine = makeDoc(
      "note",
      "keyboard",
      uid,
      { title: "restored", fileId: "original", remotePath: "old/path" },
      "restore-me",
    );
    const other = makeDoc(
      "note",
      "keyboard",
      friend,
      { title: "not mine" },
      "friend-backup",
    );
    const backup = {
      format: "wing-academy-backup",
      version: 2,
      academyId: "aid",
      documents: [mine, other],
      audio: { original: "data:audio/mpeg;base64,AQID" },
    };
    await audioStore("put", "original", new Blob([new Uint8Array([9])]));
    await e.importRaw(JSON.stringify(backup));
    expect(e.state.documents["friend-backup"]).toBeUndefined();
    const p = e.state.documents["restore-me"].payload!;
    expect(p.remotePath).toBeUndefined();
    expect(p.fileId).not.toBe("original");
    expect(
      new Uint8Array(
        await (await audioStore("get", String(p.fileId)))!.arrayBuffer(),
      ),
    ).toEqual(new Uint8Array([1, 2, 3]));
    expect((await audioStore("get", "original"))!.size).toBe(1);
    expect((await academyRecoveryList(uid, "aid")).length).toBeGreaterThan(0);
    const before = structuredClone(e.state.documents);
    backup.documents = [
      makeDoc("note", "keyboard", uid, { title: "should not apply" }, "safe"),
      { ...mine, id: "missing", payload: { fileId: "absent" } },
    ];
    await expect(e.importRaw(JSON.stringify(backup))).rejects.toThrow(
      "缺少音频",
    );
    expect(e.state.documents).toEqual(before);
    backup.documents = [
      makeDoc(
        "note",
        "keyboard",
        uid,
        { title: "collision" },
        "course/keyboard",
      ),
    ];
    await expect(e.importRaw(JSON.stringify(backup))).rejects.toThrow("归属");
    expect(e.state.documents).toEqual(before);
    const shared = {
      ...s.snapshot.documents[1],
      payload: { ...s.snapshot.documents[1].payload, goals: "backup goals" },
    };
    backup.documents = [shared];
    await e.importRaw(JSON.stringify(backup));
    expect(e.state.documents[shared.id].payload?.goals).toBe("");
    await e.importRaw(JSON.stringify(backup), true);
    expect(e.state.conflicts[shared.id].remote.payload?.goals).toBe("");
    expect(e.state.conflicts[shared.id].local.payload?.goals).toBe(
      "backup goals",
    );
  });
  it("progress counts completed active lessons once, excluding teacher preparation and unrelated notes", () => {
    const docs = [
      makeDoc("lesson", "keyboard", null, { title: "one" }, "l1"),
      makeDoc(
        "lesson",
        "keyboard",
        null,
        { title: "archived", archived: true },
        "l2",
      ),
      ...["a", "b"].map((id) =>
        makeDoc(
          "note",
          "keyboard",
          uid,
          { lessonId: "l1", status: "已完成", purpose: "learning" },
          id,
        ),
      ),
      makeDoc("note", "keyboard", uid, { lessonId: "l2", status: "已完成" }),
      makeDoc("note", "keyboard", friend, {
        lessonId: "l1",
        status: "已完成",
        purpose: "teaching",
      }),
    ];
    expect(completedLessons(docs, "keyboard", uid)).toHaveLength(1);
    expect(completedLessons(docs, "keyboard", friend)).toHaveLength(0);
  });
  it("two users and multiple courses never overwrite each other; a new account starts empty", async () => {
    const s = new Server(),
      a = await client(s, uid),
      b = await client(s, friend);
    a.edit(
      makeDoc("note", "keyboard", uid, { title: "owner", body: "notes" }, "a"),
    );
    await a.sync();
    await b.sync();
    expect(electronicData(b.state.documents, friend).sessions[0].notes).toBe(
      "",
    );
    b.edit(
      makeDoc(
        "note",
        "keyboard",
        friend,
        { title: "friend", body: "own" },
        "b",
      ),
    );
    await b.sync();
    await a.sync();
    expect(a.state.documents.a.payload?.body).toBe("notes");
    expect(a.state.documents.b.author_id).toBe(friend);
    expect(() =>
      b.edit({ ...a.state.documents.a, payload: { body: "overwrite" } }),
    ).toThrow("自己的");
    a.edit(
      makeDoc(
        "course",
        "fourth",
        null,
        { name: "Fourth", fixed: false },
        "course/fourth",
      ),
    );
    await a.sync();
    await b.sync();
    expect(b.state.documents["course/fourth"].payload?.name).toBe("Fourth");
  });
  it("shared lesson concurrent edits retain both versions, survive reload and merge", async () => {
    const s = new Server(),
      a = await client(s, uid);
    a.edit(
      makeDoc(
        "lesson",
        "keyboard",
        null,
        { title: "Lesson", content: "start" },
        "lesson",
      ),
    );
    await a.sync();
    const b = await client(s, friend);
    a.edit({
      ...a.state.documents.lesson,
      payload: { title: "Lesson", content: "A" },
    });
    b.edit({
      ...b.state.documents.lesson,
      payload: { title: "Lesson", content: "B" },
    });
    await a.sync();
    await b.sync();
    expect(b.status).toBe("存在冲突");
    expect(b.state.conflicts.lesson.local.payload?.content).toBe("B");
    expect(b.state.conflicts.lesson.remote.payload?.content).toBe("A");
    const reloaded = new AcademyEngine(
      loadAcademy(friend, await s.read()),
      s,
      () => {},
    );
    await reloaded.resolve("lesson", "local", {
      title: "Lesson",
      content: "A+B",
    });
    expect(
      s.snapshot.documents.find((d) => d.id === "lesson")!.payload?.content,
    ).toBe("A+B");
  });
  it("offline edits, in-flight typing, retry and removed-session denial preserve local work", async () => {
    const s = new Server(),
      e = await client(s, uid);
    s.online = false;
    e.edit(makeDoc("note", "keyboard", uid, { title: "offline" }, "offline"));
    await e.sync();
    expect(e.status).toBe("同步失败");
    expect(
      JSON.parse(memory.get(academyCacheKey(uid, "aid"))!).documents.offline
        .payload.title,
    ).toBe("offline");
    s.online = true;
    const reloaded = new AcademyEngine(
      loadAcademy(uid, await s.read()),
      s,
      () => {},
    );
    const write = s.write.bind(s);
    let once = true;
    s.write = async (d, n) => {
      const r = await write(d, n);
      if (once) {
        once = false;
        reloaded.edit({ ...d, payload: { title: "typed during request" } });
      }
      return r;
    };
    await reloaded.sync();
    expect(pendingDocuments(reloaded.state)).toHaveLength(1);
    expect(reloaded.state.documents.offline.revision).toBe(1);
    expect(reloaded.state.documents.offline.payload?.title).toBe(
      "typed during request",
    );
    await reloaded.sync();
    expect(reloaded.status).toBe("已同步");
    s.denied = true;
    await reloaded.sync();
    expect(reloaded.denied).toBe(true);
    expect(reloaded.state.documents.offline.payload?.title).toBe(
      "typed during request",
    );
    expect(() => reloaded.edit(makeDoc("note", "keyboard", uid, {}))).toThrow(
      "权限",
    );
  });
  it("legacy electronic adapter changes only own progress and preserves fixed definitions", async () => {
    const s = new Server(),
      a = await client(s, uid),
      adapter = new ElectronicAdapter(a);
    adapter.edit((d) => ({
      ...d,
      sessions: d.sessions.map((x, i) =>
        i ? x : { ...x, notes: "legacy UI edit" },
      ),
    }));
    expect(
      Object.keys(a.state.documents).filter((k) => k.startsWith("week/")),
    ).toEqual([`week/electronic/${uid}/W01`]);
    await a.sync();
    const b = await client(s, friend);
    expect(electronicData(b.state.documents, uid).sessions[0].notes).toBe(
      "legacy UI edit",
    );
    expect(electronicData(b.state.documents, friend).sessions[0].notes).toBe(
      "",
    );
    expect(() =>
      adapter.edit((d) => ({
        ...d,
        sessions: d.sessions.map((x, i) =>
          i ? x : { ...x, topic: "forbidden" },
        ),
      })),
    ).toThrow("固定");
  });
  it("legacy import is snapshot-first, compares differences and does not erase newer cloud notes", async () => {
    const s = new Server(),
      e = await client(s, uid),
      d = createInitialData();
    d.sessions[0].notes = "cloud";
    await e.importElectronic(d);
    await e.sync();
    d.sessions[0].notes = "old backup";
    await e.importElectronic(d);
    expect(
      e.state.conflicts[`week/electronic/${uid}/W01`].remote.payload?.notes,
    ).toBe("cloud");
    expect(e.state.documents[`week/electronic/${uid}/W01`].payload?.notes).toBe(
      "old backup",
    );
  });
  it("lost response retries adopt the acknowledged cloud revision without creating duplicates", async () => {
    const s = new Server(),
      e = await client(s, uid),
      write = s.write.bind(s);
    let lose = true;
    e.edit(
      makeDoc("note", "keyboard", uid, { title: "delivered" }, "delivered"),
    );
    s.write = async (...args) => {
      const r = await write(...args);
      if (lose) {
        lose = false;
        throw new Error("response lost");
      }
      return r;
    };
    await e.sync();
    await e.sync();
    expect(e.status).toBe("已同步");
    expect(
      s.snapshot.documents.filter((d) => d.id === "delivered"),
    ).toHaveLength(1);
  });
  it("remote audio removal intersecting local review edits preserves audio association as conflict", () => {
    const s = new Server(),
      data = createInitialData();
    data.artifacts = [
      {
        id: "a",
        projectId: "P00",
        kind: "音频版本",
        title: "demo",
        version: "v1",
        url: "",
        note: "",
        final: false,
        createdAt: "2026-10-25",
      },
    ];
    data.critiques = [
      {
        id: "c",
        projectId: "P00",
        versionId: "a",
        date: "2026-10-25",
        type: "Final Crit",
        statement: "",
        listening: "",
        strengths: "",
        issues: "01:24",
        revisions: "",
        next: "",
        completed: false,
        updatedAt: "2026-10-25",
      },
    ];
    s.snapshot.documents.push(
      ...electronicPersonal(data, uid).map((d) => ({ ...d, revision: 1 })),
    );
    const cache = freshAcademy(uid, s.snapshot),
      cid = `critique/electronic/${uid}/c`,
      aid = `artifact/electronic/${uid}/a`;
    cache.documents[cid].payload!.issues = "important feedback";
    const remote = structuredClone(s.snapshot);
    remote.documents = remote.documents.map((d) =>
      d.id === aid
        ? { ...d, payload: null, revision: 2 }
        : d.id === cid
          ? { ...d, payload: { ...d.payload, versionId: "" }, revision: 2 }
          : d,
    );
    const merged = mergeAcademy(cache, remote);
    expect(merged.conflicts[aid]).toBeTruthy();
    expect(merged.documents[aid].payload).toBeTruthy();
    expect(merged.conflicts[cid]).toBeTruthy();
  });
  it("teaching roles are per-course display roles, not admin grants; members can edit only shared goals/description", async () => {
    const s = new Server(),
      b = await client(s, friend),
      c = b.state.documents["course/keyboard"];
    b.edit({ ...c, payload: { ...c.payload, goals: "shared goal" } });
    expect(() =>
      b.edit({ ...c, payload: { ...c.payload, memberRole: "老师" } }),
    ).toThrow("管理员");
    expect(() =>
      b.edit(
        makeDoc(
          "course",
          "other",
          null,
          { name: "No permission" },
          "course/other",
        ),
      ),
    ).toThrow("管理员");
  });
  it("fixed course split retains original dates, stages, timecodes and never emits public-field patches", () => {
    const d = createInitialData();
    d.sessions[0].notes = "kept";
    d.projects[4].stages = [true, false, false, false, true];
    const rows = Object.fromEntries(
      electronicPersonal(d, uid).map((d) => [d.id, d]),
    );
    const projected = electronicData(rows, uid);
    expect(projected.sessions[0].date).toBe("2026-10-25");
    expect(projected.projects[4].stages).toEqual([
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(
      patchElectronic(
        projected,
        {
          ...projected,
          sessions: projected.sessions.map((s, i) =>
            i ? s : { ...s, progress: "changed" },
          ),
        },
        uid,
      ),
    ).toHaveLength(1);
  });
});
