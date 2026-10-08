import { notFound } from "next/navigation";
import ImportDirectory from "../ImportDirectory";

const importTypes = ["institutions", "teams", "adjudicators"] as const;

export default async function ImportTypePage({
  params,
}: {
  params: Promise<{ importType: string }>;
}) {
  const { importType } = await params;
  const category = importTypes.find((type) => type === importType);
  if (!category) notFound();

  return <ImportDirectory category={category} />;
}
