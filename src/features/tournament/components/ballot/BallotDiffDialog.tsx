"use client";

import React, { useRef } from "react";
import { GitCompare } from "lucide-react";
import type { BallotDifference } from "@/lib/ballots/result";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Table, TableContainer, TBody, TD, TH, THead, TR } from "@/components/ui/Table";

interface BallotDiffDialogProps {
  differences: BallotDifference[];
  firstLabel: string;
  secondLabel: string;
  busy?: boolean;
  onKeepFirst: () => void;
  onKeepSecond: () => void;
  onClose: () => void;
}

/** Shown when a blind check does not match the entry it checks; the checker picks which to record. */
export function BallotDiffDialog({
  differences,
  firstLabel,
  secondLabel,
  busy,
  onKeepFirst,
  onKeepSecond,
  onClose,
}: BallotDiffDialogProps) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      initialFocusRef={closeRef}
      icon={<GitCompare className="text-warning" aria-hidden="true" />}
      title={t("results.ballot.diff.title")}
      description={t("results.ballot.diff.description")}
      footer={
        <>
          <Button ref={closeRef} variant="secondary" onClick={onClose} disabled={busy}>
            {t("results.ballot.diff.goBack")}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onKeepFirst}>
            {t("results.ballot.diff.record", { entry: firstLabel })}
          </Button>
          <Button variant="primary" disabled={busy} onClick={onKeepSecond}>
            {t("results.ballot.diff.record", { entry: secondLabel })}
          </Button>
        </>
      }
    >
      <TableContainer className="max-h-80">
        <Table>
          <THead>
            <TR>
              <TH>{t("results.ballot.diff.field")}</TH>
              <TH>{firstLabel}</TH>
              <TH>{secondLabel}</TH>
            </TR>
          </THead>
          <TBody>
            {differences.map((difference) => (
              <TR key={difference.field}>
                <TD className="font-medium">{difference.field}</TD>
                <TD className="font-mono text-xs">{difference.first}</TD>
                <TD className="font-mono text-xs">{difference.second}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </Dialog>
  );
}
