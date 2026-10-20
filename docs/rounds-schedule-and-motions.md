# Rounds, schedule and motions

How CrabbyTab runs several rounds at once, times rounds and debates, publishes a schedule and
releases motions. Modelled on Tabbycat v2.12.1 (`Round.schedule_group`, `prelim_panels`,
`starts_at`, `preparation_time`, `ScheduleEvent`, `Round.motions_status`, `RoundMotion`,
`DebateTeamMotionPreference`).

## Concurrent rounds (schedule slots)

- Every round has a schedule slot: `Round.scheduleGroup`, or its `seq` when unset. Tournaments
  saved before slots existed therefore have one round per slot and behave exactly as before.
- Rounds of the same stage in one slot are **concurrent** (parallel panels such as
  "Round 1 (A)" and "Round 1 (B)"). `currentRounds()` (`features/tournament/application/schedule.ts`)
  follows Tabbycat's `Tournament.current_rounds`: while preliminary rounds remain, every incomplete
  preliminary round in the earliest incomplete round's slot; afterwards the earliest drawn,
  not-yet-advanced elimination round of each break category.
- **State rules.** Power pairing waits only for rounds in *earlier* slots
  (`previous_round_incomplete`); a concurrent round's draw is not "based on" this round
  (`later_round_drawn`). Publishing a draw that shares a team, adjudicator or venue with a
  concurrent round is an overridable violation (`concurrent_round_clash`). Changing a slot
  (`checkScheduleGroupChange`) is refused when it would create a clash between drawn rounds or put a
  drawn round before a round that comes earlier in sequence.
- **Draw and allocation.** History (repeat pairings, side history, adjudicator history) comes from
  earlier slots only. Draw generation leaves out venues already used by a concurrent round;
  auto-allocation leaves out adjudicators and venues already used by one. Teams are never dropped
  silently: a team drawn in two concurrent rounds is reported by the clash check. Parallel
  round-robin panels share a round-robin index (`roundRobinIndex`, Tabbycat `get_rrseq`).
- **Admin pages.** Draw, allocation, results and availability show a "Running at the same time"
  bar (`CurrentRoundsBar`) when the active round has concurrent rounds: one click switches round,
  each shows its progress, and clashes are listed.
- **Current round.** By default the current round is derived: the latest round whose draw is
  released to the public. **Make ... current** on the Draw page (Tabbycat `tournament-set-current-round`)
  stores an explicit `preferences.currentRoundId` instead; public pages ("current round only" draw
  mode, the round they open on, public ballots), the projector and private URLs (the round they open
  on) then use that round and the rounds of its schedule slot. **Use automatic current round**
  clears it; a deleted or cancelled round also falls back to the derivation. An explicit current
  round never publishes a draw that is not released. Unlike Tabbycat, setting it does not mark
  rounds complete or incomplete.
- **Projector.** The projector shows every concurrent round of the shown round's slot together
  (see [public-pages-and-notifications.md](./public-pages-and-notifications.md#projector-display-slugdisplay)).
- **Live sync.** The admin device listens to the debates and ballots of the active round *and* its
  concurrent rounds (`liveListenerScopes(activeRoundId, concurrentRoundIds)`), so clashes and free
  adjudicators are current across operators.
- **Preliminary panels.** `preliminaryPanels` (Tabbycat `prelim_panels`) groups the preliminary
  rounds into slots of that many rounds from the Schedule page (`groupPreliminaryRounds`): default
  names become "Round k (A)" / "RkA"; custom names are kept. The deprecated
  `preliminaryPanelsPerScheduleSlot` is read as a fallback (`preliminaryPanelsOf`) and moved to the
  new key whenever settings are saved (`migrateSchedulePreferences`). Existing rounds are **not**
  regrouped automatically: the old preference never had an effect, so regrouping rounds that
  already ran would change what counts as history.

## Start times

- `Round.startsAt` and `Debate.scheduledTime` are absolute ISO times; pages show them in the
  viewer's time zone. A debate starts at its own time, else its round's (`debateStartTime`).
- `preparationTime` (minutes; absent or negative = off): releasing a round's motions through the
  three-state control sets `startsAt` to release time plus the preparation time, as Tabbycat's
  `ReleaseMotionsView`. Toggling single motions on the Motions list does not move the start.

## Schedule and iCalendar

- Events (`TournamentPreferences.scheduleEvents`, Tabbycat's `ScheduleEvent` types) are edited on
  the Schedule page and validated before saving (`validateScheduleEvents`). They live on the
  tournament record because a schedule is small and travels with the settings.
- The schedule is public only with `publicSchedule` (released through the usual publish dialog).
  The public projection drops `scheduleEvents` otherwise and resolves event titles at publish time.
- `/[slug]/schedule/public` and `GET /api/public/tournaments/[slug]/schedule` (JSON) and
  `/schedule/ical` (iCalendar, UTC times, RFC 5545 escaping and folding) read the published
  tournament section through the cached reader: one cached read, no anonymous Firestore scans.

## Motion release (three states)

- `Round.motionsStatus` is `not_released`, `info_slides_released` or `motions_released`
  (`motionsStatusOf()` derives it for older rounds). `Round.motionsReleased` stays, always equal to
  `status === "motions_released"`, so portals, assistants and the projection keep their contract.
- The control on the Motions page (pick a round) uses `setMotionsStatusCommand`: releasing motions
  releases every motion of the round; info slides or "not released" withdraw them, except motions
  also assigned to another round whose motions are released. Motions are saved before the round,
  so a released round never points at hidden motions. `onMotionsStatusChanged` is the hook for
  notifications (email, push).
- The per-motion toggle still works; the background sync (`roundsNeedingMotionReleaseSync`) marks a
  round released once any of its motions is, and falls back to "not released" (keeping an
  info-slides release) when none is.
- Public projection: with info slides released, only those slides leave the server (no text, no
  reference). The projector shows viewers the cover and info slides only; staff see everything with
  a "not released" note.

## Motions

- A motion can be assigned to several rounds; `Motion.roundSeq[roundId]` is its order in each round
  (Tabbycat `RoundMotion.seq`, falling back to `seq`). The draw attaches the round's first motion.
- Reusing a motion (Motions page → pick a round) assigns the same record, so statistics count one
  motion; "Copy from previous round" uses Tabbycat's `Round.prev` (latest earlier preliminary round,
  or same break category).
- A reused motion that is already public makes the new round's motions count as released too:
  the motion is not secret any more.
- The public motions order is the public-site setting `publicMotionsOrder` (`lib/publicFeatures.ts`).
- `enableMotionPreferences`: ballots record each side's ranked preferences
  (`BallotSubmission.motionPreferences`, most preferred first) alongside vetoes. A ranking may not
  repeat a motion or put the vetoed motion first. `computeMotionPreferenceStatistics` counts them.
  Like vetoes, they are not part of data-entry assistants' ballot fields.
- **Cross-tournament statistics** (`/tournaments/motions`): side results, vetoes and balance of
  motions across the tournaments you administer, from the working copies on this device (no cloud
  reads). Motions are matched by normalised text; BP and two-team results are never pooled.
  Tournaments you administer that are not on the device are listed so you can open them first.
- **Public cross-tournament statistics** (`/tournaments/motions/public`, data from
  `/api/public/motions`): the same table pooled across every published tournament that released
  its motion statistics (Tabbycat `motion_tab_released`, CrabbyTab's motion statistics setting).
  Each publish stores a small per-motion summary on the tournament's public view root
  (`PublicViewRoot.motionSummary`, `src/lib/motions/publicSummary.ts`), built from the public view
  only: released motions and public results. The page therefore costs one read per such tournament,
  cached for an hour, and shows nothing the tournaments' own public pages do not. A tournament joins
  (or leaves) at its next publish that changes public data.
