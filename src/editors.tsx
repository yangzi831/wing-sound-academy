import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Check, Upload, Download, HardDrive, ArrowUpRight } from "lucide-react";
import type { AcademyData, Artifact, Critique, Session } from "./types";
import { createBackup, readBackup, audioStore } from "./storage";
import { localDate, safeUrl } from "./domain";
import { Modal, Field } from "./ui";
export function CritEditor({
  data,
  id,
  projectId,
  update,
  close,
}: {
  data: AcademyData;
  id?: string;
  projectId: string;
  update: (c: Critique) => void;
  close: () => void;
}) {
  const [c, setC] = useState<Critique>(
    () =>
      data.critiques.find((x) => x.id === id) || {
        id: crypto.randomUUID(),
        projectId,
        versionId: "",
        date: localDate(),
        type: "Concept Crit",
        statement: "",
        listening: "",
        strengths: "",
        issues: "",
        revisions: "",
        next: "",
        completed: false,
        updatedAt: new Date().toISOString(),
      },
  );
  const [created, setCreated] = useState(!!id);
  const patch = (v: Partial<Critique>) => {
    const n = { ...c, ...v, updatedAt: new Date().toISOString() };
    setC(n);
    update(n);
    setCreated(true);
  };
  return (
    <Modal
      title={`${id ? "编辑" : "新建"}评图 / Studio Critique`}
      onClose={close}
      wide
    >
      <div className="dialog-body">
        <p className="help">
          修改即自动保存；不使用数字评分。
          {!created && " 填写任意一项后建立记录。"}
        </p>
        <div className="form-grid">
          <label className="field">
            <span>对应项目</span>
            <select
              value={c.projectId}
              onChange={(e) =>
                patch({ projectId: e.target.value, versionId: "" })
              }
            >
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.id} — {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>评图类型</span>
            <select
              value={c.type}
              onChange={(e) =>
                patch({ type: e.target.value as Critique["type"] })
              }
            >
              {["Concept Crit", "Midterm Crit", "Final Crit"].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>评图日期</span>
            <input
              required
              type="date"
              value={c.date}
              onChange={(e) => {
                if (e.target.value && e.target.validity.valid)
                  patch({ date: e.target.value });
              }}
            />
          </label>
          <label className="field">
            <span>作品版本</span>
            <select
              value={c.versionId}
              onChange={(e) => patch({ versionId: e.target.value })}
            >
              <option value="">暂不关联</option>
              {data.artifacts
                .filter(
                  (a) => a.projectId === c.projectId && a.kind === "音频版本",
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.version} — {a.title}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {[
          [
            "statement",
            "创作者陈述 / Artist statement",
            "作品的意图、材料与结构。",
          ],
          [
            "listening",
            "第一遍聆听反馈 / First listening",
            "记录第一遍完整聆听的观察。",
          ],
          ["strengths", "作品优势 / Strengths", "具体有效的声音、关系与结构。"],
          [
            "issues",
            "具体问题与音频位置 / Issues + timecodes",
            "例如 01:24 — 转折处低频关系不清晰。",
          ],
          [
            "revisions",
            "建议修改方向 / Revision directions",
            "需要删减、重构或进一步发展的内容。",
          ],
          [
            "next",
            "下次需要解决的问题 / Next questions",
            "下一个版本需要回应的具体问题。",
          ],
        ].map(([key, label, placeholder]) => (
          <Field
            key={key}
            label={label}
            value={c[key as keyof Critique] as string}
            onChange={(v) => patch({ [key]: v })}
            placeholder={placeholder}
            rows={3}
          />
        ))}
        <label className="checkbox-line">
          <input
            type="checkbox"
            checked={c.completed}
            onChange={(e) => patch({ completed: e.target.checked })}
          />
          评图已完成
        </label>
      </div>
      <div className="dialog-foot">
        <span className="help">
          {created ? "已记录，关闭后仍可继续编辑" : "尚未创建记录"}
        </span>
        <button
          className="primary-btn"
          onClick={() => {
            if (!created) patch({});
            close();
          }}
        >
          完成 <Check size={15} />
        </button>
      </div>
    </Modal>
  );
}
export function ArtifactEditor({
  data,
  id,
  projectId,
  defaultKind,
  save,
  close,
}: {
  data: AcademyData;
  id?: string;
  projectId: string;
  defaultKind: Artifact["kind"];
  save: (a: Artifact, finish?: boolean) => void;
  close: () => void;
}) {
  const [a, setA] = useState<Artifact>(
    () =>
      data.artifacts.find((x) => x.id === id) || {
        id: crypto.randomUUID(),
        projectId,
        kind: defaultKind,
        title: "",
        version: "",
        url: "",
        note: "",
        final: false,
        createdAt: new Date().toISOString(),
      },
  );
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const patch = (v: Partial<Artifact>) => {
    const next = { ...a, ...v };
    setA(next);
    if (
      id &&
      next.title.trim() &&
      (!next.url || safeUrl(next.url)) &&
      (next.kind !== "音频版本" || next.fileId || next.url)
    ) {
      save(next, false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (a.url && !safeUrl(a.url)) {
      setError("外部链接需要完整的 http:// 或 https:// 地址。");
      return;
    }
    if (a.kind === "音频版本" && !file && !a.fileId && !a.url) {
      setError("请添加本地音频或外部作品链接。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let next = { ...a, title: a.title.trim() };
      if (file) {
        const fileId = crypto.randomUUID();
        await audioStore("put", fileId, file);
        next = { ...next, fileId, fileName: file.name, mime: file.type };
      }
      save(next);
    } catch {
      setError("保存附件失败，请检查浏览器存储空间后重试。");
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${id ? "编辑" : "添加"}档案 / Studio Archive`}
      onClose={() => {
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <div className="dialog-body">
          <p className="help">
            {id
              ? "文字修改自动保存；替换音频附件后请点击保存。"
              : "填写内容后保存以建立新档案；之后的文字编辑将自动保存。"}
          </p>
          <div className="form-grid">
            <label className="field">
              <span>项目</span>
              <select
                value={a.projectId}
                onChange={(e) => patch({ projectId: e.target.value })}
              >
                {data.projects.map((p) => (
                  <option key={p.id}>{p.id}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>档案类型</span>
              <select
                value={a.kind}
                onChange={(e) =>
                  patch({ kind: e.target.value as Artifact["kind"] })
                }
              >
                {[
                  "音频版本",
                  "创作笔记",
                  "声音素材",
                  "参考音乐",
                  "结题总结",
                ].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>标题 *</span>
            <input
              required
              maxLength={200}
              value={a.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="作品、研究或笔记名称"
              pattern=".*\S.*"
            />
          </label>
          <label className="field">
            <span>版本标记</span>
            <input
              value={a.version}
              onChange={(e) => patch({ version: e.target.value })}
              placeholder="例如 v01 / rough mix"
            />
          </label>
          <label className="field">
            <span>外部链接</span>
            <input
              type="url"
              value={a.url}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://…"
            />
          </label>
          {(a.kind === "音频版本" || a.kind === "声音素材") && (
            <label className="file-drop field">
              <Upload size={22} />
              <span>添加本地音频 / MP3、WAV、OGG、FLAC 等</span>
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aiff"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <small>
                {file
                  ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : a.fileName || "文件仅保存在当前浏览器，不会上传云端。"}
              </small>
            </label>
          )}
          <Field
            label="内容与修改说明"
            value={a.note}
            onChange={(note) => patch({ note })}
            placeholder="记录版本修改、声音来源、创作笔记或聆听观察。"
            rows={5}
          />
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={a.final}
              onChange={(e) => patch({ final: e.target.checked })}
            />
            标记为项目最终成果
          </label>
          <p className="help">
            本地音频随完整备份一起导出。外部链接不复制远端文件；支持的音频直链可在档案内播放。
          </p>
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <span className="help">填写后保存至当前浏览器</span>
          <button disabled={busy} className="primary-btn" type="submit">
            {busy ? "正在保存…" : "保存档案"} <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function BackupDialog({
  data,
  close,
  replace,
  notify,
  recovery,
}: {
  data: AcademyData;
  close: () => void;
  replace: (d: AcademyData) => void;
  notify: (s: string) => void;
  recovery: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const exportAll = async () => {
    setBusy(true);
    setError("");
    try {
      const backup = await createBackup(data);
      download(
        JSON.stringify(backup),
        `wing-sound-academy-${localDate()}.json`,
      );
      notify("完整备份已生成，包含本地音频");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    if (
      !confirm("导入会替换当前全部课程与个人记录。建议先导出备份。是否继续？")
    ) {
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = await readBackup(await file.text());
      replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Modal
      title="本地数据 / Backup & Migration"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className="dialog-body">
        <div className="backup-heading">
          <HardDrive size={30} />
          <h3>你的个人工作室，保存在本机。</h3>
          <p>
            文字数据使用 localStorage；音频使用
            IndexedDB。不同浏览器、设备、域名和端口分别保存，数据不会自动同步。清除浏览器数据可能删除记录，请定期导出。
          </p>
        </div>
        <div className="backup-stats">
          <span>
            <b>{data.sessions.filter((s) => s.status === "已完成").length}</b>{" "}
            已完成课程
          </span>
          <span>
            <b>{data.artifacts.length}</b> 档案
          </span>
          <span>
            <b>{data.critiques.length}</b> 评图
          </span>
        </div>
        {recovery && (
          <button
            className="secondary-btn"
            onClick={() =>
              download(
                localStorage.getItem("wing-sound-academy:v1") || "",
                "wing-sound-recovery-raw.json",
              )
            }
          >
            下载原始记录以备恢复 <Download size={15} />
          </button>
        )}
        <button
          disabled={busy || recovery}
          className="backup-option"
          aria-label="导出完整备份"
          onClick={() => void exportAll()}
        >
          <Download size={23} />
          <div>
            <h3>导出完整备份</h3>
            <p>
              课程配置、进度、笔记、评图、档案与本地音频。音频嵌入
              JSON，大文件生成可能需要片刻。
            </p>
          </div>
          <ArrowUpRight size={18} />
        </button>
        <button
          disabled={busy}
          className="backup-option"
          aria-label="导入备份"
          onClick={() => input.current?.click()}
        >
          <Upload size={23} />
          <div>
            <h3>导入备份</h3>
            <p>验证内容后替换当前记录；请导入本平台导出的完整 JSON 备份。</p>
          </div>
          <ArrowUpRight size={18} />
        </button>
        <input
          className="sr-only"
          ref={input}
          type="file"
          accept=".json,application/json"
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
        <p className="help">
          外部音频只备份链接地址，不包含远端文件。大体积音频建议同时保留原始文件。未接入云存储与账号系统。
        </p>
        {busy && <p role="status">正在处理备份，请保持此页面打开…</p>}
        {error && (
          <p role="alert" className="warning">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
export function SessionEditor({
  session,
  data,
  save,
  close,
}: {
  session: Session;
  data: AcademyData;
  save: (p: Partial<Session>) => void;
  close: () => void;
}) {
  const [draft, setDraft] = useState(session);
  const [error, setError] = useState("");
  const patch = (v: Partial<Session>) => setDraft({ ...draft, ...v });
  return (
    <Modal title={`编辑 ${session.id} / 课程配置`} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const prev = data.sessions.find((s) => s.week === session.week - 1),
            next = data.sessions.find((s) => s.week === session.week + 1);
          if (
            (prev && draft.date <= prev.date) ||
            (next && draft.date >= next.date)
          ) {
            setError("日期需晚于上一周，并早于下一周。");
            return;
          }
          if (new Date(draft.date + "T12:00:00").getDay() !== 0) {
            setError("正式教学日为星期日，请选择周日日期。");
            return;
          }
          save({
            date: draft.date,
            topic: draft.topic,
            event: draft.event,
            objectives: draft.objectives,
            task: draft.task,
            submission: draft.submission,
          });
        }}
      >
        <div className="dialog-body">
          <label className="field">
            <span>课程日期 / 星期日 · 时间待定</span>
            <input
              required
              type="date"
              value={draft.date}
              onChange={(e) => patch({ date: e.target.value })}
            />
          </label>
          {[
            ["topic", "课程内容"],
            ["event", "评图 / 教学节点"],
            ["objectives", "教学目标"],
            ["task", "当周任务"],
            ["submission", "提交内容"],
          ].map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={draft[key as keyof Session] as string}
              onChange={(v) => patch({ [key]: v })}
              rows={key === "topic" ? 2 : 3}
            />
          ))}
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <span className="help">修改将同步至课表、项目和首页。</span>
          <button className="primary-btn" type="submit">
            保存配置 <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function CourseEditor({
  data,
  save,
  close,
}: {
  data: AcademyData;
  save: (s: AcademyData["semester"]) => void;
  close: () => void;
}) {
  const [s, setS] = useState(data.semester);
  return (
    <Modal title="课程信息 / Course Configuration" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(s);
        }}
      >
        <div className="dialog-body">
          {[
            ["code", "课程编码"],
            ["title", "课程名称"],
            ["name", "学期"],
            ["year", "学年"],
          ].map(([key, label]) => (
            <label key={key} className="field">
              <span>{label}</span>
              <input
                required
                value={s[key as keyof typeof s]}
                onChange={(e) => setS({ ...s, [key]: e.target.value })}
              />
            </label>
          ))}
          <p className="help">
            周次日期和教学内容可在任意周次详情中编辑。本学期固定为16周、P00–P04五个项目。
          </p>
        </div>
        <div className="dialog-foot">
          <button className="primary-btn">
            保存课程信息 <Check size={15} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
