import type {
  AcademyData,
  Artifact,
  Critique,
  Session,
  Project,
} from "./types";
import { createInitialData } from "./data";
import { equal } from "./sync-model";

export type CourseRole = "老师" | "学生" | "共同学习者";
export type DocKind =
  | "course"
  | "lesson"
  | "project"
  | "week"
  | "process"
  | "artifact"
  | "critique"
  | "note"
  | "feedback";
export type Value = Record<string, unknown>;
export interface AcademyDocument {
  id: string;
  course_id: string;
  kind: DocKind;
  author_id: string | null;
  payload: Value | null;
  revision: number;
  updated_at: string;
}
export interface AcademyMember {
  user_id: string;
  display_name: string;
  role: "admin" | "member";
  active: boolean;
}
export interface Invitation {
  id: string;
  email: string;
  status: "sending" | "pending" | "failed" | "accepted" | "revoked";
  expires_at: string;
  sent_at: string | null;
  error: string | null;
}
export interface AcademySnapshot {
  academy: { id: string; name: string };
  members: AcademyMember[];
  documents: AcademyDocument[];
  invitations: Invitation[];
}
export interface Course {
  name: string;
  description: string;
  goals: string;
  fixed: boolean;
  archived: boolean;
  order: number;
  adminRole: CourseRole;
  memberRole: CourseRole;
  roles: Record<string, CourseRole>;
  semester?: AcademyData["semester"];
}
export interface Lesson {
  title: string;
  content: string;
  task: string;
  references: string;
  date: string;
  order: number;
  archived: boolean;
}
export interface LearningNote {
  title: string;
  body: string;
  practice: string;
  status: string;
  lessonId: string;
  projectId: string;
  purpose: "learning" | "teaching";
  fileId?: string;
  fileName?: string;
  mime?: string;
  remotePath?: string;
  fileHash?: string;
  fileSize?: number;
}
export interface AcademyCache {
  version: 2;
  uid: string;
  academyId: string;
  snapshot: AcademySnapshot;
  base: Record<string, AcademyDocument>;
  documents: Record<string, AcademyDocument>;
  conflicts: Record<
    string,
    { local: AcademyDocument; remote: AcademyDocument }
  >;
  verifiedAt?: string;
  legacyImported?: boolean;
}
export const asCourse = (d: AcademyDocument) => d.payload as unknown as Course;
export const roleFor = (course: Course, member: AcademyMember) =>
  course.roles?.[member.user_id] ||
  (member.role === "admin" ? course.adminRole : course.memberRole);
export function completedLessons(
  docs: AcademyDocument[],
  courseId: string,
  uid: string,
) {
  return docs.filter(
    (l) =>
      l.course_id === courseId &&
      l.kind === "lesson" &&
      l.payload &&
      !l.payload.archived &&
      docs.some(
        (r) =>
          r.course_id === courseId &&
          r.author_id === uid &&
          r.payload?.status === "已完成" &&
          ((r.kind === "note" &&
            r.payload.purpose !== "teaching" &&
            r.payload.lessonId === l.id) ||
            (r.kind === "week" &&
              r.id === `week/electronic/${uid}/${String(l.payload!.id)}`)),
      ),
  );
}
export const learningFields = ["notes", "progress", "status", "references"];
export const processFields = ["status", "idea", "log", "summary", "stages"];
export function omit(value: object, keys: string[]): Value {
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => !keys.includes(k)),
  );
}
export function pick(value: object, keys: string[]): Value {
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => keys.includes(k)),
  );
}
export function makeDoc(
  kind: DocKind,
  courseId: string,
  author: string | null,
  payload: object,
  id: string = crypto.randomUUID(),
): AcademyDocument {
  return {
    id,
    kind,
    course_id: courseId,
    author_id: author,
    payload: payload as Value,
    revision: 0,
    updated_at: "",
  };
}
export function electronicData(
  documents: Record<string, AcademyDocument>,
  uid: string,
): AcademyData {
  const d = createInitialData();
  const course = documents["course/electronic"];
  if (course?.payload?.semester)
    d.semester = structuredClone(
      course.payload.semester,
    ) as AcademyData["semester"];
  d.sessions = d.sessions.map(
    (s) =>
      ({
        ...s,
        ...documents[`lesson/electronic/${s.id}`]?.payload,
        ...documents[`week/electronic/${uid}/${s.id}`]?.payload,
      }) as Session,
  );
  d.projects = d.projects.map(
    (p) =>
      ({
        ...p,
        ...documents[`project/electronic/${p.id}`]?.payload,
        ...documents[`process/electronic/${uid}/${p.id}`]?.payload,
      }) as Project,
  );
  d.artifacts = Object.values(documents)
    .filter(
      (x) =>
        x.kind === "artifact" &&
        x.course_id === "electronic" &&
        x.author_id === uid &&
        x.payload,
    )
    .map((x) => structuredClone(x.payload) as unknown as Artifact);
  d.critiques = Object.values(documents)
    .filter(
      (x) =>
        x.kind === "critique" &&
        x.course_id === "electronic" &&
        x.author_id === uid &&
        x.payload,
    )
    .map((x) => structuredClone(x.payload) as unknown as Critique);
  return d;
}
export function electronicPersonal(
  data: AcademyData,
  uid: string,
): AcademyDocument[] {
  return [
    ...data.sessions.map((s) =>
      makeDoc(
        "week",
        "electronic",
        uid,
        pick(s, learningFields),
        `week/electronic/${uid}/${s.id}`,
      ),
    ),
    ...data.projects.map((p) =>
      makeDoc(
        "process",
        "electronic",
        uid,
        pick(p, processFields),
        `process/electronic/${uid}/${p.id}`,
      ),
    ),
    ...data.artifacts.map((a) =>
      makeDoc(
        "artifact",
        "electronic",
        uid,
        a,
        `artifact/electronic/${uid}/${a.id}`,
      ),
    ),
    ...data.critiques.map((c) =>
      makeDoc(
        "critique",
        "electronic",
        uid,
        c,
        `critique/electronic/${uid}/${c.id}`,
      ),
    ),
  ];
}
export function patchElectronic(
  before: AcademyData,
  after: AcademyData,
  uid: string,
): AcademyDocument[] {
  if (
    !equal(before.semester, after.semester) ||
    before.sessions.some(
      (s, i) =>
        !equal(
          omit(s, learningFields),
          omit(after.sessions[i] || {}, learningFields),
        ),
    ) ||
    before.projects.some(
      (p, i) =>
        !equal(
          omit(p, processFields),
          omit(after.projects[i] || {}, processFields),
        ),
    )
  )
    throw new Error("电子音乐课程大纲与任务书固定，只能修改自己的学习记录。");
  const old = Object.fromEntries(
    electronicPersonal(before, uid).map((d) => [d.id, d]),
  );
  const next = Object.fromEntries(
    electronicPersonal(after, uid).map((d) => [d.id, d]),
  );
  return [...new Set([...Object.keys(old), ...Object.keys(next)])]
    .filter((id) => !equal(old[id]?.payload ?? null, next[id]?.payload ?? null))
    .map((id) => next[id] || { ...old[id], payload: null });
}
export function mergeAcademy(
  cache: AcademyCache,
  remote: AcademySnapshot,
): AcademyCache {
  const n = structuredClone(cache);
  n.snapshot = remote;
  const remoteIds = new Set(remote.documents.map((d) => d.id));
  if (Object.keys(n.base).some((id) => !remoteIds.has(id)))
    throw new Error("服务器记录异常缺失，已暂停同步并保留本机内容");
  for (const row of remote.documents) {
    const base = n.base[row.id],
      local = n.documents[row.id];
    if (base && row.revision < base.revision)
      throw new Error("服务器版本倒退，已暂停同步");
    if (base?.revision === row.revision) continue;
    if (
      local &&
      (!equal(local.payload, base?.payload ?? null) || n.conflicts[row.id]) &&
      !equal(local.payload, row.payload)
    )
      n.conflicts[row.id] = { local, remote: row };
    else {
      n.documents[row.id] = row;
      delete n.conflicts[row.id];
    }
    n.base[row.id] = row;
  }
  for (const review of Object.values(n.documents)) {
    if (review.kind !== "critique" || !review.payload?.versionId) continue;
    const aid = `artifact/${review.course_id}/${review.author_id}/${review.payload.versionId}`;
    const a = n.documents[aid];
    if (
      a?.payload?.kind === "音频版本" &&
      a.payload.projectId === review.payload.projectId
    )
      continue;
    const old = cache.documents[aid];
    if (old?.payload && n.base[aid]) {
      n.documents[aid] = old;
      n.conflicts[aid] = { local: old, remote: n.base[aid] };
    }
  }
  return n;
}
export const pendingDocuments = (c: AcademyCache) =>
  Object.values(c.documents).filter(
    (d) => !equal(d.payload, c.base[d.id]?.payload ?? null),
  );
export function freshAcademy(
  uid: string,
  snapshot: AcademySnapshot,
): AcademyCache {
  const docs = Object.fromEntries(snapshot.documents.map((d) => [d.id, d]));
  return {
    version: 2,
    uid,
    academyId: snapshot.academy.id,
    snapshot,
    documents: structuredClone(docs),
    base: structuredClone(docs),
    conflicts: {},
  };
}
export function validateAcademyBackup(value: unknown): AcademyDocument[] {
  const v = value as {
    format?: string;
    version?: number;
    documents?: AcademyDocument[];
  };
  if (
    v?.format !== "wing-academy-backup" ||
    v.version !== 2 ||
    !Array.isArray(v.documents)
  )
    throw new Error("不是学院完整备份");
  const kinds: DocKind[] = [
    "course",
    "lesson",
    "project",
    "week",
    "process",
    "artifact",
    "critique",
    "note",
    "feedback",
  ];
  const ids = new Set<string>();
  for (const d of v.documents) {
    if (
      !d ||
      typeof d.id !== "string" ||
      ids.has(d.id) ||
      typeof d.course_id !== "string" ||
      !kinds.includes(d.kind) ||
      (d.author_id !== null && typeof d.author_id !== "string") ||
      ["course", "lesson", "project"].includes(d.kind) !==
        (d.author_id === null) ||
      (d.payload !== null &&
        (typeof d.payload !== "object" || Array.isArray(d.payload)))
    )
      throw new Error("备份记录格式错误或ID重复");
    ids.add(d.id);
  }
  return v.documents;
}
