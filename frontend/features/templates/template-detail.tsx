"use client";

import Image from "next/image";
import Link from "next/link";
import { useIdentity } from "@/features/identity/session";
import { TaskCards } from "@/features/tasks/task-cards";
import { useTasks } from "@/features/tasks/use-tasks";
import { CreationForm } from "@/features/upload/creation-form";
import { ApiError, errorMessage } from "@/lib/api";
import type { Template } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { categoryQuery } from "./template-list";

function CreationArea({ template }: { template: Template }) {
  const { entries, add, listState, retry, reload, reconcile } = useTasks(template.id);
  return <>
    <CreationForm template={template} onAccepted={add} />
    <section className="results" aria-label="制作任务">
      <div className="section-heading"><h2>制作任务</h2><Link href="/history">查看个人历史</Link></div>
      {listState === "loading" && <p className="notice" role="status">正在加载制作任务…</p>}
      {listState === "error" && <p className="notice error">制作任务加载失败 <button type="button" onClick={reload}>重试</button></p>}
      {listState === "ready" && entries.length === 0 && <p className="notice">当前没有待跟踪的制作任务</p>}
      <TaskCards entries={entries} retry={(id) => void retry(id)} reconcile={reconcile} />
    </section>
  </>;
}

export function TemplateDetail({ id, category }: { id: string; category?: string }) {
  const { busy, user, epoch } = useIdentity();
  const { resource, retry } = useResource<Template>("/api/templates/" + encodeURIComponent(id));
  const back = "/" + categoryQuery(category);
  return <>
    <Link className="back-link" href={back}>← <span>返回模板列表</span></Link>
    {resource.status === "loading" && <p className="notice" role="status">正在加载模板详情…</p>}
    {resource.status === "error" && <p className="notice error">
      {errorMessage(resource.error, "模板详情加载失败")}
      {!(resource.error instanceof ApiError && resource.error.status === 404)
        && <> <button type="button" onClick={retry}>重试</button></>}
    </p>}
    {resource.status === "ready" && <>
      <section className="template-detail">
        <Image className="template-image" src={resource.data.coverUrl} alt={`${resource.data.title}封面`}
          width={640} height={400} unoptimized />
        <div>
          <span className="eyebrow">{resource.data.category}</span>
          <h1>{resource.data.title}</h1>
          <p>{resource.data.description}</p>
          <ul className="requirements">
            <li>需要 {resource.data.requiredImageCount} 张图片</li>
            <li>格式 {resource.data.acceptedMimeTypes.map((mime) => mime.split("/").at(-1)?.toUpperCase()).join(" / ")}</li>
            <li>每张不超过 {resource.data.maxFileSizeBytes / 1048576} MiB</li>
            <li>每张不超过 {resource.data.maxImagePixels / 10000} 万像素</li>
          </ul>
        </div>
      </section>
      {busy ? <p className="notice">正在确认演示身份…</p> : user
        ? <CreationArea key={epoch} template={resource.data} />
        : <p className="notice">选择演示身份后可以上传素材</p>}
    </>}
  </>;
}
