# Glossary

Terms as CrabbyTab uses them in its pages and code. Most follow Tabbycat's meaning; where CrabbyTab differs, the
entry says so. UI labels are in **bold**.

**Adjudication core** — the chief adjudicators. An adjudicator flagged *Adjudication core* is always a tester, can be
listed publicly, and staff can be given the *Adjudication Core* permission group. See
[Participants and imports](Participants-and-Imports) and [Staff and roles](Staff-and-Roles).

**Adjudicator score** — the strength used to allocate adjudicators: the test score (or base score when there is none)
blended with the weighted feedback average by the round's feedback weight. See [Feedback](Feedback#scores-and-weighting).

**AIDA rules** — break rules of the Australasian Intervarsity Debating Association that limit how many teams per
institution break (1996, 2016 Australs and 2016 Easters variants). See [Breaks and eliminations](Breaks-and-Eliminations).

**Assistant** — Tabbycat's name for tab-room helpers without full access. In CrabbyTab they are **data-entry staff**,
managed on **Admin → Assistants** (page *Tournament access*). See [Staff and roles](Staff-and-Roles).

**Availability** — whether a team, adjudicator or room takes part in a round. Anyone without an availability record
counts as available (Tabbycat counts nobody until checked in). See [Check-ins and availability](Check-ins-and-Availability).

**Ballot / ballot version** — a recorded result for one debate. Each save is a new version; the one confirmed,
non-discarded version counts. See [Ballots and results](Ballots-and-Results).

**Ballot intake** — the **Results → Ballot intake** board that tracks printed ballot sheets by barcode: *Missing*,
*Received*, *Entered*, *Awaiting check*, *Confirmed* or *Disputed*. See [Printing and display](Printing-and-Display).

**Base score** — an adjudicator's rating before feedback (**Base rating (1–10)** in the adjudicator dialog). Changes are
kept in the score history. Compare *test score*. See [Feedback](Feedback).

**BP (British Parliamentary)** — four teams per room in the positions Opening Government (OG), Opening Opposition (OO),
Closing Government (CG) and Closing Opposition (CO). Teams earn 3, 2, 1 or 0 points by rank. See
[Tournament setup and formats](Tournament-Setup-and-Formats).

**Bracket** — in a power-paired round, the teams on the same score of the first team-standings metric (wins in
two-team formats, points in BP). See [Rounds and draws](Rounds-and-Draws#two-team-power-pairing).

**Break** — the teams that qualify for the elimination rounds of a break category, followed by its reserves. Generated
on **Results → Break**. See [Breaks and eliminations](Breaks-and-Eliminations).

**Break category** — an independent break, such as Open, ESL or Novice, with its own size, reserves, priority and rule. A
*general* category includes every team not marked ineligible. See [Breaks and eliminations](Breaks-and-Eliminations#break-categories).

**Bubble-up-bubble-down** — an odd-bracket method that forms intermediate brackets and swaps a team with a neighbour
when the pairing would clash. See [Rounds and draws](Rounds-and-Draws#two-team-power-pairing).

**Bye** — a team sits out a round because the field does not fill every room. *Bye team results* decides whether it
counts as absent or as a full win; it never gives speaker scores. In a partial elimination, a top seed's bye means it
advances without debating. See [Rounds and draws](Rounds-and-Draws#byes).

**Chair** — the adjudicator who leads a panel. Chairs and voting panellists can submit ballots from their private URL.
See [Adjudicator allocation](Adjudicator-Allocation).

**Check-in** — marking a team, speaker, adjudicator or room present, by tick, barcode scan or self check-in. With
*Check-in expiry*, old check-ins stop counting. See [Check-ins and availability](Check-ins-and-Availability).

**Cloud copy** — the tournament stored in Firestore, shared by devices, private URLs, staff and the public site.
Compare *working copy*. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

**Code name** — a team's public alias. With a code-name mode on, public pages show code names only and real names never
leave the server; the **Code names** page decodes them for the tab room. See
[Public pages and releases](Public-Pages-and-Releases#code-names).

**Composite team** — a team whose speakers come from more than one institution. See
[Participants and imports](Participants-and-Imports).

**Conflict** — a reason an adjudicator must not judge a team or sit with another adjudicator: personal, institutional,
or a team–institution conflict. Allocation avoids them through a large penalty and lists any that remain. Conflicts
are never public. See
[Adjudicator allocation](Adjudicator-Allocation#conflicts).

**Consensus ballot** — one result for the whole panel. Compare *voting ballot*. See
[Ballots and results](Ballots-and-Results#consensus-and-voting-ballots).

**Data-entry staff** — signed-in staff whose permission groups decide what they can do (enter ballots, check people in,
and so on). Tabbycat's assistants. See [Staff and roles](Staff-and-Roles).

**DebateXML** — the XML archive format Tabbycat uses. CrabbyTab imports it as a new tournament and exports it. See
[Participants and imports](Participants-and-Imports#debatexml-import).

**Double entry** — a second person checks every tab-room ballot before it counts, by **Review** or by **Blind**
re-entry. See [Ballots and results](Ballots-and-Results#double-entry).

**Draw** — the pairing of teams into rooms and positions for a round. See [Rounds and draws](Rounds-and-Draws).

**Draw check** — the list of errors and warnings for a draw (clashes, missing rooms, side imbalance and so on).
Releasing a draw with errors needs a recorded reason. See [Rounds and draws](Rounds-and-Draws#draw-check-and-flags).

**Draw stage** — where a round's draw is in its release: **No draw**, **Draft**, **Confirmed, not released**,
**Released to teams only** and **Released to public**. The stored values are `none`, `draft`, `locked`,
`teams_released` and `confirmed` (`released` is read as a synonym). See [Rounds and draws](Rounds-and-Draws#draw-stages).

**Draw strength** — a standings metric: the sum of a team's opponents' team points. Variants use opponents' wins,
speaks or rank. See [Standings and metrics](Standings-and-Metrics).

**Equity** — a permission group for equity officers: see and edit conflicts. It cannot see participant contact
details. See [Staff and roles](Staff-and-Roles).

**Feedback** — ratings and answers about adjudicators from teams and other adjudicators, submitted on private URLs,
public forms or entered by the tab room. See [Feedback](Feedback).

**Feedback path** — who may give feedback on whom (for example chair on panellists, teams on the chair). See
[Feedback](Feedback#feedback-paths-who-rates-whom).

**Feedback weight** — set per round on the Allocation page: how much the feedback average replaces an adjudicator's
test or base score (0 to 1; new rounds default to 1). See [Feedback](Feedback#scores-and-weighting).

**Fold / slide / adjacent** — pairing methods within a bracket of ten: fold 1 v 10, slide 1 v 6, adjacent 1 v 2. See
[Rounds and draws](Rounds-and-Draws#two-team-power-pairing).

**Forfeit** — a two-team ballot option: the other team wins with 1 point, without speaker scores. See
[Ballots and results](Ballots-and-Results#forfeits).

**Ghost speech** — see *iron-person speech*.

**Global administrator** — a site-wide administrator whose UID is in the server variable `FIREBASE_ADMIN_UIDS`. Only
global administrators create tournaments. See [Staff and roles](Staff-and-Roles).

**Importance** — a debate's priority for allocation, 0–10, set by hand or by **Prioritise by bracket** /
**Prioritise by liveness**. Preformed panels also have an importance. See
[Adjudicator allocation](Adjudicator-Allocation#debate-priority-and-liveness).

**Independent** — a team or adjudicator with no institution (*Independent / unaffiliated*), so no institutional
conflict applies. See [Participants and imports](Participants-and-Imports).

**Info slide** — background text released before a round's motions. Motion release has three steps: *Not released*,
*Info slides*, *Motions*. See [Public pages and releases](Public-Pages-and-Releases#per-round-releases).

**Intermediate bracket** — a bracket formed between two brackets to absorb an odd team: the bottom team of the higher
bracket meets the top team of the lower one. See [Rounds and draws](Rounds-and-Draws#two-team-power-pairing).

**Iron-person speech** — a speaker giving an extra speech when their team is short. The extra speech is marked
**Ghost** on the ballot: it never counts in the speaker tab, and counts towards the team score only with
*Team score includes ghosts*. See [Ballots and results](Ballots-and-Results#iron-person-ghost-speeches).

**Live** — the sync status of an administrator device whose ballots, debates, teams and adjudicators sync with the cloud
copy record by record. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

**Liveness** — per break category, whether a team is *live*, *safe* (certain to break) or *dead* (cannot break), from
the completed rounds. Shown in standings, on the Draw and Allocation pages. See
[Adjudicator allocation](Adjudicator-Allocation#debate-priority-and-liveness).

**Local only** — a tournament that has never been uploaded: nothing leaves the device. See
[Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

**Motion veto** — a team striking one of the round's motions. With **Record motion vetoes**, ballots record one veto per
team; vetoes feed the motion statistics. See [Ballots and results](Ballots-and-Results#motions-vetoes-and-preferences-on-ballots).

**N teams per room** — the format for rooms of any team count other than 2 or 4 (Tabbycat's *teams in debate*, used by
its Public Speaking preset with 6). Positions are *Team 1* … *Team N*; only random and manual draws. See
[Rounds and draws](Rounds-and-Draws#n-teams-per-room).

**One-up-one-down** — a conflict-avoidance method that swaps opponents between adjacent rooms to remove clashes. See
[Rounds and draws](Rounds-and-Draws#two-team-power-pairing).

**Panellist** — an adjudicator on a panel other than the chair. Panellists vote on voting ballots and may submit their
own sheet. See [Adjudicator allocation](Adjudicator-Allocation).

**Partial elimination** — a first elimination round when the break size is not a full bracket: the top seeds get byes
and the rest debate. See [Breaks and eliminations](Breaks-and-Eliminations).

**Passcode** — the secret that goes with a private URL. It is separate from the link and can be printed on slips. See
[Private URLs and portals](Private-URLs-and-Portals).

**Permission group** — a named set of permissions given to data-entry staff, such as Tabulation assistant, Equity,
Adjudication Core or a custom group. See [Staff and roles](Staff-and-Roles#permissions).

**Postponed debate** — a debate marked as not yet held; it gets no room and its result can come later. See
[Ballots and results](Ballots-and-Results#postponed-debates).

**Power pairing** — drawing teams against others on similar results: two-team rounds pair within brackets; BP rounds use
Tabbycat's Hungarian assignment. Round 1 is drawn randomly. See [Rounds and draws](Rounds-and-Draws#draw-types).

**Precedence** — the ordered list of metrics that ranks teams or speakers (for example points, then total speaks). See
[Standings and metrics](Standings-and-Metrics).

**Preallocated sides** — two-team sides set on the Draw page before the draw. See
[Rounds and draws](Rounds-and-Draws#side-allocation).

**Preformed panel** — a panel built before the draw and placed as a unit by its importance. See
[Adjudicator allocation](Adjudicator-Allocation).

**Private URL** — a participant's secret link (`/{slug}/private/team/…`, `/adjudicator/…` or `/speaker/…`), used with a
passcode, that opens their portal: their draw, ballots, feedback and self check-in. No account is needed. See
[Private URLs and portals](Private-URLs-and-Portals).

**Public form** — an optional ballot or feedback form on the public site for participants without private URLs, with an
optional password. Its submissions are always unconfirmed. See
[Public pages and releases](Public-Pages-and-Releases#public-forms-ballots-and-feedback-without-private-urls).

**Public snapshot** — the cleaned-up copy of released data that the server builds from the cloud copy when you publish.
Public pages read only this. See [Public pages and releases](Public-Pages-and-Releases#how-publishing-works).

**Pull-up** — a team moved up from a lower bracket to fill an odd bracket. Pull-ups are recorded on the debate and
counted by the *Pull-ups* metric. See [Rounds and draws](Rounds-and-Draws#two-team-power-pairing).

**Release** — making something visible to participants or the public: a draw stage, a round's results, team speaks,
motions, or an item on the **Public release** panel. Releases upload and publish in one step. See
[Public pages and releases](Public-Pages-and-Releases).

**Republish** — **Republish public pages** (account menu) rebuilds the public snapshot from the cloud copy. See
[Public pages and releases](Public-Pages-and-Releases#how-publishing-works).

**Reserve** — a team listed after the breaking teams of a category (R1, R2, …); the *Reserve size* sets how many. See [Breaks and eliminations](Breaks-and-Eliminations#break-categories).

**Room constraints** — *hard requirements* a room must meet (category, seats, accessible, online, near tab room) and
*soft room preferences* for room categories with a priority (Tabbycat's venue constraints). See
[Venues and constraints](Venues-and-Constraints).

**Rules preset** — a bundle of Tabbycat's settings for a named format (BP, Australs, WSDC, APDA, Public Speaking and
others), applied when the tournament is created, or later to an existing tournament after a preview of every change. See
[Tournament setup and formats](Tournament-Setup-and-Formats#rules-presets).

**Self check-in** — a participant checking themselves in from their private URL. See
[Check-ins and availability](Check-ins-and-Availability#self-check-in).

**Self-split ballot** — in a two-team voting round with one voting adjudicator, the adjudicator declares a 2:1 split.
See [Ballots and results](Ballots-and-Results#self-split-ballots).

**Side names** — what the two sides are called: Affirmative/Negative (default), Government/Opposition,
Proposition/Opposition, Pro/Con, Appellant/Respondent, Team 1/Team 2 or Plaintiff/Defense. BP uses OG, OO, CG, CO.
See [Tournament setup and formats](Tournament-Setup-and-Formats).

**Silent round** — a round whose results are kept off public results and standings. See
[Public pages and releases](Public-Pages-and-Releases#per-round-releases).

**Slug** — the short name in a tournament's address, for example `my-open-2026`. It cannot be changed later.

**Speaker category** — a group of speakers such as ESL or Novice, managed on **Setup → Speaker categories**. Public
categories get their own speaker tab; categories can also decide break eligibility. See
[Standings and metrics](Standings-and-Metrics) and [Breaks and eliminations](Breaks-and-Eliminations).

**Swing team** — a team made up on the day to fill the last room instead of giving byes. It is drawn like any team, but
it and its speakers are left out of standings and the break. See [Rounds and draws](Rounds-and-Draws#swing-teams).

**Test score** — an adjudicator score from a test that, when set, replaces the base score in allocation. See
[Feedback](Feedback#scores-and-weighting).

**Tester** — an adjudicator flag (always on for the adjudication core); the feedback pages note when a tester sat on an
adjudicator's panel. See [Participants and imports](Participants-and-Imports).

**Tournament administrator** — a person with full control of one tournament (Tabbycat's tab director). See
[Staff and roles](Staff-and-Roles).

**Trainee** — an adjudicator who sits on a panel without voting and cannot submit ballots. Only adjudicators marked as
trainees can fill trainee slots. See [Adjudicator allocation](Adjudicator-Allocation).

**Two-team formats** — UADC (Asian), Australs, WSDC and custom two-team. See
[Tournament setup and formats](Tournament-Setup-and-Formats).

**Upload now / Download and compare** — the manual cloud sync for data that does not sync live (settings, rounds,
motions, rooms, break categories, feedback and so on). Download compares the cloud copy with this device and shows
conflicts. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

**Voting ballot** — one scoresheet per voting adjudicator; the majority decides. BP ballots are always consensus. See
[Ballots and results](Ballots-and-Results#consensus-and-voting-ballots).

**Who-beat-whom** — a standings metric that ranks two tied teams by their result against each other. See
[Standings and metrics](Standings-and-Metrics).

**Working copy** — the tournament stored in this browser (IndexedDB), where the tab room's edits happen and draws,
standings and breaks are computed. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).
