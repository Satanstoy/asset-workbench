"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useIdentity } from "@/features/identity/session";
import { api, ApiError, errorMessage, jsonPost } from "@/lib/api";
import type { Asset, Task, Template } from "@/lib/api";

type Slot = { file: File; preview: string; state: "uploading" | "ready" | "error"; assetId?: string; error?: string };

export function CreationForm({ template, onAccepted }: { template: Template; onAccepted: (task: Task) => void }) {
  const { epoch, expire } = useIdentity();
  const [slots, setSlots] = useState<(Slot | null)[]>(() => Array(template.requiredImageCount).fill(null));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const uploads = useRef(new Map<number, AbortController>());
  const previews = useRef(new Map<number, string>());
  const submission = useRef<AbortController | null>(null);
  const ready = slots.every((slot) => slot?.state === "ready");

  useEffect(() => {
    const activeUploads = uploads.current;
    const activePreviews = previews.current;
    return () => {
      for (const request of activeUploads.values()) request.abort();
      activeUploads.clear();
      for (const url of activePreviews.values()) URL.revokeObjectURL(url);
      activePreviews.clear();
      submission.current?.abort();
    };
  }, []);

  function setSlot(index: number, slot: Slot | null) {
    setSlots((current) => current.map((item, position) => position === index ? slot : item));
  }

  function clearSlot(index: number) {
    uploads.current.get(index)?.abort();
    uploads.current.delete(index);
    const previous = previews.current.get(index);
    if (previous) URL.revokeObjectURL(previous);
    previews.current.delete(index);
    setSlot(index, null);
  }

  async function upload(index: number, file: File, preview: string) {
    const request = new AbortController();
    uploads.current.get(index)?.abort();
    uploads.current.set(index, request);
    setSlot(index, { file, preview, state: "uploading" });
    const body = new FormData();
    body.set("templateId", template.id);
    body.set("file", file);
    try {
      const asset = await api<Asset>("/api/assets", { method: "POST", body, signal: request.signal });
      if (!request.signal.aborted) setSlot(index, { file, preview, state: "ready", assetId: asset.id });
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) expire(epoch);
      else setSlot(index, { file, preview, state: "error", error: errorMessage(error, "上传失败，请重试") });
    } finally {
      if (uploads.current.get(index) === request) uploads.current.delete(index);
    }
  }

  function choose(index: number, file: File) {
    clearSlot(index);
    if (file.type && !template.acceptedMimeTypes.includes(file.type)) {
      setSlot(index, { file, preview: "", state: "error", error: "请选择符合模板格式要求的图片" });
      return;
    }
    if (file.size > template.maxFileSizeBytes) {
      setSlot(index, { file, preview: "", state: "error", error: "图片超过文件大小限制" });
      return;
    }
    const preview = URL.createObjectURL(file);
    previews.current.set(index, preview);
    void upload(index, file, preview);
  }

  async function submit() {
    if (!ready || submission.current) return;
    const request = new AbortController();
    submission.current = request;
    setSubmitting(true);
    setSubmitError("");
    setUncertain(false);
    try {
      const task = await api<Task>("/api/tasks", jsonPost({
        templateId: template.id, assetIds: slots.map((slot) => slot!.assetId!),
      }, request.signal));
      if (!request.signal.aborted) onAccepted(task);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) expire(epoch);
      else if (error instanceof ApiError && error.status >= 400 && error.status < 500) setSubmitError(error.message);
      else {
        setUncertain(true);
        setSubmitError("暂时无法确认是否受理，请先查看个人历史。");
      }
    } finally {
      if (!request.signal.aborted) setSubmitting(false);
      if (submission.current === request) submission.current = null;
    }
  }

  return (
    <form className="creation-form" aria-labelledby="upload-heading" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 id="upload-heading">上传素材</h2>
      <div className="upload-grid">
        {slots.map((slot, index) => (
          <div className="upload-slot" key={index}>
            <label className="file-picker" htmlFor={`asset-slot-${index}`}>
              <span className="file-picker-symbol" aria-hidden="true">{slot ? "↥" : "+"}</span>
              <span>素材 {index + 1}</span>
              <small aria-hidden="true">{slot ? "替换图片" : "点击上传图片"}</small>
            </label>
            <input id={`asset-slot-${index}`} type="file" aria-label={`素材 ${index + 1}`} accept={template.acceptedMimeTypes.join(",")}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) choose(index, file);
              }} />
            {slot && <>
              {slot.preview && <Image className="local-image" src={slot.preview} alt={`素材 ${index + 1} 预览`}
                width={320} height={180} unoptimized />}
              <p className="file-name">{slot.file.name}</p>
              {slot.state === "uploading" && <p role="status">上传中…</p>}
              {slot.state === "ready" && <p role="status">已就绪</p>}
              {slot.error && <p className="error" role="status">{slot.error}</p>}
              <div className="inline-actions">
                {slot.state === "error" && slot.preview && (
                  <button type="button" onClick={() => void upload(index, slot.file, slot.preview)}>
                    重试上传素材 {index + 1}
                  </button>
                )}
                <button type="button" onClick={() => clearSlot(index)}>移除素材 {index + 1}</button>
              </div>
            </>}
          </div>
        ))}
      </div>
      <p className="simulation-note">模拟制作完成后展示模板示例图</p>
      <button className="primary" disabled={!ready || submitting} type="submit">
        {submitting ? "提交中…" : "开始制作"}
      </button>
      {submitError && <p className="notice error" role="status">{submitError}
        {uncertain && <> <Link href="/history" target="_blank" rel="noopener">查看个人历史（新标签页）</Link></>}
      </p>}
    </form>
  );
}
