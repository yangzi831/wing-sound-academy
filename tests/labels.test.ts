import { describe, expect, it } from "vitest";
import { createInitialData } from "../src/data";
import { stages } from "../src/domain";
import { teachingLabel, statusLabel, isReviewEvent } from "../src/labels";
import { validateData } from "../src/storage";

describe("音乐教学展示与 v1 记录兼容", () => {
  it("旧枚举与默认课程用语在展示层转换，不修改个人记录", () => {
    const data = createInitialData();
    data.sessions[1].event = "Concept Crit";
    data.sessions[1].status = "待评图";
    data.sessions[1].notes = "旧评图反馈：01:24 低频修改，保留原话。";
    data.projects[4].log = "Final Jury 前的个人修改记录";
    const original = JSON.stringify(data);
    expect(teachingLabel(data.sessions[1].event)).toContain("创作方案讨论");
    expect(statusLabel(data.sessions[1].status)).toBe("待作品讲评");
    expect(teachingLabel(data.sessions[1].notes)).toBe(data.sessions[1].notes);
    expect(teachingLabel(data.projects[4].log)).toBe(data.projects[4].log);
    expect(validateData(data)).toEqual(data);
    expect(JSON.stringify(data)).toBe(original);
  });
  it("旧节点与新节点都能出现在近期课程节点中", () => {
    for (const event of [
      "Concept Crit",
      "P01 Final Crit",
      "Final Jury",
      "Pre-Final Crit",
      "Project Proposal",
    ]) {
      expect(isReviewEvent(event)).toBe(true);
      expect(isReviewEvent(teachingLabel(event))).toBe(true);
    }
    expect(isReviewEvent("工作室创作讨论 / Studio Session")).toBe(false);
    expect(teachingLabel("Desk Crit")).toBe("Studio创作讨论");
    expect(teachingLabel("constructor")).toBe("constructor");
  });
  it("默认课程保留16周和5个项目，P04保留五阶段正式创作流程", () => {
    const data = createInitialData();
    expect(data.sessions).toHaveLength(16);
    expect(data.projects.map((p) => p.id)).toEqual([
      "P00",
      "P01",
      "P02",
      "P03",
      "P04",
    ]);
    expect(data.sessions[0].date).toBe("2026-10-25");
    expect(data.sessions[15].date).toBe("2027-02-07");
    expect(stages).toHaveLength(5);
    expect(data.projects[4].stages).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(data.sessions[15].event).toContain("Final Presentation");
    expect(JSON.stringify(data)).not.toMatch(
      /评图|Final Jury|Concept Crit|Midterm Crit|Final Crit|设计项目/,
    );
    expect(data.projects[4].brief).toContain("音乐创作");
  });
});
