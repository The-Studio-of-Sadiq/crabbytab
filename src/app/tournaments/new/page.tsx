"use client";

import { SetupShell, useRequireLogin } from "@/components/setup/SetupShell";
import { TournamentWizard } from "@/components/setup/TournamentWizard";

export default function NewTournamentPage() {
  const { ready } = useRequireLogin("/tournaments/new");

  return (
    <SetupShell>
      {ready ? (
        <TournamentWizard />
      ) : (
        <p className="text-sm text-gray-500">Checking your session...</p>
      )}
    </SetupShell>
  );
}
