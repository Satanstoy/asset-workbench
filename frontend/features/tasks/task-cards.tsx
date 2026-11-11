"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import type { Task } from "@/lib/api";
import type { TaskEntry } from "./use-tasks";

const statuses: Record<Task["status"], string> = {
  PENDING: "等待处理", PROCESSING: "处理中", SUCCEEDED: "成功", FAILED: "失败",
};
const stages: Record<NonNullable<Task["stage"]>, string> = {
  CHECK_ASSETS: "素材检查", GENERATE: "模拟生成", FINALIZE: "结果整理",
};

function ResultPreview({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const url = attempt ? src + (src.includes("?") ? "&" : "?") + "retry=" + attempt : src;
  return failed ? (
    <p className="notice">
      预览暂不可用 <button type="button" onClick={() => { setAttempt(attempt + 1); setFailed(false); }}>重试预览</button>
    </p>
  ) : (
    <Image className="result-image" src={url} alt="制作结果" width={640} height={400} unoptimized
      onError={() => setFailed(true)} />
  );
}

export function TaskCards({ entries, retry, reconcile, remove }: {
  entries: TaskEntry[];
  retry: (id: string) => void;
  reconcile: (id: string) => void;
  remove: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function confirmDelete() {
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await remove(target.id);
      dialog.current?.close();
    } catch (error) {
      setDeleteError(errorMessage(error, "暂时无法删除任务，请重试"));
    } finally {
      setDeleting(false);
    }
  }

  return <>
    <div className="task-grid">
      {entries.map(({ task, queryError, unavailable }) => (
        <article className="task-card" aria-label={`任务 ${task.id}`} key={task.id}>
          <div className="task-display">
            {task.status === "SUCCEEDED" && task.resultUrl ? (
              <ResultPreview key={task.resultUrl} src={task.resultUrl} />
            ) : (
              <div className="task-state">
                <span className={`status status-${task.status.toLowerCase()}`}>{statuses[task.status]}</span>
                {task.failure && <p className="error">{task.failure.message}</p>}
              </div>
            )}
          </div>
          <div className="task-card-heading">
            <h3>{task.templateTitle}</h3>
            {task.status === "SUCCEEDED" && <span className="status status-succeeded">成功</span>}
          </div>
          <p className="task-meta">任务 #{task.id} · <time dateTime={task.createdAt}>
            {new Date(task.createdAt).toLocaleString("zh-CN")}
          </time></p>
          {task.stage && <p className="task-meta">制作阶段 · {stages[task.stage]}</p>}
          {task.status === "SUCCEEDED" && <p className="subtle">
            {task.resultUrl === `/api/tasks/${task.id}/result` ? "上传素材拼贴" : "模拟制作 · 示例结果"}
          </p>}
          {queryError && <p className="notice">暂时无法更新进度 <button type="button" onClick={() => retry(task.id)}>立即重试</button></p>}
          {unavailable && <p className="notice">任务暂时不可查 <button type="button" onClick={() => reconcile(task.id)}>重新核对</button></p>}
          {(task.status === "SUCCEEDED" || task.status === "FAILED") && (
            <button className="task-delete" type="button" aria-label={`删除任务 ${task.id}`} onClick={() => {
              setTarget(task);
              setDeleteError("");
              dialog.current?.showModal();
            }}>删除</button>
          )}
        </article>
      ))}
    </div>
    <dialog className="account-dialog" ref={dialog} aria-labelledby="delete-task-title"
      onCancel={(event) => { if (deleting) event.preventDefault(); }}>
      <h2 id="delete-task-title">删除任务</h2>
      <p>删除后，任务 #{target?.id} 将从制作任务和个人历史中移除。</p>
      {deleteError && <p role="alert" className="error">{deleteError}</p>}
      <div className="inline-actions">
        <button type="button" disabled={deleting} onClick={() => dialog.current?.close()}>取消</button>
        <button type="button" disabled={deleting} onClick={() => void confirmDelete()}>
          {deleting ? "正在删除…" : "确认删除"}
        </button>
      </div>
    </dialog>
  </>;
}
