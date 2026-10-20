"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Field";
import {
  groupPermissions,
  PERMISSION_GROUP_IDS,
  PERMISSION_GROUPS,
  STAFF_PERMISSION_LABELS,
  type PermissionGroupId,
} from "@/lib/staffPermissions";

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
  const [selected, setSelected] = useState<PermissionGroupId[]>(groups);
  const [saving, setSaving] = useState(false);
  const changed = [...selected].sort().join() !== [...groups].sort().join();
  const permissions = groupPermissions({ groups: selected });

  return (
    <fieldset className="mt-2 space-y-2">
      <legend className="text-xs font-medium text-fg-muted">Permission groups for {email}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {PERMISSION_GROUP_IDS.map((group) => (
          <Checkbox
            key={group}
            label={PERMISSION_GROUPS[group].label}
            description={PERMISSION_GROUPS[group].description}
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
        Can: {permissions.map((permission) => STAFF_PERMISSION_LABELS[permission]).join(", ")}.
        {selected.length === 0 && " (No group ticked: the full tabulation assistant set applies.)"}
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
        Save groups
      </Button>
    </fieldset>
  );
}
