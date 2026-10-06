"use client";

import { SetupShell } from "@/components/setup/SetupShell";
import { TournamentWizard } from "@/components/setup/TournamentWizard";

export default function NewTournamentPage() {
  return (
    <SetupShell>
      <TournamentWizard />
    </SetupShell>
  );
}
