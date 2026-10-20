# Self-registration

Teams, adjudicators and institution representatives can register for a cloud tournament on a
public form, Tabbycat 2.x style (roadmap item #14 in `tabbycat-parity-plan.md`). Nothing a
registrant submits reaches the tournament directly: submissions wait in an administrator review
queue, and an approval creates the team or adjudicator with the ordinary entity commands.

## For organisers

**Registration** (`/{tournament}/registration`, administrators only) has three tabs.

**Settings**
- *Accept registrations* on/off, plus optional opening and closing times. The public form is at
  `/register/{slug}` (shown with a copy button).
- Which kinds may register (teams, adjudicators), and *Institution representatives only*.
- Speakers per team (minimum and maximum, 1–6) and the speaker category labels registrants may
  tick (e.g. ESL, Novice). Approved speakers carry the labels in `Speaker.categories`.
- Limits, counted over submissions that are not rejected (0 = none): teams and adjudicators per
  institution, and tournament-wide maximums. Teams and adjudicators added by hand do not count.
- Custom questions for the team and adjudicator forms, using the feedback question types (short
  and long text, yes/no, choose one, choose several, number scale), and instructions shown above
  the form (plain text).

**Representatives.** Add an institution, a representative's email and optional place limits that
override the per-institution defaults. The representative receives a personal link
(`/register/{slug}#…`) that fixes the institution on the form and shows the places left. **New
link** replaces the link (the old one stops working); **Revoke** stops it. Submissions already
made stay in the queue. Adding the same institution and email again also issues a new link. If
email delivery fails or SMTP is not configured, the link is shown once to copy.

**Review queue**
- Each submission shows its details, answers and **possible duplicates**: an existing team with
  the same name or a speaker email in common, an existing adjudicator with the same name or email,
  or another open submission matching the same way. Flags are advisory.
- **Approve** creates the team or adjudicator (with private URL keys) and records which one. The
  institution is matched by name or code; when none matches, a new institution is created with a
  suggested code. Declared institution conflicts become institution conflicts, and team or person
  conflicts become personal conflicts where a team of that name exists. Anything unmatched is
  listed after approval, to add by hand.
- **Edit** (pending only) uses the same validation as the public form. Limits and the window do not
  apply to administrators. **Reject** takes an optional reason (kept for administrators) and frees
  the place. **Reopen** puts a rejected submission back in the queue and takes the place again,
  even above the limit.
- The queue does not update by itself: use **Refresh**. No public listener or scan exists, so a
  busy form does not cost Firestore reads on administrator devices.

With **Email registrants** on (Email page, "Email settings and templates"), the contact address
gets "Registration received" on submission and "Registration approved" on approval, using the
tournament's saved templates (see [email-notifications.md](email-notifications.md)). Rejections
are not emailed.

## Registration breadth (Tabbycat parity)

Settings added for the source-level audit's registration items:

- **Institutions can register** (`institution_registration`): an institution, or its coach, asks
  for team and adjudicator places (with optional code and, if asked, region). In the queue,
  **Allocate places and send link** approves it with the places given (prefilled with the request):
  the coach becomes the institution's representative with those limits and receives the "Places
  allocated" email with their link. Institution registrations never count against any limit and
  are always reviewed. A representative link cannot register another institution.
- **Registration confirmation** (`registration_confirmation`): *Always* (default, as before),
  *Only open registrations* (registrations through a representative link are accepted at once), or
  *Never*. An accepted registration is created by the server directly in the live `teams` /
  `adjudicators` collections with private URL keys (as the data-entry route does) and marked
  approved ("Accepted automatically"). Institutions are matched by name or code against the cloud
  copy; an institution not there yet is not created (institutions are not live) and the record
  keeps its name. If creation fails, the registration stays in the queue.
- **Refuse registrations above an institution's places** (`reg_block_over_allocated`): on by
  default. Off: such registrations are accepted and flagged "Above the institution's places"; the
  tournament-wide maximums always hold.
- **Representatives can transfer places** (`reg_institution_slot_transfers`): a representative
  asks, on their link's page, to give team or adjudicator places to another registered
  institution; **Place transfers** (Representatives tab) approves or rejects. Approval moves the
  places between the two representatives' limits in one transaction; places already used, and
  unlimited places, cannot be given away.
- **Team names** (`team_name_generator`): as registered, institution + letter, institution +
  number, or institution + speaker initials, always unused in the tournament. **Code names**
  (`code_name_generator`): none, emoji, or speakers' last names. Applied when a registration is
  approved or accepted (`src/lib/registration/names.ts`).
- **Form fields**: phone and gender for speakers and adjudicators, region for institutions. Phones
  must be international (`+country code`). On approval they are copied to the real fields
  (`Speaker.phone/gender`, `Adjudicator.phone/gender`), so gender appears on the diversity page.
  Phones are organiser-only: assistant data and public pages leave them out.
- **Per-form messages** shown above the team, adjudicator and institution forms, and extra
  **question sets** for institutions and for each speaker (asked once per speaker).

## Approval and live collaboration

Since #35, teams and adjudicators of cloud tournaments are live collections
(`live-collaboration.md`). The server does not create them itself, because the administrator
devices' working copies own those records. Approval is therefore three steps:

1. **Claim.** The server moves the submission from *pending* to *being approved*. A second
   administrator approving at the same time is refused, so nothing is created twice.
2. **Create.** The reviewer's device creates the record with `addTeams` / `addAdjudicators`. On a
   live device these write to Firestore at once, so every other administrator device sees the new
   team or adjudicator within seconds.
3. **Approve.** The server records the new record's id.

If step 2 fails, the claim is released. If step 3 fails, the record exists and the submission
stays *being approved*: the queue offers **Mark approved as …** for matching records, or **Return
to pending**. Approving is disabled while live updates are off or stopped on the device.

Institutions are not a live collection yet. An institution created by an approval reaches other
devices with the next upload; until then, the team or adjudicator still carries the institution
name.

Local-only tournaments cannot use registration: the page explains that the tournament must be
uploaded first.

## Abuse protection

Public writes go only through `POST /api/public/tournaments/{slug}/registration`:

- **Size.** Bodies over 32 kB are refused. Names are limited to 120 characters, answers to 2,000,
  at most 20 conflicts, and speakers to the configured range.
- **Validation.** Allowed kinds, emails, speaker categories from the configured list, and answers
  to exactly the configured questions are checked, in `src/lib/registration/validation.ts`.
- **Spam.** A hidden `website` honeypot field: when filled, the server answers as if the form
  were received and stores nothing. The form also reports when it was shown; submissions within
  3 seconds or after 24 hours are refused.
- **Rate limits** per hour (`checkPrivateApiRateLimit`): 40 per client address per tournament,
  60 per client address overall, 600 per tournament. Wrong representative links count against a
  failure limit of 30 per address per hour.
- **Quotas** are checked and counted in the same transaction that stores the submission, against
  one counters document, so two simultaneous registrations cannot take the same last place.
- A short hash of the client address is stored with each submission, to spot floods from one
  network.

## Storage and Firestore budget

Everything lives under the server-only namespace `tournaments/{id}/serverOnly`, which
`firestore.rules` deny to every client:

| Path | Contents |
|---|---|
| `serverOnly/registration` | settings (with the tournament name copied, so the form needs no tournament read) |
| `serverOnly/registrationCounters` | non-rejected submissions per kind, total and per institution |
| `serverOnly/registration/submissions/{id}` | submissions, with a `revision` number |
| `serverOnly/registration/representatives/{id}` | representatives (only a hash of each link secret) |
| `serverOnly/registration/transfers/{id}` | place transfer requests |

Costs:
- **Public form:** 2 reads (slug registry and settings), cached at the edge for 30 seconds.
- **Submission:** about 7 reads and 5 writes, including the rate-limit documents.
- **Opening the review page:** reads every submission and representative once.

Every review action names the submission `revision` it saw. A submission changed since, for
example by another administrator, is refused with a reload message instead of being overwritten.

## API

| Route | Who | Purpose |
|---|---|---|
| `GET /api/public/tournaments/{slug}/registration` | public | form definition (no quotas or review data) |
| `POST …/registration` `{action: "representative", token}` | link holder | institution and places left |
| `POST …/registration` `{action: "submit", registration, representativeToken?, website, startedAt}` | public | store a submission (accepted at once when no confirmation is needed) |
| `POST …/registration` `{action: "transfer", token, transfer: {toRepresentativeId, teams, adjudicators}}` | link holder | ask to give places away |
| `GET /api/tournaments/{id}/registration` | administrators | settings, submissions, representatives, counters |
| `PUT …/registration` `{settings}` | administrators | save settings |
| `POST …/registration/submissions` `{action, submissionId, revision, …}` | administrators | `edit`, `reject`, `reopen`, `claim`, `release`, `approve`, `allocate` (institutions: `teamsAllocated`, `adjudicatorsAllocated`) |
| `POST …/registration/transfers` `{transferId, decision}` | administrators | approve or reject a place transfer |
| `POST / PATCH / DELETE …/registration/representatives` | administrators | add (and email), new link, revoke |

## Limitations

- Speaker categories are free labels. They are not yet tied to break eligibility; wave 3 #13
  makes speaker categories entities.
- Team-declared institution conflicts (wave 4 #20) are not collected; adjudicators declare their
  conflicts.
- Submissions are kept after the tournament. Deleting a tournament does not delete its
  `serverOnly` records.
