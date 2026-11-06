import { useEffect, useMemo, useState } from "react";
import type { Session as AuthSession } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import LegacyCloudApp, { Login, downloadJSON } from "./cloud-ui";
import { createInitialData } from "./data";
import { Syllabus } from "./pages";
import { Modal, Field, AudioPlayer } from "./ui";
import { academyRPC, academyTransport } from "./academy-api";
import {
  AcademyEngine,
  loadAcademy,
  academyCacheKey,
  academyRecovery,
  academyRecoveryList,
} from "./academy-engine";
import {
  asCourse,
  roleFor,
  makeDoc,
  pendingDocuments,
  completedLessons,
} from "./academy-model";
import type {
  AcademyCache,
  AcademyDocument,
  CourseRole,
  Lesson,
  Value,
} from "./academy-model";
import { ElectronicAdapter } from "./electronic-adapter";
import App from "./App";
import { ProjectArtwork } from "./artwork";
import { audioStore, repository, setBackupAudioResolver } from "./storage";
import { BUCKET, checkAudio, digest, getAudio } from "./cloud-audio";
import type { Artifact } from "./types";
import { equal } from "./sync-model";

let callbackPromise: Promise<void> | undefined;
async function finishInvitation() {
  const params = new URLSearchParams(location.search),
    token = params.get("token_hash"),
    type = params.get("type");
  const invitation = params.get("invitation"),
    ticket = params.get("ticket");
  if (!invitation || !ticket) return;
  // Strip email credentials from URL before rendering or navigating.
  history.replaceState(null, "", location.pathname + location.hash);
  const pending = { invitation, ticket };
  sessionStorage.setItem("wing-pending-invitation", JSON.stringify(pending));
  if (token && (type === "invite" || type === "magiclink")) {
    const { error } = await supabase!.auth.verifyOtp({
      token_hash: token,
      type,
    });
    if (error)
      throw new Error(
        "邮箱确认链接已失效或已使用。可用同一受邀邮箱登录后再接受；或请管理员重发邀请。",
      );
  }
}
async function acceptPending() {
  const raw = sessionStorage.getItem("wing-pending-invitation");
  if (!raw) return;
  const { invitation, ticket } = JSON.parse(raw);
  await academyRPC("academy_accept_invitation", {
    p_id: invitation,
    p_hash: await digest(new Blob([ticket])),
  });
  sessionStorage.removeItem("wing-pending-invitation");
}
export default function AcademyRoot() {
  const [session, setSession] = useState<AuthSession | null>(null),
    [checked, setChecked] = useState(!supabase);
  const [engine, setEngine] = useState<AcademyEngine | null>(null),
    [error, setError] = useState(""),
    [, render] = useState(0);
  const [legacyMode, setLegacyMode] = useState(false);
  const [invitationError, setInvitationError] = useState("");
  const [courseId, setCourseId] = useState(
    () =>
      new URLSearchParams(location.search).get("course") ||
      (/^#(week|project|schedule|archive|critique|overview|syllabus)/.test(
        location.hash,
      )
        ? "electronic"
        : ""),
  );
  const [view, setView] = useState(""),
    [panel, setPanel] = useState(false),
    [members, setMembers] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    callbackPromise ||= finishInvitation();
    void callbackPromise
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (!active) return;
        void supabase!.auth.getSession().then(({ data, error }) => {
          if (active) {
            setSession(data.session);
            setChecked(true);
            if (error) setError(error.message);
          }
        });
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) {
        setSession(s);
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
    let active = true,
      current: AcademyEngine | undefined,
      release: (() => void) | undefined;
    const uid = session.user.id;
    setEngine(null);
    const start = async () => {
      try {
        await callbackPromise?.catch(() => {});
        try {
          await acceptPending();
        } catch (e) {
          if (active) setInvitationError((e as Error).message);
        }
        const index =
          await academyRPC<{ id: string; name: string; role: string }[]>(
            "academy_index",
          );
        if (!index.length)
          throw new Error(
            "此账号尚未加入学院。请打开管理员发来的有效邀请邮件；现有管理员需先执行学院增量迁移。",
          );
        const snapshot = await academyTransport(index[0].id, uid).read();
        if (!active) return;
        const state = loadAcademy(uid, snapshot);
        const old =
          localStorage.getItem(`wing-sound-sync:v1:${uid}`) ||
          localStorage.getItem("wing-sound-academy:v1");
        if (!localStorage.getItem(academyCacheKey(uid, index[0].id)))
          await academyRecovery(uid, index[0].id, "首次升级前本机原始数据", {
            raw: old,
          });
        current = new AcademyEngine(
          state,
          academyTransport(index[0].id, uid),
          () => {
            if (active) render((n) => n + 1);
          },
        );
        current.save(state);
        localStorage.setItem(`wing-academy-last:${uid}`, index[0].id);
        setBackupAudioResolver(getAudio);
        setEngine(current);
        setError("");
        await current.sync();
      } catch (e) {
        if (!active) return;
        const message = (e as Error).message;
        if (
          (e as Error & { code?: string }).code === "PGRST202" &&
          message.includes("academy_index")
        ) {
          setLegacyMode(true);
          return;
        }
        if (/fetch|network|timeout|abort/i.test(message)) {
          try {
            const aid = localStorage.getItem(`wing-academy-last:${uid}`);
            const raw = aid && localStorage.getItem(academyCacheKey(uid, aid));
            if (raw) {
              const state = JSON.parse(raw) as AcademyCache;
              if (state.uid === uid && state.version === 2) {
                current = new AcademyEngine(
                  state,
                  academyTransport(state.academyId, uid),
                  () => {
                    if (active) render((n) => n + 1);
                  },
                );
                current.status = "未同步（离线）";
                setEngine(current);
                setBackupAudioResolver(getAudio);
                return;
              }
            }
          } catch {
            /* Preserve corrupt data and surface original error. */
          }
        }
        setError(message);
      }
    };
    if (!navigator.locks) {
      setError("请使用支持编辑锁的新版浏览器");
      return;
    }
    void navigator.locks.request(
      `wing-academy:${uid}`,
      { ifAvailable: true },
      async (lock) => {
        if (!active) return;
        if (!lock) {
          setError("另一标签页正在编辑学院，请关闭后刷新。");
          return;
        }
        const held = new Promise<void>((r) => {
          release = r;
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
    const timer = setInterval(sync, 15000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [engine]);
  useEffect(() => {
    if (
      !engine ||
      engine.denied ||
      engine.status === "同步失败" ||
      engine.status === "未同步（离线）" ||
      !pendingDocuments(engine.state).some((d) => !engine.state.conflicts[d.id])
    )
      return;
    const timer = setTimeout(() => void engine.sync(), 900);
    return () => clearTimeout(timer);
  }, [engine, engine?.state.documents]);
  const adapter = useMemo(
    () => (engine ? new ElectronicAdapter(engine) : null),
    [engine],
  );
  adapter?.refresh();
  const choose = (id: string) => {
    setCourseId(id);
    setView("");
    setMembers(false);
    const params = new URLSearchParams(location.search);
    if (id) params.set("course", id);
    else params.delete("course");
    history.replaceState(
      null,
      "",
      location.pathname +
        (params.size ? "?" + params : "") +
        (id ? "#overview" : "#academy"),
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };
  const logout = async () => {
    await supabase!.auth.signOut({ scope: "local" });
  };
  if (session && legacyMode)
    return (
      <>
        <div className="academy-upgrade-notice" role="status">
          学院升级代码已就绪，服务器尚未执行增量迁移。当前继续使用原个人工作室与云同步。管理员请按
          README 部署学院数据库和邀请函数后刷新。
        </div>
        <LegacyCloudApp />
      </>
    );
  if (
    !session ||
    !engine ||
    engine.state.uid !== session.user.id ||
    engine.denied
  )
    return (
      <div className="app-shell public-studio">
        <header className="header">
          <span className="brand">
            WING SOUND
            <br />
            ACADEMY®
          </span>
        </header>
        <main>
          {!checked ? (
            <p>恢复会话中…</p>
          ) : !session ? (
            <Login academy />
          ) : (
            <section className="cloud-login">
              <div>
                <h2>学院访问</h2>
                <p role="alert">
                  {engine?.denied
                    ? "你的学院成员权限已移除，服务器访问已停止。"
                    : error || "正在确认邮箱与学院成员身份…"}
                </p>
                {invitationError && (
                  <p role="alert">邀请未接受：{invitationError}</p>
                )}
                {sessionStorage.getItem("wing-pending-invitation") && (
                  <button
                    className="text-btn"
                    onClick={() => {
                      sessionStorage.removeItem("wing-pending-invitation");
                      setInvitationError("");
                    }}
                  >
                    忽略此邀请
                  </button>
                )}
                <button
                  className="secondary-btn"
                  onClick={() => location.reload()}
                >
                  重试
                </button>
                <button className="text-btn" onClick={() => void logout()}>
                  退出登录
                </button>
              </div>
            </section>
          )}
          {error && !session && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
          <Syllabus
            data={createInitialData()}
            publicView
            edit={() =>
              document.getElementById("studio-login")?.scrollIntoView()
            }
          />
        </main>
      </div>
    );
  const me = engine.state.snapshot.members.find(
    (m) => m.user_id === session.user.id,
  )!;
  const courses = Object.values(engine.state.documents)
    .filter((d) => d.kind === "course" && d.payload)
    .sort((a, b) => asCourse(a).order - asCourse(b).order);
  const selected = courses.find((d) => d.course_id === courseId);
  const tools = (
    <div className="academy-toolbar">
      <button onClick={() => choose("")} className="text-btn">
        ← 学院
      </button>
      <select
        aria-label="切换课程"
        value={selected?.course_id || ""}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">学院课程列表</option>
        {courses
          .filter((d) => !asCourse(d).archived)
          .map((d) => (
            <option value={d.course_id} key={d.id}>
              {asCourse(d).name}
            </option>
          ))}
      </select>
      {selected && (
        <>
          <span>{roleFor(asCourse(selected), me)}</span>
          <button
            className="text-btn"
            onClick={() => setView(view === "records" ? "" : "records")}
          >
            {view === "records" ? "返回课程" : "双方学习记录与反馈"}
          </button>
        </>
      )}
      <button
        className="text-btn academy-status"
        onClick={() => setPanel(true)}
      >
        {engine.status}
      </button>
      {me.role === "admin" && (
        <button className="text-btn" onClick={() => setMembers(true)}>
          成员与邀请
        </button>
      )}
      <button className="text-btn" onClick={() => void logout()}>
        退出
      </button>
    </div>
  );
  const main =
    selected?.course_id === "electronic" && !view && !members && adapter ? (
      <>
        {tools}
        <App
          key={engine.state.uid}
          engine={adapter}
          fixed
          syncTools={
            <button
              className="header-tool cloud-status"
              onClick={() => setPanel(true)}
            >
              {engine.status}
            </button>
          }
        />
      </>
    ) : (
      <div className="app-shell">
        <header className="header">
          <span className="brand">
            WING SOUND
            <br />
            ACADEMY®
          </span>
          <span className="mono">ACADEMY / SHARED STUDIO</span>
        </header>
        {tools}
        <main>
          {members ? (
            <MemberPanel engine={engine} />
          ) : !selected ? (
            <AcademyHome engine={engine} courses={courses} choose={choose} />
          ) : view === "records" ? (
            <Records engine={engine} course={selected} />
          ) : (
            <CustomCourse engine={engine} course={selected} />
          )}
        </main>
      </div>
    );
  return (
    <>
      {invitationError && (
        <div role="alert" className="academy-warning">
          邀请未接受：{invitationError}{" "}
          <button
            onClick={() => {
              sessionStorage.removeItem("wing-pending-invitation");
              setInvitationError("");
            }}
          >
            忽略此邀请
          </button>
        </div>
      )}
      {main}
      {engine.error && (
        <div className="academy-warning" role="alert">
          {engine.error}{" "}
          <button onClick={() => setPanel(true)}>查看同步与恢复</button>
        </div>
      )}
      {panel && <AcademySync engine={engine} close={() => setPanel(false)} />}
    </>
  );
}
export function AcademyHome({
  engine,
  courses,
  choose,
}: {
  engine: AcademyEngine;
  courses: AcademyDocument[];
  choose: (id: string) => void;
}) {
  const [archived, setArchived] = useState(false),
    [edit, setEdit] = useState<AcademyDocument | null>(null);
  const uid = engine.state.uid,
    me = engine.state.snapshot.members.find((m) => m.user_id === uid)!;
  const docs = Object.values(engine.state.documents);
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const upcoming = docs
    .filter(
      (d) =>
        d.kind === "lesson" &&
        d.payload &&
        String(d.payload.date || "") >= today &&
        !d.payload.archived,
    )
    .sort((a, b) =>
      String(a.payload!.date).localeCompare(String(b.payload!.date)),
    )
    .slice(0, 5);
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ACADEMY / COURSES & PRACTICE</span>
          <h1>
            WING SOUND ACADEMY<span className="blue">.</span>
          </h1>
          <p>课程、共同内容与各自的学习记录</p>
        </div>
        {me.role === "admin" && (
          <button
            className="primary-btn"
            onClick={() =>
              setEdit(
                makeDoc("course", crypto.randomUUID(), null, {
                  name: "",
                  description: "",
                  goals: "",
                  fixed: false,
                  archived: false,
                  order: courses.length,
                  adminRole: "共同学习者",
                  memberRole: "共同学习者",
                  roles: {},
                }),
              )
            }
          >
            新增课程 ＋
          </button>
        )}
      </div>
      <div className="cloud-actions">
        <button className="text-btn" onClick={() => setArchived(!archived)}>
          {archived ? "查看进行中课程" : "查看归档课程"}
        </button>
        <span>我的学院权限：{me.role === "admin" ? "管理员" : "成员"}</span>
      </div>
      <div className="academy-courses">
        {courses
          .filter((d) => !!asCourse(d).archived === archived)
          .map((d) => {
            const c = asCourse(d),
              mine = docs.filter(
                (x) =>
                  x.course_id === d.course_id &&
                  x.author_id === uid &&
                  x.payload,
              ),
              lessons = docs.filter(
                (x) =>
                  x.kind === "lesson" &&
                  x.course_id === d.course_id &&
                  x.payload &&
                  !x.payload.archived,
              ),
              role = roleFor(c, me),
              done = completedLessons(docs, d.course_id, uid).length;
            return (
              <article key={d.id}>
                {d.course_id === "electronic" ? (
                  <ProjectArtwork id="P01" decorative />
                ) : (
                  <div className="custom-course-mark">
                    <span>{c.name.slice(0, 1)}</span>
                    <small>OPEN COURSE / SHARED CONTENT</small>
                  </div>
                )}
                <div className="course-card-content">
                  <span className="eyebrow">
                    {c.fixed ? "固定课程" : "共同编辑课程"} / 我的角色：{role}
                  </span>
                  <h2>
                    <button onClick={() => choose(d.course_id)}>
                      {c.name}
                    </button>
                  </h2>
                  <p>
                    {c.description ||
                      "课程框架已建立，内容由学院成员共同填写。"}
                  </p>
                  <p className="help">
                    {role === "老师"
                      ? `教学记录 ${mine.filter((x) => x.kind === "note" || x.kind === "feedback").length} 条 · 备课与反馈`
                      : `我的完成进度 ${done} / ${lessons.length} 课次`}
                  </p>
                  <div className="cloud-actions">
                    <button
                      className="text-btn"
                      onClick={() => choose(d.course_id)}
                    >
                      进入课程 ↗
                    </button>
                    {me.role === "admin" && !c.fixed && (
                      <button className="text-btn" onClick={() => setEdit(d)}>
                        课程设置
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
      </div>
      <div className="academy-home-lower">
        <section>
          <h2>近期安排</h2>
          {upcoming.length ? (
            upcoming.map((d) => (
              <button
                className="academy-event"
                key={d.id}
                onClick={() => choose(d.course_id)}
              >
                <span className="mono">{String(d.payload!.date)}</span>
                <span>{String(d.payload!.topic || d.payload!.title)}</span>
                <small>
                  {
                    asCourse(engine.state.documents["course/" + d.course_id])
                      .name
                  }
                </small>
              </button>
            ))
          ) : (
            <p>暂无已安排日期的课次。</p>
          )}
        </section>
        <section>
          <h2>我的待办</h2>
          {courses
            .filter((d) => !asCourse(d).archived)
            .map((c) => {
              const role = roleFor(asCourse(c), me);
              const lessons = docs.filter(
                (x) =>
                  x.kind === "lesson" &&
                  x.course_id === c.course_id &&
                  x.payload &&
                  !x.payload.archived,
              );
              const outstanding = lessons.filter(
                (l) =>
                  !docs.some(
                    (r) =>
                      r.author_id === uid &&
                      r.course_id === c.course_id &&
                      r.payload?.status === "已完成" &&
                      (r.payload.lessonId === l.id ||
                        r.id ===
                          `week/electronic/${uid}/${String(l.payload!.id)}`),
                  ),
              );
              return (
                <div className="recovery-row" key={c.id}>
                  <strong>{asCourse(c).name}</strong>
                  <span>
                    {role === "老师"
                      ? "教学待办：备课、试听与反馈"
                      : `学习待办：${outstanding.length} 个未完成课次`}
                  </span>
                  <button
                    className="text-btn"
                    onClick={() => choose(c.course_id)}
                  >
                    查看课程
                  </button>
                </div>
              );
            })}
        </section>
      </div>
      {edit && (
        <CourseEditorV2
          engine={engine}
          doc={edit}
          close={() => setEdit(null)}
        />
      )}
    </>
  );
}
function CourseEditorV2({
  engine,
  doc,
  close,
}: {
  engine: AcademyEngine;
  doc: AcademyDocument;
  close: () => void;
}) {
  const admin =
    engine.state.snapshot.members.find((m) => m.user_id === engine.state.uid)
      ?.role === "admin";
  const [c, setC] = useState(asCourse(doc)),
    [error, setError] = useState("");
  return (
    <Modal title="课程设置 / Course" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            if (
              engine.state.documents[doc.id]?.revision !== doc.revision &&
              doc.revision
            )
              throw new Error("课程已被另一设备更新，请复制输入后重新打开比较");
            const id = "course/" + doc.course_id;
            engine.edit({ ...doc, id, payload: c as unknown as Value });
            close();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="dialog-body">
          <label className="field">
            <span>课程名称</span>
            <input
              required
              disabled={!admin}
              value={c.name}
              onChange={(e) => setC({ ...c, name: e.target.value })}
            />
          </label>
          <Field
            label="简介"
            value={c.description}
            onChange={(description) => setC({ ...c, description })}
          />
          <Field
            label="学习目标"
            value={c.goals}
            onChange={(goals) => setC({ ...c, goals })}
          />
          {admin && (
            <>
              <label className="field">
                <span>排序（较小的在前）</span>
                <input
                  type="number"
                  value={c.order}
                  onChange={(e) =>
                    setC({ ...c, order: Number(e.target.value) })
                  }
                />
              </label>
              {engine.state.snapshot.members
                .filter((m) => m.active)
                .map((m) => (
                  <label className="field" key={m.user_id}>
                    <span>{m.display_name} 的课程角色</span>
                    <select
                      value={roleFor(c, m)}
                      onChange={(e) =>
                        setC({
                          ...c,
                          roles: {
                            ...c.roles,
                            [m.user_id]: e.target.value as CourseRole,
                          },
                        })
                      }
                    >
                      {["老师", "学生", "共同学习者"].map((r) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </label>
                ))}
              <label className="field">
                <span>之后加入成员的默认课程角色</span>
                <select
                  value={c.memberRole}
                  onChange={(e) =>
                    setC({ ...c, memberRole: e.target.value as CourseRole })
                  }
                >
                  {["老师", "学生", "共同学习者"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={c.archived}
                  onChange={(e) => setC({ ...c, archived: e.target.checked })}
                />
                归档课程（取消勾选可恢复）
              </label>
            </>
          )}
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <span className="help">教学角色不赋予学院管理权限</span>
          <button className="primary-btn">保存课程</button>
        </div>
      </form>
    </Modal>
  );
}
export function CustomCourse({
  engine,
  course,
}: {
  engine: AcademyEngine;
  course: AcademyDocument;
}) {
  const [info, setInfo] = useState(false);
  const [editing, setEditing] = useState<AcademyDocument | null>(null),
    [showArchived, setShowArchived] = useState(false);
  const c = asCourse(course);
  const lessons = Object.values(engine.state.documents)
    .filter(
      (d) =>
        d.kind === "lesson" && d.course_id === course.course_id && d.payload,
    )
    .sort((a, b) => Number(a.payload!.order) - Number(b.payload!.order));
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">SHARED COURSE / 共同课程内容</span>
          <h1>{c.name}</h1>
          <p>{c.description || "简介待填写"}</p>
        </div>
        <button
          className="primary-btn"
          onClick={() =>
            setEditing(
              makeDoc("lesson", course.course_id, null, {
                title: "",
                content: "",
                task: "",
                references: "",
                date: "",
                order: lessons.length,
                archived: false,
              }),
            )
          }
        >
          新增课次 ＋
        </button>
      </div>
      <section className="course-goals">
        <button className="text-btn" onClick={() => setInfo(true)}>
          编辑共同简介与目标
        </button>
        <h2>学习目标</h2>
        <p className="preserve">{c.goals || "学习目标待共同填写。"}</p>
        <p className="help">
          课次与资料由学院成员共同维护；每人的笔记、练习和作品分别保存。
        </p>
      </section>
      <button
        className="text-btn"
        onClick={() => setShowArchived(!showArchived)}
      >
        {showArchived ? "隐藏已归档课次" : "显示已归档课次"}
      </button>
      <div className="academy-lessons">
        {lessons
          .filter((d) => showArchived || !d.payload!.archived)
          .map((d, i) => {
            const l = d.payload as unknown as Lesson;
            return (
              <article key={d.id}>
                <div className="lesson-index mono">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div>
                  <h2>{l.title}</h2>
                  <p className="help">
                    {l.date || "日期待安排"}
                    {l.archived ? " · 已归档" : ""}
                  </p>
                  <h3>学习内容</h3>
                  <p className="preserve">{l.content || "待填写"}</p>
                  <h3>练习任务</h3>
                  <p className="preserve">{l.task || "待填写"}</p>
                  <h3>参考资料</h3>
                  <p className="preserve">{l.references || "暂无"}</p>
                </div>
                <button className="text-btn" onClick={() => setEditing(d)}>
                  编辑课次
                </button>
              </article>
            );
          })}
      </div>
      {!lessons.length && (
        <div className="empty">
          <h3>尚无课次</h3>
          <p>新增第一课，或先填写课程目标。不限课次和项目数量。</p>
        </div>
      )}
      <Records engine={engine} course={course} />
      {info && (
        <CourseEditorV2
          engine={engine}
          doc={course}
          close={() => setInfo(false)}
        />
      )}
      {editing && (
        <LessonEditor
          engine={engine}
          doc={editing}
          close={() => setEditing(null)}
        />
      )}
    </>
  );
}
function LessonEditor({
  engine,
  doc,
  close,
}: {
  engine: AcademyEngine;
  doc: AcademyDocument;
  close: () => void;
}) {
  const [l, setL] = useState(doc.payload as unknown as Lesson),
    [error, setError] = useState("");
  return (
    <Modal title="课次内容 / Shared lesson" onClose={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const now = engine.state.documents[doc.id];
            if (now && !equal(now.payload, doc.payload))
              throw new Error(
                "另一设备已修改此课次。你的输入仍在表单中，请复制后重新打开比较。",
              );
            engine.edit({ ...doc, payload: l as unknown as Value });
            close();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <div className="dialog-body">
          <label className="field">
            <span>主题</span>
            <input
              required
              value={l.title}
              onChange={(e) => setL({ ...l, title: e.target.value })}
            />
          </label>
          <Field
            label="学习内容"
            value={l.content}
            onChange={(content) => setL({ ...l, content })}
          />
          <Field
            label="练习任务"
            value={l.task}
            onChange={(task) => setL({ ...l, task })}
          />
          <Field
            label="参考资料"
            value={l.references}
            onChange={(references) => setL({ ...l, references })}
          />
          <div className="form-grid">
            <label className="field">
              <span>可选日期</span>
              <input
                type="date"
                value={l.date}
                onChange={(e) => setL({ ...l, date: e.target.value })}
              />
            </label>
            <label className="field">
              <span>排序</span>
              <input
                type="number"
                value={l.order}
                onChange={(e) => setL({ ...l, order: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={l.archived}
              onChange={(e) => setL({ ...l, archived: e.target.checked })}
            />
            归档此课次（可恢复）
          </label>
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <span className="help">双方均可编辑；并发修改会保留冲突</span>
          <button className="primary-btn">保存课次</button>
        </div>
      </form>
    </Modal>
  );
}
const labels: Record<string, string> = {
  notes: "学习笔记",
  progress: "练习进度",
  status: "完成状态",
  references: "参考资料",
  idea: "创作想法",
  log: "修改记录",
  summary: "个人总结",
  stages: "期末五阶段",
  title: "标题",
  body: "学习记录",
  practice: "练习与修改",
  statement: "创作者陈述",
  listening: "聆听反馈",
  strengths: "作品优势",
  issues: "问题与音频时间位置",
  revisions: "修改方向",
  next: "下次待解决的问题",
  note: "内容说明",
  version: "作品版本",
  date: "日期",
  type: "讲评类型",
  projectId: "关联项目",
  versionId: "关联版本",
};
function authorName(engine: AcademyEngine, id: string | null) {
  return (
    engine.state.snapshot.members.find((m) => m.user_id === id)?.display_name ||
    "历史成员"
  );
}
export function Records({
  engine,
  course,
}: {
  engine: AcademyEngine;
  course: AcademyDocument;
}) {
  const [filter, setFilter] = useState("all"),
    [edit, setEdit] = useState<AcademyDocument | null>(null),
    [error, setError] = useState("");
  const docs = Object.values(engine.state.documents),
    uid = engine.state.uid,
    c = asCourse(course),
    me = engine.state.snapshot.members.find((m) => m.user_id === uid)!;
  const records = docs.filter(
    (d) =>
      d.course_id === course.course_id &&
      d.author_id &&
      d.kind !== "feedback" &&
      d.payload &&
      (filter === "all" ||
        (filter === "mine" && d.author_id === uid) ||
        (filter === "others" && d.author_id !== uid)),
  );
  const lessons = docs.filter(
    (d) =>
      d.course_id === course.course_id &&
      d.kind === "lesson" &&
      d.payload &&
      !d.payload.archived,
  );
  return (
    <section className="learning-records">
      <div className="section-head">
        <div>
          <span className="eyebrow">LEARNING RECORDS / SIGNED BY AUTHOR</span>
          <h2>{c.name} · 学习记录与作品</h2>
        </div>
        <button
          className="primary-btn"
          onClick={() =>
            setEdit(
              makeDoc("note", course.course_id, uid, {
                title: "",
                body: "",
                practice: "",
                status: "未开始",
                lessonId: "",
                projectId: "",
                purpose: roleFor(c, me) === "老师" ? "teaching" : "learning",
              }),
            )
          }
        >
          添加我的记录 / 作品
        </button>
      </div>
      <div className="learner-progress">
        {engine.state.snapshot.members.map((m) => {
          const role = roleFor(c, m);
          const completed = completedLessons(docs, course.course_id, m.user_id);
          return (
            <div key={m.user_id}>
              <strong>
                {m.display_name}
                {!m.active ? "（已离院）" : ""}
              </strong>
              <span>{role}</span>
              <p>
                {role === "老师"
                  ? "教学任务：备课与反馈，不计算学生作业进度"
                  : `${completed.length} / ${lessons.length} 课次已完成`}
              </p>
            </div>
          );
        })}
      </div>
      <div className="cloud-actions" role="group" aria-label="学习记录作者筛选">
        {[
          ["all", "全部"],
          ["mine", "我的"],
          ["others", "对方的"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={filter === v ? "primary-btn" : "secondary-btn"}
            onClick={() => setFilter(v)}
          >
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      <div className="shared-records">
        {records.map((d) => {
          const p = d.payload!;
          const relation = String(
            (p.lessonId
              ? engine.state.documents[String(p.lessonId)]?.payload?.title ||
                engine.state.documents[String(p.lessonId)]?.payload?.topic ||
                "关联课次已归档或移除"
              : "") ||
              p.projectId ||
              (["week", "process"].includes(d.kind)
                ? d.id.split("/").at(-1)
                : ""),
          );
          const audioVersion =
            d.kind === "critique" && p.versionId
              ? docs.find(
                  (a) =>
                    a.kind === "artifact" &&
                    a.course_id === d.course_id &&
                    a.author_id === d.author_id &&
                    a.payload?.id === p.versionId,
                )
              : undefined;
          const feedback = docs.filter(
            (f) => f.kind === "feedback" && f.payload?.targetId === d.id,
          );
          return (
            <article key={d.id}>
              <div className="record-signature">
                <span className="eyebrow">
                  {authorName(engine, d.author_id)} /{" "}
                  {d.author_id === uid ? "我的" : "对方的"} /{" "}
                  {d.kind === "week"
                    ? "课次学习"
                    : d.kind === "process"
                      ? "项目过程"
                      : d.kind === "critique"
                        ? "作品讲评"
                        : d.kind === "artifact"
                          ? "作品档案"
                          : p.purpose === "teaching"
                            ? "备课与教学"
                            : "学习与练习"}
                </span>
                <span className="help">{relation}</span>
              </div>
              <h3>{String(p.title || p.version || relation || "学习记录")}</h3>
              {[
                "notes",
                "progress",
                "idea",
                "log",
                "summary",
                "body",
                "practice",
                "statement",
                "listening",
                "strengths",
                "issues",
                "revisions",
                "next",
                "note",
              ]
                .filter((k) => p[k])
                .map((k) => (
                  <div className="record-text" key={k}>
                    <span>{labels[k]}</span>
                    <p className="preserve">{String(p[k])}</p>
                  </div>
                ))}
              {!!p.status && (
                <p>{p.status === "待评图" ? "待作品讲评" : String(p.status)}</p>
              )}
              {Array.isArray(p.stages) && (
                <p>
                  期末阶段：
                  {p.stages
                    .map((x, i) => `${i + 1}${x ? " 已完成" : " 未完成"}`)
                    .join(" · ")}
                </p>
              )}
              {!!(p.fileId || p.url) && (
                <AudioPlayer artifact={p as unknown as Artifact} />
              )}
              {audioVersion?.payload && (
                <div className="record-text">
                  <span>
                    关联试听版本：{String(audioVersion.payload.title || "作品")}{" "}
                    / {String(audioVersion.payload.version || "")}
                  </span>
                  <AudioPlayer
                    artifact={audioVersion.payload as unknown as Artifact}
                  />
                </div>
              )}
              <div className="cloud-actions">
                {d.author_id === uid && (
                  <>
                    <button className="text-btn" onClick={() => setEdit(d)}>
                      编辑我的记录
                    </button>
                    {!["week", "process"].includes(d.kind) && (
                      <button
                        className="text-btn"
                        onClick={() => {
                          if (confirm("移除此记录？云端历史与音频原文件保留。"))
                            try {
                              engine.edit({ ...d, payload: null });
                            } catch (e) {
                              setError((e as Error).message);
                            }
                        }}
                      >
                        移除记录
                      </button>
                    )}
                  </>
                )}
              </div>
              <div className="record-feedback">
                <h4>留言反馈</h4>
                {feedback.map((f) => (
                  <div className="feedback-item" key={f.id}>
                    <b>{authorName(engine, f.author_id)}</b>
                    <p className="preserve">{String(f.payload!.body)}</p>
                    {f.author_id === uid && (
                      <div className="cloud-actions">
                        <button className="text-btn" onClick={() => setEdit(f)}>
                          编辑留言
                        </button>
                        <button
                          className="text-btn"
                          onClick={() => engine.edit({ ...f, payload: null })}
                        >
                          删除留言
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <FeedbackForm engine={engine} target={d} />
              </div>
            </article>
          );
        })}
      </div>
      {!records.length && (
        <div className="empty">
          <h3>暂无学习记录</h3>
          <p>从自己的笔记或第一份试听作品开始，对方的记录会独立保存。</p>
        </div>
      )}
      {edit && (
        <RecordEditor
          engine={engine}
          doc={edit}
          lessons={lessons}
          close={() => setEdit(null)}
        />
      )}
    </section>
  );
}
function FeedbackForm({
  engine,
  target,
}: {
  engine: AcademyEngine;
  target: AcademyDocument;
}) {
  const [body, setBody] = useState(""),
    [error, setError] = useState("");
  return (
    <form
      className="feedback-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          engine.edit(
            makeDoc("feedback", target.course_id, engine.state.uid, {
              body,
              targetId: target.id,
            }),
          );
          setBody("");
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <label className="field">
        <span>以本人身份添加反馈</span>
        <textarea
          required
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="具体观察、音频位置与修改建议"
        />
      </label>
      <button className="secondary-btn">保存留言</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function RecordEditor({
  engine,
  doc,
  lessons,
  close,
}: {
  engine: AcademyEngine;
  doc: AcademyDocument;
  lessons: AcademyDocument[];
  close: () => void;
}) {
  const [p, setP] = useState(doc.payload!),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [known, setKnown] = useState(doc.payload),
    [saved, setSaved] = useState(false);
  const check = () => {
    const now = engine.state.documents[doc.id];
    if (now && !equal(now.payload, known))
      throw new Error(
        "此记录已在另一设备更新；草稿保留，请复制后重新打开比较。",
      );
  };
  const patch = (key: string, value: unknown) => {
    const next = { ...p, [key]: value };
    setP(next);
    if (engine.state.documents[doc.id] || saved) {
      try {
        check();
        engine.edit({ ...doc, payload: next });
        setKnown(next);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  };
  const fields =
    doc.kind === "week"
      ? ["notes", "progress", "references"]
      : doc.kind === "process"
        ? ["idea", "log", "summary"]
        : doc.kind === "critique"
          ? [
              "statement",
              "listening",
              "strengths",
              "issues",
              "revisions",
              "next",
            ]
          : doc.kind === "feedback"
            ? ["body"]
            : doc.kind === "artifact"
              ? ["title", "version", "note"]
              : ["title", "body", "practice"];
  return (
    <Modal
      title="我的记录 / Personal record"
      onClose={() => {
        if (!busy) close();
      }}
      wide
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            check();
            let next = { ...p };
            if (file) {
              checkAudio(file, file.name);
              const id = crypto.randomUUID();
              await audioStore("put", id, file);
              next = {
                ...next,
                fileId: id,
                fileName: file.name,
                mime: file.type,
              };
              delete next.remotePath;
              delete next.fileHash;
              delete next.fileSize;
            }
            check();
            engine.edit({ ...doc, payload: next });
            setKnown(next);
            setSaved(true);
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="dialog-body">
          <p className="help">
            作者：{authorName(engine, doc.author_id)}
            。已有记录的文字修改自动保存；新增记录与替换音频请点击保存。
          </p>
          {doc.kind === "note" && (
            <>
              <div className="form-grid">
                <label className="field">
                  <span>记录用途</span>
                  <select
                    value={String(p.purpose)}
                    onChange={(e) => patch("purpose", e.target.value)}
                  >
                    <option value="learning">学习 / 作业</option>
                    <option value="teaching">备课 / 教学</option>
                  </select>
                </label>
                <label className="field">
                  <span>可选课次关联</span>
                  <select
                    value={String(p.lessonId || "")}
                    onChange={(e) => patch("lessonId", e.target.value)}
                  >
                    <option value="">课程整体</option>
                    {lessons.map((l) => (
                      <option value={l.id} key={l.id}>
                        {String(l.payload!.title || l.payload!.topic)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {doc.course_id === "electronic" && (
                <label className="field">
                  <span>可选项目关联</span>
                  <select
                    value={String(p.projectId || "")}
                    onChange={(e) => patch("projectId", e.target.value)}
                  >
                    <option value="">不关联项目</option>
                    {["P00", "P01", "P02", "P03", "P04"].map((id) => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          {fields.map((k) => (
            <Field
              key={k}
              label={labels[k] || k}
              value={String(p[k] || "")}
              onChange={(v) => patch(k, v)}
              rows={k === "title" ? 1 : 4}
            />
          ))}
          {["week", "process", "note"].includes(doc.kind) && (
            <label className="field">
              <span>状态</span>
              <select
                value={String(p.status || "未开始")}
                onChange={(e) => patch("status", e.target.value)}
              >
                {["未开始", "进行中", "待评图", "已完成"].map((s) => (
                  <option key={s} value={s}>
                    {s === "待评图" ? "待作品讲评" : s}
                  </option>
                ))}
              </select>
            </label>
          )}
          {Array.isArray(p.stages) && (
            <div>
              {p.stages.map((v, i) => (
                <label key={i} className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={!!v}
                    onChange={(e) =>
                      patch(
                        "stages",
                        (p.stages as boolean[]).map((x, j) =>
                          i === j ? e.target.checked : x,
                        ),
                      )
                    }
                  />
                  期末阶段 {i + 1}
                </label>
              ))}
            </div>
          )}
          {["note", "artifact"].includes(doc.kind) && (
            <>
              <label className="file-drop field">
                <span>上传 / 更换试听作品 · MP3 / M4A ≤45 MB</span>
                <input
                  type="file"
                  accept="audio/*,.m4a"
                  onChange={(e) => setFile(e.target.files?.[0])}
                />
                <small>
                  {file?.name || String(p.fileName || "无音频文件")}
                </small>
              </label>
              {!!p.fileId && (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    const next = { ...p };
                    for (const key of [
                      "fileId",
                      "fileName",
                      "mime",
                      "remotePath",
                      "fileHash",
                      "fileSize",
                    ])
                      delete next[key];
                    setP(next);
                    setFile(undefined);
                  }}
                >
                  移除音频关联（保存后生效，原文件保留）
                </button>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="warning">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-foot">
          <span className="help">仅本人可编辑；所有成员可查看和留言</span>
          <button disabled={busy} className="primary-btn">
            {busy ? "保存中…" : "保存记录"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function MemberPanel({ engine }: { engine: AcademyEngine }) {
  const [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      await job();
      await engine.sync();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      await engine.sync();
      setBusy(false);
    }
  };
  const send = async (address: string) => {
    const { data, error } = await supabase!.functions.invoke("academy-invite", {
      body: { academyId: engine.state.academyId, email: address },
    });
    if (error) {
      let detail = error.message;
      try {
        const body = await error.context?.json();
        detail = body?.error || detail;
      } catch {
        /* use HTTP error */
      }
      throw new Error(detail);
    }
    if (!data?.sent)
      throw new Error("未确认邮件发送，请检查服务端日志和邀请状态");
    setMessage("邮件服务已接受发送，请对方检查收件箱；此提示不代表已经加入。");
  };
  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ACADEMY MEMBERS / INVITATION ONLY</span>
          <h1>学院成员与邀请</h1>
          <p>邀请加入本学院。课程角色与学院管理权限分别设置。</p>
        </div>
      </div>
      <form
        className="invite-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => send(email));
        }}
      >
        <label className="field">
          <span>朋友的邮箱</span>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button disabled={busy} className="primary-btn">
          发送学院邀请
        </button>
      </form>
      {message && (
        <p role="status" className="warning">
          {message}
        </p>
      )}
      <section>
        <h2>成员</h2>
        {engine.state.snapshot.members.map((m) => (
          <div className="recovery-row" key={m.user_id}>
            <div>
              <strong>{m.display_name}</strong>
              <p>
                {m.role === "admin" ? "学院管理员" : "学院成员"} ·{" "}
                {m.active ? "已加入" : "已移除（历史记录保留）"}
              </p>
            </div>
            {m.active && m.role !== "admin" && (
              <button
                disabled={busy}
                className="text-btn"
                onClick={() => {
                  if (
                    confirm(
                      "移除此成员？现有登录会话也将失去服务器访问权限，历史作品与署名保留。",
                    )
                  )
                    void run(() =>
                      academyRPC("academy_remove_member", {
                        p_academy: engine.state.academyId,
                        p_user: m.user_id,
                      }),
                    );
                }}
              >
                移除成员
              </button>
            )}
          </div>
        ))}
      </section>
      <section className="invitation-list">
        <h2>邀请状态</h2>
        {engine.state.snapshot.invitations.map((i) => (
          <div className="recovery-row" key={i.id}>
            <div>
              <b>{i.email}</b>
              <p>
                {i.status === "accepted"
                  ? "已接受"
                  : i.status === "revoked"
                    ? "已撤销"
                    : new Date(i.expires_at) < new Date()
                      ? "已过期"
                      : i.status === "failed"
                        ? "发送失败"
                        : i.status === "sending"
                          ? "正在发送"
                          : "待接受"}{" "}
                · 有效期至 {new Date(i.expires_at).toLocaleString("zh-CN")}
              </p>
              {i.error && <p role="alert">{i.error}</p>}
            </div>
            {!["accepted", "revoked"].includes(i.status) && (
              <div className="cloud-actions">
                <button
                  disabled={busy}
                  className="text-btn"
                  onClick={() => void run(() => send(i.email))}
                >
                  重发
                </button>
                <button
                  disabled={busy}
                  className="text-btn"
                  onClick={() =>
                    void run(() =>
                      academyRPC("academy_revoke_invitation", {
                        p_academy: engine.state.academyId,
                        p_id: i.id,
                      }),
                    )
                  }
                >
                  撤销邀请
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
function AcademySync({
  engine,
  close,
}: {
  engine: AcademyEngine;
  close: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [merged, setMerged] = useState<Record<string, string>>({}),
    [history, setHistory] = useState<AcademyDocument[]>([]);
  const [restoreShared, setRestoreShared] = useState(false);
  const [snapshots, setSnapshots] = useState<
    Awaited<ReturnType<typeof academyRecoveryList>>
  >([]);
  const run = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const legacyRaw =
    localStorage.getItem(`wing-sound-sync:v1:${engine.state.uid}`) ||
    localStorage.getItem("wing-sound-academy:v1");
  return (
    <Modal
      title="学院同步、冲突与备份"
      wide
      onClose={() => {
        if (!busy) close();
      }}
    >
      <div className="dialog-body cloud-panel">
        <div className="sync-summary" role="status">
          <strong>{engine.status}</strong>
          <span>
            {pendingDocuments(engine.state).length} 条待同步 ·{" "}
            {Object.keys(engine.state.conflicts).length} 条冲突
          </span>
          <span>
            {engine.state.verifiedAt
              ? new Date(engine.state.verifiedAt).toLocaleString("zh-CN")
              : ""}
          </span>
        </div>
        <p>
          课程、课次和个人记录分别保存，断网修改先保留本机。另一设备修改同一条内容时保留两个版本；成员被移除后服务器拒绝访问。
        </p>
        {engine.uploading && (
          <p role="status">上传并校验：{engine.uploading}</p>
        )}
        {(engine.error || error) && (
          <p className="warning" role="alert">
            {error || engine.error}
          </p>
        )}
        <div className="cloud-actions">
          <button
            disabled={busy}
            className="primary-btn"
            onClick={() => void run(() => engine.sync())}
          >
            同步 / 重试
          </button>
          <button
            disabled={busy}
            className="secondary-btn"
            onClick={() =>
              void run(async () =>
                downloadJSON(
                  await engine.exportBackup(),
                  "wing-academy-complete.json",
                ),
              )
            }
          >
            导出学院完整备份
          </button>
          <button
            disabled={busy}
            className="secondary-btn"
            onClick={() =>
              void run(async () =>
                downloadJSON(
                  await engine.exportLegacy(),
                  "wing-electronic-personal.json",
                ),
              )
            }
          >
            导出我的电子音乐旧格式备份
          </button>
          <button
            className="text-btn"
            onClick={() =>
              downloadJSON(engine.state, "wing-academy-cache-recovery.json")
            }
          >
            导出同步原文
          </button>
        </div>
        {engine.state.snapshot.members.find(
          (m) => m.user_id === engine.state.uid,
        )?.role === "admin" && (
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={restoreShared}
              onChange={(e) => setRestoreShared(e.target.checked)}
            />
            导入学院备份时，同时恢复自定义课程框架（公共内容差异进入比较）
          </label>
        )}
        <label className="field">
          <span>导入完整备份（先保存恢复快照）</span>
          <input
            disabled={busy}
            type="file"
            accept=".json"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (
                file &&
                confirm(
                  "仅恢复本人记录；不同内容进入冲突比较，不替换对方记录。学院备份的公共课程不会自动覆盖。是否继续？",
                )
              )
                void run(() =>
                  file
                    .text()
                    .then((raw) => engine.importRaw(raw, restoreShared)),
                );
            }}
          />
        </label>
        {legacyRaw &&
          !engine.state.legacyImported &&
          engine.state.snapshot.members.find(
            (m) => m.user_id === engine.state.uid,
          )?.role === "admin" && (
            <section>
              <h3>检测到旧版本机数据</h3>
              <p>
                云端已迁移的数据保持原作者。若此浏览器还有未同步的旧笔记，可在快照后比较并导入；差异不会自动覆盖云端。新成员无需导入旧管理员数据。
              </p>
              <button
                disabled={busy}
                className="secondary-btn"
                onClick={() =>
                  void run(async () => {
                    const old = JSON.parse(legacyRaw);
                    await engine.importElectronic(
                      old.data ? old.data : repository.load(),
                    );
                  })
                }
              >
                比较导入本机旧电子音乐记录
              </button>
            </section>
          )}
        {Object.entries(engine.state.conflicts).map(([id, c]) => (
          <section className="conflict-card" key={id}>
            <h3>
              {String(c.local.payload?.title || c.local.payload?.topic || id)} /
              冲突
            </h3>
            <p>云端版本 {c.remote.revision}。操作前保留本机恢复快照。</p>
            <div className="academy-conflict">
              <div>
                <b>本机版本</b>
                <pre>{JSON.stringify(c.local.payload, null, 2)}</pre>
              </div>
              <div>
                <b>云端版本</b>
                <pre>{JSON.stringify(c.remote.payload, null, 2)}</pre>
              </div>
            </div>
            <div className="cloud-actions">
              <button
                disabled={busy}
                className="secondary-btn"
                onClick={() => void run(() => engine.resolve(id, "local"))}
              >
                保留本机
              </button>
              <button
                disabled={busy}
                className="secondary-btn"
                onClick={() => void run(() => engine.resolve(id, "remote"))}
              >
                使用云端
              </button>
              <button
                className="text-btn"
                onClick={() => downloadJSON(c, "wing-academy-conflict.json")}
              >
                下载两个版本
              </button>
            </div>
            <details>
              <summary>手动合并</summary>
              <textarea
                rows={8}
                value={merged[id] ?? JSON.stringify(c.local.payload, null, 2)}
                onChange={(e) => setMerged({ ...merged, [id]: e.target.value })}
              />
              <button
                disabled={busy}
                className="secondary-btn"
                onClick={() =>
                  void run(() =>
                    engine.resolve(
                      id,
                      "local",
                      JSON.parse(merged[id] ?? JSON.stringify(c.local.payload)),
                    ),
                  )
                }
              >
                保存合并结果
              </button>
            </details>
          </section>
        ))}
        <section>
          <h3>云端历史</h3>
          <button
            disabled={busy}
            className="secondary-btn"
            onClick={() =>
              void run(async () => {
                const { data, error } = await supabase!
                  .from("academy_history")
                  .select("*")
                  .eq("academy_id", engine.state.academyId)
                  .order("updated_at", { ascending: false })
                  .limit(100);
                if (error) throw error;
                setHistory(data as AcademyDocument[]);
              })
            }
          >
            读取最近100个版本
          </button>
          {history.map((d) => (
            <div className="recovery-row" key={d.id + ":" + d.revision}>
              <span>
                {d.kind} / {authorName(engine, d.author_id)} / 版本{d.revision}
              </span>
              <button
                className="text-btn"
                onClick={() => downloadJSON(d, "academy-history.json")}
              >
                下载原文
              </button>
              {d.author_id === engine.state.uid && (
                <button
                  disabled={busy}
                  className="text-btn"
                  onClick={() => {
                    if (
                      confirm(
                        "恢复此历史个人记录？先保存当前快照，再加入版本检查队列。",
                      )
                    )
                      void run(async () => {
                        await engine.snapshot("恢复历史记录前");
                        engine.edit(d);
                      });
                  }}
                >
                  恢复本人版本
                </button>
              )}
            </div>
          ))}
        </section>
        <PrivateFiles engine={engine} />
        <section>
          <h3>本机恢复快照</h3>
          <button
            className="secondary-btn"
            onClick={() =>
              void run(async () =>
                setSnapshots(
                  await academyRecoveryList(
                    engine.state.uid,
                    engine.state.academyId,
                  ),
                ),
              )
            }
          >
            读取迁移与操作前快照
          </button>
          {snapshots.map((s, i) => (
            <div className="recovery-row" key={i}>
              <div>
                <b>{s.reason}</b>
                <p>{new Date(s.at).toLocaleString("zh-CN")}</p>
              </div>
              <button
                className="text-btn"
                onClick={() =>
                  downloadJSON(s, "wing-academy-local-snapshot.json")
                }
              >
                下载原文
              </button>
              {"documents" in s.state && (
                <button
                  className="text-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const snapshotEngine = new AcademyEngine(
                        s.state as AcademyCache,
                        engine.transport,
                        () => {},
                      );
                      downloadJSON(
                        await snapshotEngine.exportBackup(),
                        "wing-academy-snapshot-complete.json",
                      );
                    })
                  }
                >
                  导出此快照完整备份
                </button>
              )}
            </div>
          ))}
        </section>
        <p className="help">
          完整 JSON 含私人音频与双方记录，妥善保管。恢复快照在 IndexedDB
          wing-academy-recovery 中；原 localStorage 和 IndexedDB
          音频不会自动删除。导入旧备份只恢复本人的学习内容，固定大纲保持不变。
        </p>
      </div>
    </Modal>
  );
}

function PrivateFiles({ engine }: { engine: AcademyEngine }) {
  const [files, setFiles] = useState<{ path: string; course_id: string }[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const referenced = (path: string) =>
    Object.values(engine.state.documents).some(
      (d) => d.payload?.remotePath === path,
    );
  return (
    <section>
      <h3>我的私有音频文件</h3>
      <p className="help">
        更换文件与删除记录不会自动删除原音频。永久删除会影响历史版本的试听，请先导出完整备份。其他成员的文件不能在这里删除。
      </p>
      <button
        className="secondary-btn"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const { data, error } = await supabase!
              .from("academy_files")
              .select("path,course_id")
              .eq("academy_id", engine.state.academyId)
              .eq("author_id", engine.state.uid)
              .limit(1000);
            if (error) throw error;
            setFiles(data || []);
          })
        }
      >
        读取我的文件（最多1000项）
      </button>
      {error && (
        <p role="alert" className="warning">
          {error}
        </p>
      )}
      {files.map((f) => (
        <div className="recovery-row" key={f.path}>
          <span style={{ overflowWrap: "anywhere" }}>
            {asCourse(engine.state.documents["course/" + f.course_id]).name} /{" "}
            {f.path.split("/").at(-1)} ·{" "}
            {referenced(f.path) ? "当前使用" : "当前未引用或已删除"}
          </span>
          <button
            disabled={busy}
            className="text-btn"
            onClick={() =>
              void run(async () => {
                const { data, error } = await supabase!.storage
                  .from(BUCKET)
                  .download(f.path);
                if (error) throw error;
                const url = URL.createObjectURL(data),
                  a = document.createElement("a");
                a.href = url;
                a.download = f.path.split("/").at(-1) || "audio";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 10000);
              })
            }
          >
            下载原文件
          </button>
          {!referenced(f.path) && (
            <button
              disabled={busy}
              className="text-btn"
              onClick={() => {
                if (
                  confirm(
                    "永久删除此云音频？历史与备份中引用的云文件也将无法下载。请先确认其他设备已同步，并保存完整备份。",
                  )
                )
                  void run(async () => {
                    const { data, error } = await supabase!.storage
                      .from(BUCKET)
                      .remove([f.path]);
                    if (error) throw error;
                    if (!data?.some((d) => d.name === f.path))
                      throw new Error(
                        "未删除文件：可能仍被云端记录引用、权限已变更，或文件已不存在。请先同步再检查。",
                      );
                    setFiles(files.filter((x) => x.path !== f.path));
                  });
              }}
            >
              永久删除云文件
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
