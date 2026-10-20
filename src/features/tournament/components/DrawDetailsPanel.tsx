"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Field";
import { Table, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import type { DebateSide } from "@/types";
import type { RoundSide, TeamDrawDetails } from "@/lib/draw/drawFlags";

/**
 * "Draw details": one row per team with its points, this round's room and opponents, sides by
 * round, previous opponents and pull-ups, for checking a draw before it is released.
 */

type T = ReturnType<typeof useI18n>["t"];

function sideText(side: RoundSide | null, t: T): string {
  if (side === null) return "—";
  if (side === "bye") return t("tabroom.draw.details.bye");
  if (side === "tbc") return t("tabroom.draw.details.tbc");
  return side;
}

function sideTitle(side: RoundSide | null, t: T): string {
  if (side === null) return t("tabroom.draw.details.didNotDebate");
  if (side === "bye") return t("tabroom.draw.details.bye");
  if (side === "tbc") return t("tabroom.draw.details.tbcTitle");
  return side;
}

export function DrawDetailsPanel({ rows, sides }: { rows: TeamDrawDetails[]; sides: readonly DebateSide[] }) {
  const { t, formatList, formatNumber } = useI18n();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return rows;
    return rows.filter((row) =>
      [row.teamName, row.institutionName ?? "", ...row.opponents.map((opponent) => opponent.teamName)]
        .some((value) => value.toLowerCase().includes(text))
    );
  }, [rows, query]);
  const roundLabels = rows[0]?.sidesByRound.map((entry) => entry.roundLabel) ?? [];
  const columnCount = 6 + roundLabels.length;

  return (
    <Card role="region" aria-labelledby="draw-details-heading">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="draw-details-heading" className="text-sm font-semibold text-fg">{t("tabroom.draw.details.title")}</h2>
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tabroom.draw.details.filterPlaceholder")}
          aria-label={t("tabroom.draw.details.filterAria")}
          leadingIcon={<Search />}
          wrapperClassName="w-full max-w-xs"
          className="h-7 text-xs"
        />
      </div>
      <div className="overflow-x-auto">
        <Table className="text-xs">
          <caption className="sr-only">{t("tabroom.draw.details.caption")}</caption>
          <THead>
            <TR>
              <TH>{t("tabroom.draw.details.team")}</TH>
              <TH align="right">{t("tabroom.draw.details.points")}</TH>
              <TH>{t("tabroom.draw.details.thisRound")}</TH>
              {roundLabels.map((label) => (
                <TH key={label}>{label}</TH>
              ))}
              <TH>{t("tabroom.draw.details.sides")}</TH>
              <TH>{t("tabroom.draw.details.previousOpponents")}</TH>
              <TH align="right">{t("tabroom.draw.details.pullups")}</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((row) => (
              <TR key={row.teamId} className="align-top">
                <TH scope="row" className="whitespace-normal bg-transparent text-xs font-semibold normal-case tracking-normal text-fg">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {row.teamName}
                    {row.isSwing && <Badge>{t("tabroom.draw.details.swing")}</Badge>}
                  </span>
                  {row.institutionName && <div className="text-[11px] font-normal text-fg-muted">{row.institutionName}</div>}
                </TH>
                <TD numeric>{row.points === undefined ? "—" : formatNumber(row.points)}</TD>
                <TD className="align-top">
                  {row.current ? (
                    <>
                      <span className="font-semibold">
                        {row.current.side === "bye" ? t("tabroom.draw.details.bye") : row.current.room}
                      </span>{" "}
                      {row.current.side !== "bye" && (
                        <span title={sideTitle(row.current.side, t)}>({sideText(row.current.side, t)})</span>
                      )}
                      {row.current.opponents.length > 0 && (
                        <div className="text-fg-muted">
                          {t("tabroom.draw.details.versus", { opponents: formatList(row.current.opponents) })}
                        </div>
                      )}
                      {row.current.pulledUp && (
                        <div className="font-semibold text-warning">{t("tabroom.draw.details.pulledUp")}</div>
                      )}
                    </>
                  ) : (
                    <span className="font-semibold text-danger">{t("tabroom.draw.details.notPlaced")}</span>
                  )}
                </TD>
                {row.sidesByRound.map((entry) => (
                  <TD
                    key={entry.roundLabel}
                    className="align-top"
                    title={t("tabroom.draw.details.roundSideTitle", { round: entry.roundLabel, side: sideTitle(entry.side, t) })}
                  >
                    {sideText(entry.side, t)}
                  </TD>
                ))}
                <TD className="whitespace-nowrap align-top">
                  {sides.map((side) => `${side} ${row.sideCounts[side] ?? 0}`).join(" · ")}
                </TD>
                <TD className="align-top text-fg-muted">
                  {row.opponents.length === 0
                    ? "—"
                    : row.opponents.map((opponent) => `${opponent.teamName} (${opponent.rounds.join(", ")})`).join("; ")}
                </TD>
                <TD numeric className="align-top">{formatNumber(row.pullups)}</TD>
              </TR>
            ))}
            {filtered.length === 0 && <TableEmpty colSpan={columnCount}>{t("tabroom.draw.details.noMatch")}</TableEmpty>}
          </TBody>
        </Table>
      </div>
    </Card>
  );
}
