import { supabase } from "./supabase";
import { uploadAudio } from "./cloud-audio";
import type { Artifact } from "./types";
import type { AcademyDocument, AcademySnapshot } from "./academy-model";
export interface AcademyTransport {
  read(): Promise<AcademySnapshot>;
  write(
    d: AcademyDocument,
    expected: number,
  ): Promise<{ ok: boolean; row: AcademyDocument }>;
  upload(d: AcademyDocument): Promise<AcademyDocument>;
}
export async function academyRPC<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase!.rpc(name, args);
  if (error) {
    const e = new Error(error.message) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
  return data as T;
}
export function academyTransport(
  academyId: string,
  uid: string,
): AcademyTransport {
  return {
    read: () =>
      academyRPC<AcademySnapshot>("academy_snapshot", { p_academy: academyId }),
    write: (d, expected) =>
      academyRPC("academy_write", {
        p_academy: academyId,
        p_id: d.id,
        p_course: d.course_id,
        p_kind: d.kind,
        p_author: d.author_id,
        p_payload: d.payload,
        p_expected: expected,
      }),
    async upload(d) {
      const p = d.payload!;
      const prefix = `${academyId}/${uid}`;
      await academyRPC("academy_register_file", {
        p_academy: academyId,
        p_course: d.course_id,
        p_file: p.fileId,
      });
      const a = await uploadAudio(prefix, p as unknown as Artifact);
      return {
        ...d,
        payload: {
          ...p,
          remotePath: a.remotePath,
          fileHash: a.fileHash,
          fileSize: a.fileSize,
        },
      };
    },
  };
}
