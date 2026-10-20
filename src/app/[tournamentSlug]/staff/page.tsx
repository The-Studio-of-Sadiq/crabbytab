"use client";

import React, { useEffect, useState } from "react";
import { Trash2, UserPlus, Users } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTournament } from "@/contexts/TournamentContext";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ConfirmActionDialog } from "@/components/ui/ConfirmActionDialog";
import { Alert, EmptyState, Skeleton } from "@/components/ui/Feedback";
import { Select, Textarea } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { StaffInvitationsPanel } from "@/features/tournament/components/StaffInvitationsPanel";
import { StaffAccessSettings } from "@/features/tournament/components/StaffAccessSettings";
import { PublicFormsSettings } from "@/features/tournament/components/PublicFormsSettings";
import { StaffPermissionGroups } from "@/features/tournament/components/StaffPermissionGroups";
import { StaffCustomGroupsEditor } from "@/features/tournament/components/StaffCustomGroupsEditor";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  isCustomGroupId,
  isPermissionGroupId,
  normalizeCustomGroups,
  type CustomPermissionGroup,
} from "@/lib/staffPermissions";

interface StaffMember {
  uid: string;
  email: string;
  displayName: string;
  role: "admin" | "dataEntry";
  addedAt: string;
  groups?: unknown;
}

/** A server-supplied message (shown verbatim) or a translated message from this page. */
type Notice = { text: string } | { key: MessageKey } | { assigned: StaffMember["role"]; count: number };

function errorNotice(caught: unknown, fallback: MessageKey): Notice {
  return caught instanceof Error && caught.message ? { text: caught.message } : { key: fallback };
}

function memberGroups(member: StaffMember): string[] {
  const groups = Array.isArray(member.groups)
    ? member.groups.filter((group): group is string => isPermissionGroupId(group) || isCustomGroupId(group))
    : [];
  return groups.length > 0 ? groups : ["tab_assistant"];
}

export default function StaffPage() {
  const { t, plural } = useI18n();
  const { tournament, isOwnerOrAdmin, saveTournament } = useTournament();
  const { user, loading: authLoading } = useAuth();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [emails, setEmails] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "dataEntry">("dataEntry");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Notice | null>(null);
  const [message, setMessage] = useState<Notice | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<StaffMember | null>(null);
  const [customGroups, setCustomGroups] = useState<CustomPermissionGroup[]>([]);

  const renderNotice = (notice: Notice) => {
    if ("text" in notice) return notice.text;
    if ("assigned" in notice) {
      return plural(notice.assigned === "admin" ? "setup.staff.assignedAdmin" : "setup.staff.assignedDataEntry", notice.count);
    }
    return t(notice.key);
  };

  useEffect(() => {
    let active = true;
    async function loadStaff() {
      if (!user || !tournament || !isOwnerOrAdmin) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const result = await response.json() as {
          error?: string;
          staff?: StaffMember[];
        };
        if (!response.ok) throw new Error(result.error || "");
        const groupsResponse = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff/groups`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const groupsResult = await groupsResponse.json() as { error?: string; groups?: unknown };
        if (!groupsResponse.ok) throw new Error(groupsResult.error || "");
        if (active) {
          setStaff(result.staff || []);
          setCustomGroups(normalizeCustomGroups(groupsResult.groups));
        }
      } catch (loadError) {
        if (active) setError(errorNotice(loadError, "setup.staff.loadError"));
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadStaff();
    return () => {
      active = false;
    };
  }, [user, tournament, isOwnerOrAdmin]);

  const addStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    const selectedEmails = [...new Set(emails.split(/[\s,;]+/).map((email) => email.trim()).filter(Boolean))];
    if (!user || !tournament || selectedEmails.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ emails: selectedEmails, role: selectedRole }),
      });
      const result = await response.json() as { error?: string; staff?: StaffMember[] };
      if (!response.ok) throw new Error(result.error || "");
      setStaff((current) => [
        ...current.filter((member) => !result.staff?.some((added) => added.uid === member.uid)),
        ...(result.staff || []),
      ].sort((left, right) => left.email.localeCompare(right.email)));
      setEmails("");
      setMessage({ assigned: selectedRole, count: result.staff?.length || 0 });
    } catch (addError) {
      setError(errorNotice(addError, "setup.staff.assignError"));
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (member: StaffMember) => {
    if (!user || !tournament) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uid: member.uid }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "");
      setStaff((current) => current.filter((item) => item.uid !== member.uid));
      setMessage({ key: "setup.staff.removed" });
    } catch (removeError) {
      setError(errorNotice(removeError, "setup.staff.removeError"));
    } finally {
      setBusy(false);
      setPendingRemoval(null);
    }
  };

  const saveCustomGroups = async (groups: CustomPermissionGroup[]) => {
    if (!user || !tournament) return;
    setError(null);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff/groups`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ groups }),
      });
      const result = await response.json() as { error?: string; groups?: unknown };
      if (!response.ok) throw new Error(result.error || "");
      setCustomGroups(normalizeCustomGroups(result.groups));
      setMessage({ key: "setup.staff.customGroupsSaved" });
    } catch (saveError) {
      setError(errorNotice(saveError, "setup.staff.customGroupsError"));
    }
  };

  const saveGroups = async (uid: string, groups: string[]) => {
    if (!user || !tournament) return;
    setError(null);
    setMessage(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/tournaments/${encodeURIComponent(tournament.id)}/staff`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ uid, groups }),
      });
      const result = await response.json() as { error?: string; groups?: unknown };
      if (!response.ok) throw new Error(result.error || "");
      setStaff((current) => current.map((member) => member.uid === uid ? { ...member, groups: result.groups } : member));
      setMessage({ key: "setup.staff.groupsSaved" });
    } catch (saveError) {
      setError(errorNotice(saveError, "setup.staff.groupsError"));
    }
  };

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-[13px] text-fg-muted">{t("setup.staff.loading")}</p>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full max-w-3xl" />
      </div>
    );
  }
  if (!user || !tournament || !isOwnerOrAdmin) {
    return <Alert role="alert" tone="danger">{t("setup.staff.signInRequired")}</Alert>;
  }

  const roleLabel = (role: StaffMember["role"]) =>
    role === "admin" ? t("setup.staff.roleAdmin") : t("setup.staff.roleDataEntry");

  return (
    <div className="space-y-6">
      <PageHeader title={t("setup.staff.title")} description={t("setup.staff.description")} />

      <StaffInvitationsPanel tournamentId={tournament.id} user={user} />

      <StaffAccessSettings tournament={tournament} onSave={saveTournament} />

      <PublicFormsSettings tournament={tournament} user={user} onSave={saveTournament} />

      <StaffCustomGroupsEditor groups={customGroups} disabled={busy} onSave={saveCustomGroups} />

      <Card className="max-w-3xl">
        <CardHeader
          icon={<UserPlus aria-hidden="true" />}
          title={t("setup.staff.assignTitle")}
          description={t("setup.staff.assignDescription")}
        />
        <CardBody>
          <form onSubmit={addStaff} className="space-y-3">
            <Textarea
              label={t("setup.staff.assignEmailsLabel")}
              help={t("setup.staff.assignEmailsHelp")}
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              rows={3}
              autoComplete="off"
              placeholder={t("setup.staff.emailPlaceholder")}
            />
            <Select
              label={t("setup.staff.roleLabel")}
              wrapperClassName="max-w-xs"
              value={selectedRole}
              onChange={(event) => {
                const role = event.target.value;
                if (role === "admin" || role === "dataEntry") setSelectedRole(role);
              }}
            >
              <option value="dataEntry">{t("setup.staff.roleDataEntry")}</option>
              <option value="admin">{t("setup.staff.roleAdmin")}</option>
            </Select>
            <Button type="submit" variant="primary" disabled={busy || !emails.trim()}>
              <UserPlus aria-hidden="true" />
              {t("setup.staff.assignButton")}
            </Button>
          </form>
        </CardBody>
      </Card>

      {error && <Alert role="alert" tone="danger">{renderNotice(error)}</Alert>}
      {message && <Alert role="status" tone="success">{renderNotice(message)}</Alert>}

      <Card className="max-w-3xl">
        <CardHeader
          icon={<Users aria-hidden="true" />}
          title={<span id="assistant-list-heading">{t("setup.staff.assignedTitle", { count: staff.length })}</span>}
        />
        <CardBody>
          {staff.length === 0 ? (
            <EmptyState icon={<Users aria-hidden="true" />} title={t("setup.staff.assignedEmpty")} />
          ) : (
            <ul aria-labelledby="assistant-list-heading" className="divide-y divide-border">
              {staff.map((member) => (
                <li key={member.uid} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-fg">{member.displayName || member.email}</p>
                    {member.displayName && <p className="truncate text-xs text-fg-muted">{member.email}</p>}
                    <Badge tone={member.role === "admin" ? "accent" : "neutral"} className="mt-1">
                      {roleLabel(member.role)}
                    </Badge>
                    {member.role === "dataEntry" && (
                      <StaffPermissionGroups
                        uid={member.uid}
                        email={member.email}
                        groups={memberGroups(member)}
                        customGroups={customGroups}
                        disabled={busy}
                        onSave={saveGroups}
                      />
                    )}
                  </div>
                  <IconButton
                    variant="secondary"
                    icon={<Trash2 aria-hidden="true" />}
                    label={t("setup.staff.removeLabel", { email: member.email })}
                    onClick={() => setPendingRemoval(member)}
                    disabled={busy}
                    className="hover:bg-danger-subtle hover:text-danger"
                  />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {pendingRemoval && (
        <ConfirmActionDialog
          variant="danger"
          title={t("setup.staff.removeConfirmTitle")}
          description={t(
            pendingRemoval.role === "admin" ? "setup.staff.removeConfirmAdmin" : "setup.staff.removeConfirmDataEntry",
            { email: pendingRemoval.email }
          )}
          confirmLabel={t("setup.staff.removeConfirmButton")}
          isBusy={busy}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => void removeStaff(pendingRemoval)}
        />
      )}
    </div>
  );
}
