"use client";

import { useIdentity } from "@/features/identity/session";
import { TaskCards } from "./task-cards";
import { useTasks } from "./use-tasks";

function Records() {
  const { entries, listState, retry, reload, reconcile } = useTasks();
  return <>
    {listState === "loading" && <p role="status" className="notice">正在加载个人历史…</p>}
    {listState === "error" && <p className="notice error">个人历史加载失败 <button type="button" onClick={reload}>重试</button></p>}
    {listState === "ready" && entries.length === 0 && <p className="notice">暂无制作任务</p>}
    <TaskCards entries={entries} retry={(id) => void retry(id)} reconcile={reconcile} />
  </>;
}

export function History() {
  const { busy, user, epoch } = useIdentity();
  return <>
    <section className="intro"><span className="eyebrow">工作台 / 记录</span><h1>个人历史</h1>
      <p>查看已受理的制作任务、制作阶段和结果。</p></section>
    {busy ? <p className="notice">正在确认演示身份…</p>
      : user ? <Records key={epoch} /> : <p className="notice">请选择演示身份后查看个人历史</p>}
  </>;
}
