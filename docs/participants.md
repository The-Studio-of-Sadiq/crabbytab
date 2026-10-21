# Participants: speakers, records, code names and institution reports

Tab-room tools for the people in a tournament, mirroring Tabbycat's `participants` admin pages.
Pure logic lives in `src/lib/participants/` (tested without Firebase); pages read the tournament
already loaded on the device, so none of them adds cloud reads.

## Speakers on an existing team

The team edit dialog (Setup → Teams) can **add** a speaker (a new slot, saved with the team; a
slot left blank is dropped) and **remove** one (Tabbycat `participants-team-speaker-add/delete`).
A speaker with speeches on any ballot that is not discarded, on the scores or on any adjudicator's
scoresheet, cannot be removed: the button is disabled with the reason, and the save itself is
refused (`checkSpeakerRemoval` in `stateGuards.ts`, enforced by `updateTeam`, so the API refuses it
too). Rename such a speaker instead, or discard those ballots first.

## Team names (Tabbycat reference, short and long names)

A team can be named the Tabbycat way (`src/lib/teamNames.ts`): a **reference** ("1", "A"), an
optional **short reference**, and **prefix with the institution**. Its long name is "institution
name + reference" ("Victoria 1") and its short name "institution code + short reference" ("VUW
1"); both are stored (`longName`, `shortName`). Every page shows `Team.name`, so for these teams
`name` is the long name, or the short name when *Format & teams -> Team names* is set to short
names (`preferences.teamNameDisplay`). Teams without a reference keep the name as typed (as
before). Edit the fields in the team dialog; **Update team names** refreshes them after an
institution is renamed.

**Convert team names** (Tabbycat `convertteamnames`) previews, then converts every team without a
reference: a name starting with the institution's name or code ("Auckland 1", "AUCK 1") becomes
reference "1" with the prefix on; other names become the reference with no prefix. Swing teams are
left alone. What teams show does not change unless short names are chosen.

The public registration form's *Prefix the team name with the institution* option creates the
team this way too (reference = the typed name without the institution).

## Composite teams

Tabbycat's composite team type: a team whose speakers come from more than one institution
(`Team.isComposite`, `compositeInstitutionIds`, set in the team dialog). Unlike a swing team it is
an ordinary team in draws, standings and breaks. Its other institutions count as its own for
same-institution draw avoidance (`sameInstitution` in `src/lib/draw/history.ts`) and for
adjudicator institution conflicts (`calculateAdjDebateConflict`). A swing team cannot be composite.

## Institution coaches

Institutions can list their **coaches and representatives** (Tabbycat Coach; `Institution.coaches`,
name and email) in the institution dialog. **Save representatives as coaches** (Registration ->
Representatives) adds every active registration representative to their institution's coaches.
Coaches are organiser-only (not on public pages, not in assistant copies) and receive emails sent
to the **Institution coaches and representatives** group (no private URL).

## Person fields

`Speaker` and `Adjudicator` have optional `lastName` and `pronoun` (Tabbycat `Person.last_name`,
`Person.pronoun`), edited in the team and adjudicator dialogs and available through the API.
`lastName` is used by the "last names" code-name generator (absent: the last word of the name).
A pronoun is pre-printed after the name on printed ballots (speakers and the panel), e.g.
"Alex Kim (they/them)". Neither is published on public pages.

## Team record

Each team row on the Teams page links to its record (`/{slug}/team/{teamId}`, Tabbycat
`participants-team-record`), which works whether or not public record pages are on: details and
speakers, private URL, every debate (including results not yet released, unconfirmed ballots, the
panel and each speech), adjudicator conflicts with the reason, and feedback the team submitted.
Administrators only.

## Adjudicator record

Each adjudicator's name on the Adjudicators page links to their record
(`/{slug}/feedback/adjudicator/{id}`, Tabbycat `participants-adjudicator-record`) for
administrators and staff with `feedback.view` or `adjudicators.scores_edit`, also when feedback is
switched off (the page then links back to the adjudicator list): rounds and roles, base and test
scores with their history, feedback received and the adjudicator's recorded conflicts (team,
adjudicator and institution conflicts, for administrators and staff with `conflicts.view`).

## Code names

*Setup → Code names* (`/imports/code-names`, Tabbycat `participants-code-names-list`) decodes each
team's code name next to its real name, institution and speakers, code names first. Teams without
a code name are counted with a link to generate them. Data-entry staff see the decoder too (read
only), as in Tabbycat's assistant interface.

Teams added by hand used to get the team name stored as their code name. Under code-name modes
that is treated as no code name, but after a rename the old real name would have been published as
if it were a code name. New teams now get no code name, and saving a team clears a code name that
equals its current or previous name (`withoutRealNameCodeName`, applied by `addTeams` and
`updateTeam`).

## Institution reports

- **Adjudicator requirement** (*Setup → Adjudicator requirement*, Tabbycat `participants-adj-rule`):
  teams / adjudicators per institution, registered (adjudicators excluding independents) and for
  each preliminary round with a draw (teams debating / adjudicators allocated, chairs, panellists
  and trainees). A cell is flagged, with an icon and screen-reader text, when an institution with N
  teams provides fewer than N-1 adjudicators (Tabbycat's "N-1" rule).
- **Gender by institution** (Diversity page, Tabbycat `participants-institution-gender-diversity`):
  speakers (by their team's institution) and adjudicators (independents excluded) per gender.
  Genders are free text in CrabbyTab, so labels are grouped ignoring case and spaces.

## Rooms in several categories

See [adjudicator allocation](adjudicator-allocation.md#rooms) for `Venue.categories`.
