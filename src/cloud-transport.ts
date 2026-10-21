import { supabase } from "./supabase";
import { uploadAudio } from "./cloud-audio";
import type { Transport } from "./sync-engine";
import type { CloudRow } from "./sync-model";

export function cloudTransport(uid: string): Transport {
  const client = supabase!;
  return {
    async read() {
      const { data, error } = await client.rpc("studio_snapshot");
      if (error) throw new Error(`云端读取失败：${error.message}`);
      if (!Array.isArray(data)) throw new Error("云端响应无效，已保留本地记录");
      return data as CloudRow[];
    },
    async write(kind, id, payload, expected) {
      const { data, error } = await client.rpc("studio_write", {
        p_kind: kind,
        p_id: id,
        p_payload: payload,
        p_expected: expected,
      });
      if (error) throw new Error(`云端保存失败：${error.message}`);
      if (!data?.row || typeof data.ok !== "boolean")
        throw new Error("云端保存结果无效");
      return data as { ok: boolean; row: CloudRow };
    },
    upload: (a) => uploadAudio(uid, a),
  };
}
