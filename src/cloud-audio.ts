import type { Artifact } from "./types";
import { audioStore } from "./storage";
import { supabase } from "./supabase";

export const AUDIO_LIMIT = 45 * 1024 * 1024;
export const BUCKET = "studio-audio";
export function checkAudio(file: Blob, name: string) {
  if (file.size > AUDIO_LIMIT)
    throw new Error(
      "单文件上限45 MB。请导出 MP3 / M4A 试听版本；原始工程和无损大文件请另行保管。",
    );
  if (!file.size) throw new Error("音频文件为空");
  if (!/\.(mp3|m4a|aac|wav|ogg|flac|aiff?|webm)$/i.test(name))
    throw new Error(
      "请选择 MP3、M4A、AAC、WAV、OGG、FLAC、AIFF 或 WebM 音频文件",
    );
}
export async function digest(blob: Blob) {
  const hash = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function getAudio(a: Artifact): Promise<Blob> {
  if (!a.fileId) throw new Error("未关联音频");
  const local = await audioStore("get", a.fileId);
  if (local) return local;
  if (!a.remotePath || !supabase)
    throw new Error("本机缺少此音频。请联网登录同步账户，或从完整备份恢复。");
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(a.remotePath);
  if (error)
    throw new Error(`私有音频读取失败：${error.message}。可恢复网络后重试。`);
  if (a.fileHash && (await digest(data)) !== a.fileHash)
    throw new Error("音频完整性检查未通过，请重试");
  await audioStore("put", a.fileId, data);
  return data;
}
export async function uploadAudio(uid: string, a: Artifact): Promise<Artifact> {
  if (!supabase || !a.fileId) throw new Error("云存储未就绪");
  const blob = await audioStore("get", a.fileId);
  if (!blob)
    throw new Error(
      `「${a.fileName}」本地文件缺失，请恢复完整备份或重新选择音频`,
    );
  checkAudio(blob, a.fileName || "audio.mp3");
  const path = `${uid}/${a.fileId}`,
    hash = await digest(blob);
  // Immutable paths make retries safe after a lost HTTP response; never upsert.
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: blob.type || "application/octet-stream",
      upsert: false,
    });
  if (error && !/already exists|duplicate/i.test(error.message))
    throw new Error(
      `音频上传失败：${error.message}。本地文件已保留，可重试；请检查存储配额。`,
    );
  const verification = await supabase.storage.from(BUCKET).download(path);
  if (
    verification.error ||
    !verification.data ||
    verification.data.size !== blob.size ||
    (await digest(verification.data)) !== hash
  )
    throw new Error("云端音频校验失败，本地文件已保留");
  return { ...a, remotePath: path, fileHash: hash, fileSize: blob.size };
}
