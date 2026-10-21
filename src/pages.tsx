import { teachingLabel, statusLabel } from "./labels";
import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Pencil,
  Plus,
  Check,
  ChevronRight,
} from "lucide-react";
import type { AcademyData, Project, Session } from "./types";
import { formatDate, stages } from "./domain";
import { Tag, Field, StatusSelect, SectionHead, PageTitle, go } from "./ui";
import { SessionEditor } from "./editors";
export function FilterBar({
  data,
  value,
  onChange,
}: {
  data: AcademyData;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="filter-bar" role="group" aria-label="按项目筛选">
      <button className={!value ? "selected" : ""} onClick={() => onChange("")}>
        全部项目
      </button>
      {data.projects.map((p) => (
        <button
          key={p.id}
          className={value === p.id ? "selected" : ""}
          onClick={() => onChange(p.id)}
        >
          {p.id} <span>{p.cn}</span>
        </button>
      ))}
    </div>
  );
}
export function Schedule({
  data,
  current,
  next,
  completed,
}: {
  data: AcademyData;
  current?: string;
  next?: string;
  completed: number;
}) {
  return (
    <>
      <PageTitle
        eyebrow="SEMESTER 01 / ACADEMIC CALENDAR"
        title="Semester schedule"
        cn="学期课表 / 每周日 · 时间待定"
      >
        <div className="schedule-count mono">
          <b>{completed.toString().padStart(2, "0")}</b>
          <span>
            / 16
            <br />
            SESSIONS COMPLETED
          </span>
        </div>
      </PageTitle>
      <div className="schedule-info">
        <span>
          {formatDate(data.sessions[0].date)} —{" "}
          {formatDate(data.sessions[15].date)}
        </span>
        <p>
          日期定位教学周；完成状态由手动记录。
          <span className="blue"> W09 为演出期弹性工作室课程。</span>
        </p>
        {next && (
          <button
            className="text-btn"
            onClick={() =>
              document
                .getElementById(`row-${next}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            定位下次课程 <ArrowRight size={14} />
          </button>
        )}
      </div>
      <div className="schedule-table">
        <div className="schedule-table-head mono">
          <span>PROJECT</span>
          <span>WEEK / DATE</span>
          <span>STUDIO CONTENT</span>
          <span>REVIEW / MILESTONE</span>
          <span>STATUS</span>
        </div>
        {data.projects.map((p) => (
          <div className="schedule-group" key={p.id}>
            <button
              className={`schedule-project ${p.id === "P04" ? "jury-project" : ""}`}
              onClick={() => go("project", p.id)}
            >
              <span className="mono">
                {p.id} <ArrowUpRight size={17} />
              </span>
              <h3>{p.name}</h3>
              <p>{p.cn}</p>
              <small className="mono">
                {p.weeks.length} {p.weeks.length === 1 ? "WEEK" : "WEEKS"}
              </small>
            </button>
            <div>
              {data.sessions
                .filter((s) => s.projectId === p.id)
                .map((s) => (
                  <button
                    id={`row-${s.id}`}
                    key={s.id}
                    className={`session-row ${s.id === next ? "next-row" : ""} ${s.id === current ? "current-row" : ""} ${s.week === 9 ? "flex-row" : ""}`}
                    onClick={() => go("week", s.id)}
                  >
                    <span className="session-date">
                      <b className="mono">{s.id}</b>
                      <small>{s.date.replaceAll("-", ".")}</small>
                    </span>
                    <span className="session-topic">
                      {s.topic}
                      <small>
                        {s.id === next
                          ? "NEXT SESSION / 下次课程"
                          : s.id === current
                            ? "CURRENT WEEK / 当前教学周"
                            : s.week === 9
                              ? "演出期弹性 Studio"
                              : ""}
                      </small>
                    </span>
                    <span className="session-event">
                      <i
                        className={
                          /Final|Jury|结题/.test(s.event) ? "event-final" : ""
                        }
                      />
                      {teachingLabel(s.event)}
                    </span>
                    <span className="session-status">
                      <Tag tone={s.status === "已完成" ? "done" : ""}>
                        {statusLabel(s.status)}
                      </Tag>
                      <ChevronRight size={15} />
                    </span>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
export function WeekDetail({
  session: s,
  data,
  update,
  openCrit,
  notify,
}: {
  session: Session;
  data: AcademyData;
  update: (p: Partial<Session>) => void;
  openCrit: () => void;
  notify: (s: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const p = data.projects.find((p) => p.id === s.projectId)!;
  return (
    <>
      <div className="back-line">
        <a href="#schedule">
          <ArrowLeft size={14} /> 学期课表
        </a>
        <div>
          {s.week > 1 && (
            <button
              onClick={() =>
                go("week", data.sessions.find((x) => x.week === s.week - 1)?.id)
              }
            >
              上一周
            </button>
          )}
          {s.week < 16 && (
            <button
              onClick={() =>
                go("week", data.sessions.find((x) => x.week === s.week + 1)?.id)
              }
            >
              下一周 <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
      <PageTitle
        eyebrow={`${s.id} / ${formatDate(s.date).toUpperCase()} / SUNDAY · 时间待定`}
        title={`Week ${String(s.week).padStart(2, "0")}`}
        cn={s.topic}
      >
        <StatusSelect
          value={s.status}
          onChange={(status) => update({ status })}
        />
      </PageTitle>
      <div className="detail-meta">
        <Tag tone="blue-tag">{teachingLabel(s.event)}</Tag>
        <button className="text-btn" onClick={() => go("project", p.id)}>
          {p.id} / {p.name} <ArrowUpRight size={14} />
        </button>
        <button className="text-btn" onClick={() => setEdit(true)}>
          <Pencil size={13} />
          编辑课程配置
        </button>
      </div>
      <div className="detail-columns">
        <div>
          <SectionHead code="01" title="本周工作室课程" />
          <div className="brief-block">
            <span className="eyebrow">OBJECTIVES / 教学目标</span>
            <p>{teachingLabel(s.objectives)}</p>
          </div>
          <div className="brief-block">
            <span className="eyebrow">ASSIGNMENT / 当周任务</span>
            <p>{teachingLabel(s.task)}</p>
          </div>
          <div className="brief-block">
            <span className="eyebrow">DELIVERABLES / 提交内容</span>
            <p>{teachingLabel(s.submission)}</p>
          </div>
          <button className="text-btn" onClick={openCrit}>
            为本项目添加作品讲评 <Plus size={15} />
          </button>
        </div>
        <div className="writing-panel">
          <SectionHead
            code="02"
            title="个人工作记录"
            action={<span className="help">自动保存</span>}
          />
          <Field
            label="上课笔记 / Session notes"
            value={s.notes}
            onChange={(notes) => update({ notes })}
            placeholder="记录课堂讨论、声音实验与观察。"
            rows={7}
          />
          <Field
            label="参考资料 / References"
            value={s.references}
            onChange={(references) => update({ references })}
            placeholder="记录参考曲目、文章、链接与聆听观察。"
          />
          <Field
            label="个人进度 / Progress"
            value={s.progress}
            onChange={(progress) => update({ progress })}
            placeholder="目前完成什么，下一步需要解决什么？"
          />
        </div>
      </div>
      {edit && (
        <SessionEditor
          session={s}
          data={data}
          close={() => setEdit(false)}
          save={(patch) => {
            update(patch);
            setEdit(false);
            notify("课程配置已更新");
          }}
        />
      )}
    </>
  );
}
export function ProjectDetail({
  project: p,
  data,
  update,
  range,
  openCrit,
  openArtifact,
  crits,
  artifacts,
}: {
  project: Project;
  data: AcademyData;
  update: (p: Partial<Project>) => void;
  range: string;
  openCrit: () => void;
  openArtifact: () => void;
  crits: ReactNode;
  artifacts: ReactNode;
}) {
  const [tab, setTab] = useState("brief");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setTab("brief");
    setEditing(false);
  }, [p.id]);
  return (
    <>
      <div className="back-line">
        <a href="#projects">
          <ArrowLeft size={14} /> 所有创作项目
        </a>
        <span className="mono">PROJECT BRIEF / {p.id}</span>
      </div>
      <section className={`project-hero ${p.id === "P04" ? "final-hero" : ""}`}>
        <div className="eyebrow">
          {p.id === "P04"
            ? "FINAL PROJECT / INDEPENDENT RESEARCH"
            : p.direction}
        </div>
        <div className="project-title-row">
          <span className="project-outline mono">{p.id}</span>
          <div>
            <h1>{p.name}</h1>
            <p>{p.cn}</p>
          </div>
          <ArrowUpRight className="project-hero-arrow" size={48} />
        </div>
        <div className="project-hero-meta">
          <span className="mono">
            W{String(p.weeks[0]).padStart(2, "0")} — W
            {String(p.weeks.at(-1)).padStart(2, "0")} / {p.weeks.length} WEEKS
          </span>
          <span>{range}</span>
          <StatusSelect
            value={p.status}
            onChange={(status) => update({ status })}
          />
        </div>
      </section>
      {p.id === "P04" && (
        <div className="final-stages">
          {stages.map((stage, i) => (
            <button
              className={p.stages[i] ? "checked" : ""}
              key={stage}
              onClick={() =>
                update({ stages: p.stages.map((v, j) => (i === j ? !v : v)) })
              }
              aria-pressed={p.stages[i]}
            >
              <span className="mono">
                {p.stages[i] ? (
                  <Check size={17} />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </span>
              <strong>{stage}</strong>
              <small>{p.stages[i] ? "已完成" : "未完成 · 点击更新"}</small>
            </button>
          ))}
        </div>
      )}
      <div className="project-tabs">
        {[
          ["brief", "创作任务书", "Brief"],
          ["process", "创作过程", "Process"],
          ["versions", "作品版本与档案", "Versions"],
          ["crits", "作品讲评记录", "Reviews"],
        ].map(([key, cn, en]) => (
          <button
            className={tab === key ? "selected" : ""}
            key={key}
            onClick={() => setTab(key)}
          >
            {cn}
            <span>{en}</span>
            {key === "versions" && (
              <small>
                {data.artifacts.filter((a) => a.projectId === p.id).length}
              </small>
            )}
            {key === "crits" && (
              <small>
                {data.critiques.filter((c) => c.projectId === p.id).length}
              </small>
            )}
          </button>
        ))}
      </div>
      {tab === "brief" && (
        <div className="detail-columns project-brief">
          <div>
            <div className="research-question">
              <span className="eyebrow">RESEARCH QUESTION / 核心研究问题</span>
              <h2>{p.question}</h2>
            </div>
            <SectionHead
              code="01"
              title="项目 Brief"
              action={
                <button
                  className="text-btn"
                  onClick={() => setEditing(!editing)}
                >
                  <Pencil size={13} />
                  {editing ? "完成编辑" : "编辑创作任务"}
                </button>
              }
            />
            {editing ? (
              <>
                <Field
                  label="研究问题"
                  value={p.question}
                  onChange={(question) => update({ question })}
                />
                <Field
                  label="项目 Brief"
                  value={teachingLabel(p.brief)}
                  onChange={(brief) => update({ brief })}
                />
                <Field
                  label="创作限制"
                  value={teachingLabel(p.constraints)}
                  onChange={(constraints) => update({ constraints })}
                />
                <Field
                  label="学习主题与技术"
                  value={teachingLabel(p.topics)}
                  onChange={(topics) => update({ topics })}
                />
                <Field
                  label="参考研究"
                  value={p.references}
                  onChange={(references) => update({ references })}
                />
              </>
            ) : (
              <>
                <div className="brief-block">
                  <p>{teachingLabel(p.brief)}</p>
                </div>
                <div className="brief-block">
                  <span className="eyebrow">CONSTRAINTS / 创作限制</span>
                  <p>{teachingLabel(p.constraints)}</p>
                </div>
                <div className="brief-block">
                  <span className="eyebrow">STUDY AREAS / 学习主题与技术</span>
                  <p>{teachingLabel(p.topics)}</p>
                </div>
                {p.references && (
                  <div className="brief-block">
                    <span className="eyebrow">REFERENCES / 参考研究</span>
                    <p>{p.references}</p>
                  </div>
                )}
              </>
            )}
          </div>
          <aside className="milestone-panel">
            <SectionHead code="02" title="阶段里程碑" />
            {data.sessions
              .filter((s) => s.projectId === p.id)
              .map((s) => (
                <button key={s.id} onClick={() => go("week", s.id)}>
                  <div className="mono">
                    <span>{s.id}</span>
                    <span>
                      {formatDate(s.date, { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                  <h3>{teachingLabel(s.event)}</h3>
                  <p>{s.topic}</p>
                  <div>
                    <Tag tone={s.status === "已完成" ? "done" : ""}>
                      {statusLabel(s.status)}
                    </Tag>
                    <ArrowUpRight size={17} />
                  </div>
                </button>
              ))}
          </aside>
        </div>
      )}
      {tab === "process" && (
        <div className="process-writing">
          <div>
            <SectionHead code="01" title="创作想法" />
            <Field
              label="Concept / 意图、材料与初步结构"
              value={p.idea}
              onChange={(idea) => update({ idea })}
              rows={9}
              placeholder="从核心研究问题出发，记录你的创作意图。"
            />
          </div>
          <div>
            <SectionHead code="02" title="进度与修改记录" />
            <Field
              label="Process log / 记录日期、版本与修改依据"
              value={p.log}
              onChange={(log) => update({ log })}
              rows={9}
              placeholder="例如：日期 / 版本 / 修改内容 / 聆听结果。"
            />
          </div>
          <div className="full-width">
            <SectionHead code="03" title="结题总结" />
            <Field
              label="Reflection / 研究成果与未解决的问题"
              value={p.summary}
              onChange={(summary) => update({ summary })}
              rows={6}
              placeholder="总结创作意图、实际成果与后续研究方向。"
            />
          </div>
          <span className="help">所有文字自动保存在当前浏览器。</span>
        </div>
      )}
      {tab === "versions" && (
        <section className="tab-content">
          <SectionHead
            code="ARCHIVE"
            title="作品版本与研究档案"
            action={
              <button className="primary-btn" onClick={openArtifact}>
                <Plus size={15} />
                添加档案
              </button>
            }
          />
          {artifacts}
        </section>
      )}
      {tab === "crits" && (
        <section className="tab-content">
          <SectionHead
            code="REVIEWS"
            title="项目作品讲评记录"
            action={
              <button className="primary-btn" onClick={openCrit}>
                <Plus size={15} />
                新建作品讲评
              </button>
            }
          />
          {crits}
        </section>
      )}
    </>
  );
}

export function Syllabus({
  data,
  edit,
}: {
  data: AcademyData;
  edit: () => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow={`${data.semester.code} / OFFICIAL COURSE SYLLABUS`}
        title="Course syllabus"
        cn="课程大纲 / 电子音乐创作实验室"
      >
        <button className="secondary-btn" onClick={edit}>
          <Pencil size={15} />
          编辑课程信息
        </button>
      </PageTitle>
      <div className="syllabus-layout">
        <aside className="syllabus-index">
          <span className="eyebrow">COURSE INFORMATION</span>
          <h2>{data.semester.code}</h2>
          <p>{data.semester.title}</p>
          <dl>
            <dt>学院</dt>
            <dd>WING SOUND ACADEMY</dd>
            <dt>学年 / 学期</dt>
            <dd>
              {data.semester.year}
              <br />
              {data.semester.name}
            </dd>
            <dt>教学周期</dt>
            <dd>
              {formatDate(data.sessions[0].date)}
              <br />— {formatDate(data.sessions[15].date)}
            </dd>
            <dt>正式教学日</dt>
            <dd>
              每周日 · 时间待定
              <br />
              16周 / 16次 Studio
            </dd>
            <dt>教学方式</dt>
            <dd>Project-Based Studio</dd>
          </dl>
        </aside>
        <article className="syllabus-body">
          <section>
            <span className="eyebrow">01 / COURSE POSITION</span>
            <h2>课程定位与培养目标</h2>
            <p>
              通过连续的音乐创作项目，研究电子音乐的律动、声音设计、时间结构、后摇与电子音乐的融合，并逐渐发展个人音乐语言。
            </p>
            <p>
              从实际创作问题出发，在作品、讨论与修改中建立音乐判断。第一周直接进入微型创作，不设独立基础理论学习周。
            </p>
          </section>
          <section>
            <span className="eyebrow">02 / FIELDS OF STUDY</span>
            <h2>主要研究领域</h2>
            <div className="study-tags">
              {[
                "Electronic Music",
                "Sound Design",
                "Melodic Techno",
                "Post-rock × Electronica",
                "Experimental Composition",
              ].map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </section>
          <section>
            <span className="eyebrow">03 / STUDIO METHOD</span>
            <h2>工作室课程与创作流程</h2>
            <p>
              每个项目从创作任务出发，通过参考作品试听、声音实验和工作室课程发展阶段作品；提交
              Demo
              后开展创作讲评，根据反馈修改，再以正式音频与创作陈述完成结题。作品版本与创作记录贯穿整个过程。
            </p>
            <p>
              2026年12月20日为演出期弹性工作室课程，安排自由制作、参考研究与素材整理。
            </p>
          </section>
          <section>
            <span className="eyebrow">04 / PROJECT SEQUENCE</span>
            <h2>五个连续创作项目</h2>
            {data.projects.map((p) => (
              <button
                className="syllabus-project"
                key={p.id}
                onClick={() => go("project", p.id)}
              >
                <span className="mono blue">{p.id}</span>
                <div>
                  <h3>{p.name}</h3>
                  <p>
                    {p.cn} / {p.question}
                  </p>
                </div>
                <ArrowUpRight size={19} />
              </button>
            ))}
          </section>
          <section>
            <span className="eyebrow">05 / COMPOSITION REVIEWS</span>
            <h2>学期作品讲评机制</h2>
            <p>
              创作方案讨论：试听动机与声音草稿，明确创作意图；阶段试听与反馈：围绕
              Demo
              的节奏、声音设计、编曲结构与能量推进提出修改意见；作品结题讲评：完整试听成品，对照创作目标复盘制作选择。
            </p>
            <p>
              作品讲评关注具体证据与可执行修改，记录音频时间位置和版本，不使用数字化评分。所有作品讲评由实际讨论产生，不预填评价。
            </p>
          </section>
          <section className="syllabus-final">
            <span className="eyebrow">06 / FINAL PROJECT</span>
            <h2>
              Independent Studio
              <br />
              期末独立创作
            </h2>
            <p>
              完全自主命题，不规定固定风格和长度。需提交完整的创作概念、正式作品、过程版本和最终作品讲评。
            </p>
            <div className="mono">{stages.join(" → ")}</div>
            <strong>
              FINAL PRESENTATION /{" "}
              {formatDate(data.sessions[15].date).toUpperCase()}
            </strong>
          </section>
          <section>
            <span className="eyebrow">07 / DELIVERABLES</span>
            <h2>学期成果要求</h2>
            <p>
              保留各项目正式音频、不同版本Demo、创作笔记、重要音色与素材记录、参考研究和结题总结。期末以正式作品与过程档案共同呈现研究成果。
            </p>
            <button className="text-btn" onClick={() => go("archive")}>
              进入创作档案 <ArrowRight size={15} />
            </button>
          </section>
        </article>
      </div>
    </>
  );
}
