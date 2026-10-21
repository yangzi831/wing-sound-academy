import type { CSSProperties } from "react";
import p00 from "./assets/artwork/P00.svg";
import p01 from "./assets/artwork/P01.svg";
import p02 from "./assets/artwork/P02.svg";
import p03 from "./assets/artwork/P03.svg";
import p04 from "./assets/artwork/P04.svg";
import studio from "./assets/artwork/studio-field.svg";

const visuals: Record<
  string,
  { src: string; accent: string; description: string }
> = {
  P00: { src: p00, accent: "#9e3c24", description: "重复的短动机与休止" },
  P01: { src: p01, accent: "#174bfa", description: "旋转的序列与周期运动" },
  P02: { src: p02, accent: "#35624e", description: "颗粒密度与声音材质变形" },
  P03: { src: p03, accent: "#985333", description: "多层曲线与长篇结构" },
  P04: { src: p04, accent: "#174bfa", description: "开放谱面与独立创作" },
};
export function projectAccent(id: string): CSSProperties {
  return {
    "--project-accent": (visuals[id] || visuals.P00).accent,
  } as CSSProperties;
}
export function ProjectArtwork({
  id,
  className = "",
  decorative = false,
  eager = false,
}: {
  id: string;
  className?: string;
  decorative?: boolean;
  eager?: boolean;
}) {
  const art = visuals[id] || visuals.P00;
  return (
    <div className={`project-artwork ${className}`} data-project={id}>
      <img
        src={art.src}
        alt={decorative ? "" : `${id} 原创项目封面：${art.description}`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
      />
    </div>
  );
}
export function StudioArtwork() {
  return (
    <figure className="studio-artwork">
      <img
        src={studio}
        alt="原创实验电子音乐主题图：曲线、颗粒与序列构成的声音密度场"
        fetchPriority="high"
      />
      <figcaption>
        <span>声音密度与时间结构</span>
        <span className="mono">原创生成式图形 / WSA</span>
      </figcaption>
    </figure>
  );
}
