"use client";

import { SetupShell } from "@/components/setup/SetupShell";
import { DemoTournamentForm } from "@/components/setup/DemoTournamentForm";

export default function DemoTournamentPage() {
  return (
    <SetupShell>
      <DemoTournamentForm />
    </SetupShell>
  );
}
