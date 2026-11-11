"use client";

import { useIdentity } from "@/features/identity/session";
import { TaskCards } from "./task-cards";
import { useTasks } from "./use-tasks";

function Records({ displayName }: { displayName: string }) {
  const { entries, listState, retry, reload, reconcile, remove } = useTasks();
  return <>
    <div className="section-heading">
      <h1>个人历史</h1>
      <div className="inline-actions"><span className="subtle">{displayName}</span>
        <button type="button" disabled={listState === "loading"} onClick={reload}>刷新历史</button>
      </div>
    </div>
    {listState === "loading" && <p role="status" className="notice">正在加载个人历史…</p>}
    {listState === "error" && <p className="notice error">个人历史加载失败 <button type="button" onClick={reload}>重试</button></p>}
    {listState === "ready" && entries.length === 0 && <p className="notice">暂无制作任务</p>}
    <TaskCards entries={entries} retry={(id) => void retry(id)} reconcile={reconcile} remove={remove} />
  </>;
}

export function History() {
  const { busy, user, epoch, openAccount } = useIdentity();
  return <>
    {(busy || !user) && <h1>个人历史</h1>}
    {busy ? <p className="notice">正在确认演示身份…</p>
      : user ? <Records key={epoch} displayName={user.displayName} /> : (
        <div className="notice">
          <p>请选择演示身份后查看个人历史</p>
          <button type="button" onClick={openAccount}>选择演示身份</button>
        </div>
      )}
  </>;
}
