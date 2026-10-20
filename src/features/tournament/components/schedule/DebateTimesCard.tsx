"use client";

import React, { useMemo, useState } from "react";
import { Clock } from "lucide-react";
import type { Debate } from "@/types";
import { useTournament } from "@/contexts/TournamentContext";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { Table, TableContainer, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/Table";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/schedule/time";

function teamsLabel(debate: Debate): string {
  return Object.values(debate.teams || {}).map((slot) => slot?.teamName).filter(Boolean).join(" vs ") || debate.id;
}

/** Per-debate start times, for debates that do not start with their round (staggered rooms). */
export function DebateTimesCard() {
  const { rounds, debates, activeRound, isOwnerOrAdmin, updateDebates } = useTournament();
  const live = rounds.filter((round) => !round.cancelled).sort((left, right) => left.seq - right.seq);
  const [roundId, setRoundId] = useState(activeRound?.id ?? "");
  const selectedRoundId = roundId || activeRound?.id || live[0]?.id || "";
  const round = rounds.find((item) => item.id === selectedRoundId);
  const roundDebates = useMemo(
    () => debates.filter((debate) => debate.roundId === selectedRoundId).sort((left, right) => left.roomRank - right.roomRank),
    [debates, selectedRoundId]
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const changed = roundDebates.flatMap((debate) => {
    if (!(debate.id in drafts)) return [];
    const value = drafts[debate.id];
    if (value === "") {
      if (!debate.scheduledTime) return [];
      const { scheduledTime: _removed, ...rest } = debate;
      void _removed;
      return [rest as Debate];
    }
    const iso = fromDateTimeLocalValue(value);
    return iso && iso !== debate.scheduledTime ? [{ ...debate, scheduledTime: iso }] : [];
  });
  const invalid = Object.entries(drafts).some(([, value]) => value !== "" && !fromDateTimeLocalValue(value));

  return (
    <Card>
      <CardHeader
        icon={<Clock aria-hidden="true" />}
        title="Debate times"
        description="Debates start with their round unless you give one its own time."
        actions={
          <Select
            aria-label="Round"
            value={selectedRoundId}
            onChange={(event) => {
              setRoundId(event.target.value);
              setDrafts({});
            }}
            className="h-8 w-44"
          >
            {live.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        }
      />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger" role="alert">{error}</Alert>}
        {saved && <Alert tone="success" role="status">{saved}</Alert>}
        <TableContainer className="max-h-96">
          <Table>
            <THead>
              <TR>
                <TH>Venue</TH>
                <TH>Debate</TH>
                <TH>Starts at</TH>
              </TR>
            </THead>
            <TBody>
              {roundDebates.length === 0 && <TableEmpty colSpan={3}>{round ? `${round.name} has no draw yet.` : "No rounds yet."}</TableEmpty>}
              {roundDebates.map((debate) => (
                <TR key={debate.id}>
                  <TD>{debate.venueName || "—"}</TD>
                  <TD className="max-w-xs truncate">{teamsLabel(debate)}</TD>
                  <TD>
                    <Input
                      aria-label={`Start time for ${teamsLabel(debate)}`}
                      type="datetime-local"
                      value={drafts[debate.id] ?? toDateTimeLocalValue(debate.scheduledTime)}
                      placeholder={toDateTimeLocalValue(round?.startsAt)}
                      disabled={!isOwnerOrAdmin || busy}
                      onChange={(event) => setDrafts((all) => ({ ...all, [debate.id]: event.target.value }))}
                      className="h-8 w-52"
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
        {isOwnerOrAdmin && (
          <Button
            variant="primary"
            loading={busy}
            disabled={changed.length === 0 || invalid}
            onClick={async () => {
              setBusy(true);
              setError("");
              setSaved("");
              try {
                const byId = new Map(changed.map((debate) => [debate.id, debate]));
                await updateDebates(debates.map((debate) => byId.get(debate.id) ?? debate));
                setDrafts({});
                setSaved(`${changed.length} debate time${changed.length === 1 ? "" : "s"} saved.`);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "Could not save the debate times.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Save debate times
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
