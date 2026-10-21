export type Status = "未开始" | "进行中" | "待评图" | "已完成";
export type CritType = "Concept Crit" | "Midterm Crit" | "Final Crit";
export interface Semester {
  name: string;
  year: string;
  title: string;
  code: string;
  timezone: string;
}
export interface Session {
  id: string;
  week: number;
  date: string;
  topic: string;
  event: string;
  projectId: string;
  objectives: string;
  task: string;
  submission: string;
  references: string;
  notes: string;
  progress: string;
  status: Status;
}
export interface Project {
  id: string;
  name: string;
  cn: string;
  weeks: number[];
  direction: string;
  question: string;
  brief: string;
  constraints: string;
  topics: string;
  references: string;
  status: Status;
  idea: string;
  log: string;
  summary: string;
  stages: boolean[];
}
export interface Critique {
  id: string;
  projectId: string;
  versionId: string;
  date: string;
  type: CritType;
  statement: string;
  listening: string;
  strengths: string;
  issues: string;
  revisions: string;
  next: string;
  completed: boolean;
  updatedAt: string;
}
export interface Artifact {
  id: string;
  projectId: string;
  kind: "音频版本" | "创作笔记" | "声音素材" | "参考音乐" | "结题总结";
  title: string;
  version: string;
  url: string;
  note: string;
  fileId?: string;
  fileName?: string;
  mime?: string;
  remotePath?: string;
  fileSize?: number;
  fileHash?: string;
  final: boolean;
  createdAt: string;
}
export interface AcademyData {
  schemaVersion: 1;
  semester: Semester;
  sessions: Session[];
  projects: Project[];
  critiques: Critique[];
  artifacts: Artifact[];
}
