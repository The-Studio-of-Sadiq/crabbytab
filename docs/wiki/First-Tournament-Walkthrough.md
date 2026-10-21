# First tournament walkthrough

A complete run through a small tournament, from setup to the final, with the current interface. It assumes CrabbyTab is [deployed](Deploying-to-Vercel-and-Firebase) (or [running locally](Installation-and-Local-Development)) and that you are a global administrator. Sidebar sections are written as **Section → Page**.

> **How saving works.** Everything you do is saved in this browser at once. Once the tournament has a cloud copy, ballots, check-ins, draws and allocations also sync **live** to other administrator devices. Settings, rounds, motions, rooms, breaks and feedback reach the cloud with **Upload now** (cloud status menu in the top bar), and release buttons upload and publish in one step. The top bar shows how many changes are not uploaded.

## Option A: rehearse with a demo tournament

The fastest way to learn the workflow, and to train volunteers.

1. `/tournaments` → *Or load a demo tournament for a rehearsal*. Choose **British Parliamentary (24 teams)** or **WSDC (16 teams, three speakers and a reply)** and a URL starting with `demo-`, then **Create demo tournament**. It comes with institutions, teams and speakers (some ESL), adjudicators with scores and conflicts, rooms, preliminary and elimination rounds, motions and Open / ESL break categories, under that format's rules preset. It has no draws or results.
2. Follow [Each preliminary round](#each-preliminary-round) below for Round 1: generate the draw, allocate, release.
3. **Admin → Rehearsal tools**: pick the round and a seed, then **Simulate results** (one random, valid, confirmed ballot per debate) and **Simulate feedback**. The same seed on the same draw gives the same results. Simulated records are marked "Simulated (rehearsal)".
4. Repeat for every round, then generate the break and run the eliminations.

Rehearsal tools also work on a real tournament, but then each run needs the tournament's short name typed as confirmation and is recorded in the audit log. Never use them during an event.

## Option B: a real tournament

### Before the tournament

1. **Create the tournament.** `/tournaments` → **Create a new tournament**. The wizard asks for the name and URL slug (it cannot change later), the format, an optional **Tabbycat rules preset** (Australs, BP, UADC, WSDC, APDA, Karl Popper and others), scoring, the number of preliminary rounds and draw method, break categories, what is public and how participants submit ballots. See [Tournament setup and formats](Tournament-Setup-and-Formats).
2. **Review settings.** **Admin → Configuration**: *Draw rules*, *Round settings*, *Format & teams*, *Scoring & ballots*, *Standings rules*, *Public visibility*. Defaults follow Tabbycat's ([Settings reference](Settings-Reference)). To copy another tournament's settings, use *Format & teams → Configuration file and rules presets*.
3. **Break and speaker categories.** **Results → Break**: check the categories (add ESL, Novice…). **Setup → Speaker categories**: add speaker categories if eligibility depends on them.
4. **Import participants** ([how](Participants-and-Imports)): **Setup → Institutions**, **Teams**, **Adjudicators** (each with **Import CSV** and a preview), then **Venues** and **Motions**. Try the files in `testdata/` when rehearsing.
5. **Check adjudicators.** Base scores, trainees, *Adjudication core*, *Breaking* and *Tester* flags, and conflicts (adjudicator dialog, or **Setup → Conflicts**).
6. **Rooms.** **Setup → Venues**: priorities, categories, capacities; **Setup → Room preferences** for soft preferences ([details](Venues-and-Constraints)).
7. **Upload.** Cloud status menu → **Upload now**. This creates the cloud copy, claims the slug and switches on live sync for ballots, check-ins and draws.
8. **Staff.** **Admin → Assistants** (the staff page): add tournament administrators and data-entry staff, by existing account or email invitation ([Staff and roles](Staff-and-Roles)).
9. **Registration (optional).** **Setup → Registration** to let teams and adjudicators register themselves, with representative links and team invitations.
10. **Private URLs.** **Public → Private URLs**: *Ensure all credentials assigned*, then **Print QR slips** or email the links ([how](Private-URLs-and-Portals)).
11. **Schedule (optional).** **Setup → Schedule**: start times, parallel panels, preparation time, the public schedule.
12. **Back up.** Account menu → **Export tournament backup**, and keep the file safe.

### Each preliminary round

Select the round in the top bar; the sidebar group becomes *Round · R1*.

1. **Availability.** *Round · R1* → **Availability**. Everyone is present unless marked absent. Mark absentees, use barcode scanning, or let participants self check-in ([how](Check-ins-and-Availability)).
2. **Draw.** *Round · R1* → **Draw**. Check the draw type in *Draw setup* (the first power-paired round is random), then **Generate R1 draw**. Read the draw check and the flags (rematches, same institution, side counts, pull-ups); move teams by drag or **Move** → **Place here** / **Swap here**; mark postponed debates. If teams are short of a full room, add a swing team or let byes apply. ([Rounds and draws](Rounds-and-Draws))
3. **Rooms.** Rooms are assigned when the draw is generated; press **Allocate venues** after changes.
4. **Adjudicators.** *Round · R1* → **Allocation**. Set panel size and feedback weight, optionally **Prioritise by bracket** / **by liveness**, then **Auto-Allocate All**. Fix the reported clashes by hand. ([Adjudicator allocation](Adjudicator-Allocation))
5. **Confirm and release the draw.** On the Draw page: **Confirm draw** (optional; locks the matchups), **Release to teams only** (optional; teams see their room on their private URL without the panel), then **Release draw to public**. Then **Reveal Adjudicators** on the Allocation page. Put **Display** on the projector.
6. **Motions.** **Setup → Motions**: release the round's info slides, then its motions, when announced. Releasing motions starts the preparation time if one is set.
7. **Ballots.** Adjudicators submit ballots from their private URLs (or the public ballot form, if chosen), or the tab room enters paper ballots on **Results** (track paper with the ballot intake board). Confirm each ballot; with double entry on, a different person checks it. ([Ballots and results](Ballots-and-Results))
8. **Publish and complete.** On **Results**: **Publish round results** and, separately, **Publish team speaks** (skip for silent rounds), then **Complete round**. Completed rounds count towards break liveness, and the tabs cover completed rounds only. (The next round's power pairing needs every ballot of this round confirmed.)
9. **Feedback.** **Results → Feedback**: review submissions and the progress panel; lower the next round's feedback weight if base scores should keep influence ([Feedback](Feedback)).
10. **Back up** after each round.

### The break

1. After the last preliminary round, check **Results → Standings**.
2. **Results → Break**: set overrides (ineligible, withdrawn, resolved ties) and **Generate break** for each category, highest priority first. Ties at the cutoff are reported and must be resolved with overrides. Check **Breaking adjudicators** too.
3. Release the break from the **Public release** panel on **Results → Standings**. ([Breaks and eliminations](Breaks-and-Eliminations))

### Elimination rounds

1. Select the first elimination round and **Generate draw** on the Draw page: a seeded bracket from the break (partial eliminations give the top seeds a bye). Sides follow *Sides in elimination rounds* (by seed, or random and recorded on the ballot).
2. Allocate panels, release the draw, reveal adjudicators, enter and confirm ballots as before.
3. On **Results**, **Proceed to next round** marks losing teams eliminated and activates the next elimination round.

### Afterwards

- **Results → Standings → Public release**: **Release the tab** releases the team and speaker tabs, the motion tab, scoresheets and every round's results together; or release items one by one (participants, adjudicator lists, speaker category tabs…).
- Release the audit log for transparency (**Admin → Audit log**).
- Export a final backup and a DebateXML archive (account menu).

## Gotchas

- Generating a draw while an earlier round is unfinished asks for a reason: unfinished results do not count towards power pairing.
- Regenerating a draw that has ballots discards them (they stay in history). Confirmed or released draws need a reason to regenerate.
- A changed panel hides revealed adjudicators again; reveal again when done.
- Changing the format, speakers or ballot mode is locked once ballots exist.
- Self check-ins and participants' ballots go to the cloud; a device with live sync paused sees them only after **Download and compare**.
