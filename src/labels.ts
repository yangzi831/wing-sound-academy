// Keep stored v1 enums and personal writing unchanged; translate only known display labels.
const legacyLabels: Record<string, string> = {
  "Concept Crit": "创作方案讨论 / Concept Review",
  "Midterm Crit": "阶段试听与反馈 / Work-in-Progress Review",
  "Final Crit": "作品结题讲评 / Final Review",
  "Desk Crit": "Studio创作讨论",
  "Pre-Final Crit": "期末作品预评 / Pre-Final Review",
  "Final Jury": "期末作品展示与评审 / Final Presentation",
  "Progress Crit": "阶段作品试听与反馈 / Progress Review",
  "Project Proposal": "独立创作立项 / Project Proposal",
  "Studio Development": "工作室创作讨论 / Studio Session",
  "Flexible Studio": "自主制作与参考研究 / Flexible Studio",
  快题讲评与结题: "微型作品试听与结题",
  "正式期末设计项目。完全自主命题，可以深化之前的研究成果，也可以创作新的原创作品。":
    "正式期末独立音乐创作项目。自主提出创作命题，可以深化之前的声音研究，也可以创作新的原创作品。",
  "不规定固定风格与长度；须具备完整创作概念、正式作品、过程版本和最终评图。":
    "不规定固定风格与长度；须具备完整创作方案、正式音频、过程版本和作品结题讲评。",
  "Project Proposal → Progress Review → Development → Pre-Final Review → Final Jury":
    "创作立项 → 阶段试听与反馈 → 独立制作 → 期末作品预评 → 作品展示与评审",
  "正式音频、过程版本、最终评图与结题总结":
    "正式音频、过程版本、作品结题讲评与创作总结",
  "P01 Final Crit": "P01 · 作品结题讲评 / Final Review",
  "P02 Final Crit": "P02 · 作品结题讲评 / Final Review",
  "P03 Final Crit": "P03 · 作品结题讲评 / Final Review",
};
export function teachingLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(legacyLabels, value)
    ? legacyLabels[value]
    : value;
}
export function statusLabel(value: string): string {
  return value === "待评图" ? "待作品讲评" : value;
}
export function isReviewEvent(value: string): boolean {
  return /Review|Presentation|Proposal|讲评|结题|预评|立项|评审/.test(
    teachingLabel(value),
  );
}
