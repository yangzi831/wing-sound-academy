import { describe, expect, it } from "vitest";
import { createInitialData } from "../src/data";
import { localDate, safeUrl, semesterClock } from "../src/domain";
import { validateData } from "../src/storage";

describe("真实学期与日期定位", () => {
  it("保留16个连续周日和真实初始状态", () => {
    const d = createInitialData();
    expect(d.sessions.map((s) => s.date)).toEqual(
      Array.from({ length: 16 }, (_, i) =>
        new Date(Date.UTC(2026, 9, 25 + i * 7)).toISOString().slice(0, 10),
      ),
    );
    expect(
      d.sessions.every((s) => s.status === "未开始" && !s.notes && !s.progress),
    ).toBe(true);
    expect(d.critiques).toEqual([]);
    expect(d.artifacts).toEqual([]);
    expect(validateData(d)).toEqual(d);
  });
  it("开课前显示下一次课程，不伪造当前教学周", () => {
    const clock = semesterClock(createInitialData().sessions, "2026-10-20");
    expect(clock.phase).toBe("before");
    expect(clock.current).toBeUndefined();
    expect(clock.next?.id).toBe("W01");
  });
  it("当天课程仍属于下次课程，周中定位当前周与下个周日", () => {
    const s = createInitialData().sessions;
    expect(semesterClock(s, "2026-11-01").next?.id).toBe("W02");
    const c = semesterClock(s, "2026-11-04");
    expect(c.current?.id).toBe("W02");
    expect(c.next?.id).toBe("W03");
    expect(s.every((x) => x.status === "未开始")).toBe(true);
  });
  it("正确处理跨年、期末当天与结课后", () => {
    const s = createInitialData().sessions;
    expect(semesterClock(s, "2027-01-01").current?.id).toBe("W10");
    expect(semesterClock(s, "2027-02-07").next?.id).toBe("W16");
    expect(semesterClock(s, "2027-02-08")).toMatchObject({
      phase: "after",
      current: undefined,
      next: undefined,
    });
  });
  it("使用上海日期，不受设备所在时区影响", () => {
    expect(localDate(new Date("2026-10-24T16:05:00Z"))).toBe("2026-10-25");
  });
  it("拒绝脚本与无效外部链接", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("https://example.com/a.mp3")).toBe(
      "https://example.com/a.mp3",
    );
  });
});
describe("备份完整性保护", () => {
  it("拒绝缺周、重复周、无效日期与非周日课程", () => {
    const d = createInitialData();
    d.sessions.pop();
    expect(() => validateData(d)).toThrow();
    const e = createInitialData();
    e.sessions[1] = { ...e.sessions[0] };
    expect(() => validateData(e)).toThrow();
    const f = createInitialData();
    f.sessions[0].date = "2026-02-30";
    expect(() => validateData(f)).toThrow();
    const g = createInitialData();
    g.sessions[0].date = "2026-10-26";
    expect(() => validateData(g)).toThrow();
  });
  it("拒绝评图跨项目关联或关联到不存在的作品", () => {
    const d = createInitialData();
    d.critiques.push({
      id: "c1",
      projectId: "P00",
      versionId: "missing",
      date: "2026-10-25",
      type: "Concept Crit",
      statement: "",
      listening: "",
      strengths: "",
      issues: "",
      revisions: "",
      next: "",
      completed: false,
      updatedAt: "2026-10-25T12:00:00Z",
    });
    expect(() => validateData(d)).toThrow();
  });
});
