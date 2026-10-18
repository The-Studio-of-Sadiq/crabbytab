"use client";

import { SetupShell } from "@/components/setup/SetupShell";
import { DebateXmlImportForm } from "@/components/setup/DebateXmlImportForm";

export default function ImportTournamentPage() {
  return (
    <SetupShell>
      <DebateXmlImportForm />
    </SetupShell>
  );
}
