import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialData } from "../src/data";
import {
  SyncEngine,
  loadSync,
  recoveries,
  recoverBrokenCache,
} from "../src/sync-engine";
import type { Transport } from "../src/sync-engine";
import {
  compose,
  dirtyKeys,
  entities,
  freshState,
  keyOf,
} from "../src/sync-model";
import type { CloudRow, Payload } from "../src/sync-model";
import type { Artifact } from "../src/types";
import { checkAudio, AUDIO_LIMIT } from "../src/cloud-audio";

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v),
});
beforeEach(() => memory.clear());
class Server implements Transport {
  rows: Record<string, CloudRow> = {};
  offline = false;
  writes = 0;
  async read() {
    if (this.offline) throw new Error("offline");
    return structuredClone(Object.values(this.rows));
  }
  async write(
    kind: CloudRow["kind"],
    id: string,
    payload: Payload | null,
    expected: number,
  ) {
    if (this.offline) throw new Error("offline");
    this.writes++;
    const k = keyOf({ kind, id }),
      previous = this.rows[k];
    if ((previous?.revision ?? 0) !== expected)
      return { ok: false, row: structuredClone(previous) };
    const row = {
      kind,
      id,
      payload: structuredClone(payload),
      revision: expected + 1,
      updated_at: new Date().toISOString(),
    };
    this.rows[k] = row;
    return { ok: true, row: structuredClone(row) };
  }
  async upload(a: Artifact) {
    return {
      ...a,
      remotePath: `owner/${a.fileId}`,
      fileHash: "hash",
      fileSize: 10,
    };
  }
}
function engine(id: string, server: Transport) {
  return new SyncEngine(
    id,
    loadSync(id, createInitialData()),
    server,
    () => {},
  );
}
async function initialized(id: string, server: Transport) {
  const e = engine(id, server);
  await e.sync();
  await e.initialize(e.preview?.length ? "cloud" : "local");
  return e;
}
describe("durable per-record cloud synchronization", () => {
  it("first upload requires confirmation, keeps 16 weeks / 5 projects, and snapshots original data", async () => {
    const server = new Server(),
      e = engine("migration", server);
    e.edit((d) => ({
      ...d,
      sessions: d.sessions.map((s, i) =>
        i ? s : { ...s, notes: "existing local note" },
      ),
    }));
    await e.sync();
    expect(server.writes).toBe(0);
    expect(e.state.initialized).toBe(false);
    await e.initialize("local");
    expect(Object.keys(server.rows)).toHaveLength(22);
    expect(e.state.verifiedAt).toBeTruthy();
    expect(e.state.data.sessions).toHaveLength(16);
    expect((await recoveries(e.uid))[0].state.data.sessions[0].notes).toBe(
      "existing local note",
    );
  });
  it("two devices exchange progress, notes, projects and five final stages without whole-document writes", async () => {
    const server = new Server(),
      company = await initialized("company", server),
      home = await initialized("home", server);
    const before = server.writes;
    company.edit((d) => ({
      ...d,
      sessions: d.sessions.map((s, i) =>
        i ? s : { ...s, status: "已完成", notes: "company" },
      ),
    }));
    await company.sync();
    expect(server.writes - before).toBe(1);
    await home.sync();
    expect(home.state.data.sessions[0].status).toBe("已完成");
    home.edit((d) => ({
      ...d,
      projects: d.projects.map((p) =>
        p.id === "P04"
          ? {
              ...p,
              idea: "home idea",
              stages: [true, true, false, false, false],
            }
          : p,
      ),
    }));
    await home.sync();
    await company.sync();
    expect(company.state.data.projects[4].stages).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
  it("offline edits survive reload and reconnect without clearing local data", async () => {
    const server = new Server(),
      e = await initialized("offline", server);
    server.offline = true;
    e.edit((d) => ({
      ...d,
      projects: d.projects.map((p, i) =>
        i ? p : { ...p, log: "offline work" },
      ),
    }));
    await e.sync();
    expect(e.status).toContain("失败");
    const reloaded = engine("offline", server);
    expect(reloaded.state.data.projects[0].log).toBe("offline work");
    expect(dirtyKeys(reloaded.state)).toEqual(["project:P00"]);
    server.offline = false;
    await reloaded.sync();
    expect(reloaded.status).toBe("已同步");
    expect(server.rows["project:P00"].payload?.log).toBe("offline work");
  });
  it("same-record edits do not silently overwrite; both survive and resolution is backed up", async () => {
    const server = new Server(),
      a = await initialized("conflict-a", server),
      b = await initialized("conflict-b", server);
    a.edit((d) => ({
      ...d,
      sessions: d.sessions.map((s, i) => (i ? s : { ...s, notes: "A" })),
    }));
    b.edit((d) => ({
      ...d,
      sessions: d.sessions.map((s, i) => (i ? s : { ...s, notes: "B" })),
    }));
    await a.sync();
    await b.sync();
    expect(b.state.conflicts["session:W01"].remote.payload?.notes).toBe("A");
    expect(b.state.data.sessions[0].notes).toBe("B");
    expect(server.rows["session:W01"].payload?.notes).toBe("A");
    await b.resolve("session:W01", "local", {
      ...entities(b.state.data)["session:W01"],
      notes: "A + B",
    });
    expect(server.rows["session:W01"].payload?.notes).toBe("A + B");
    expect(
      (await recoveries(b.uid))[0].state.conflicts["session:W01"].remote.payload
        ?.notes,
    ).toBe("A");
  });
  it("CAS catches a concurrent write after the initial pull", async () => {
    const server = new Server(),
      e = await initialized("cas", server);
    e.edit((d) => ({ ...d, semester: { ...d.semester, title: "local" } }));
    const write = server.write.bind(server);
    let raced = false;
    server.write = async (kind, id, payload, revision) => {
      if (!raced) {
        raced = true;
        await write(kind, id, { ...payload, title: "raced remote" }, revision);
      }
      return write(kind, id, payload, revision);
    };
    await e.sync();
    expect(e.state.conflicts["semester:main"].remote.payload?.title).toBe(
      "raced remote",
    );
    expect(e.state.data.semester.title).toBe("local");
  });
  it("typing during an in-flight write remains queued and persists through reload", async () => {
    const server = new Server(),
      e = await initialized("typing", server),
      write = server.write.bind(server);
    e.edit((d) => ({ ...d, semester: { ...d.semester, title: "first" } }));
    let typed = false;
    server.write = async (...args) => {
      const result = await write(...args);
      if (!typed) {
        typed = true;
        e.edit((d) => ({ ...d, semester: { ...d.semester, title: "second" } }));
      }
      return result;
    };
    await e.sync();
    expect(e.state.data.semester.title).toBe("second");
    expect(dirtyKeys(e.state)).toEqual(["semester:main"]);
    const restored = engine("typing", server);
    await restored.sync();
    expect(server.rows["semester:main"].payload?.title).toBe("second");
  });
  it("migration with both sides populated preserves new IDs and requires conflict decisions", async () => {
    const server = new Server();
    await initialized("seed", server);
    const remote = server.rows["session:W01"];
    remote.payload!.notes = "cloud note";
    remote.revision++;
    const e = engine("merge", server);
    e.edit((d) => ({
      ...d,
      sessions: d.sessions.map((s, i) =>
        i ? s : { ...s, notes: "legacy note" },
      ),
    }));
    await e.sync();
    await e.initialize("merge");
    expect(e.state.data.sessions[0].notes).toBe("legacy note");
    expect(e.state.conflicts["session:W01"].remote.payload?.notes).toBe(
      "cloud note",
    );
    expect(e.state.data.sessions).toHaveLength(16);
    expect(e.state.data.projects).toHaveLength(5);
  });
  it("remote tombstones prevent deleted archives resurrecting on stale devices", async () => {
    const server = new Server(),
      a = await initialized("delete-a", server);
    const item: Artifact = {
      id: "note-1",
      projectId: "P00",
      kind: "创作笔记",
      title: "note",
      version: "",
      url: "",
      note: "body",
      final: false,
      createdAt: new Date().toISOString(),
    };
    a.edit((d) => ({ ...d, artifacts: [item] }));
    await a.sync();
    const b = await initialized("delete-b", server);
    a.edit((d) => ({ ...d, artifacts: [] }));
    await a.sync();
    await b.sync();
    expect(b.state.data.artifacts).toHaveLength(0);
    expect(server.rows["artifact:note-1"].payload).toBeNull();
  });
  it("audio metadata reaches second device only after upload; upload failure does not block independent notes", async () => {
    const server = new Server(),
      e = await initialized("audio", server);
    const artifact: Artifact = {
      id: "demo",
      projectId: "P00",
      kind: "音频版本",
      title: "demo",
      version: "v1",
      url: "",
      note: "",
      fileId: "blob-1",
      fileName: "demo.mp3",
      final: false,
      createdAt: new Date().toISOString(),
    };
    e.edit((d) => ({
      ...d,
      artifacts: [artifact],
      semester: { ...d.semester, title: "new title" },
    }));
    server.upload = async () => {
      throw new Error("quota exhausted");
    };
    await e.sync();
    expect(server.rows["semester:main"].payload?.title).toBe("new title");
    expect(server.rows["artifact:demo"]).toBeUndefined();
    expect(e.state.data.artifacts[0].fileId).toBe("blob-1");
    server.upload = async (a) => ({
      ...a,
      remotePath: "owner/blob-1",
      fileSize: 10,
      fileHash: "hash",
    });
    await e.sync();
    const b = await initialized("audio-b", server);
    expect(b.state.data.artifacts[0].remotePath).toBe("owner/blob-1");
    expect(e.status).toBe("已同步");
  });
  it("failed and incomplete reads never reset data or mark integrity verified", async () => {
    const server = new Server(),
      e = await initialized("missing", server);
    const verified = e.state.verifiedAt;
    delete server.rows["project:P00"];
    await e.sync();
    expect(e.status).toBe("同步失败");
    expect(e.state.data.projects).toHaveLength(5);
    expect(e.state.verifiedAt).toBe(verified);
  });
  it("file size and format failures are explicit", () => {
    expect(() =>
      checkAudio({ size: AUDIO_LIMIT + 1 } as Blob, "large.wav"),
    ).toThrow("45 MB");
    expect(() => checkAudio(new Blob(["data"]), "song.als")).toThrow("音频");
    expect(() => checkAudio(new Blob(["data"]), "demo.m4a")).not.toThrow();
  });
  it("lost write response is retried without overwriting or creating duplicates", async () => {
    const server = new Server(),
      e = await initialized("lost-response", server),
      write = server.write.bind(server);
    e.edit((d) => ({ ...d, semester: { ...d.semester, title: "delivered" } }));
    let fail = true;
    server.write = async (...args) => {
      const result = await write(...args);
      if (fail) {
        fail = false;
        throw new Error("response lost");
      }
      return result;
    };
    await e.sync();
    expect(e.status).toBe("同步失败");
    await e.sync();
    expect(e.status).toBe("已同步");
    expect(e.state.conflicts).toEqual({});
    expect(server.rows["semester:main"].revision).toBe(2);
  });
  it("quota error preserves unsaved memory and blocks remote mutation until persistence works", async () => {
    const server = new Server(),
      e = await initialized("quota", server),
      writes = server.writes;
    const setter = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    expect(() =>
      e.edit((d) => ({
        ...d,
        semester: { ...d.semester, title: "keep in memory" },
      })),
    ).toThrow("本地缓存");
    await e.sync();
    expect(server.writes).toBe(writes);
    expect(e.state.data.semester.title).toBe("keep in memory");
    setter.mockRestore();
    await e.sync();
    expect(e.status).toBe("已同步");
    expect(server.rows["semester:main"].payload?.title).toBe("keep in memory");
  });
  it("offline flag produces explicit unsynced state", async () => {
    const server = new Server(),
      e = await initialized("offline-status", server);
    server.offline = true;
    Object.defineProperty(navigator, "onLine", {
      value: false,
      configurable: true,
    });
    try {
      await e.sync();
      expect(e.status).toBe("未同步（离线）");
    } finally {
      Reflect.deleteProperty(navigator, "onLine");
    }
  });
  it("broken-cache recovery snapshots raw input and returns to explicit cloud comparison", async () => {
    memory.set("wing-sound-sync:v1:broken", "not-json");
    memory.set("wing-sound-academy:v1", "original-legacy");
    expect(() => loadSync("broken", createInitialData())).toThrow();
    await recoverBrokenCache("broken", createInitialData());
    expect(loadSync("broken", createInitialData()).initialized).toBe(false);
    expect((await recoveries("broken"))[0].raw).toContain("not-json");
    expect(memory.get("wing-sound-academy:v1")).toBe("original-legacy");
  });
  it("remote audio deletion preserves a locally edited linked review and both recoverable conflicts", async () => {
    const server = new Server(),
      e = await initialized("linked-delete", server);
    const d = createInitialData();
    d.artifacts = [
      {
        id: "a-link",
        projectId: "P00",
        kind: "音频版本",
        title: "audio",
        url: "https://example.org/demo.mp3",
        version: "v1",
        note: "",
        final: false,
        createdAt: new Date().toISOString(),
      },
    ];
    d.critiques = [
      {
        id: "c-link",
        projectId: "P00",
        versionId: "a-link",
        date: "2026-10-25",
        type: "Final Crit",
        statement: "",
        listening: "",
        strengths: "",
        issues: "01:24 old",
        revisions: "",
        next: "",
        completed: false,
        updatedAt: new Date().toISOString(),
      },
    ];
    e.edit(d);
    await e.sync();
    e.edit((x) => ({
      ...x,
      critiques: x.critiques.map((c) => ({
        ...c,
        issues: "01:24 important local feedback",
      })),
    }));
    server.rows["artifact:a-link"] = {
      ...server.rows["artifact:a-link"],
      payload: null,
      revision: 2,
    };
    server.rows["critique:c-link"] = {
      ...server.rows["critique:c-link"],
      payload: { ...server.rows["critique:c-link"].payload!, versionId: "" },
      revision: 2,
    };
    await e.sync();
    expect(e.status).toBe("存在冲突");
    expect(e.state.data.critiques[0].issues).toContain("important local");
    expect(e.state.data.critiques[0].versionId).toBe("a-link");
    expect(Object.keys(e.state.conflicts).sort()).toEqual([
      "artifact:a-link",
      "critique:c-link",
    ]);
    await e.resolve("critique:c-link", "local", {
      ...entities(e.state.data)["critique:c-link"],
      versionId: "",
    });
    await e.resolve("artifact:a-link", "remote");
    expect(e.state.data.artifacts).toHaveLength(0);
    expect(e.state.data.critiques[0].issues).toContain("important local");
  });
  it("interrupted whole-backup restoration can resume even while cloud dates are partially updated", async () => {
    const server = new Server(),
      e = await initialized("partial-import", server),
      write = server.write.bind(server);
    const next = structuredClone(e.state.data);
    next.sessions = next.sessions.map((s) => ({
      ...s,
      date: new Date(Date.parse(s.date + "T12:00:00Z") + 7 * 86400000)
        .toISOString()
        .slice(0, 10),
    }));
    await e.restore(next);
    let writes = 0;
    server.write = async (...args) => {
      writes++;
      if (writes === 4) throw new Error("interrupted import");
      return write(...args);
    };
    await e.sync();
    expect(e.status).toBe("同步失败");
    expect(e.state.data.sessions[15].date).toBe(next.sessions[15].date);
    server.write = write;
    const reloaded = engine("partial-import", server);
    await reloaded.sync();
    expect(reloaded.status).toBe("已同步");
    expect(server.rows["session:W16"].payload?.date).toBe(
      next.sessions[15].date,
    );
  });
  it("composing cloud rows keeps fixed IDs and default course schedule", () => {
    const data = compose({});
    expect(data.sessions[0].date).toBe("2026-10-25");
    expect(data.sessions[15].date).toBe("2027-02-07");
    expect(data.projects.map((p) => p.id)).toEqual([
      "P00",
      "P01",
      "P02",
      "P03",
      "P04",
    ]);
    expect(freshState(data).initialized).toBe(false);
  });
  it("legacy custom record IDs containing a colon keep their full identity", async () => {
    const server = new Server(),
      e = await initialized("custom-id", server);
    e.edit((d) => ({
      ...d,
      artifacts: [
        {
          id: "legacy:note",
          projectId: "P00",
          kind: "创作笔记",
          title: "custom",
          version: "",
          note: "keep",
          url: "",
          final: false,
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    await e.sync();
    expect(e.status).toBe("已同步");
    expect(server.rows["artifact:legacy:note"].id).toBe("legacy:note");
    const other = await initialized("custom-id-other", server);
    expect(other.state.data.artifacts[0].id).toBe("legacy:note");
  });
});
