import { ProjectArtwork, StudioArtwork, projectAccent } from "./artwork";
import { teachingLabel, isReviewEvent, statusLabel } from "./labels";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  SlidersHorizontal,
  Menu,
  Trash2,
  FileAudio,
  Link2,
  FileText,
  HardDrive,
  ExternalLink,
  Pencil,
  Check,
} from "lucide-react";
import type { AcademyData, Artifact, Project, Session } from "./types";
import type { ReactNode } from "react";
import type { SyncEngine } from "./sync-engine";
import { formatDate, localDate, safeUrl, semesterClock } from "./domain";
import {
  Tag,
  Empty,
  StatusSelect,
  SectionHead,
  AudioPlayer,
  PageTitle,
  go,
} from "./ui";
import {
  FilterBar,
  Schedule,
  WeekDetail,
  ProjectDetail,
  Syllabus,
} from "./pages";
import {
  CritEditor,
  ArtifactEditor,
  BackupDialog,
  CourseEditor,
} from "./editors";
const navs = [
  ["overview", "总览", "Overview"],
  ["schedule", "学期课表", "Schedule"],
  ["projects", "创作项目", "Projects"],
  ["critique", "作品讲评", "Reviews"],
  ["archive", "创作档案", "Archive"],
  ["syllabus", "课程大纲", "Syllabus"],
];
type Route = { page: string; id?: string };
const routeFromHash = (): Route => {
  const [page, id] = location.hash.slice(1).split("/");
  return {
    page:
      navs.some((n) => n[0] === page) || page === "week" || page === "project"
        ? page
        : "overview",
    id,
  };
};
export default function App({
  engine,
  syncTools,
}: {
  engine: SyncEngine;
  syncTools: ReactNode;
}) {
  const [loadError, setLoadError] = useState("");
  const data = engine.state.data;
  const setData = (change: AcademyData | ((d: AcademyData) => AcademyData)) => {
    try {
      engine.edit(change);
      setSaveError("");
    } catch (e) {
      setSaveError((e as Error).message);
    }
  };
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [saveError, setSaveError] = useState("");
  const [toast, setToast] = useState("");
  const [menu, setMenu] = useState(false);
  const [critFilter, setCritFilter] = useState("");
  const [archiveFilter, setArchiveFilter] = useState("");
  const [modal, setModal] = useState<
    "backup" | "artifact" | "crit" | "course" | null
  >(null);
  const [editCrit, setEditCrit] = useState<string | undefined>();
  const [editArtifact, setEditArtifact] = useState<string | undefined>();
  const [context, setContext] = useState("P00");
  const [artifactKind, setArtifactKind] =
    useState<Artifact["kind"]>("音频版本");
  const [today, setToday] = useState(localDate());
  useEffect(() => {
    const f = () => {
      setRoute(routeFromHash());
      setMenu(false);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(localDate()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const clock = semesterClock(data.sessions, today);
  const activeProject =
    data.projects.find(
      (p) => p.id === (clock.current?.projectId || clock.next?.projectId),
    ) || data.projects[4];
  const sessionUpdate = (id: string, patch: Partial<Session>) =>
    setData((d) => ({
      ...d,
      sessions: d.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  const projectUpdate = (id: string, patch: Partial<Project>) =>
    setData((d) => ({
      ...d,
      projects: d.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const openCrit = (projectId: string, id?: string) => {
    setContext(projectId);
    setEditCrit(id);
    setModal("crit");
  };
  const openArtifact = (
    projectId: string,
    id?: string,
    kind: Artifact["kind"] = "音频版本",
  ) => {
    setContext(projectId);
    setEditArtifact(id);
    setArtifactKind(kind);
    setModal("artifact");
  };
  const upcoming = data.sessions
    .filter((s) => s.date >= today && isReviewEvent(s.event))
    .slice(0, 3);
  const completed = data.sessions.filter((s) => s.status === "已完成").length;
  const projectRange = (p: Project) => {
    const ss = data.sessions
      .filter((s) => s.projectId === p.id)
      .sort((a, b) => a.date.localeCompare(b.date));
    return ss.length
      ? `${formatDate(ss[0].date, { day: "2-digit", month: "short" })} — ${formatDate(ss.at(-1)!.date)}`
      : "";
  };
  const removeCrit = (id: string) => {
    if (confirm("删除这条作品讲评记录？此操作可通过已有备份恢复。")) {
      setData((d) => ({
        ...d,
        critiques: d.critiques.filter((c) => c.id !== id),
      }));
      setToast("作品讲评记录已删除");
    }
  };
  const removeArtifact = async (a: Artifact) => {
    if (
      !confirm("移除这份档案？关联讲评保留，版本关联清除。原音频暂保留供恢复。")
    )
      return;
    setData((d) => ({
      ...d,
      artifacts: d.artifacts.filter((v) => v.id !== a.id),
      critiques: d.critiques.map((c) =>
        c.versionId === a.id ? { ...c, versionId: "" } : c,
      ),
    }));
    setToast("档案已移除；原音频保留供备份和恢复，云文件可在同步管理中清理。");
  };
  function critList(projectId?: string) {
    const cs = data.critiques
      .filter((c) => !projectId || c.projectId === projectId)
      .sort((a, b) => b.date.localeCompare(a.date));
    return cs.length ? (
      <div className="crit-list">
        {cs.map((c) => (
          <article key={c.id} className="crit-row">
            <div className="mono crit-date">
              {formatDate(c.date)}
              <span>{c.projectId}</span>
            </div>
            <button
              className="crit-content"
              onClick={() => openCrit(c.projectId, c.id)}
            >
              <h3>
                {teachingLabel(c.type)}
                <ArrowUpRight size={18} />
              </h3>
              <p>{c.statement || "尚未填写创作者陈述"}</p>
              <span className="help">
                {data.artifacts.find((a) => a.id === c.versionId)?.title ||
                  "未关联作品版本"}
              </span>
            </button>
            <Tag tone={c.completed ? "done" : ""}>
              {c.completed ? "作品讲评完成" : "待整理"}
            </Tag>
            <button
              className="icon-btn"
              aria-label="删除作品讲评"
              onClick={() => removeCrit(c.id)}
            >
              <Trash2 size={16} />
            </button>
          </article>
        ))}
      </div>
    ) : (
      <Empty
        code="REVIEWS / 00"
        title="尚无作品讲评记录"
        text="从一次作品聆听开始，记录具体问题与下一步修改。"
        action={
          <button
            className="text-btn"
            onClick={() => openCrit(projectId || context)}
          >
            添加作品讲评 <Plus size={15} />
          </button>
        }
      />
    );
  }
  function artifactList(items: Artifact[], projectId?: string) {
    return items.length ? (
      <div className="artifact-grid">
        {items.map((a) => (
          <article
            key={a.id}
            className="artifact"
            data-project={a.projectId}
            style={projectAccent(a.projectId)}
          >
            {a.kind === "音频版本" && (
              <div className="artifact-cover">
                <ProjectArtwork id={a.projectId} decorative />
                <span className="mono">{a.projectId} / 项目视觉</span>
              </div>
            )}
            <div className="artifact-top">
              <span className="mono">
                {a.projectId} / {a.kind}
              </span>
              <div>
                <button
                  className="icon-btn"
                  aria-label={`编辑 ${a.title}`}
                  onClick={() => openArtifact(a.projectId, a.id)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-btn"
                  aria-label={`删除 ${a.title}`}
                  onClick={() => void removeArtifact(a)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
            <div className="artifact-mark">
              {a.kind === "音频版本" ? (
                <FileAudio size={28} />
              ) : a.kind === "参考音乐" ? (
                <Link2 size={28} />
              ) : (
                <FileText size={28} />
              )}
              <span className="mono">
                {a.version || "DOCUMENT"}
                {a.final ? " / FINAL" : ""}
              </span>
            </div>
            <h3>{a.title}</h3>
            <p className="preserve">{a.note || "未添加说明"}</p>
            {a.kind === "音频版本" && (
              <div className="artifact-player">
                <span className="eyebrow">AUDIO / 作品试听</span>
                <AudioPlayer artifact={a} />
              </div>
            )}
            {a.url && (
              <a
                className="text-btn"
                href={safeUrl(a.url)}
                target="_blank"
                rel="noreferrer"
              >
                打开作品链接 <ExternalLink size={13} />
              </a>
            )}
            <div className="artifact-foot">
              <span>
                {a.fileId
                  ? `${engine.uploading === (a.fileName || a.title) ? "上传与校验中…" : a.remotePath ? "私有云音频" : "待上传音频"} · ${a.fileName}`
                  : a.url
                    ? "外部链接"
                    : "本地文字记录"}
              </span>
              <span>{formatDate(a.createdAt.slice(0, 10))}</span>
            </div>
            {engine.audioErrors[a.id] && (
              <p className="warning" role="alert">
                {engine.audioErrors[a.id]}{" "}
                <button className="text-btn" onClick={() => void engine.sync()}>
                  重试上传
                </button>
              </p>
            )}
          </article>
        ))}
      </div>
    ) : (
      <Empty
        code="ARCHIVE / 00"
        title="档案从第一份作品开始"
        text="添加音频版本、创作笔记、声音素材或参考音乐。所有个人记录初始为空。"
        action={
          <button
            className="text-btn"
            onClick={() => openArtifact(projectId || context)}
          >
            添加档案 <Plus size={15} />
          </button>
        }
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="header">
        <a
          href="#overview"
          className="brand"
          aria-label="WING SOUND ACADEMY 首页"
        >
          <span className="brand-symbol">
            <i />
            <i />
            <i />
          </span>
          <span>
            WING SOUND
            <br />
            ACADEMY<span className="brand-reg">®</span>
          </span>
        </a>
        <nav className={menu ? "nav open" : "nav"} aria-label="主导航">
          {navs.map(([page, cn, en]) => (
            <a
              key={page}
              className={
                route.page === page ||
                (route.page === "week" && page === "schedule") ||
                (route.page === "project" && page === "projects")
                  ? "active"
                  : ""
              }
              href={`#${page}`}
            >
              <span>{cn}</span>
              <small>{en}</small>
            </a>
          ))}
        </nav>
        {syncTools}
        <button
          className="header-tool"
          onClick={() => setModal("backup")}
          aria-label="数据与备份"
        >
          <SlidersHorizontal size={17} />
          <span>数据管理</span>
        </button>
        <button
          className="mobile-menu icon-btn"
          onClick={() => setMenu(!menu)}
          aria-label="展开导航"
        >
          <Menu />
        </button>
      </header>
      <div className="semester-bar">
        <span className="mono">
          {data.semester.code} <span className="bar-separator">/</span>{" "}
          {data.semester.year}
        </span>
        <span>
          <i className="tiny-blue" />{" "}
          {clock.phase === "before"
            ? "学期即将开始"
            : clock.phase === "after"
              ? "学期课程已结束"
              : `教学周 ${clock.current?.id || "—"}`}
          <span className="desktop-only"> · {data.semester.name}</span>
        </span>
        <span className="mono bar-right">
          CLOUD STUDIO <HardDrive size={12} />
        </span>
      </div>
      {(loadError || saveError) && (
        <div role="alert" className="error-banner">
          {loadError || saveError}
          <button className="text-btn" onClick={() => setModal("backup")}>
            管理备份 <ArrowRight size={14} />
          </button>
        </div>
      )}
      <main id="main">
        {route.page === "overview" && (
          <>
            <section className="hero">
              <div className="hero-main">
                <div className="eyebrow">
                  <i className="tiny-blue" /> DEPARTMENT OF ELECTRONIC MUSIC{" "}
                  <span>个人音乐学院 / 数字教务平台</span>
                </div>
                <h1>
                  WING SOUND
                  <br />
                  ACADEMY<span className="hero-period">.</span>
                </h1>
                <div className="hero-bottom">
                  <div>
                    <span className="mono blue">{data.semester.code} —</span>
                    <h2>{data.semester.title}</h2>
                    <p>电子音乐创作实验室</p>
                  </div>
                  <button
                    className="round-arrow"
                    onClick={() => go("syllabus")}
                    aria-label="查看课程大纲"
                  >
                    <ArrowUpRight size={28} />
                  </button>
                </div>
              </div>
              <StudioArtwork />
            </section>
            <div className="overview-top">
              <section className="next-session">
                <div className="eyebrow">
                  01 / NEXT SESSION <span>下次课程</span>
                </div>
                {clock.next ? (
                  <>
                    <div className="next-date">
                      <span>
                        {formatDate(clock.next.date, { day: "2-digit" })}
                      </span>
                      <div className="mono">
                        {formatDate(clock.next.date, {
                          month: "short",
                          year: "numeric",
                        }).toUpperCase()}
                        <small>星期日 · 时间待定</small>
                      </div>
                      <span className="next-week mono">{clock.next.id}</span>
                    </div>
                    <div className="next-title">
                      <div>
                        <h3>
                          {
                            data.projects.find(
                              (p) => p.id === clock.next!.projectId,
                            )?.name
                          }
                        </h3>
                        <p>{clock.next.topic}</p>
                        <Tag tone="outline">
                          {teachingLabel(clock.next.event)}
                        </Tag>
                      </div>
                      <button
                        className="square-arrow"
                        onClick={() => go("week", clock.next!.id)}
                        aria-label="进入下次课程"
                      >
                        <ArrowUpRight size={25} />
                      </button>
                    </div>
                  </>
                ) : (
                  <Empty
                    code="END OF SEMESTER"
                    title="本学期课程已结束"
                    text="可继续整理作品和讲评记录；实际完成状态仍由你记录。"
                  />
                )}
              </section>
              <section className="current-project">
                <div className="eyebrow">
                  02 /{" "}
                  {clock.phase === "before"
                    ? "FIRST PROJECT"
                    : "CURRENT PROJECT"}{" "}
                  <span>
                    {clock.phase === "before" ? "首个创作项目" : "当前创作项目"}
                  </span>
                </div>
                <div className="project-current-body">
                  <button
                    className="current-artwork-link"
                    onClick={() => go("project", activeProject.id)}
                    aria-label={`查看 ${activeProject.id} ${activeProject.name}`}
                  >
                    <ProjectArtwork id={activeProject.id} decorative eager />
                    <span className="mono">{activeProject.id}</span>
                  </button>
                  <div>
                    <StatusSelect
                      label="首页项目状态"
                      value={activeProject.status}
                      onChange={(status) =>
                        projectUpdate(activeProject.id, { status })
                      }
                    />
                    <h3>{activeProject.name}</h3>
                    <p>{activeProject.cn}</p>
                  </div>
                </div>
                <div className="current-bottom">
                  <span className="mono">
                    W{String(activeProject.weeks[0]).padStart(2, "0")} — W
                    {String(activeProject.weeks.at(-1)).padStart(2, "0")}{" "}
                    <span>
                      {" "}
                      / {activeProject.weeks.length}{" "}
                      {activeProject.weeks.length === 1 ? "WEEK" : "WEEKS"}
                    </span>
                  </span>
                  <button
                    className="text-btn"
                    onClick={() => go("project", activeProject.id)}
                  >
                    进入项目 <ArrowUpRight size={16} />
                  </button>
                </div>
              </section>
            </div>
            <section className="timeline-section">
              <SectionHead
                code="03"
                title="学期时间轴"
                action={
                  <button className="text-btn" onClick={() => go("schedule")}>
                    完整课表 <ArrowUpRight size={15} />
                  </button>
                }
              />
              <div className="timeline-legend">
                <span className="mono">SEMESTER 01 / 16 WEEKS</span>
                <span>
                  课程完成 <b>{completed}</b> / 16{" "}
                  <span className="help"> · 手动记录</span>
                  <progress
                    className="semester-progress"
                    value={completed}
                    max={data.sessions.length}
                    aria-label="学期课程完成进度"
                  />
                </span>
              </div>
              <div
                className="timeline-scroll"
                role="region"
                aria-label="16周课程时间轴，可横向滚动"
                tabIndex={0}
              >
                <div className="timeline-projects">
                  {data.projects.map((p) => (
                    <button
                      key={p.id}
                      style={{ gridColumn: `span ${p.weeks.length}` }}
                      className={p.id === activeProject.id ? "is-current" : ""}
                      onClick={() => go("project", p.id)}
                    >
                      <span className="mono">{p.id}</span>
                      <span>
                        {p.cn}
                        <small>{p.name}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="timeline-weeks">
                  {data.sessions.map((s) => (
                    <button
                      key={s.id}
                      title={`${s.id} ${s.topic} · ${statusLabel(s.status)}`}
                      className={`${clock.next?.id === s.id ? "next" : ""} ${s.status === "已完成" ? "finished" : ""}`}
                      onClick={() => go("week", s.id)}
                    >
                      <span className="mono">{s.id}</span>
                      <i />
                      <small>{s.date.slice(5).replace("-", ".")}</small>
                    </button>
                  ))}
                </div>
              </div>
              <p className="help timeline-hint">
                左右滚动查看全部16周 · 点击周次查看课程，点击项目查看创作任务
              </p>
            </section>
            <div className="overview-lower">
              <section>
                <SectionHead
                  code="04"
                  title="近期课程节点"
                  action={<span className="mono help">UPCOMING REVIEWS</span>}
                />
                {upcoming.length ? (
                  upcoming.map((s, i) => (
                    <button
                      className="upcoming-row"
                      key={s.id}
                      onClick={() => go("week", s.id)}
                    >
                      <span className="mono upcoming-number">0{i + 1}</span>
                      <div>
                        <h3>{teachingLabel(s.event)}</h3>
                        <p>
                          {s.projectId} / {s.topic}
                        </p>
                      </div>
                      <span className="mono upcoming-date">
                        {formatDate(s.date, { day: "2-digit", month: "short" })}
                        <small>{s.id}</small>
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ))
                ) : (
                  <Empty
                    code="REVIEWS"
                    title="暂无后续节点"
                    text="可在作品讲评模块整理已完成的讨论。"
                  />
                )}
              </section>
              <section className="studio-notes">
                <SectionHead
                  code="05"
                  title="Studio Notes"
                  action={
                    <button className="text-btn" onClick={() => go("archive")}>
                      档案 <ArrowUpRight size={15} />
                    </button>
                  }
                />
                {(() => {
                  const a = [...data.artifacts]
                    .reverse()
                    .find((a) => a.kind === "创作笔记");
                  const c = [...data.critiques].sort((a, b) =>
                    b.updatedAt.localeCompare(a.updatedAt),
                  )[0];
                  return a ? (
                    <button
                      className="note-preview"
                      onClick={() => openArtifact(a.projectId, a.id)}
                    >
                      <span className="eyebrow">
                        {a.projectId} / STUDIO NOTE
                      </span>
                      <h3>{a.title}</h3>
                      <p>{a.note || "尚未填写笔记"}</p>
                    </button>
                  ) : c ? (
                    <button
                      className="note-preview"
                      onClick={() => openCrit(c.projectId, c.id)}
                    >
                      <span className="eyebrow">
                        {c.projectId} / {teachingLabel(c.type)}
                      </span>
                      <h3>{c.statement || "作品讲评记录"}</h3>
                      <p>{c.revisions || "尚未填写修改方向"}</p>
                    </button>
                  ) : (
                    <div className="notes-empty">
                      <span className="notes-glyph">↳</span>
                      <h3>工作室的记录，从这里开始。</h3>
                      <p>
                        保存创作想法、聆听观察与修改依据。
                        <br />
                        目前还没有个人记录。
                      </p>
                      <button
                        className="text-btn"
                        onClick={() =>
                          openArtifact(activeProject.id, undefined, "创作笔记")
                        }
                      >
                        写一条创作笔记 <Plus size={14} />
                      </button>
                    </div>
                  );
                })()}
              </section>
            </div>
            <button className="jury-strip" onClick={() => go("project", "P04")}>
              <span className="mono">FINAL PROJECT / P04</span>
              <h3>
                Independent Studio <span>期末独立创作</span>
              </h3>
              <span className="mono">
                FINAL PRESENTATION
                <br />
                {formatDate(data.sessions[15].date).toUpperCase()}
              </span>
              <ArrowUpRight size={25} />
            </button>
          </>
        )}
        {route.page === "schedule" && (
          <Schedule
            data={data}
            current={clock.current?.id}
            next={clock.next?.id}
            completed={completed}
          />
        )}
        {route.page === "week" &&
          (() => {
            const s = data.sessions.find((s) => s.id === route.id);
            return s ? (
              <WeekDetail
                session={s}
                data={data}
                update={(patch) => sessionUpdate(s.id, patch)}
                openCrit={() => openCrit(s.projectId)}
                notify={setToast}
              />
            ) : (
              <Empty
                code="404"
                title="未找到该周次"
                text="请从学期课表重新选择。"
                action={<a href="#schedule">返回课表</a>}
              />
            );
          })()}
        {route.page === "projects" && (
          <>
            <PageTitle
              eyebrow="STUDIO 01 / PROJECT DIRECTORY"
              title="Studio projects"
              cn="创作项目 / 五个连续的音乐创作项目"
            >
              <Tag>PROJECT-BASED STUDIO</Tag>
            </PageTitle>
            <p className="page-intro">
              从微型动机到独立命题，逐步研究律动、声音材料与时间结构。
              <br />
              参考试听 → 声音实验 → 作品提交 → 创作讲评 → 修改与结题
            </p>
            <div className="project-directory">
              {data.projects.map((p) => (
                <article
                  key={p.id}
                  className={`project-directory-row ${p.id === "P04" ? "final-project" : ""}`}
                  data-project={p.id}
                  style={projectAccent(p.id)}
                >
                  <button
                    className="directory-cover"
                    onClick={() => go("project", p.id)}
                    aria-label={`查看 ${p.id} ${p.name}`}
                  >
                    <ProjectArtwork id={p.id} decorative />
                    <span className="cover-index mono">{p.id}</span>
                  </button>
                  <button
                    className="project-directory-title"
                    onClick={() => go("project", p.id)}
                  >
                    <span className="eyebrow">
                      <span className="project-id">{p.id}</span> {p.direction}
                    </span>
                    <h2>
                      {p.name} <ArrowUpRight size={25} />
                    </h2>
                    <p>{p.cn}</p>
                    <p className="project-question">{p.question}</p>
                  </button>
                  <div className="project-directory-meta">
                    <StatusSelect
                      label={`${p.id}项目状态`}
                      value={p.status}
                      onChange={(status) => projectUpdate(p.id, { status })}
                    />
                    <span className="mono">
                      W{String(p.weeks[0]).padStart(2, "0")} — W
                      {String(p.weeks.at(-1)).padStart(2, "0")}
                    </span>
                    <small>{projectRange(p)}</small>
                    <button
                      className="text-btn"
                      onClick={() => go("project", p.id)}
                    >
                      查看创作任务书 <ArrowRight size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {route.page === "project" &&
          (() => {
            const p = data.projects.find((p) => p.id === route.id);
            return p ? (
              <ProjectDetail
                project={p}
                data={data}
                update={(patch) => projectUpdate(p.id, patch)}
                range={projectRange(p)}
                openCrit={() => openCrit(p.id)}
                openArtifact={() => openArtifact(p.id)}
                crits={critList(p.id)}
                artifacts={artifactList(
                  data.artifacts.filter((a) => a.projectId === p.id),
                  p.id,
                )}
              />
            ) : (
              <Empty
                code="404"
                title="未找到该项目"
                text="请从创作项目目录重新选择。"
                action={<a href="#projects">返回项目</a>}
              />
            );
          })()}
        {route.page === "critique" && (
          <>
            <PageTitle
              eyebrow="STUDIO DIALOGUE / REVIEW RECORDS"
              title="Composition reviews"
              cn="作品讲评 / 从聆听、讨论到具体修改"
            >
              <button
                className="primary-btn"
                onClick={() => openCrit(critFilter || activeProject.id)}
              >
                <Plus size={16} />
                新建作品讲评
              </button>
            </PageTitle>
            <div className="crit-explainer">
              {[
                [
                  "01",
                  "创作方案讨论 / Concept Review",
                  "讨论创作意图、早期方案与探索方向。",
                ],
                [
                  "02",
                  "阶段试听与反馈 / Work-in-Progress Review",
                  "检验结构、声音与发展方式，提出删减和重构。",
                ],
                [
                  "03",
                  "作品结题讲评 / Final Review",
                  "评审完整作品、制作完成度与创作复盘。",
                ],
              ].map(([n, t, d]) => (
                <div key={n}>
                  <span className="mono blue">{n}</span>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              ))}
            </div>
            <FilterBar
              data={data}
              value={critFilter}
              onChange={setCritFilter}
            />
            {critList(critFilter || undefined)}
          </>
        )}
        {route.page === "archive" && (
          <>
            <PageTitle
              eyebrow="WORKS / VERSIONS / RESEARCH"
              title="Studio archive"
              cn="创作档案 / 一个学期留下的声音与研究"
            >
              <button
                className="primary-btn"
                onClick={() => openArtifact(archiveFilter || activeProject.id)}
              >
                <Plus size={16} />
                添加档案
              </button>
            </PageTitle>
            <div className="storage-notice">
              <HardDrive size={18} />
              <p>
                个人工作室：文字先保存在本机缓存，再同步到云端。
                <strong>私有音频上传并校验后，其他设备可登录试听。</strong>
                完整备份另行打包文字与文件；外部链接只保存地址。
              </p>
              <button className="text-btn" onClick={() => setModal("backup")}>
                备份与迁移 <ArrowUpRight size={15} />
              </button>
            </div>
            <FilterBar
              data={data}
              value={archiveFilter}
              onChange={setArchiveFilter}
            />
            {artifactList(
              data.artifacts.filter(
                (a) => !archiveFilter || a.projectId === archiveFilter,
              ),
              archiveFilter || activeProject.id,
            )}
          </>
        )}
        {route.page === "syllabus" && (
          <Syllabus data={data} edit={() => setModal("course")} />
        )}
      </main>
      <footer>
        <div>
          <span className="footer-brand">WING SOUND ACADEMY</span>
          <span className="mono">STUDIO 01 · {data.semester.year}</span>
        </div>
        <div>
          <span
            className={`save-state ${saveError || loadError ? "warning" : ""}`}
          >
            <i />
            {saveError || loadError ? "保存需处理" : engine.status}
          </span>
          <button onClick={() => setModal("backup")}>
            完整备份 · 导入与导出 <ArrowUpRight size={12} />
          </button>
        </div>
      </footer>
      {toast && (
        <div role="status" className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === "crit" && (
        <CritEditor
          data={data}
          id={editCrit}
          projectId={context}
          close={() => setModal(null)}
          update={(c) =>
            setData((d) => ({
              ...d,
              critiques: d.critiques.some((x) => x.id === c.id)
                ? d.critiques.map((x) => (x.id === c.id ? c : x))
                : [...d.critiques, c],
            }))
          }
        />
      )}
      {modal === "artifact" && (
        <ArtifactEditor
          data={data}
          id={editArtifact}
          projectId={context}
          defaultKind={artifactKind}
          close={() => setModal(null)}
          save={(a, finish = true) => {
            setData((d) => ({
              ...d,
              artifacts: d.artifacts.some((x) => x.id === a.id)
                ? d.artifacts.map((x) => (x.id === a.id ? a : x))
                : [...d.artifacts, a],
              critiques: d.critiques.map((c) =>
                c.versionId === a.id &&
                (c.projectId !== a.projectId || a.kind !== "音频版本")
                  ? { ...c, versionId: "" }
                  : c,
              ),
            }));
            if (finish) {
              setModal(null);
              setToast("档案已保存");
            }
          }}
        />
      )}
      {modal === "backup" && (
        <BackupDialog
          data={data}
          close={() => setModal(null)}
          replace={async (d) => {
            await engine.restore(d);
            setLoadError("");
            setToast("完整备份已导入");
            setModal(null);
          }}
          notify={setToast}
          recovery={!!loadError}
        />
      )}
      {modal === "course" && (
        <CourseEditor
          data={data}
          close={() => setModal(null)}
          save={(semester) => {
            setData((d) => ({ ...d, semester }));
            setModal(null);
            setToast("课程信息已更新");
          }}
        />
      )}
    </div>
  );
}
