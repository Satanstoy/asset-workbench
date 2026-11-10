import { TemplateList } from "@/features/templates/template-list";

export default async function TemplateListPage({ searchParams }: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const { category } = await searchParams;
  const selected = typeof category === "string" ? category : undefined;
  return <TemplateList key={selected} category={selected} />;
}
