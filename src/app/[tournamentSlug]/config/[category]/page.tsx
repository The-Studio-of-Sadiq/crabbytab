import { notFound } from "next/navigation";
import ConfigForm from "../ConfigForm";

const categories = ["draw", "rounds", "format", "scoring", "standings", "visibility"] as const;

export default async function ConfigCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category: categoryParam } = await params;
  const category = categories.find((value) => value === categoryParam);
  if (!category) notFound();

  return <ConfigForm category={category} />;
}
