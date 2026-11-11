"use client";

import Image from "next/image";
import { useState } from "react";
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

export function TaskCards({ entries, retry, reconcile }: {
  entries: TaskEntry[];
  retry: (id: string) => void;
  reconcile: (id: string) => void;
}) {
  return (
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
        </article>
      ))}
    </div>
  );
}
