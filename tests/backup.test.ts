import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import {
  audioStore,
  createBackup,
  readBackup,
  repository,
} from "../src/storage";
import { createInitialData } from "../src/data";
const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memory.get(k) || null,
  setItem: (k: string, v: string) => memory.set(k, v),
});
class FileReaderPolyfill {
  result = "";
  onload?: () => void;
  onerror?: () => void;
  async readAsDataURL(blob: Blob) {
    try {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
      this.onload?.();
    } catch {
      this.onerror?.();
    }
  }
}
vi.stubGlobal("FileReader", FileReaderPolyfill);
beforeEach(() => memory.clear());
describe("完整音频备份与恢复", () => {
  it("跨存储恢复文字、状态、评图关联和音频原始字节", async () => {
    const d = createInitialData();
    d.sessions[0].notes = "真实的测试笔记";
    d.sessions[0].status = "待评图";
    d.sessions[0].event = "Concept Crit";
    const fileId = crypto.randomUUID();
    const bytes = new Uint8Array([82, 73, 70, 70, 0, 1, 2, 3, 255]);
    await audioStore("put", fileId, new Blob([bytes], { type: "audio/wav" }));
    d.artifacts.push({
      id: "a1",
      projectId: "P00",
      kind: "音频版本",
      title: "测试音频",
      version: "v01",
      url: "",
      note: "修改记录",
      fileId,
      fileName: "test.wav",
      mime: "audio/wav",
      final: false,
      createdAt: "2026-10-25T12:00:00Z",
    });
    d.critiques.push({
      id: "c1",
      projectId: "P00",
      versionId: "a1",
      date: "2026-10-25",
      type: "Final Crit",
      statement: "陈述",
      listening: "",
      strengths: "",
      issues: "00:01 修改位置",
      revisions: "",
      next: "",
      completed: true,
      updatedAt: "2026-10-25T12:00:00Z",
    });
    const backup = await createBackup(d);
    await audioStore("delete", fileId);
    const restored = await readBackup(JSON.stringify(backup));
    expect(restored.sessions[0].notes).toBe("真实的测试笔记");
    expect(restored.sessions[0].status).toBe("待评图");
    expect(restored.sessions[0].event).toBe("Concept Crit");
    expect(restored.critiques[0]).toEqual(d.critiques[0]);
    expect(restored.projects).toEqual(d.projects);
    expect(restored.critiques[0].versionId).toBe("a1");
    expect(restored.artifacts[0].fileId).not.toBe(fileId);
    const blob = await audioStore("get", restored.artifacts[0].fileId!);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(bytes);
    expect(repository.load()).toEqual(restored);
  });
  it("缺失音频时拒绝生成看似完整的备份", async () => {
    const d = createInitialData();
    d.artifacts.push({
      id: "a1",
      projectId: "P00",
      kind: "音频版本",
      title: "lost",
      version: "",
      url: "",
      note: "",
      fileId: "not-present",
      fileName: "lost.wav",
      final: false,
      createdAt: "2026-10-25T12:00:00Z",
    });
    await expect(createBackup(d)).rejects.toThrow("缺失");
  });
  it("无效导入不覆盖当前记录", async () => {
    const d = createInitialData();
    d.sessions[0].notes = "保留此记录";
    repository.save(d);
    await expect(readBackup('{"format":"invalid"}')).rejects.toThrow();
    expect(repository.load().sessions[0].notes).toBe("保留此记录");
  });
  it("损坏的音频备份不覆盖已有数据", async () => {
    const d = createInitialData();
    repository.save(d);
    const b = await createBackup(d);
    b.data.artifacts.push({
      id: "a1",
      projectId: "P00",
      kind: "音频版本",
      title: "bad",
      version: "",
      url: "",
      note: "",
      fileId: "x",
      final: false,
      createdAt: "2026-10-25T12:00:00Z",
    });
    await expect(readBackup(JSON.stringify(b))).rejects.toThrow("不完整");
    expect(repository.load().artifacts).toEqual([]);
  });
});
