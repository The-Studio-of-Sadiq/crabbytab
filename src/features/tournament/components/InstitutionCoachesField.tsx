"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Button, IconButton } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { createEntityId } from "@/features/tournament/application/entities";
import type { Coach, Institution } from "@/types";

/**
 * An institution's coaches / representatives (Tabbycat Coach), edited with the institution. They
 * receive emails sent to the "Institution coaches" group and are organiser-only.
 */
export function InstitutionCoachesField({
  institution,
  onChange,
}: {
  institution: Institution;
  onChange: (institution: Institution) => void;
}) {
  const { t } = useI18n();
  const coaches = institution.coaches ?? [];
  const update = (next: Coach[]) => onChange({ ...institution, coaches: next });
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-medium text-fg">{t("setup.imports.coaches.legend")}</legend>
      {coaches.map((coach, index) => (
        <div key={coach.id} className="flex items-end gap-2">
          <Input
            label={t("setup.imports.coaches.name")}
            value={coach.name}
            maxLength={120}
            onChange={(event) => update(coaches.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))}
            wrapperClassName="flex-1"
          />
          <Input
            label={t("setup.imports.coaches.email")}
            type="email"
            value={coach.email ?? ""}
            maxLength={254}
            onChange={(event) =>
              update(coaches.map((item, position) => {
                if (position !== index) return item;
                const { email: _previous, ...rest } = item;
                return event.target.value.trim() ? { ...rest, email: event.target.value.trim() } : rest;
              }))
            }
            wrapperClassName="flex-1"
          />
          <IconButton
            variant="secondary"
            icon={<Trash2 aria-hidden="true" />}
            label={t("setup.imports.coaches.remove", { name: coach.name || t("setup.imports.coaches.unnamed") })}
            onClick={() => update(coaches.filter((_, position) => position !== index))}
          />
        </div>
      ))}
      <Button size="sm" variant="secondary" onClick={() => update([...coaches, { id: createEntityId("coach"), name: "" }])}>
        <Plus aria-hidden="true" />
        {t("setup.imports.coaches.add")}
      </Button>
    </fieldset>
  );
}

/** Coaches as saved: nameless rows dropped. */
export function cleanCoaches(institution: Institution): Institution {
  if (!institution.coaches) return institution;
  const coaches = institution.coaches
    .map((coach) => ({ ...coach, name: coach.name.trim() }))
    .filter((coach) => coach.name);
  const { coaches: _previous, ...rest } = institution;
  return coaches.length > 0 ? { ...rest, coaches } : rest;
}
