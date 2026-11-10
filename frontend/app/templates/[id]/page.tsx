import { TemplateDetail } from "@/features/templates/template-detail";

export default async function TemplateDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const { id } = await params;
  const { category } = await searchParams;
  return <TemplateDetail key={id} id={id} category={typeof category === "string" ? category : undefined} />;
}
