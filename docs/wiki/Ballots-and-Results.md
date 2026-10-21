# Ballots and results

Results are entered as **ballots**. A debate can have several ballot *versions*; the one confirmed, non-discarded version is the result. Standings are calculated live from confirmed ballots.

Where things are:

| Task | Where |
| --- | --- |
| Enter, check and confirm ballots | Sidebar **Results → Results** (page *Results & ballot entry*): pick the round, then **Enter ballot** / **Edit ballot** on a debate |
| Print ballot sheets, scan paper ballots | **Print ballot sheets** and **Ballot intake** links on the Results page (see [Printing and display](Printing-and-Display)) |
| Ballot settings | **Admin → Configuration → Scoring & ballots**, card *Ballot rules and options* |
| Private-URL ballots, individual ballots, self-split | **Admin → Assistants** (page *Tournament access*), card *Staff access and private-URL ballots* |
| Public (non-private-URL) ballot form | Same page, card *Public forms* (see [Public pages and releases](Public-Pages-and-Releases)) |
| Motion preferences | **Setup → Motions**, card *Motion settings* |

Deep reference: [results-and-ballots.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/results-and-ballots.md), [ballot-intake.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/ballot-intake.md), [staff-access.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/staff-access.md).

## Ballot settings

All on **Configuration → Scoring & ballots** unless stated.

| Setting | Default | What it does |
| --- | --- | --- |
| Minimum / maximum speaker score, score step; reply minimum / maximum | format preset | Range and step every speech is checked against |
| Ballot introduction/explanation | empty | Text shown on the tab-room ballot page, printed ballots, private-URL and public ballot forms |
| Margin includes dissenters | off | Voting ballots: scores, totals and margins come from the whole panel instead of the majority |
| Team score includes ghosts | on for new tournaments | Iron-person (ghost) speeches count towards the team total |
| Require double-entry ballot verification | off | A second person must check each tab-room ballot (see below) |
| How ballots are checked | Review | *Review* or *Blind* double entry |
| Ballots per debate, preliminary rounds | Consensus | *Consensus* (one ballot per panel) or *Voting* (one sheet per voting adjudicator). Two-team formats only; BP is always consensus |
| Ballots per debate, elimination rounds | Same as preliminary | Locked once an elimination ballot exists |
| Record motion vetoes | format preset | Each team may record the motion it vetoed |
| Allow forfeits | off | Two-team only: record a debate as forfeited by one side |
| Allow motion reuse | on | Reuse a motion in another round |
| Deciding the winner | from the scores | See [Deciding the winner](#deciding-the-winner) |
| Ballots ask for speaker scores | Always | *Always*, *Preliminary rounds only* or *Never* ([results-only ballots](#results-only-ballots)) |
| Speech ranks | Do not rank | Consensus ballots rank every substantive speech (adds the *Speech ranks (sum)* speaker metric) |
| Panel score aggregation (voting ballots) | Mean | *Mean* or *Median* |
| Maximum margin | 0 (no limit) | Two-team: no scoresheet may have a bigger margin |
| Reply score step | half the speaker step | Step for reply scores |
| Reply speaker must have given a substantive speech | on | The last substantive speaker can never reply either way |
| Side names | Affirmative/Negative | Two-team formats: Government/Opposition, Proposition/Opposition, Pro/Con, Team 1/Team 2 and others; used everywhere sides are shown |
| Record motions on ballots | on | Off: ballots and printed scoresheets do not ask for the motion or vetoes |
| Score criteria | none | Weighted criteria (e.g. WSDC Style/Content/Strategy); a speech's score is the weighted sum |
| Bye team results (*Draw rules*) | Absent | *Win* gives a bye team a win (see [Byes](#byes)) |

**Locked once ballots exist:** the format, teams per debate, substantive speakers, reply scoring, preliminary ballot mode, *Ballots ask for speaker scores* and score criteria (existing ballots would no longer fit). Changing a scoring setting after ballots exist asks for confirmation; see [Recalculating stored ballots](#recalculating-stored-ballots-when-scoring-changes).

## Consensus and voting ballots

| | Consensus | Voting |
| --- | --- | --- |
| Formats | All | Two-team formats, and N-team rooms ([see below](#n-teams-per-room)); never BP |
| Sheets | One ballot for the whole panel | One scoresheet per voting adjudicator: chair and panellists; trainees never vote |
| Winner | From the scores / declared, per *Deciding the winner* | Each sheet votes; the majority wins |
| Speaker scores | As entered | Combined per speech over the relevant sheets (majority, or the whole panel with *Margin includes dissenters*) |
| Team totals and margin | Own total − opponent total (two-team); BP has no margin | Mean of the relevant sheets' own totals and margins |

**Points.** BP: 1st = 3, 2nd = 2, 3rd = 1, 4th = 0. Two-team: win = 1. N-team rooms: teams in the room − rank. Preliminary round points are multiplied by the round's weight (*Round settings*); wins and speaks are not.

**Voting ballots in practice**

1. Allocate a chair (the page says *Allocate a chair before entering voting ballots*).
2. The speaker order is set on the chair's sheet and shared by every sheet.
3. Enter each adjudicator's scores. Every sheet must produce a winner.
4. A tied panel (e.g. 1–1) is decided by the chair's sheet. With no chair sheet the ballot is refused.
5. **Fill from private-URL ballots** copies each adjudicator's latest private-URL sheet into the ballot and warns about disagreements and missing adjudicators.

**Mean or median.** *Mean* is exact (not rounded). *Median* follows Tabbycat: an odd panel takes the median; an even panel takes the mean rounded up to a whole number (75 and 76 give 76). With score criteria each criterion is combined separately. Team totals and margins are always the mean of the sheets' totals.

## Deciding the winner

| Option | Two-team | BP |
| --- | --- | --- |
| From the scores (default) | Higher total wins; tied totals invalid | Ranks follow totals; tied totals invalid |
| Declared, as a check | Declared winner must have the higher total | As "from the scores" |
| Declared, to break ties | Equal totals allowed; declared winner may not have the lower total | Entered ranks may order teams with equal totals |
| Declared, overriding the scores | Low-point wins allowed | Any ranks accepted |

This replaces the old *Allow low-point wins* switch (still read for older tournaments). It applies to every voting sheet as well.

## Validation

A ballot is checked before it saves; the page lists every problem.

- **Speeches:** exactly the configured number of substantive speeches per team, in order, by speakers on the team's roster.
- **Scores:** within range and on the step (or each criterion within its own range and step).
- **Ranks / winner:** see above. BP needs each rank 1st–4th once.
- **Maximum margin**, when set.
- **Replies** (two-team, reply scoring on): one per team, not by the last substantive speaker, and (by default) by someone who gave a counted substantive speech.
- **Speech ranks**, when on: no ties; with "ranks must follow the scores", a higher score may not be ranked below a lower one.
- **Motion and vetoes:** the motion must be one of the round's motions; a veto must be another of the round's motions.

### Iron-person (ghost) speeches

If a speaker appears twice the ballot is refused until the extra speech is marked **Ghost** (the button next to the speech). Ghost speeches never count in the speaker tab; they count towards the team total only with *Team score includes ghosts*.

## Self-split ballots

*Allow self-split ballots for solo adjudicators* (Assistants page, Tabbycat's Karl Popper rule). In a two-team **voting** round, when a debate has exactly one voting adjudicator, the ballot page shows **This was a 2:1 split decision (self-declared)**.

- The winner is recorded with 2 votes and the loser 1, out of 3. Scores, winner and margin do not change.
- In standings the *votes/ballots carried* metric credits 2/3 and 1/3 of a panel.
- With *Show splitting adjudicators* on, the public site marks the adjudicator as splitting.
- Refused when the setting is off, the panel has more than one voting adjudicator, or the round uses consensus ballots. The checkbox is also on that adjudicator's private-URL ballot.
- Turning the setting off does not change saved ballots.

## Motions, vetoes and preferences on ballots

- **Motion debated.** With one motion in the round it is recorded automatically. With several, the ballot asks which was debated; private-URL and public-form ballots must answer (checked on the server, never defaulted).
- **Vetoes** (*Record motion vetoes*): one optional veto per team, from the round's other motions. Also offered on private-URL and public-form ballots. Vetoes appear in the motion statistics on **Analytics**, and publicly only once the veto statistics are released (see [Public pages and releases](Public-Pages-and-Releases)).
- **Motion preferences** (*Record ranked motion preferences*, Motions page): each team's ranking of the round's motions, most preferred first. A ranking may not repeat a motion or put its vetoed motion first. Tab-room entry only.
- **Record motions on ballots** off: ballots, portals and printed sheets stop asking for the motion or vetoes.

## Results-only ballots

*Ballots ask for speaker scores* = *Preliminary rounds only* or *Never*: affected ballots record only the result (*This round's ballots record the result only*).

- Two-team: the winner (or each adjudicator's declared winner on voting ballots). BP: the ranks.
- Points and wins count; team speaks, margins and the speaker tab leave the debate out.
- Rounds without speaker scores do not count against speakers for "speeches missable".

## Forfeits

With *Allow forfeits* (two-team only), choose **{team} forfeited** on the ballot. The other team wins with 1 point; no speaker scores, margin 0. Forfeits are left out of speaks, margins and motion statistics.

## Byes

A bye needs no ballot. With *Bye team results* = *Win*, the team gets 1 point and a win in every format (in BP that counts as a third place), with **no speaker scores and no margin**. With *Absent* (default) nothing is added.

> The bye notice on the ballot page still says the win comes "with prior average speaker scores". That text is out of date: standings award no speaker scores for a bye.

## Postponed debates

On the Draw page a debate can be marked **postponed**. Postponed debates are left out of standings, feedback and draw history and block round completion until resolved.

## Versions, confirming and discarding

Every save is a new **version**. The *Ballot versions* list on the entry page shows each with its status (*Confirmed*, *Discarded*, *Awaiting check*), the submitter (*Tab room*, *Public form*, *Adjudicator (private URL)*) and time, with **Edit as new version**, **Confirm vN** and **Discard vN**.

- **Confirming** a version unconfirms the previously confirmed one; drafts and other versions are left as they are (Tabbycat's behaviour). It writes the points and totals onto the debate and records who confirmed it.
- A ballot whose teams no longer match the current draw cannot be confirmed (protects regenerated draws).
- A confirmed or discarded version is never edited in place: corrections are saved as a new version.
- An unconfirmed new version leaves the existing confirmed result in force until it is confirmed.
- **Discarding the confirmed version** clears the result (you are warned). The debate goes back to *draft* if other versions remain, else *none*.
- Confirming or discarding a result **withdraws the round's published results and team speaks** so nothing stale stays public. Publish again when ready.
- Changing a result in a completed round asks for confirmation; results of an elimination round whose teams have advanced, or of a cancelled round, cannot change.

**Two devices.** On cloud tournaments, ballots of the active round sync live between administrator devices. If two devices confirm different versions before seeing each other, the sync status shows "N double confirmations"; discard the version that should not count. See [Backups, restore and cloud sync](Backups-Restore-and-Cloud-Sync).

## Double entry

With *Require double-entry ballot verification*:

- **Review** (default): the first person uses **Save for checking**. A different person sees *Version N, entered by …, is waiting for your check*, compares it with the paper and confirms or discards it. If they change anything they can only **Save corrected version (needs another check)**.
- **Blind:** the checker re-enters the paper ballot without seeing the first entry (its scores are *Hidden during blind check* in the history). Matching entries confirm the result and the checked entry is discarded. If they differ, *The two entries do not match* lists the differences (motion, forfeit, vetoes, sides, ranks/winners, self-split, every speech, or every sheet) and lets the checker record either entry; the other is kept as a discarded version.

**Who counts as "a different person".** The signed-in account. Confirming your own entry is a rule a tab director can override with a recorded reason (see [Audit log](Audit-Log)). On a signed-out single device people cannot be told apart, so the check is not applied. Data-entry staff with *Confirm others' ballots* are always held to the same-person rule, double entry or not.

Ballots from adjudicators' private URLs are their own record, not tab-room data entry, so double entry does not apply to them; use *The tab room confirms* (below) if you want to review them.

## Ballots from adjudicators

Adjudicators submit from their [private URL](Private-URLs-and-Portals) if they are the chair or a voting panellist of the debate (trainees cannot). Turn it off with *Ballot submissions from adjudicators through private URLs* (then the server refuses them). A **public ballot form** is a separate switch.

The server re-checks every ballot with the same rules as the tab room. Private-URL ballots support ghost speeches, the motion, vetoes, results-only rounds and self-split; forfeits and motion preferences are tab-room only.

*Ballots submitted through private URLs*:

| Option | Behaviour |
| --- | --- |
| **The tab room confirms** (default for new tournaments, as Tabbycat) | Every private-URL ballot is stored unconfirmed and waits for the tab room or staff with *Confirm others' ballots* |
| **The chair confirms** (tournaments created before the setting) | A chair's ballot counts at once and replaces earlier ballots of the debate |

Either way, a debate whose result the **tab room confirmed** is never overridden by a later chair ballot, and rounds that are completed, published or advanced do not accept automatic results: the new ballot waits as an unconfirmed version.

**Voting rounds.** A private URL records only the submitter's own sheet. If they are the debate's only voting adjudicator, that sheet becomes the voting ballot. Otherwise:

- Without *Individual ballots from every voting adjudicator*, the ballot is stored unconfirmed and the tab room enters the panel (Fill from private-URL ballots takes it).
- With it, each voting adjudicator's latest sheet is merged into one voting ballot. Sheets must agree on speakers, motion, vetoes and sides; disagreeing fields are cleared and flagged, never guessed. With *The chair confirms* a clean merge is confirmed when the last sheet arrives; with *The tab room confirms* use **Fill from private-URL ballots** and confirm.

Public-form ballots are **always** unconfirmed. Ballot receipts can be emailed ([Email and notifications](Email-and-Notifications)).

## Data-entry staff

Staff with *Enter ballots* save unconfirmed ballots only, may overwrite only their own unconfirmed ballots, and only for rounds whose draw is released and still running. Staff with *Confirm others' ballots* can confirm or blind-check someone else's entry, but not where a tab-room override would be needed (completed, cancelled or released rounds, advanced eliminations). See [Staff and roles](Staff-and-Roles).

## Recalculating stored ballots when scoring changes

Team totals, margins and voting aggregates are stored on each ballot. If you change *Team score includes ghosts*, *Margin includes dissenters* or *Panel score aggregation* after ballots exist, saving asks you to confirm ("the stored team totals of every entered ballot will be recalculated"). CrabbyTab then recalculates every live ballot (Tabbycat's `resaveballots`), updates the debates and writes a `ballots.resaved` audit entry listing ballots changed, ballots whose **result** changed (a winner decided by totals can flip) and ballots skipped (forfeits, results-only ballots, individual sheets, ballots that no longer fit the ballot mode). Other scoring settings (ranges, winner rule, forfeits, bye results, speech ranks, maximum margin) also ask for confirmation but are not recalculated.

Limitation: changing these settings through the REST API does not recalculate.

## N teams per room

For tournaments with rooms of other than 2 or 4 teams (e.g. the *Public Speaking* preset), ballots follow Tabbycat's "poly" rules:

| Ballot | What is recorded |
| --- | --- |
| Consensus with speaker scores | Teams ranked by total, highest first; tied totals refused. Points = teams in the room − rank. Nobody "wins"; no margin. Ranks always follow totals |
| Consensus without speaker scores | The advancing teams: exactly two, or one in the final round |
| Voting | Only with *Margin includes dissenters* on, and only with speaker scores. Scores only: each speech is the panel mean or median, each team total the mean of sheets; no ranks, points or winner |

A short last room is scored on its own teams. Each private-URL sheet in a voting round records scores only. Elimination rooms advance the declared teams, or the top two by rank (one in the final); a scores-only voting ballot cannot decide who advances. Forfeits and self-split are two-team only. Motion statistics are not computed for these tournaments.

## Publishing results and completing a round

On the Results page, card *Round publication*:

- **Publish round results** and **Publish team speaks** are separate; both stay disabled until every debate has a confirmed ballot or is a bye. Unpublishing is always allowed.
- **Silent round** hides this round's results from the public tab.
- **Complete round** (preliminary rounds) needs a draw, no postponed debates and a confirmed ballot for every non-bye debate. It can be reopened. Completion feeds break liveness and which rounds released tabs cover; standings do not wait for it.
- Elimination rounds use **Proceed to next round** instead (see [Breaks and eliminations](Breaks-and-Eliminations)).

What the public sees is covered in [Public pages and releases](Public-Pages-and-Releases).

## Details

- **Rehearsal results:** *Admin → Rehearsal tools* can generate simulated ballots that satisfy every ballot rule in force.
- **Paper intake:** each printed sheet has a barcode id; the intake board tracks Missing → Received → Entered/Awaiting check → Confirmed, with *Disputed* for disagreeing entries.
- **Not done:** per-criterion scores are not shown on public scoresheets. BP voting ballots are not offered (Tabbycat stores no points for them either).
