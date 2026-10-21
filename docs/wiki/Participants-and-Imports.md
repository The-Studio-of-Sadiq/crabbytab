# Participants and imports

Participants are managed under **Setup** in the sidebar:

| Page | What it is for |
| --- | --- |
| **Institutions** | Institutions, their codes, regions, coaches and representatives |
| **Teams** | Teams and their speakers |
| **Adjudicators** | Adjudicators, scores, flags and conflicts |
| **Diversity** | Gender and region of speakers and adjudicators, with statistics |
| **Registration** | Public self-registration, representative links and team invitations (administrators) |
| **Conflicts** | Conflicts CSV import, the list of every conflict, team–institution conflicts |
| **Code names** | Code-name decoder (real name next to each code name) |
| **Speaker categories** | ESL, novice and similar categories, with optional public tabs |
| **Adjudicator requirement** | Teams and adjudicators per institution (Tabbycat's N-1 rule) |
| **Venues**, **Room preferences** | See [Venues and constraints](Venues-and-Constraints) |
| **Motions**, **Schedule** | Motions and their release; round times; see [Rounds and draws](Rounds-and-Draws) |

Data-entry staff see a reduced Setup section (the code-name decoder, and only the pages their permissions allow).

## Recommended order

1. **Break categories** (Results → **Break**) and **speaker categories** (Setup → Speaker categories), so imports can refer to them.
2. **Institutions** — teams and adjudicators are linked by institution name or code.
3. **Teams**
4. **Adjudicators** — an adjudicator linked to an institution (and not marked independent) automatically conflicts with it.
5. **Venues**, **Room preferences** and **Motions**.
6. **Conflicts** (CSV or by hand).

Exact column names and aliases: [CSV formats](CSV-Formats). Sample files are in `testdata/`.

## Importing institutions, teams and adjudicators (CSV)

On the Institutions, Teams or Adjudicators page, choose **Import CSV**, upload a file or paste text, then **Preview import**. Nothing is saved until you press **Import**.

The preview lists every row with what will happen:

- **Errors** (row cannot be imported): missing name, invalid email, score or yes/no flag, unknown break category, a speaker email or categories without a speaker name, wrong number of cells. A file with errors is refused unless you tick **Import the valid rows only**.
- **Warnings**: no speakers (placeholder speakers "Team Speaker 1"… are created; rename them), fewer speakers than the format uses, a speaker email already used, an adjudicator with the same name at another institution.
- **Duplicates** are detected instead of created twice. Institutions match by name or code, teams by name, adjudicators by email (else name and institution). A match defaults to **Skip**; switch it to **Update existing** (only filled cells change; speakers keep their ids) or **Create**.
- **New institutions** named in the file are listed with a suggested code you can edit; untick one to keep the name as text without linking it. `Independent`, `Unaffiliated`, `None` and `-` mean no institution.
- **New speaker categories** named in `speakerN_categories` are created (not public) and listed.
- **Columns that will be ignored** are listed.

Whole-file problems stop the import: files over 5 MB, an empty file, a header with no rows, repeated column names, a missing `name` column or an unclosed quote. Formulas and markup are kept as text, never evaluated.

**Team seeds.** The *Team seed column* setting at the top of the team import decides what a `seed` column means: *Do not ask* (default; the column is ignored), a number (0–99,999, higher is stronger) or a *seed title* (Unseeded, Free seed, Half seed, Full seed). Seeds are used by seeded and round-robin draws.

**Venues** and **motions** import directly from CSV, without this preview.

Each import is one audit-log event. For cloud tournaments, teams and adjudicators are written live like any other edit.

## Teams

Setup → **Teams** lists every team with links to its **private URL** and its **team record**. **Add team** or the edit button opens the team dialog:

- **Team name** and **Institution affiliation** (or *Unaffiliated / independent*: no institutional clash constraints).
- **Tabbycat name** (optional): build the name from a reference, see below.
- **Composite team**: speakers from more than one institution, see below.
- **Code name** and **Emoji**, shown publicly when code names are on.
- **Break eligibility** for each non-general break category (every team is in the general ones).
- **Speakers**: name, email, speaker categories, code name, last name, pronoun and *Anonymous on public pages*. **Add speaker** adds a slot; **Remove** removes one.

Set elsewhere: **seeds** on the Draw page (or the CSV `seed` column), **divisions** from the CSV `division` / `division_id` columns, **venue requirements** from the CSV requirement columns.

### Adding and removing speakers

A speaker can be removed only if they have no speeches on a live ballot, a score or any adjudicator's scoresheet. Otherwise the button is disabled with the reason, and the save is refused (also through the API). Rename the speaker instead, or discard those ballots first.

### Team names: references and prefixes

A team can be named the Tabbycat way: a **reference** ("1", "A"), an optional **short reference**, and **Prefix with the institution**. Its long name is "institution name + reference" ("Victoria 1"); its short name "institution code + short reference" ("VUW 1"). Admin → Configuration → *Format & teams* → **Team names** chooses which one teams show, offers **Update team names** after an institution is renamed, and **Preview conversion** to convert existing teams (a team called "Auckland 1" from Auckland becomes reference "1" with the prefix on). Teams without a reference keep the name as typed.

### Composite teams

Tick *Speakers from more than one institution* and the other institutions. A composite team is an ordinary team in draws, standings and breaks; its other institutions count as its own for same-institution draw avoidance and for adjudicator institution conflicts. (A swing team, which stands in for a missing team in one round, is different; see [Rounds and draws](Rounds-and-Draws#swing-teams).)

### Code names and emoji

*Admin → Configuration → Public visibility* sets the *Team code names* mode (off, real names with code names as tooltips, code names publicly, code names everywhere) and *Speaker and adjudicator code names*. The same page reports how many teams lack a code name or emoji and offers **Generate missing code names** (*Code name standard*: emoji names or speakers' last names) and **Assign missing emoji**. Under code-name modes only the code name leaves the server; a team without one appears without a name.

Setup → **Code names** lists each team's code name next to its real name, institution and speakers. Teams added by hand get no code name automatically, and saving a team clears a code name that equals its own real name.

### Team record

Each team row links to `/{slug}/team/{teamId}` (administrators): details and speakers, private URL, every debate including unreleased results and unconfirmed ballots, the panel and each speech, adjudicator conflicts with the reason, and feedback the team submitted.

## Speakers

Speakers carry name, email, speaker categories, code name, optional **last name** (used by the last-name code-name generator; otherwise the last word of the name) and optional **pronoun** (printed after the name on ballots, e.g. "Alex Kim (they/them)"). Phone and gender can also come from registration. Pronouns, last names, phones and emails are never published.

**Speaker categories** (Setup → Speaker categories): name, slug, order, *Public tab* and *Public limit*. A category can be deleted only when no speaker is in it. Break eligibility can be derived from speaker categories on Results → Break → Eligibility. Older free-text speaker labels are shown as "From labels, not saved" until the list is saved.

## Adjudicators

The adjudicator dialog holds: name, institution (or independent), email, **Base rating (1–10)**, *Trainee judge*, *Adjudication core*, *Breaking adjudicator*, *Tester* (always on for the adjudication core), *Anonymous on public pages*, gender, region, code name, last name, pronoun, and **Conflicts** (team, adjudicator and other institution conflicts). Test scores, base-score history and the tester and breaking columns are also on the Feedback pages. Each adjudicator's name links to their **adjudicator record** (rounds and roles, scores and history, feedback received, conflicts) for administrators and staff with feedback or score access.

See [Adjudicator allocation](Adjudicator-Allocation#conflicts) for how conflicts are used.

## Institutions and coaches

An institution has a name, code, region and optional venue requirements. Its dialog also lists **coaches and representatives** (name and email). Coaches are organiser-only and receive emails sent to the *Institution coaches and representatives* group. Registration → Representatives → **Save representatives as coaches** copies every active representative into their institution's coaches.

## Conflicts

Setup → **Conflicts** (administrators and staff with conflict access):

- **Import conflicts** from CSV. Each row fills exactly two of `adjudicator`, `team`, `institution`, `other_adjudicator`: adjudicator–team, adjudicator–adjudicator, adjudicator–institution or team–institution. Unknown or ambiguous names are errors; conflicts already recorded are skipped. Preview first, as with the participant imports.
- **Recorded conflicts** lists every conflict and removes one (adjudicator–adjudicator conflicts from both sides).
- **Add a team–institution conflict**: adjudicators from that institution should not judge the team.
- **Export conflicts CSV**.

Conflicts are never shown publicly.

## Diversity and institution reports

- **Diversity** is an inline editor for speaker and adjudicator gender and region (administrators; saved when you leave a field), with summary statistics and **gender by institution** (speakers by their team's institution; independent adjudicators excluded). Genders are free text, grouped ignoring case and spaces. Diversity is shown as badges on the Allocation page; it is not an allocation constraint.
- **Adjudicator requirement** shows teams and adjudicators per institution, registered and per drawn preliminary round (chairs, panellists, trainees). An institution with N teams that provides fewer than N−1 adjudicators is flagged with an icon and text.

## Registration

Setup → **Registration** (administrators; the tournament must be uploaded first) lets teams, adjudicators and institutions register on a public form at `/register/{slug}`. Nothing a registrant submits reaches the tournament directly unless you choose automatic acceptance.

- **Settings**: accept registrations and an optional window; which kinds may register and through which channel (open form, representative links); speakers per team; speaker categories offered; per-institution and tournament-wide limits; custom questions (also per speaker, for institutions and for coaches); per-form messages; generated team names and code names; which person fields are asked; confirmation (*Always*, *Only open registrations*, *Never*).
- **Optional team fields** (none by default): *Prefix the team name with the institution*, **break categories** (non-general ones), **seed** (number or seed title, following the team import's seed setting) and **emoji**. The break-category list and seed mode are copied when the settings are saved, so save them again after changing break categories.
- **Representatives**: give an institution's representative a personal link that fixes the institution and shows the places left. **New link** replaces it, **Revoke** stops it. Representatives can request place transfers, which you approve on this tab.
- **Team invitations** (Representatives tab): a link for one existing team (`/register/{slug}/join#…`), shown once to copy, through which speakers add themselves to that team. **New link** replaces it, **Withdraw** stops it. Joining needs no review, but respects the registration window, the maximum speakers per team, and refuses a repeated name or email.
- **Review queue**: each submission with possible duplicates flagged; **Approve** creates the team or adjudicator (with private URL keys, matching or creating the institution), **Edit**, **Reject** (optional reason, not emailed), **Reopen**. Use **Refresh** to see new submissions.

With *Email registrants* on (Email page), registrants get "Registration received" and "Registration approved" emails. Full details, limits and abuse protection: [`docs/registration.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/registration.md).

## Deleting

Deleting a team, adjudicator, institution, venue, motion or break category asks for confirmation. Records still in use cannot be deleted:

| Record | Refused while referenced by | Instead |
| --- | --- | --- |
| Team | a debate (including a bye), a ballot or feedback | Mark the team unavailable |
| Adjudicator | a panel, a ballot or feedback | Mark the adjudicator unavailable |
| Venue | a debate | Mark the venue unavailable |
| Institution | a team or adjudicator | Move or delete those first |
| Break category | a generated break or a drawn elimination round | — |

For cloud tournaments, deleted teams and adjudicators are soft-deleted in Firestore at once (content kept); other records are queued as cloud deletions for the next upload.

## DebateXML import

**Tournaments hub → Or import a DebateXML archive** (global administrators) creates a **new** tournament from a DebateXML file, such as a Tabbycat export or a CrabbyTab archive. It never merges into an existing tournament.

1. Choose the file (up to 10 MB). It is validated before anything is saved.
2. Review **What will be imported** (counts), **errors** (which block the import) and **warnings**, each pointing at the element, e.g. `round "Round 1" › debate "D3" › side 2`.
3. Set the name, short name and slug, and choose **Create tournament from this file**. It is saved on this device; upload when ready.

Imported: institutions, teams and speakers (categories, gender), adjudicators (score, trainee, independent, gender, conflicts), venues, motions with info slides, break and speaker categories, divisions, feedback questions, rounds, debates with sides and panels, results (consensus or voting), byes and confirmed feedback. The style's rules preset is applied as Tabbycat's importer does.

Notes:

- The format comes from the archive's `style` if it is a CrabbyTab format, otherwise from the debates (4 sides = BP). Speakers per team and reply scoring are inferred; score ranges are widened to fit the imported scores (the preview says so).
- Imported draws are drafts and motions and results are unreleased, so nothing becomes public until you release it.
- Private URLs, emails and check-ins are not part of DebateXML.
- Panels only distinguish the chair; other members become trainees if flagged `trainee`, otherwise panellists.
- The file is treated as untrusted: DOCTYPE and entity declarations are refused and record counts are capped.

## Exports

Admin → **Data exports** downloads teams, speakers, adjudicators, institutions, availability, break eligibility and conflicts as CSV, built in the browser. Private URL keys and passcodes are never exported; the files do contain email addresses.

## Limitations

- CSV and API serializers do not yet carry team references, composite fields, pronouns or last names.
- Divisions and venue requirements of teams and adjudicators can only be set by CSV (and the API), not in the dialogs.
- Institutions are per tournament.

Details: [`docs/participants.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/participants.md), [`docs/data-import-export.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/data-import-export.md), [`docs/registration.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/registration.md).
