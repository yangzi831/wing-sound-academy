import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { Artifact, Status } from "./types";
import { statuses, safeUrl } from "./domain";
import { audioStore } from "./storage";
export function go(page: string, id?: string) {
  location.hash = page + (id ? "/" + id : "");
}
export function Tag({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
export function Empty({
  code,
  title,
  text,
  action,
}: {
  code: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="mono empty-code">{code}</span>
      <div>
        <h3>{title}</h3>
        <p>{text}</p>
        {action}
      </div>
    </div>
  );
}
export function Field({
  label,
  value,
  onChange,
  placeholder = "",
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function StatusSelect({
  value,
  onChange,
  label = "状态",
}: {
  value: Status;
  onChange: (v: Status) => void;
  label?: string;
}) {
  return (
    <label className="status-select">
      <span className="sr-only">{label}</span>
      <i className={`status-dot s-${statuses.indexOf(value)}`} />
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as Status)}
      >
        {statuses.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <X size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function SectionHead({
  code,
  title,
  action,
}: {
  code: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <h2>
        <span className="mono">{code}</span>
        {title}
      </h2>
      {action}
    </div>
  );
}
export function PageTitle({
  eyebrow,
  title,
  cn,
  children,
}: {
  eyebrow: string;
  title: string;
  cn: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div className="eyebrow">{eyebrow}</div>
      <div className="page-title-row">
        <div>
          <h1>
            {title}
            <span className="blue">.</span>
          </h1>
          <p>{cn}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Signal({ small = false }: { small?: boolean }) {
  return (
    <div className={`signal ${small ? "small" : ""}`} aria-hidden="true">
      <div className="signal-guides" />
      {Array.from({ length: 62 }, (_, i) => {
        const h =
          8 +
          Math.pow(Math.abs(Math.sin(i * 0.42) * Math.cos(i * 0.13)), 0.7) * 83;
        return <i key={i} style={{ height: `${h}%` }} />;
      })}
      <span className="signal-axis mono">SIGNAL STUDY — 001 / WSA</span>
    </div>
  );
}
export function AudioPlayer({ artifact }: { artifact: Artifact }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setSrc("");
    setError("");
    if (artifact.fileId) {
      audioStore("get", artifact.fileId)
        .then((blob) => {
          if (!active) return;
          if (blob) {
            objectUrl = URL.createObjectURL(blob);
            setSrc(objectUrl);
          } else setError("本地音频已缺失，请从完整备份恢复或重新添加。");
        })
        .catch(() => {
          if (active) setError("无法读取本地音频。");
        });
    } else if (artifact.url) setSrc(safeUrl(artifact.url));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.fileId, artifact.url]);
  return (
    <>
      {src && (
        <audio
          aria-label={`播放 ${artifact.title}`}
          controls
          preload="metadata"
          src={src}
          onError={() =>
            setError(
              "无法直接播放此资源。外部页面请通过作品链接打开；本地格式请使用浏览器支持的 MP3 / WAV / OGG。",
            )
          }
        />
      )}
      {error && <p className="help warning">{error}</p>}
    </>
  );
}
