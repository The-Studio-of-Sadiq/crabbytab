"use client";

import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { PublicFormsPerson } from "@/lib/publicForms";

/** The tournament password field shown above a public form when the tab room requires one. */
export function PublicFormPasswordField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const { t } = useI18n();
  return (
    <Input
      label={t("publicForms.passwordLabel")}
      help={t("publicForms.passwordHelp")}
      type="password"
      autoComplete="off"
      value={value}
      error={error}
      onChange={(event) => onChange(event.target.value)}
      wrapperClassName="max-w-sm"
    />
  );
}

/**
 * A searchable list of people to choose from (Tabbycat's public index tables). Each row is a
 * button naming the person; `detail` adds a second line such as the room.
 */
export function PublicPersonPicker({
  people,
  actionLabel,
  onPick,
  detail,
  searchLabel,
}: {
  people: PublicFormsPerson[];
  actionLabel: (name: string) => string;
  onPick: (person: PublicFormsPerson) => void;
  detail?: (person: PublicFormsPerson) => string | undefined;
  searchLabel: string;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? people.filter((person) => person.name.toLocaleLowerCase().includes(needle)) : people;
  }, [people, query]);
  return (
    <div className="space-y-3">
      <Input
        label={searchLabel}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        leadingIcon={<Search aria-hidden="true" />}
        wrapperClassName="max-w-sm"
      />
      {shown.length === 0 ? (
        <p className="text-[13px] text-fg-muted">{t("publicForms.noMatches")}</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {shown.map((person) => {
            const name = person.name || t("publicForms.anonymous");
            const extra = detail?.(person);
            return (
              <li key={person.id}>
                <Button
                  variant="secondary"
                  size="lg"
                  className="h-auto min-h-10 w-full flex-col items-start justify-center py-2 text-start"
                  onClick={() => onPick(person)}
                >
                  <span className="break-words font-medium">{actionLabel(name)}</span>
                  {extra && <span className="text-xs font-normal text-fg-muted">{extra}</span>}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
