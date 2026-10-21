import { useEffect, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import App from "./App";
import { Syllabus } from "./pages";
import { Modal } from "./ui";
import { createInitialData } from "./data";
import {
  repository,
  createBackup,
  readBackup,
  setBackupAudioResolver,
} from "./storage";
import { authCallback, supabase, cloudConfigured } from "./supabase";
import { getAudio, BUCKET } from "./cloud-audio";
import { cloudTransport } from "./cloud-transport";
import {
  describeData,
  loadSync,
  rawSync,
  recoveries,
  SyncEngine,
  recoverBrokenCache,
} from "./sync-engine";
import type { Recovery } from "./sync-engine";
import { compose, dirtyKeys, entities, equal } from "./sync-model";
import type { CloudRow, Payload } from "./sync-model";

export function downloadJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Login() {
  const [email, setEmail] = useState(""),
    [token, setToken] = useState(""),
    [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <section className="cloud-login" id="studio-login">
      <div>
        <span className="eyebrow">PERSONAL STUDIO / PRIVATE ACCESS</span>
        <h2>进入个人工作室</h2>
        <p>
          首次在此设备验证邮箱。登录会话将保留，课程记录和试听文件仅向本人开放。
        </p>
      </div>
      {cloudConfigured ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              if (sent) {
                const { error } = await supabase!.auth.verifyOtp({
                  email,
                  token: token.trim(),
                  type: "email",
                });
                if (error) throw error;
              } else {
                const { error } = await supabase!.auth.signInWithOtp({
                  email,
                  options: {
                    shouldCreateUser: false,
                    emailRedirectTo: authCallback(),
                  },
                });
                if (error) throw error;
                setSent(true);
                setMessage(
                  "验证码已发送。请使用预先授权的邮箱，并检查垃圾邮件。",
                );
              }
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span>授权邮箱</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              disabled={sent}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {sent && (
            <label className="field">
              <span>邮件中的一次性验证码</span>
              <input
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
          )}
          <div className="cloud-actions">
            <button className="primary-btn" disabled={busy}>
              {busy ? "正在验证…" : sent ? "验证并进入" : "发送验证码"}
            </button>
            {sent && (
              <button
                type="button"
                className="text-btn"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setToken("");
                }}
              >
                重新发送 / 更换邮箱
              </button>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </form>
      ) : (
        <div>
          <p className="warning">
            云同步尚未配置，个人工作室暂未开放。本机旧记录和音频均保留。
          </p>
          <p>
            站点所有者需在 Supabase 创建项目，并按仓库 README 的「Supabase
            配置」步骤连接。此处不接受私钥。
          </p>
        </div>
      )}
    </section>
  );
}
export default function CloudApp() {
  const [session, setSession] = useState<AuthSession | null>(null),
    [checked, setChecked] = useState(!supabase);
  const [engine, setEngine] = useState<SyncEngine | null>(null),
    [, render] = useState(0);
  const [error, setError] = useState(""),
    [panel, setPanel] = useState(false);
  const [history, setHistory] = useState<Recovery[]>([]);
  const [authorizedUid, setAuthorizedUid] = useState("");
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) {
        setSession(s);
        setChecked(true);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (active) {
          setSession(data.session);
          setChecked(true);
          if (error) setError(error.message);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setChecked(true);
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!session?.user.id || !supabase) {
      setEngine(null);
      return;
    }
    const uid = session.user.id;
    let active = true,
      current: SyncEngine | undefined,
      release: (() => void) | undefined;
    setError("");
    setAuthorizedUid("");
    setEngine(null);
    const start = async () => {
      try {
        if (!session.user.email_confirmed_at)
          throw new Error("请先通过邮件验证身份");
        // Read old data only after authentication. Never copy it into the public syllabus.
        let cached;
        let cacheError;
        try {
          if (rawSync(uid)) cached = loadSync(uid, createInitialData());
        } catch (e) {
          cacheError = e;
        }
        if (navigator.onLine) {
          const { data, error } = await supabase!.rpc("studio_authorized");
          const offlineCache =
            error &&
            cached?.initialized &&
            /fetch|network|timeout|abort/i.test(error.message);
          if (error && !offlineCache) throw error;
          if (!offlineCache && data !== true)
            throw new Error(
              "此邮箱尚未获得工作室权限。请按 README 将已验证用户加入 studio_owners。",
            );
        } else if (!cached?.initialized)
          throw new Error("首次启用同步需要网络连接");
        if (!active) return;
        setAuthorizedUid(uid);
        if (cacheError) throw cacheError;
        const state = cached || loadSync(uid, repository.load());
        current = new SyncEngine(uid, state, cloudTransport(uid), () => {
          if (active) render((n) => n + 1);
        });
        setBackupAudioResolver(getAudio);
        setPanel(!state.initialized);
        setEngine(current);
        await current.sync();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    if (!navigator.locks) {
      setError(
        "此浏览器不支持安全的多标签写入锁。请使用新版 Chrome、Edge 或 Safari。",
      );
    } else
      void navigator.locks.request(
        `wing-sound-editor:${uid}`,
        { ifAvailable: true },
        async (lock) => {
          if (!active) return;
          if (!lock) {
            setError(
              "另一标签页正在使用个人工作室。请关闭该标签页后刷新，避免本机两个页面互相覆盖。",
            );
            return;
          }
          // Create the release promise before any awaited work, including initial network reads.
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          await start();
          if (active) await held;
        },
      );
    return () => {
      active = false;
      if (current) current.stopped = true;
      release?.();
      setBackupAudioResolver(undefined);
    };
  }, [session?.user.id]);
  useEffect(() => {
    if (!engine) return;
    const sync = () => {
      if (document.visibilityState !== "hidden") void engine.sync();
    };
    const interval = setInterval(sync, 15000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [engine]);
  useEffect(() => {
    if (
      !engine?.state.initialized ||
      engine.status === "同步失败" ||
      engine.status === "未同步（离线）"
    )
      return;
    if (!dirtyKeys(engine.state).some((k) => !engine.state.conflicts[k]))
      return;
    const timer = setTimeout(() => void engine.sync(), 900);
    return () => clearTimeout(timer);
  }, [engine, engine?.state.data]);
  useEffect(() => {
    if (!engine || !panel) return;
    void recoveries(engine.uid)
      .then(setHistory)
      .catch((e) => setError(e.message));
  }, [engine, panel, engine?.state.verifiedAt, engine?.state.initialized]);
  const signOut = async () => {
    await supabase!.auth.signOut({ scope: "local" });
    setPanel(false);
  };
  if (!session || !engine || engine.uid !== session.user.id)
    return (
      <div className="app-shell public-studio">
        <header className="header">
          <a className="brand" href="#syllabus">
            WING SOUND
            <br />
            ACADEMY®
          </a>
          <span className="mono">PUBLIC SYLLABUS / 公开课程</span>
        </header>
        <main>
          {!checked ? (
            <p role="status">正在恢复登录会话…</p>
          ) : session ? (
            <section className="cloud-login">
              <div>
                <h2>个人工作室</h2>
                <p role="status">{error || "正在验证权限并读取本机缓存…"}</p>
                <div className="cloud-actions">
                  <button
                    className="secondary-btn"
                    onClick={() => location.reload()}
                  >
                    重试
                  </button>
                  <button className="text-btn" onClick={() => void signOut()}>
                    退出登录
                  </button>
                </div>
                {error && authorizedUid === session.user.id && (
                  <label className="field">
                    <span>从完整 JSON 恢复（先保留原始数据）</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (
                          !confirm(
                            "从完整备份重建本机同步缓存？原始损坏记录会保留为恢复快照，随后仍需比较云端，不会直接覆盖云端。",
                          )
                        )
                          return;
                        try {
                          const data = await readBackup(
                            await file.text(),
                            false,
                          );
                          await recoverBrokenCache(session.user.id, data);
                          location.reload();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    />
                  </label>
                )}
                {error && authorizedUid === session.user.id && (
                  <button
                    className="text-btn"
                    onClick={() =>
                      downloadJSON(
                        {
                          rawCache: rawSync(session.user.id),
                          legacy: localStorage.getItem("wing-sound-academy:v1"),
                        },
                        "wing-sound-raw-recovery.json",
                      )
                    }
                  >
                    下载原始记录以备恢复
                  </button>
                )}
              </div>
            </section>
          ) : (
            <Login />
          )}
          {!session && error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
          <Syllabus
            publicView
            data={createInitialData()}
            edit={() =>
              document
                .getElementById("studio-login")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          />
        </main>
      </div>
    );
  return (
    <>
      <App
        engine={engine}
        syncTools={
          <button
            className="header-tool cloud-status"
            onClick={() => {
              setPanel(true);
              void recoveries(engine.uid)
                .then(setHistory)
                .catch((e) => setError(e.message));
            }}
          >
            <i
              className={
                engine.status === "已同步" ? "synced-dot" : "pending-dot"
              }
            />
            <span>{engine.status}</span>
          </button>
        }
      />
      {(!engine.state.initialized || panel) && (
        <SyncPanel
          engine={engine}
          email={session.user.email || ""}
          history={history}
          error={error}
          close={() => setPanel(false)}
          signOut={() => void signOut()}
        />
      )}
    </>
  );
}
function Compare({
  local,
  remote,
}: {
  local: Payload | null;
  remote: Payload | null;
}) {
  const fieldNames: Record<string, string> = {
    notes: "课程笔记",
    progress: "个人进度",
    status: "完成状态",
    references: "参考资料",
    title: "标题",
    name: "名称",
    year: "学年",
    code: "课程编码",
    timezone: "时区",
    idea: "创作想法",
    log: "修改记录",
    summary: "创作总结",
    stages: "期末五阶段",
    topic: "课程内容",
    event: "课程节点",
    objectives: "教学目标",
    task: "任务",
    submission: "提交内容",
    date: "日期",
    projectId: "所属项目",
    versionId: "关联音频版本",
    statement: "创作者陈述",
    listening: "聆听反馈",
    strengths: "作品优势",
    issues: "问题与音频位置",
    revisions: "修改方向",
    next: "下次需要解决的问题",
    completed: "讲评完成",
    updatedAt: "修改时间",
    note: "内容说明",
    fileId: "音频文件",
    fileName: "文件名",
    remotePath: "私有云文件",
    fileHash: "文件校验",
    fileSize: "文件大小",
    final: "最终成果",
    url: "外部作品链接",
    version: "版本名称",
    brief: "创作任务",
    question: "研究问题",
    constraints: "限制条件",
    topics: "研究主题",
    direction: "方向",
    kind: "档案类型",
    type: "讲评类型",
  };
  const keys = [
    ...new Set([...Object.keys(local || {}), ...Object.keys(remote || {})]),
  ].filter((k) => !equal(local?.[k], remote?.[k]));
  return (
    <div className="conflict-compare">
      {keys.map((k) => (
        <div key={k}>
          <b>{fieldNames[k] || k}</b>
          <div>
            <span>本机</span>
            <pre>
              {local === null
                ? "（记录已删除）"
                : JSON.stringify(local[k] ?? "", null, 2)}
            </pre>
          </div>
          <div>
            <span>云端</span>
            <pre>
              {remote === null
                ? "（记录已删除）"
                : JSON.stringify(remote[k] ?? "", null, 2)}
            </pre>
          </div>
        </div>
      ))}
    </div>
  );
}
export function SyncPanel({
  engine,
  email,
  history,
  error,
  close,
  signOut,
}: {
  engine: SyncEngine;
  email: string;
  history: Recovery[];
  error: string;
  close: () => void;
  signOut: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [merged, setMerged] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<{ name: string; id: string | null }[]>([]),
    [listed, setListed] = useState(false);
  const [cloudHistory, setCloudHistory] = useState<CloudRow[]>([]);
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await job();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cloud = engine.preview
    ? compose(
        Object.fromEntries(
          engine.preview.map((r) => [`${r.kind}:${r.id}`, r.payload]),
        ),
      )
    : null;
  const conflicts = Object.entries(engine.state.conflicts);
  const exportData = async (data = engine.state.data) =>
    downloadJSON(await createBackup(data), "wing-sound-complete-backup.json");
  const activePaths = new Set(
    engine.state.data.artifacts.map((a) => a.remotePath),
  );
  return (
    <Modal
      title="个人工作室 / Cloud & Recovery"
      wide
      onClose={() => {
        if (!busy && engine.state.initialized) close();
      }}
    >
      <div className="dialog-body cloud-panel">
        <div className="cloud-account">
          <div>
            <span className="eyebrow">VERIFIED EMAIL</span>
            <p>{email}</p>
          </div>
          <button className="text-btn" onClick={signOut} disabled={busy}>
            退出此设备登录
          </button>
        </div>
        <div className="sync-summary" role="status">
          <strong>{engine.status}</strong>
          <span>
            {dirtyKeys(engine.state).length} 条待同步 · {conflicts.length}{" "}
            条冲突
          </span>
          {engine.state.verifiedAt && (
            <span>
              最近完整核验：
              {new Date(engine.state.verifiedAt).toLocaleString("zh-CN")}
            </span>
          )}
        </div>
        {(engine.error || error || message) && (
          <p className="warning" role="alert">
            {message || engine.error || error}
          </p>
        )}
        {engine.uploading && (
          <p role="status">
            正在上传并校验：{engine.uploading}（请保持页面打开）
          </p>
        )}
        {!engine.state.initialized ? (
          <section className="migration-choice">
            <h3>首次同步：先比较，再选择</h3>
            <p>本机：{describeData(engine.state.data)}</p>
            <p>
              云端：
              {cloud
                ? engine.preview!.length
                  ? describeData(cloud)
                  : "尚无记录"
                : "尚未读取成功"}
            </p>
            <p>
              选择前会保存恢复快照；原 localStorage 和 IndexedDB
              音频不会删除。云端已有记录时可先合并，再逐条处理差异。
            </p>
            <div className="cloud-actions">
              <button
                className="primary-btn"
                disabled={busy || !cloud}
                onClick={() =>
                  void run(() =>
                    engine.initialize(
                      engine.preview!.length ? "merge" : "local",
                    ),
                  )
                }
              >
                {engine.preview?.length
                  ? "比较并合并两边记录"
                  : "确认将本机记录及音频迁移到云端"}
              </button>
              {!!engine.preview?.length && (
                <>
                  <button
                    className="secondary-btn"
                    disabled={busy}
                    onClick={() => void run(() => engine.initialize("cloud"))}
                  >
                    使用云端（保留本机快照）
                  </button>
                  <button
                    className="secondary-btn"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "确定以本机数据替换云端当前记录？云端旧版本会保留在历史中，本机也会生成快照。",
                        )
                      )
                        void run(() => engine.initialize("local"));
                    }}
                  >
                    使用本机替换云端
                  </button>
                </>
              )}
            </div>
          </section>
        ) : (
          <p>
            文字即时缓存于此浏览器，约1秒后自动同步；每15秒、切回页面及恢复网络时检查云端。离线记录会继续保留，冲突不会自动覆盖。
          </p>
        )}
        <div className="cloud-actions">
          <button
            className="secondary-btn"
            disabled={busy}
            onClick={() => void run(() => engine.sync())}
          >
            立即同步 / 重试
          </button>
          <button
            className="secondary-btn"
            disabled={busy}
            onClick={() => void run(() => exportData())}
          >
            导出完整 JSON 备份
          </button>
          <button
            className="text-btn"
            onClick={() =>
              downloadJSON(engine.state, "wing-sound-sync-state.json")
            }
          >
            导出同步状态（文字与冲突）
          </button>
        </div>
        {conflicts.map(([key, c]) => (
          <section className="conflict-card" key={key}>
            <h3>{key} / 版本冲突</h3>
            <p>
              云端版本 {c.remote.revision} ·{" "}
              {new Date(c.remote.updated_at).toLocaleString("zh-CN")}
              。两边内容均已保留，操作前另存快照。
            </p>
            <Compare local={c.local} remote={c.remote.payload} />
            <div className="cloud-actions">
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => void run(() => engine.resolve(key, "local"))}
              >
                保留本机版本
              </button>
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() => void run(() => engine.resolve(key, "remote"))}
              >
                使用云端版本
              </button>
              <button
                className="text-btn"
                onClick={() =>
                  downloadJSON(c, `conflict-${key.replace(":", "-")}.json`)
                }
              >
                下载两个版本
              </button>
            </div>
            <details>
              <summary>手动合并此记录</summary>
              <p className="help">
                可将两边文字合并到同一个 JSON 对象中。保留原
                ID、字段类型及作品版本关联；保存前会验证完整课程数据。
              </p>
              <textarea
                aria-label={`合并 ${key}`}
                rows={10}
                value={merged[key] ?? JSON.stringify(c.local, null, 2)}
                onChange={(e) =>
                  setMerged({ ...merged, [key]: e.target.value })
                }
              />
              <button
                className="secondary-btn"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await engine.resolve(
                      key,
                      "local",
                      JSON.parse(merged[key] ?? JSON.stringify(c.local)),
                    );
                  })
                }
              >
                保存合并内容
              </button>
            </details>
          </section>
        ))}
        <section>
          <h3>本机恢复快照</h3>
          <p className="help">
            迁移、导入和处理冲突前保存。快照引用本机原音频；完整 JSON
            备份会下载缺少的云音频并打包文件字节。
          </p>
          {history.length ? (
            history.map((r) => (
              <div className="recovery-row" key={r.id}>
                <div>
                  <b>{r.reason}</b>
                  <p>{new Date(r.at).toLocaleString("zh-CN")}</p>
                </div>
                <button
                  className="text-btn"
                  disabled={busy || !!r.raw}
                  onClick={() => void run(() => exportData(r.state.data))}
                >
                  导出此快照完整备份
                </button>
                <button
                  className="text-btn"
                  onClick={() =>
                    downloadJSON(r, "wing-sound-recovery-snapshot.json")
                  }
                >
                  导出快照原文
                </button>
              </div>
            ))
          ) : (
            <p>尚无快照；首次选择迁移后将自动生成。</p>
          )}
        </section>
        <section>
          <h3>云端修改历史</h3>
          <p className="help">
            每次成功保存都有独立版本，包括删除记录。可恢复历史文字及保留的音频关联；恢复前生成本机快照，并再次检查当前云端版本。
          </p>
          <button
            className="secondary-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { data, error } = await supabase!
                  .from("studio_history")
                  .select("kind,id,payload,revision,updated_at")
                  .order("updated_at", { ascending: false })
                  .limit(100);
                if (error) throw error;
                setCloudHistory((data || []) as CloudRow[]);
              })
            }
          >
            查看最近100个云端版本
          </button>
          {cloudHistory.map((r) => (
            <div
              className="recovery-row"
              key={`${r.kind}:${r.id}:${r.revision}`}
            >
              <div>
                <b>
                  {r.kind}:{r.id} · v{r.revision}
                </b>
                <p>
                  {new Date(r.updated_at).toLocaleString("zh-CN")}
                  {!r.payload ? " · 删除记录" : ""}
                </p>
              </div>
              <button
                className="text-btn"
                onClick={() => downloadJSON(r, "wing-sound-cloud-history.json")}
              >
                下载此版本
              </button>
              <button
                className="text-btn"
                disabled={busy || !engine.state.initialized}
                onClick={() => {
                  if (
                    confirm(
                      "将此历史版本恢复为当前本机记录并加入同步队列？将先保留当前快照；有关联的音频档案需要先恢复。",
                    )
                  )
                    void run(async () => {
                      await engine.restore(
                        compose({
                          ...entities(engine.state.data),
                          [`${r.kind}:${r.id}`]: r.payload,
                        }),
                      );
                      await engine.sync();
                    });
                }}
              >
                恢复此版本
              </button>
            </div>
          ))}
        </section>
        <section>
          <h3>私有音频管理</h3>
          <p>
            单文件上限45 MB，建议 MP3 / M4A
            试听版。所有文件均需登录授权下载。更换或移除音频后，旧云文件保留至手动清理，避免同步冲突期间丢失文件。
          </p>
          <button
            className="secondary-btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { data, error } = await supabase!.storage
                  .from(BUCKET)
                  .list(engine.uid, { limit: 1000 });
                if (error) throw error;
                setFiles(data || []);
                setListed(true);
              })
            }
          >
            检查可清理的旧音频
          </button>
          {listed && (
            <p className="help">
              已列出最多1000个文件。仅显示当前档案未引用的音频；其他设备尚未同步的附件可能也在其中，清理前请确认各设备已同步并保存完整备份。
            </p>
          )}
          {files
            .filter((f) => f.id && !activePaths.has(`${engine.uid}/${f.name}`))
            .map((f) => (
              <div key={f.name} className="recovery-row">
                <span className="mono">{f.name}</span>
                <button
                  className="text-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const { data, error } = await supabase!.storage
                        .from(BUCKET)
                        .download(`${engine.uid}/${f.name}`);
                      if (error) throw error;
                      const u = URL.createObjectURL(data);
                      const a = document.createElement("a");
                      a.href = u;
                      a.download = f.name;
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(u), 1000);
                    })
                  }
                >
                  下载保留原文件
                </button>
                <button
                  className="text-btn"
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        "永久删除此私有云文件？历史版本中的该音频将仅能从本机缓存或已有完整备份恢复。请先下载保留原文件。",
                      )
                    )
                      void run(async () => {
                        await engine.sync();
                        if (engine.status !== "已同步")
                          throw new Error(
                            "请先完成同步并处理冲突，再清理云文件。",
                          );
                        const current = await engine.transport.read();
                        if (
                          current.some(
                            (r) =>
                              r.kind === "artifact" &&
                              r.payload?.remotePath ===
                                `${engine.uid}/${f.name}`,
                          )
                        )
                          throw new Error("此音频已被云端档案引用，不能清理。");
                        await engine.snapshot("永久清理旧云音频前");
                        const { error } = await supabase!.storage
                          .from(BUCKET)
                          .remove([`${engine.uid}/${f.name}`]);
                        if (error) throw error;
                        setFiles(files.filter((v) => v.name !== f.name));
                      });
                  }}
                >
                  永久删除云文件
                </button>
              </div>
            ))}
        </section>
        {engine.state.initialized && (
          <button className="primary-btn" disabled={busy} onClick={close}>
            返回工作室
          </button>
        )}
      </div>
    </Modal>
  );
}
