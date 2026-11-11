"use client";

import Image from "next/image";
import Link from "next/link";
import { errorMessage } from "@/lib/api";
import type { TemplateList as TemplateData } from "@/lib/api";
import { useResource } from "@/lib/use-resource";

export function categoryQuery(category?: string) {
  return category ? "?" + new URLSearchParams({ category }).toString() : "";
}

export function TemplateList({ category }: { category?: string }) {
  const query = categoryQuery(category);
  const { resource, retry } = useResource<TemplateData>("/api/templates" + query);
  return <>
    <h1 className="visually-hidden">模板列表</h1>
    {resource.status === "loading" && <p className="notice" role="status">正在加载模板…</p>}
    {resource.status === "error" && <p className="notice error">
      {errorMessage(resource.error, "模板加载失败")} <button type="button" onClick={retry}>重试</button>
    </p>}
    {resource.status === "ready" && <>
      <nav className="categories" aria-label="模板分类">
        <Link aria-current={!category ? "page" : undefined} href="/">全部</Link>
        {resource.data.categories.map((item) => (
          <Link key={item} aria-current={category === item ? "page" : undefined} href={"/" + categoryQuery(item)}>
            {item}
          </Link>
        ))}
      </nav>
      {resource.data.templates.length === 0 && <p className="notice">暂无符合条件的模板</p>}
      <div className="template-grid">
        {resource.data.templates.map((template) => (
          <Link className="template-card" key={template.id} href={`/templates/${encodeURIComponent(template.id)}${query}`}>
            <Image className="template-image" src={template.coverUrl} alt="" width={640} height={400} unoptimized />
            <div className="template-copy">
              <h2>{template.title}</h2>
            </div>
          </Link>
        ))}
      </div>
    </>}
  </>;
}
