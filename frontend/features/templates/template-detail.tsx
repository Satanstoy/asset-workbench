"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useIdentity } from "@/features/identity/session";
import { TaskCards } from "@/features/tasks/task-cards";
import { useTasks } from "@/features/tasks/use-tasks";
import { CreationForm } from "@/features/upload/creation-form";
import { ApiError, errorMessage } from "@/lib/api";
import type { Template } from "@/lib/api";
import { useResource } from "@/lib/use-resource";
import { categoryQuery } from "./template-list";

function CreationArea({ template, overview }: { template: Template; overview: ReactNode }) {
  const { entries, add, listState, retry, reload, reconcile } = useTasks(template.id);
  return (
    <div className="studio">
      <div className="studio-sidebar">
        {overview}
        <CreationForm template={template} onAccepted={add} />
      </div>
      <section className="results" aria-label="制作任务">
        <div className="section-heading">
          <h2>制作任务</h2>
          <Link href="/history">查看个人历史</Link>
        </div>
        {listState === "loading" && <p className="notice" role="status">正在加载制作任务…</p>}
        {listState === "error" && <p className="notice error">制作任务加载失败 <button type="button" onClick={reload}>重试</button></p>}
        {listState === "ready" && entries.length === 0 && <p className="notice">这个模板暂无制作任务</p>}
        <TaskCards entries={entries} retry={(id) => void retry(id)} reconcile={reconcile} />
      </section>
    </div>
  );
}

export function TemplateDetail({ id, category }: { id: string; category?: string }) {
  const { busy, user, epoch, openAccount } = useIdentity();
  const { resource, retry } = useResource<Template>("/api/templates/" + encodeURIComponent(id));
  const back = "/" + categoryQuery(category);
  const returnLink = <Link className="back-link" href={back} aria-label="返回模板列表">‹</Link>;
  if (resource.status === "loading") return <>{returnLink}<p className="notice" role="status">正在加载模板详情…</p></>;
  if (resource.status === "error") return <>{returnLink}<p className="notice error">
    {errorMessage(resource.error, "模板详情加载失败")}
    {!(resource.error instanceof ApiError && resource.error.status === 404)
      && <> <button type="button" onClick={retry}>重试</button></>}
  </p></>;

  const template = resource.data;
  const overview = (
    <section className="template-detail">
      <div className="detail-heading">{returnLink}<h1>{template.title}</h1></div>
      <div className="detail-cover">
        <Image className="cover-backdrop" src={template.coverUrl} alt="" fill unoptimized />
        <Image className="template-image" src={template.coverUrl} alt={`${template.title}封面`}
          width={640} height={400} unoptimized />
      </div>
      <p>{template.description}</p>
      <ul className="requirements">
        <li>需要 {template.requiredImageCount} 张图片</li>
        <li>格式 {template.acceptedMimeTypes.map((mime) => mime.split("/").at(-1)?.toUpperCase()).join(" / ")}</li>
        <li>每张不超过 {template.maxFileSizeBytes / 1048576} MiB</li>
        <li>每张不超过 {template.maxImagePixels / 10000} 万像素</li>
      </ul>
    </section>
  );
  if (!busy && user) return <CreationArea key={epoch} template={template} overview={overview} />;
  return (
    <div className="studio">
      <div className="studio-sidebar">{overview}
        <div className="notice">
          <p>{busy ? "正在确认演示身份…" : "选择演示身份后可以上传素材"}</p>
          {!busy && <button type="button" onClick={openAccount}>选择演示身份</button>}
        </div>
      </div>
      <section className="results" aria-label="制作任务">
        <div className="section-heading"><h2>制作任务</h2><Link href="/history">查看个人历史</Link></div>
        <p className="notice">{busy ? "正在加载会话…" : "选择演示身份后查看制作任务"}</p>
      </section>
    </div>
  );
}
