import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect, vi } from "vitest";
import { Buffer } from "node:buffer";
const storage = vi.hoisted(() => ({
  files: new Map<string, Blob>(),
  allowed: true,
  failUpload: false,
}));
vi.mock("../src/supabase", () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string, blob: Blob) => {
          if (!storage.allowed || storage.failUpload)
            return { error: { message: "denied or quota exceeded" } };
          if (storage.files.has(path))
            return { error: { message: "already exists" } };
          storage.files.set(path, blob);
          return { error: null };
        },
        download: async (path: string) =>
          storage.allowed && storage.files.has(path)
            ? { data: storage.files.get(path), error: null }
            : { data: null, error: { message: "permission denied" } },
      }),
    },
  },
}));
import { uploadAudio, getAudio } from "../src/cloud-audio";
import {
  audioStore,
  createBackup,
  readBackup,
  setBackupAudioResolver,
} from "../src/storage";
import { createInitialData } from "../src/data";
import type { Artifact } from "../src/types";
class Reader {
  result = "";
  onload?: () => void;
  async readAsDataURL(blob: Blob) {
    this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    this.onload?.();
  }
}
vi.stubGlobal("FileReader", Reader);
beforeEach(() => {
  storage.files.clear();
  storage.allowed = true;
  storage.failUpload = false;
  setBackupAudioResolver(undefined);
});
async function local() {
  const a: Artifact = {
    id: crypto.randomUUID(),
    projectId: "P00",
    kind: "音频版本",
    title: "demo",
    version: "v1",
    url: "",
    note: "01:24 feedback",
    fileId: crypto.randomUUID(),
    fileName: "demo.m4a",
    mime: "audio/mp4",
    final: false,
    createdAt: new Date().toISOString(),
  };
  const bytes = new Uint8Array([0, 1, 2, 3, 254, 255]);
  await audioStore("put", a.fileId!, new Blob([bytes], { type: "audio/mp4" }));
  return { a, bytes };
}
describe("private audio, retries and portable complete backups", () => {
  it("verified private upload can be downloaded with identical bytes by a second device", async () => {
    const { a, bytes } = await local();
    const uploaded = await uploadAudio("owner", a);
    expect(uploaded.remotePath).toBe(`owner/${a.fileId}`);
    expect(uploaded.fileHash).toHaveLength(64);
    await audioStore("delete", a.fileId!);
    const downloaded = await getAudio(uploaded);
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
  });
  it("failed upload preserves local blob and retry verifies an existing immutable object", async () => {
    const { a } = await local();
    storage.failUpload = true;
    await expect(uploadAudio("owner", a)).rejects.toThrow("上传失败");
    expect(await audioStore("get", a.fileId!)).toBeTruthy();
    storage.failUpload = false;
    const one = await uploadAudio("owner", a),
      two = await uploadAudio("owner", a);
    expect(two).toEqual(one);
    expect(storage.files.size).toBe(1);
  });
  it("unauthorized download and wrong content are rejected without changing metadata", async () => {
    const { a } = await local();
    const uploaded = await uploadAudio("owner", a);
    await audioStore("delete", a.fileId!);
    storage.allowed = false;
    await expect(getAudio(uploaded)).rejects.toThrow("permission denied");
    storage.allowed = true;
    storage.files.set(uploaded.remotePath!, new Blob(["wrong"]));
    await expect(getAudio(uploaded)).rejects.toThrow("完整性");
    expect(await audioStore("get", a.fileId!)).toBeUndefined();
  });
  it("cloud-only files hydrate into the old complete backup format, import detaches old paths", async () => {
    const { a, bytes } = await local(),
      d = createInitialData();
    d.artifacts.push(await uploadAudio("owner", a));
    await audioStore("delete", a.fileId!);
    setBackupAudioResolver(getAudio);
    const backup = await createBackup(d);
    expect(backup.version).toBe(1);
    expect(backup.audio[a.fileId!]).toContain("base64");
    const restored = await readBackup(JSON.stringify(backup), false);
    expect(restored.artifacts[0].remotePath).toBeUndefined();
    expect(restored.artifacts[0].fileId).not.toBe(a.fileId);
    const blob = await getAudio(restored.artifacts[0]);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});
