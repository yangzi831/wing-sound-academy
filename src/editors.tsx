import { teachingLabel } from "./labels";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Check, Upload, Download, HardDrive, ArrowUpRight } from "lucide-react";
import type { AcademyData, Artifact, Critique, Session } from "./types";
import { createBackup, readBackup, audioStore } from "./storage";
import { localDate, safeUrl } from "./domain";
import { Modal, Field } from "./ui";
import { checkAudio } from "./cloud-audio";
import { equal } from "./sync-model";
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
  const currentReview = data.critiques.find((x) => x.id === c.id);
  useEffect(() => {
    if (currentReview) setC(currentReview);
  }, [currentReview]);
  const patch = (v: Partial<Critique>) => {
    if (created && !currentReview) return;
    const n = { ...c, ...v, updatedAt: new Date().toISOString() };
    setC(n);
    update(n);
    setCreated(true);
  };
  return (
    <Modal
      title={`${id ? "编辑" : "新建"}作品讲评 / Composition Review`}
      onClose={close}
      wide
    >
      <div className="dialog-body">
        <p className="help">
          修改即自动保存；不使用数字评分。
          {!created && " 填写任意一项后建立记录。"}
        </p>
        {created && !currentReview && (
          <p role="alert" className="warning">
            此记录已在其他设备移除，请关闭窗口。历史内容可在云同步管理中恢复。
          </p>
        )}
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
            <span>作品讲评类型</span>
            <select
              value={c.type}
              onChange={(e) =>
                patch({ type: e.target.value as Critique["type"] })
              }
            >
              {["Concept Crit", "Midterm Crit", "Final Crit"].map((t) => (
                <option key={t} value={t}>
                  {teachingLabel(t).split(" / ")[0]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>作品讲评日期</span>
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
          作品讲评已完成
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
  const currentArtifact = data.artifacts.find((x) => x.id === a.id);
  const knownArtifact = useRef(currentArtifact);
  const [draftConflict, setDraftConflict] = useState(false);
  useEffect(() => {
    if (equal(knownArtifact.current, currentArtifact)) return;
    if (
      currentArtifact &&
      (equal(a, knownArtifact.current) || equal(a, currentArtifact))
    )
      setA(currentArtifact);
    else if (id) {
      setDraftConflict(true);
      setError(
        "其他设备已更新此档案。未保存的草稿仍保留，请先复制文字，再载入最新记录进行合并。",
      );
    }
    knownArtifact.current = currentArtifact;
  }, [currentArtifact]);
  const patch = (v: Partial<Artifact>) => {
    if (id && !currentArtifact) {
      setError(
        "此档案已在其他设备移除。请关闭窗口后从云端历史恢复，或新建档案。",
      );
      return;
    }
    const next = { ...a, ...v };
    setA(next);
    if (draftConflict) return;
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
    if (draftConflict) {
      setError("请先复制草稿并载入最新记录，再合并保存。");
      return;
    }
    if (id && !currentArtifact) {
      setError("此档案已在其他设备移除，请先关闭窗口。");
      return;
    }
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
    const submitBase = knownArtifact.current;
    try {
      let next = { ...a, title: a.title.trim() };
      if (file) {
        checkAudio(file, file.name);
        const fileId = crypto.randomUUID();
        await audioStore("put", fileId, file);
        next = {
          ...next,
          fileId,
          fileName: file.name,
          mime: file.type,
          fileSize: file.size,
        };
        delete next.remotePath;
        delete next.fileHash;
      }
      if (id && !equal(submitBase, knownArtifact.current)) {
        setError(
          "保存附件期间档案已更新。本次所选文件仍保留，请核对最新文字后再次保存。",
        );
        setBusy(false);
        return;
      }
      save(next);
    } catch (e) {
      setError(
        (e as Error).message || "保存附件失败，请检查浏览器存储空间后重试。",
      );
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
          {draftConflict && (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => {
                if (
                  currentArtifact &&
                  confirm(
                    "已复制未保存的草稿文字？载入最新记录会替换此表单内容。",
                  )
                ) {
                  setA(currentArtifact);
                  setDraftConflict(false);
                  setError("");
                }
              }}
            >
              载入最新档案（请先复制草稿）
            </button>
          )}
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
              <span>添加试听音频 / 推荐 MP3、M4A · 单文件≤45 MB</span>
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aiff"
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <small>
                {file
                  ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : a.fileName || "先保存本机，随后上传并校验私有云文件。"}
              </small>
            </label>
          )}
          {a.fileId && (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                if (a.kind === "音频版本" && !a.url) {
                  setError(
                    "音频版本需要文件或链接。可选择新文件更换，或删除整份档案。",
                  );
                  return;
                }
                setFile(undefined);
                const next = { ...a };
                delete next.fileId;
                delete next.remotePath;
                delete next.fileHash;
                delete next.fileName;
                delete next.fileSize;
                delete next.mime;
                setA(next);
                if (id) save(next, false);
              }}
            >
              移除关联音频（原文件保留供恢复）
            </button>
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
          <span className="help">先保存本机，再同步到私有云端</span>
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
  replace: (d: AcademyData) => void | Promise<void>;
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
      const next = await readBackup(await file.text(), false);
      await replace(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <Modal
      title="完整备份 / Backup & Restore"
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className="dialog-body">
        <div className="backup-heading">
          <HardDrive size={30} />
          <h3>为个人工作室另存一份完整备份。</h3>
          <p>
            云同步让授权设备使用同一份记录；本机缓存支持离线编辑。完整 JSON
            备份独立于云同步，包含文字与音频原始字节，请定期导出并妥善保管。
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
            <b>{data.critiques.length}</b> 作品讲评
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
              课程配置、进度、笔记、作品讲评、档案与本地音频。音频嵌入
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
          本机缺少的私有云音频会在导出时下载；离线且文件缺失时会明确报错。外部音频只备份链接。导入前会生成本机恢复快照，恢复内容经版本检查后同步；旧版完整
          JSON 仍可导入。
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
  const [original] = useState(session);
  const [error, setError] = useState("");
  const patch = (v: Partial<Session>) => setDraft({ ...draft, ...v });
  return (
    <Modal title={`编辑 ${session.id} / 课程配置`} onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            ["date", "topic", "event", "objectives", "task", "submission"].some(
              (k) =>
                draft[k as keyof Session] !== original[k as keyof Session] &&
                session[k as keyof Session] !== original[k as keyof Session],
            )
          ) {
            setError(
              "其他设备已修改相同课程字段。请先复制本次输入，再关闭并重新打开配置进行比较。",
            );
            return;
          }
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
            ...Object.fromEntries(
              ["date", "topic", "event", "objectives", "task", "submission"]
                .filter(
                  (k) =>
                    draft[k as keyof Session] !== original[k as keyof Session],
                )
                .map((k) => [k, draft[k as keyof Session]]),
            ),
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
            ["event", "作品讲评 / 教学节点"],
            ["objectives", "教学目标"],
            ["task", "当周任务"],
            ["submission", "提交内容"],
          ].map(([key, label]) => (
            <Field
              key={key}
              label={label}
              value={teachingLabel(draft[key as keyof Session] as string)}
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
  const [original] = useState(data.semester);
  const [error, setError] = useState("");
  return (
    <Modal title="课程信息 / Course Configuration" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const changed = Object.keys(s).filter(
            (k) => s[k as keyof typeof s] !== original[k as keyof typeof s],
          );
          if (
            changed.some(
              (k) =>
                data.semester[k as keyof typeof s] !==
                original[k as keyof typeof s],
            )
          ) {
            setError(
              "其他设备已修改相同字段。请先复制本次输入，再关闭并重新打开配置进行比较。",
            );
            return;
          }
          save({
            ...data.semester,
            ...Object.fromEntries(
              changed.map((k) => [k, s[k as keyof typeof s]]),
            ),
          });
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
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
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
