"use client";

import React, { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useTournament } from "@/contexts/TournamentContext";
import {
  Key,
  Copy,
  ExternalLink,
  Check,
  Search,
  RefreshCw,
  FileCheck2,
  MessageSquareHeart,
  Share2,
  Printer,
} from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { QrCode } from "@/components/ui/QrCode";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button, IconButton, iconButtonClasses } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { Table, TableContainer, TableEmpty, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import {
  buildPrivateUrlSlips,
  generatePrivateKey,
  getAbsolutePrivateUrl,
  getAdjudicatorPrivatePath,
  getTeamPrivatePath,
} from "@/lib/privateUrls";

type ParticipantTab = "adjudicators" | "teams";
const TABS_ID = "private-urls";

export default function PrivateUrlsManagementPage() {
  const params = useParams();
  const tournamentSlug = params.tournamentSlug as string;
  const { t, rich } = useI18n();

  const {
    tournament,
    loading,
    teams,
    adjudicators,
    generatePrivateUrlKeys,
    updateAdjudicator,
    updateTeam,
  } = useTournament();

  const [activeTab, setActiveTab] = useState<ParticipantTab>("adjudicators");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  // Announced through a role="status" region whenever something is copied.
  const [copyAnnouncement, setCopyAnnouncement] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [copiedAllNotice, setCopiedAllNotice] = useState(false);
  const [actionError, setActionError] = useState("");
  const [includePasscodeOnSlips, setIncludePasscodeOnSlips] = useState(true);
  // Slips (and their QR codes) are only rendered while printing, to keep the page light.
  const [printingSlips, setPrintingSlips] = useState(false);

  React.useEffect(() => {
    if (!printingSlips) return;
    const finish = () => setPrintingSlips(false);
    window.addEventListener("afterprint", finish);
    window.print();
    return () => window.removeEventListener("afterprint", finish);
  }, [printingSlips]);

  // Auto-generate keys on first visit if any are missing
  React.useEffect(() => {
    if (loading) return;
    const missingAdjCredentials = adjudicators.some((a) => !a.privateUrlKey || !a.privatePasscode);
    const missingTeamKeys = teams.some((team) => !team.privateUrlKey || !team.privatePasscode);
    if (missingAdjCredentials || missingTeamKeys) {
      generatePrivateUrlKeys(false);
    }
  }, [loading, adjudicators, teams, generatePrivateUrlKeys]);

  const handleCopy = (text: string, keyId: string, announcement: string) => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(keyId);
      setCopyAnnouncement(announcement);
      setTimeout(() => {
        setCopiedKey(null);
        setCopyAnnouncement("");
      }, 2500);
    }
  };

  const handleGenerate = async (forceRegenerate = false) => {
    setIsGenerating(true);
    try {
      await generatePrivateUrlKeys(forceRegenerate);
      setShowRegenConfirm(false);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGeneratePasscode = async (adjId: string) => {
    const adjudicator = adjudicators.find((item) => item.id === adjId);
    if (!adjudicator) return;
    setActionError("");
    try {
      await updateAdjudicator({ ...adjudicator, privatePasscode: generatePrivateKey() });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("setup.email.privateUrls.passcodeFailed"));
    }
  };

  const handleGenerateTeamPasscode = async (teamId: string) => {
    const team = teams.find((item) => item.id === teamId);
    if (!team) return;
    setActionError("");
    try {
      await updateTeam({ ...team, privatePasscode: generatePrivateKey() });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("setup.email.privateUrls.passcodeFailed"));
    }
  };

  // Filter adjudicators
  const filteredAdjudicators = useMemo(() => {
    return adjudicators.filter((a) => {
      const q = searchQuery.toLowerCase();
      return (
        a.name.toLowerCase().includes(q) ||
        (a.institutionName && a.institutionName.toLowerCase().includes(q)) ||
        (a.email && a.email.toLowerCase().includes(q))
      );
    });
  }, [adjudicators, searchQuery]);

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const q = searchQuery.toLowerCase();
      const matchSpk = team.speakers?.some((s) => s.name.toLowerCase().includes(q));
      return (
        team.name.toLowerCase().includes(q) ||
        (team.institutionName && team.institutionName.toLowerCase().includes(q)) ||
        Boolean(matchSpk)
      );
    });
  }, [teams, searchQuery]);

  // The copied table is a spreadsheet export: its headers and values stay in English.
  const handleCopyAll = () => {
    const lines: string[] = [];
    if (activeTab === "adjudicators") {
      lines.push("Name\tInstitution\tRole\tPrivate URL\tPersonal Passcode");
      filteredAdjudicators.forEach((a) => {
        const key = a.privateUrlKey;
        if (!key) return;
        const url = getAbsolutePrivateUrl(tournamentSlug, "adjudicator", key);
        lines.push(`${a.name}\t${a.institutionName || "Unaffiliated"}\t${a.trainee ? "Trainee" : "Judge"}\t${url}\t${a.privatePasscode || ""}`);
      });
    } else {
      lines.push("Team Name\tInstitution\tSpeakers\tPrivate URL\tPersonal Passcode");
      filteredTeams.forEach((team) => {
        const key = team.privateUrlKey;
        if (!key) return;
        const url = getAbsolutePrivateUrl(tournamentSlug, "team", key);
        const spks = (team.speakers || []).map((s) => s.name).join(", ");
        lines.push(`${team.name}\t${team.institutionName || "Unaffiliated"}\t${spks}\t${url}\t${team.privatePasscode || ""}`);
      });
    }

    if (navigator?.clipboard) {
      navigator.clipboard.writeText(lines.join("\n"));
      setCopiedAllNotice(true);
      setCopyAnnouncement(t("setup.email.privateUrls.copiedList"));
      setTimeout(() => {
        setCopiedAllNotice(false);
        setCopyAnnouncement("");
      }, 3000);
    }
  };

  // Slips follow the current tab and search, like "Copy current list".
  const slipParticipants = activeTab === "adjudicators"
    ? filteredAdjudicators.map((adjudicator) => ({
        ...adjudicator,
        detail: adjudicator.institutionName || t("setup.email.privateUrls.independent"),
      }))
    : filteredTeams.map((team) => ({
        ...team,
        detail: [team.institutionName, (team.speakers || []).map((speaker) => speaker.name).join(", ")]
          .filter(Boolean)
          .join(" · "),
      }));
  const slips = buildPrivateUrlSlips(
    slipParticipants,
    activeTab === "adjudicators" ? "adjudicator" : "team",
    {
      origin: typeof window === "undefined" ? "" : window.location.origin,
      tournamentSlug,
      includePasscode: includePasscodeOnSlips,
    }
  );

  const privateLinkCell = (path: string) => (
    <span className="block max-w-xs truncate rounded border border-border bg-muted px-2 py-1 font-mono text-[11px] text-fg">
      {path || t("setup.email.privateUrls.generatingLink")}
    </span>
  );

  const passcodeCell = (
    id: string,
    name: string,
    passcode: string | undefined,
    onGenerate: () => void
  ) =>
    passcode ? (
      <div className="flex items-center gap-1.5">
        <span className="rounded border border-border bg-muted px-2 py-1 font-mono text-[11px] text-fg">{passcode}</span>
        <IconButton
          size="sm"
          variant="secondary"
          label={t("setup.email.privateUrls.copyPasscodeFor", { name })}
          icon={copiedKey === `${id}:passcode` ? <Check className="text-success" aria-hidden="true" /> : <Copy aria-hidden="true" />}
          onClick={() => handleCopy(passcode, `${id}:passcode`, t("setup.email.privateUrls.copiedPasscodeFor", { name }))}
        />
      </div>
    ) : (
      <Button size="sm" onClick={onGenerate}>
        {t("setup.email.privateUrls.generatePasscode")}
      </Button>
    );

  const linkActions = (id: string, name: string, fullUrl: string, path: string, key: string | undefined) => (
    <div className="flex items-center justify-end gap-1.5">
      <IconButton
        size="sm"
        variant="secondary"
        label={t("setup.email.privateUrls.copyLinkFor", { name })}
        icon={copiedKey === id ? <Check className="text-success" aria-hidden="true" /> : <Copy aria-hidden="true" />}
        onClick={() => handleCopy(fullUrl, id, t("setup.email.privateUrls.copiedLinkFor", { name }))}
        disabled={!key}
      />
      {key && (
        <Link
          href={path}
          target="_blank"
          rel="noreferrer"
          aria-label={t("setup.email.privateUrls.openPortalFor", { name })}
          title={t("setup.email.privateUrls.openPortalFor", { name })}
          className={iconButtonClasses({ size: "sm" })}
        >
          <ExternalLink aria-hidden="true" />
        </Link>
      )}
    </div>
  );

  return (
    <div className="max-w-5xl space-y-6 pb-16">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Key className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
            {t("setup.email.privateUrls.title")}
          </span>
        }
        description={t("setup.email.privateUrls.description")}
        actions={
          <>
            <Button size="sm" onClick={handleCopyAll}>
              {copiedAllNotice ? (
                <Check className="text-success" aria-hidden="true" />
              ) : (
                <Share2 aria-hidden="true" />
              )}
              {copiedAllNotice ? t("setup.email.privateUrls.copiedList") : t("setup.email.privateUrls.copyList")}
            </Button>
            <Checkbox
              label={t("setup.email.privateUrls.passcodesOnSlips")}
              checked={includePasscodeOnSlips}
              onChange={(event) => setIncludePasscodeOnSlips(event.target.checked)}
            />
            <Button
              size="sm"
              onClick={() => setPrintingSlips(true)}
              disabled={slips.length === 0 || printingSlips}
              title={t("setup.email.privateUrls.printSlipsHelp")}
            >
              <Printer aria-hidden="true" />
              {t("setup.email.privateUrls.printSlips", { count: slips.length })}
            </Button>
            <Button variant="primary" size="sm" onClick={() => handleGenerate(false)} loading={isGenerating}>
              {!isGenerating && <RefreshCw aria-hidden="true" />}
              {t("setup.email.privateUrls.ensureCredentials")}
            </Button>
          </>
        }
      />

      <p role="status" className="sr-only">{copyAnnouncement}</p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader
            headingLevel="h2"
            icon={<FileCheck2 aria-hidden="true" />}
            title={t("setup.email.privateUrls.adjudicatorInfoTitle")}
          />
          <CardBody className="text-xs leading-relaxed text-fg-muted">
            {rich("setup.email.privateUrls.adjudicatorInfo", { b: (text) => <strong className="text-fg">{text}</strong> })}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            headingLevel="h2"
            icon={<MessageSquareHeart aria-hidden="true" />}
            title={t("setup.email.privateUrls.teamInfoTitle")}
          />
          <CardBody className="text-xs leading-relaxed text-fg-muted">
            {rich("setup.email.privateUrls.teamInfo", { b: (text) => <strong className="text-fg">{text}</strong> })}
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <Tabs
          id={TABS_ID}
          ariaLabel={t("setup.email.privateUrls.tabsLabel")}
          value={activeTab}
          onValueChange={setActiveTab}
          items={[
            { value: "adjudicators", label: t("setup.email.privateUrls.tabAdjudicators"), count: adjudicators.length },
            { value: "teams", label: t("setup.email.privateUrls.tabTeams"), count: teams.length },
          ]}
        />
        <Input
          type="search"
          aria-label={activeTab === "adjudicators" ? t("setup.email.privateUrls.searchAdjudicators") : t("setup.email.privateUrls.searchTeams")}
          placeholder={activeTab === "adjudicators" ? t("setup.email.privateUrls.searchAdjudicators") : t("setup.email.privateUrls.searchTeams")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leadingIcon={<Search />}
          className="w-full sm:w-64"
        />
      </div>

      {actionError && <Alert tone="danger" role="alert">{actionError}</Alert>}

      <TabPanel id={TABS_ID} value={activeTab}>
        {activeTab === "adjudicators" ? (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t("setup.email.privateUrls.colAdjudicator")}</TH>
                  <TH>{t("setup.email.privateUrls.colInstitution")}</TH>
                  <TH>{t("setup.email.privateUrls.colRole")}</TH>
                  <TH>{t("setup.email.privateUrls.colPrivateUrl")}</TH>
                  <TH>{t("setup.email.privateUrls.colPasscode")}</TH>
                  <TH align="right">{t("setup.common.actions")}</TH>
                </TR>
              </THead>
              <TBody>
                {filteredAdjudicators.length === 0 ? (
                  <TableEmpty colSpan={6}>{t("setup.email.privateUrls.noAdjudicators")}</TableEmpty>
                ) : (
                  filteredAdjudicators.map((adj) => {
                    const key = adj.privateUrlKey;
                    const fullUrl = key ? getAbsolutePrivateUrl(tournamentSlug, "adjudicator", key) : "";
                    const path = key ? getAdjudicatorPrivatePath(tournamentSlug, key) : "";

                    return (
                      <TR key={adj.id}>
                        <TD className="font-semibold">
                          {adj.name}
                          {adj.email && (
                            <span className="block text-[11px] font-normal text-fg-muted">{adj.email}</span>
                          )}
                        </TD>
                        <TD className="text-fg-muted">
                          {adj.institutionName || t("setup.email.privateUrls.unaffiliated")}
                        </TD>
                        <TD>
                          <div className="flex items-center gap-1.5">
                            {adj.trainee ? (
                              <Badge tone="warning">{t("setup.email.privateUrls.trainee")}</Badge>
                            ) : (
                              <Badge tone="info">{t("setup.email.privateUrls.votingJudge")}</Badge>
                            )}
                            <span className="whitespace-nowrap font-mono text-[11px] text-fg-muted">
                              {t("setup.email.privateUrls.score", { score: adj.baseScore })}
                            </span>
                          </div>
                        </TD>
                        <TD>{privateLinkCell(path)}</TD>
                        <TD>
                          {passcodeCell(adj.id, adj.name, adj.privatePasscode, () => handleGeneratePasscode(adj.id))}
                        </TD>
                        <TD align="right">{linkActions(adj.id, adj.name, fullUrl, path, key)}</TD>
                      </TR>
                    );
                  })
                )}
              </TBody>
            </Table>
          </TableContainer>
        ) : (
          <TableContainer>
            <Table>
              <THead>
                <TR>
                  <TH>{t("setup.email.privateUrls.colTeam")}</TH>
                  <TH>{t("setup.email.privateUrls.colInstitution")}</TH>
                  <TH>{t("setup.email.privateUrls.colSpeakers")}</TH>
                  <TH>{t("setup.email.privateUrls.colTeamPrivateUrl")}</TH>
                  <TH>{t("setup.email.privateUrls.colPasscode")}</TH>
                  <TH align="right">{t("setup.common.actions")}</TH>
                </TR>
              </THead>
              <TBody>
                {filteredTeams.length === 0 ? (
                  <TableEmpty colSpan={6}>{t("setup.email.privateUrls.noTeams")}</TableEmpty>
                ) : (
                  filteredTeams.map((team) => {
                    const key = team.privateUrlKey;
                    const fullUrl = key ? getAbsolutePrivateUrl(tournamentSlug, "team", key) : "";
                    const path = key ? getTeamPrivatePath(tournamentSlug, key) : "";

                    return (
                      <TR key={team.id}>
                        <TD className="font-semibold">{team.name}</TD>
                        <TD className="text-fg-muted">
                          {team.institutionName || t("setup.email.privateUrls.unaffiliated")}
                        </TD>
                        <TD className="text-fg-muted">
                          {(team.speakers || []).map((s) => s.name).join(", ") || "—"}
                        </TD>
                        <TD>{privateLinkCell(path)}</TD>
                        <TD>
                          {passcodeCell(team.id, team.name, team.privatePasscode, () => handleGenerateTeamPasscode(team.id))}
                        </TD>
                        <TD align="right">{linkActions(team.id, team.name, fullUrl, path, key)}</TD>
                      </TR>
                    );
                  })
                )}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      <Alert tone="warning">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span>{t("setup.email.privateUrls.securityNotice")}</span>
          <Button variant="danger" size="sm" className="shrink-0" onClick={() => setShowRegenConfirm(true)}>
            {t("setup.email.privateUrls.regenerateAll")}
          </Button>
        </div>
      </Alert>
      <p className="text-xs text-fg-muted">{t("setup.email.privateUrls.uploadReminder")}</p>

      {showRegenConfirm && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.email.privateUrls.regenerateTitle")}
          description={t("setup.email.privateUrls.regenerateDescription")}
          confirmLabel={t("setup.email.privateUrls.regenerateConfirm")}
          isBusy={isGenerating}
          onConfirm={() => handleGenerate(true)}
          onCancel={() => setShowRegenConfirm(false)}
        />
      )}
      {printingSlips && (
        <section className="print-only private-url-slips" aria-label={t("setup.email.privateUrls.slipsLabel")}>
          {slips.map((slip) => (
            <article key={slip.id} className="private-url-slip">
              <QrCode value={slip.url} label={t("setup.email.privateUrls.slipQrLabel", { name: slip.name })} size={110} />
              <div className="private-url-slip-text">
                <strong>{slip.name}</strong>
                {slip.detail && <span>{slip.detail}</span>}
                <span>
                  {t(
                    slip.type === "adjudicator"
                      ? "setup.email.privateUrls.slipAdjudicator"
                      : "setup.email.privateUrls.slipTeam",
                    { tournament: tournament?.name ?? "" }
                  )}
                </span>
                <code>{slip.url}</code>
                {slip.passcode && (
                  <span>
                    {rich("setup.email.privateUrls.slipPasscode", { code: (text) => <code>{text}</code> }, { passcode: slip.passcode })}
                  </span>
                )}
                <em>{t("setup.email.privateUrls.slipKeepPrivate")}</em>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
