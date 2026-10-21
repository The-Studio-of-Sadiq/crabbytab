"use client";

import React, { useEffect, useState } from "react";
import { Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Checkbox, Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Feedback";
import {
  CUSTOM_GROUP_PREFIX,
  MAX_CUSTOM_GROUPS,
  STAFF_PERMISSIONS,
  validateCustomGroups,
  type CustomPermissionGroup,
  type StaffPermission,
} from "@/lib/staffPermissions";
import { STAFF_PERMISSION_KEYS } from "@/features/tournament/components/StaffPermissionGroups";

function newGroupId(): string {
  const random = globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${CUSTOM_GROUP_PREFIX}${random}`;
}

/**
 * Organiser-defined permission groups (Tabbycat `users.Group`): a name and a set of the
 * server-enforced staff permissions. Saved through `PUT /api/tournaments/{id}/staff/groups`,
 * which validates them and refreshes every staff member's stored permissions.
 */
export function StaffCustomGroupsEditor({
  groups,
  disabled,
  onSave,
}: {
  groups: CustomPermissionGroup[];
  disabled?: boolean;
  onSave: (groups: CustomPermissionGroup[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CustomPermissionGroup[]>(groups);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  useEffect(() => setDraft(groups), [groups]);
  const changed = JSON.stringify(draft) !== JSON.stringify(groups);

  const update = (id: string, change: Partial<CustomPermissionGroup>) =>
    setDraft((current) => current.map((group) => (group.id === id ? { ...group, ...change } : group)));
  const togglePermission = (group: CustomPermissionGroup, permission: StaffPermission, checked: boolean) =>
    update(group.id, {
      permissions: STAFF_PERMISSIONS.filter((item) =>
        item === permission ? checked : group.permissions.includes(item)
      ),
    });

  const save = async () => {
    const found = validateCustomGroups(draft);
    setProblems(found);
    if (found.length > 0) return;
    setSaving(true);
    try {
      await onSave(draft.map((group) => ({ ...group, name: group.name.trim() })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="max-w-3xl">
      <CardHeader
        icon={<ShieldCheck aria-hidden="true" />}
        title={t("setup.staff.customGroupsTitle")}
        description={t("setup.staff.customGroupsDescription")}
      />
      <CardBody className="space-y-4">
        {draft.length === 0 && <p className="text-[13px] text-fg-muted">{t("setup.staff.customGroupsEmpty")}</p>}
        {draft.map((group, index) => (
          <fieldset key={group.id} className="space-y-2 rounded-md border border-border p-3">
            <legend className="sr-only">{t("setup.staff.customGroupLegend", { number: index + 1 })}</legend>
            <div className="flex items-end gap-2">
              <Input
                label={t("setup.staff.customGroupNameLabel")}
                value={group.name}
                maxLength={80}
                disabled={disabled || saving}
                onChange={(event) => update(group.id, { name: event.target.value })}
                wrapperClassName="flex-1"
              />
              <IconButton
                variant="secondary"
                icon={<Trash2 aria-hidden="true" />}
                label={t("setup.staff.customGroupRemove", { name: group.name || t("setup.staff.customGroupUnnamed") })}
                disabled={disabled || saving}
                onClick={() => setDraft((current) => current.filter((item) => item.id !== group.id))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {STAFF_PERMISSIONS.map((permission) => (
                <Checkbox
                  key={permission}
                  label={t(STAFF_PERMISSION_KEYS[permission])}
                  checked={group.permissions.includes(permission)}
                  disabled={disabled || saving}
                  onChange={(event) => togglePermission(group, permission, event.target.checked)}
                />
              ))}
            </div>
          </fieldset>
        ))}
        {problems.length > 0 && (
          <Alert role="alert" tone="danger">
            <ul className="list-disc ps-4">
              {problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          </Alert>
        )}
        <p className="text-xs text-fg-muted">{t("setup.staff.customGroupsRemovedNote")}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={disabled || saving || draft.length >= MAX_CUSTOM_GROUPS}
            onClick={() => setDraft((current) => [...current, { id: newGroupId(), name: "", permissions: [] }])}
          >
            <Plus aria-hidden="true" />
            {t("setup.staff.customGroupAdd")}
          </Button>
          <Button variant="primary" disabled={disabled || !changed} loading={saving} onClick={() => void save()}>
            {t("setup.staff.customGroupsSave")}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
