"use client";

import React, { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Field";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  groupPermissions,
  PERMISSION_GROUP_IDS,
  type PermissionGroupId,
  type StaffPermission,
} from "@/lib/staffPermissions";

/** Display names for the permission groups (the lib's English labels stay as the API's source of truth). */
const GROUP_KEYS: Record<PermissionGroupId, { label: MessageKey; description: MessageKey }> = {
  tab_assistant: { label: "setup.staff.groupTabAssistant", description: "setup.staff.groupTabAssistantDescription" },
  ballot_desk: { label: "setup.staff.groupBallotDesk", description: "setup.staff.groupBallotDeskDescription" },
  check_in_desk: { label: "setup.staff.groupCheckInDesk", description: "setup.staff.groupCheckInDeskDescription" },
  feedback_desk: { label: "setup.staff.groupFeedbackDesk", description: "setup.staff.groupFeedbackDeskDescription" },
};

const STAFF_PERMISSION_KEYS: Record<StaffPermission, MessageKey> = {
  "results.enter": "setup.staff.permResultsEnter",
  "results.confirm_others": "setup.staff.permResultsConfirmOthers",
  "ballots.intake": "setup.staff.permBallotsIntake",
  "feedback.enter": "setup.staff.permFeedbackEnter",
  "checkins.edit": "setup.staff.permCheckinsEdit",
  "participants.edit": "setup.staff.permParticipantsEdit",
  "draw.display": "setup.staff.permDrawDisplay",
  "motions.display": "setup.staff.permMotionsDisplay",
};

/** Permission groups of one data-entry staff member, saved through the staff route's PATCH. */
export function StaffPermissionGroups({
  uid,
  email,
  groups,
  disabled,
  onSave,
}: {
  uid: string;
  email: string;
  groups: PermissionGroupId[];
  disabled?: boolean;
  onSave: (uid: string, groups: PermissionGroupId[]) => Promise<void>;
}) {
  const { t, formatList } = useI18n();
  const [selected, setSelected] = useState<PermissionGroupId[]>(groups);
  const [saving, setSaving] = useState(false);
  const changed = [...selected].sort().join() !== [...groups].sort().join();
  const permissions = groupPermissions({ groups: selected });

  return (
    <fieldset className="mt-2 space-y-2">
      <legend className="text-xs font-medium text-fg-muted">{t("setup.staff.groupsLegend", { email })}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {PERMISSION_GROUP_IDS.map((group) => (
          <Checkbox
            key={group}
            label={t(GROUP_KEYS[group].label)}
            description={t(GROUP_KEYS[group].description)}
            checked={selected.includes(group)}
            disabled={disabled || saving}
            onChange={(event) =>
              setSelected((current) =>
                event.target.checked ? [...current, group] : current.filter((item) => item !== group)
              )
            }
          />
        ))}
      </div>
      <p className="text-xs text-fg-muted">
        {t("setup.staff.permissionsSummary", {
          permissions: formatList(permissions.map((permission) => t(STAFF_PERMISSION_KEYS[permission]))),
        })}
        {selected.length === 0 && <> {t("setup.staff.permissionsNoGroup")}</>}
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={!changed || disabled}
        loading={saving}
        onClick={async () => {
          setSaving(true);
          try {
            await onSave(uid, selected);
          } finally {
            setSaving(false);
          }
        }}
      >
        {t("setup.staff.saveGroups")}
      </Button>
    </fieldset>
  );
}
