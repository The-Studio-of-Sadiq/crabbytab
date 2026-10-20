"use client";

import React from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Checkbox, Input } from "@/components/ui/Field";
import { normalizeCompositeTeam } from "@/lib/compositeTeams";
import { withTeamNames, type TeamNameDisplay } from "@/lib/teamNames";
import type { Institution, Team } from "@/types";

const groupBox = "space-y-2 rounded-md border border-border p-3";
const groupLegend = "px-1 text-xs font-medium text-fg";

/**
 * Team edit fields for Tabbycat's naming (reference, short reference, institution prefix) and
 * composite teams. `prepareTeamForSave` applies both before the team is saved.
 */
export function TeamIdentityFields({
  team,
  institutions,
  display,
  onChange,
}: {
  team: Team;
  institutions: Institution[];
  display: TeamNameDisplay | undefined;
  onChange: (team: Team) => void;
}) {
  const { t } = useI18n();
  const institution = institutions.find((item) => item.id === team.institutionId);
  const named = team.reference !== undefined;
  const preview = named ? withTeamNames(team, institution, display) : team;
  const others = institutions.filter((item) => item.id !== team.institutionId);

  return (
    <>
      <fieldset className={groupBox}>
        <legend className={groupLegend}>{t("setup.imports.teamNaming.legend")}</legend>
        <Checkbox
          label={t("setup.imports.teamNaming.useReference")}
          description={t("setup.imports.teamNaming.useReferenceHelp")}
          checked={named}
          onChange={(event) =>
            onChange(event.target.checked
              ? { ...team, reference: team.name, useInstitutionPrefix: false }
              : withoutReference(team))
          }
        />
        {named && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                label={t("setup.imports.teamNaming.reference")}
                value={team.reference ?? ""}
                maxLength={150}
                onChange={(event) => onChange({ ...team, reference: event.target.value })}
              />
              <Input
                label={t("setup.imports.teamNaming.shortReference")}
                value={team.shortReference ?? ""}
                maxLength={35}
                onChange={(event) => {
                  const { shortReference: _previous, ...rest } = team;
                  onChange(event.target.value ? { ...rest, shortReference: event.target.value } : rest);
                }}
              />
            </div>
            <Checkbox
              label={t("setup.imports.teamNaming.prefix")}
              description={t("setup.imports.teamNaming.prefixHelp")}
              checked={team.useInstitutionPrefix === true}
              disabled={!institution}
              onChange={(event) => onChange({ ...team, useInstitutionPrefix: event.target.checked })}
            />
            <p className="text-xs text-fg-muted">
              {t("setup.imports.teamNaming.preview", { long: preview.longName ?? "", short: preview.shortName ?? "" })}
            </p>
          </>
        )}
      </fieldset>

      {!team.isSwing && (
        <fieldset className={groupBox}>
          <legend className={groupLegend}>{t("setup.imports.composite.legend")}</legend>
          <Checkbox
            label={t("setup.imports.composite.isComposite")}
            description={t("setup.imports.composite.help")}
            checked={team.isComposite === true}
            onChange={(event) => onChange(normalizeCompositeTeam({ ...team, isComposite: event.target.checked }))}
          />
          {team.isComposite && (
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {others.map((item) => (
                <Checkbox
                  key={item.id}
                  label={item.name}
                  checked={(team.compositeInstitutionIds ?? []).includes(item.id)}
                  onChange={(event) =>
                    onChange(normalizeCompositeTeam({
                      ...team,
                      compositeInstitutionIds: event.target.checked
                        ? [...(team.compositeInstitutionIds ?? []), item.id]
                        : (team.compositeInstitutionIds ?? []).filter((id) => id !== item.id),
                    }))
                  }
                />
              ))}
            </div>
          )}
        </fieldset>
      )}
    </>
  );
}

/** The team named as typed again: every Tabbycat naming field removed (not set to undefined). */
function withoutReference(team: Team): Team {
  const {
    reference: _reference,
    shortReference: _shortReference,
    useInstitutionPrefix: _prefix,
    longName: _longName,
    shortName: _shortName,
    ...rest
  } = team;
  return rest;
}

/** The team as saved: derived names brought up to date and composite fields cleaned. */
export function prepareTeamForSave(team: Team, institutions: Institution[], display: TeamNameDisplay | undefined): Team {
  const institution = institutions.find((item) => item.id === team.institutionId);
  return normalizeCompositeTeam(withTeamNames(team, institution, display));
}
