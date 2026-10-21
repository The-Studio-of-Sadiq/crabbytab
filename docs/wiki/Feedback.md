# Feedback

Adjudicator feedback is collected from teams and adjudicators, reviewed by the tab room and blended into adjudicator scores for [allocation](Adjudicator-Allocation). It is on by default.

Where things are:

| Task | Where |
| --- | --- |
| Turn feedback on/off, scale, step, introduction, questions, paths | **Admin → Configuration → Scoring & ballots**, card *Adjudicator feedback* |
| Switch feedback off for one round | **Admin → Configuration → Round settings** (per-round checkbox) |
| Progress, weights, ratings, manual entry, exports, bulk base scores | Sidebar **Results → Feedback** (page *Adjudicator feedback and ratings*) |
| Review individual submissions | Feedback page → **View submitted forms** (*Individual feedback forms*) |
| Duplicates | Feedback page → **Duplicate feedback** |
| One adjudicator's history | Click an adjudicator in the ratings summary (`/feedback/adjudicator/{id}`) |
| Printed forms | Feedback page → **Print forms** |
| Private-URL / public-form switches | **Admin → Assistants** (page *Tournament access*): *Feedback submissions through private URLs*; *Public forms* card |
| Round feedback weight | **Round → Allocation** page |

Deep reference: [adjudicator-allocation.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/adjudicator-allocation.md) (sections *Feedback paths* to *Duplicate feedback*).

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Enable adjudicator feedback submission | on | Off hides the Feedback page and portal forms |
| Minimum / maximum feedback score | 1 / 10 | The feedback scale; mapped onto the 1–10 adjudicator scale for scores |
| Feedback score step | 1 | Scores must be the minimum plus whole steps (e.g. 0.5). Checked in every form and again on the server |
| Feedback introduction | empty | Plain text shown above feedback forms in the private portals |
| Show unexpected feedback | on | Progress lists submissions no path expected, marked "?" |
| Important feedback threshold | 2 | Used by the *Important only* filter |
| Custom feedback questions | none | Separate *Team feedback* and *Adjudicator feedback* questionnaires |
| Feedback paths | see below | Who rates whom |
| Collect feedback in elimination rounds | on | Plus optional *Use different paths in elimination rounds* |
| Feedback submissions through private URLs | on | Off: portals hide the forms and the server refuses them |
| Public feedback form | off | A form on the public site; see [Public pages and releases](Public-Pages-and-Releases) |

## Questions

Every submission has an overall score, an optional *Agreed with the decision* answer and optional comments (up to 5,000 characters). Custom questions can be any of: short text, long text, whole number box, decimal number box (optional min/max), integer scale (pick one, at most 21 choices), number in range, yes/no, checkbox, select one, select many. Any can be *Required* (a required checkbox must be ticked). Answers are validated in the browser and again on the server. **Answers never change the score**; only the overall score counts.

## Feedback paths (who rates whom)

Set under *Feedback paths*. The same paths decide what the portals offer, what the server accepts, which sources the tab-room form lists, what the progress panel expects and which forms are printed.

**Teams give feedback on** (Tabbycat's `feedback_from_teams`):

| Option | May rate | Expected |
| --- | --- | --- |
| The chair only | chair | the chair |
| The orallist | voting adjudicators; team picks who gave the oral | one submission |
| Any voting adjudicator allowed, only the orallist expected | voting adjudicators | one submission |
| Any adjudicator (trainees too) allowed, only the orallist expected | every adjudicator | one submission |
| Every voting adjudicator (not trainees) | voting adjudicators | each of them |
| Every adjudicator on the panel | every adjudicator | each of them |
| Nobody | — | — |

CrabbyTab does not record who gave the oral, so for "one submission" modes a team's first submission on any allowed adjudicator settles it; further ones are *unexpected*.

**Adjudicators**, each a separate switch: chair on panellists, chair on trainees, panellists on chair, trainees on chair, panellists on each other (not trainees), or every adjudicator on every other (trainees included). Optionally **also allow feedback on teams**; it is never expected and never counts towards adjudicator scores.

Nobody rates themselves, and postponed debates take no feedback.

Tournaments created before explicit paths keep their old preset (*chairs → panel*, *two-way*, *everyone*), mapped onto these switches.

## How feedback comes in

| Route | Stored as | Notes |
| --- | --- | --- |
| [Private URL portals](Private-URLs-and-Portals) | confirmed | Server checks the source and target sat in the debate, the paths, score range and step, and answers. Teams see their panel only once adjudicators are revealed |
| Public feedback form | confirmed | Participants pick themselves from a list; optional tournament password. Same checks as private URLs |
| Tab room (**Enter feedback** on the Feedback page) | confirmed | Choose judge, debate, then who submitted it |
| Data-entry staff with *Enter feedback* | **unconfirmed** | The server checks only that source and target sat in the debate, not the paths (known gap) |
| Paper | — | **Print forms** produces one form per expected submission; enter them in the tab room |
| REST API | per request | See [API and tokens](API-and-Tokens) |

## Versions: resubmitting replaces

Feedback is versioned per source, target and debate (as Tabbycat). When confirmed feedback is saved from a private URL or the tab room, the same source's earlier confirmed feedback on the same target in that debate is **unconfirmed** (kept, not deleted), so it is not counted twice. In "orallist" mode a team's new feedback replaces its earlier one on any adjudicator of that debate.

Gotcha: **public-form** submissions do not replace earlier ones. Feedback stored twice before versioning existed also keeps both copies. Use the duplicate report to clean up.

## Reviewing

- **Individual feedback forms**: tabs for team and adjudicator feedback; filters by round, adjudicator rated, source type, source, and status (counted, unconfirmed, ignored), plus *Important only*. Administrators can **Confirm / Unconfirm** and **Ignore / Count again** each one; every change is audited. Ignored feedback stays on record but does not count.
- **Important only (±N from base score)**: feedback whose score differs from the adjudicator's current base score by more than the *Important feedback threshold* (Tabbycat's important feedback view).
- **Duplicate feedback**: submissions by the same team or adjudicator on the same target in the same debate, with the same confirm/ignore controls. It changes nothing by itself. Choose the minimum number of copies to show.
- **Feedback progress**: for a round, who owes feedback under the round's paths and who has not given it. Any submission from that source about that target counts as received (even unconfirmed or ignored). With *Show unexpected feedback*, unexpected submissions are listed with "?"; they still count towards scores unless ignored. A public progress page can be released separately.
- **Per-adjudicator page**: role in each round, all feedback received, a per-question summary of answers, the score history (base/test changes with who, when and why, and the feedback-derived score by round), and which rounds were *Tested* (a tester other than themselves sat on the panel).
- **Judge ratings summary**: base, test, counted feedback, weighted average, agreement rate, plus **Breaking** and **Tester** checkboxes.

Deleting feedback is only available through the REST API (soft delete, audited); in the UI, ignore it instead.

## Scores and weighting

- **Feedback weighting by source** (administrators, Feedback page): a multiplier for each pair of source role (team, chair, panellist, trainee) and the rated adjudicator's role. 1 = normal, 0 = not counted.
- Only confirmed, non-ignored feedback about adjudicators counts. The weighted average is mapped onto 1–10.
- Blended score = (1 − w) × (test score, else base score) + w × feedback average, where w is the round's feedback weight set on the Allocation page. New rounds default to w = 1, so feedback fully replaces the base score once there is any; lower it to keep base scores relevant. See [Adjudicator allocation](Adjudicator-Allocation).

## Bulk base scores

**Update base scores in bulk** (Feedback page): paste one `adjudicator,score` line per adjudicator (name or id; case and surrounding spaces ignored). **Check lines** previews each line; nothing is saved while any line has a problem (unknown or ambiguous name, missing or out-of-range score, extra columns, an adjudicator listed twice). Unchanged scores are skipped. Every change is recorded in the score history. Available to administrators and staff with *adjudicators.scores_edit*; staff changes reach the cloud with their next sync.

## Exports and privacy

- **Feedback CSV (admin only)**: every submission with sources, comments, answers and unconfirmed ones. **Scores CSV (admin only)**: base, test, feedback and blended scores using the current round's weight.
- Feedback is never on the public site or in the public snapshot.
- DebateXML exports include feedback scores and question answers, but not the free-text comments.
- API tokens need the `feedback` scope to read it.
- Data-entry staff see scores, comments and answers only with *See feedback and adjudicator scores* (`feedback.view`); see [Staff and roles](Staff-and-Roles).
