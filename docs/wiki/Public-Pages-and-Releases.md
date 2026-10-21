# Public pages and releases

Every tournament has a public site. Nobody needs an account to view it.

| Address | What it is |
| --- | --- |
| `/{slug}/public` | The public tab (sidebar → **Public → Public tab**) |
| `/{slug}/public/team/{id}`, `/{slug}/public/adjudicator/{id}` | Record pages (one participant's public debates and results) |
| `/{slug}/public/ballots`, `/{slug}/public/feedback` | Public ballot and feedback forms, when switched on |
| `/{slug}/schedule/public` and its iCalendar feed | The published schedule |
| `/{slug}/checkins/public` | Public check-in status |
| `/{slug}/audit/public` | The released audit log ([Audit log](Audit-Log)) |
| `/{slug}/display` | The projector ([Printing and display](Printing-and-Display)) |

Nothing is public until you release it. The rest of this page covers what each release shows and
where you switch it.

## How publishing works

Public pages never read your live data. They show a cleaned-up **public snapshot** of the cloud
copy, built by the server when you publish. A value that is hidden is left out of the snapshot,
so it is not just hidden on the page. Open public pages check for a new version every 45 seconds.

- **Releases publish in one step.** Release buttons open a dialog that saves the change, uploads
  this device's other pending changes and publishes the public pages. The dialog tells you how many
  other changes go up with it. If the upload or publish fails, it says the change is saved on this
  device but **not public yet**. This applies to: draw stages, round results, team speaks, motion
  releases, the schedule, and every item on the Public release panel. A release is refused while
  you are offline or while records conflict with the cloud (resolve those first). On a device
  without cloud sync, the change is saved on that device only.
- **Some changes are only saved on this device.** **Reveal Adjudicators** (Allocation page),
  the **Silent round** box (Results page) and every setting below go up with your next Upload. After
  you save settings, a **Saved on this device only** notice with an **Upload and publish** button
  appears.
- **Republish public pages** (account menu) publishes the cloud copy as it is. If this device has
  changes that are not uploaded, it asks first (**Upload and publish**, or **Publish cloud copy
  anyway**).
- An upload that hit conflicts, or that stopped part-way, does not update public pages. The top
  bar says so and shows how to recover.
- Submissions that skip your device (private-URL ballots and feedback, self check-ins, assistant
  syncs) appear on public pages after your next upload or republish.

To take something back, unrelease it the same way. Anyone who already saw it may remember it.

## Per-round releases

| What | Where | Effect |
| --- | --- | --- |
| Draw stages | Round → **Draw**: Confirm draw → Release to teams only → Release draw to public; Unrelease draw | Only **Released to public** reaches the public draw page and adjudicator portals. **Released to teams only** shows each team its own room, side and opponents on its private URL, and nothing else. |
| Panels | Round → **Allocation** → **Reveal Adjudicators** | Panels appear on the public draw, projector and team portals. Saved on the device; Upload to publish. |
| Current round | Draw page → **Make {round} current** / **Use automatic current round** | Chooses which round "current round only" pages, public forms and portals open on. By default it is the latest round whose draw is released to the public. Setting it never releases a draw. |
| Motions | Setup → **Motions** → pick a round → motion release: Not released / Info slides / Motions | Info slides only: viewers see the info slides, not the motions. Motions: portals, the projector and the public Motions tab show them. If the round has a preparation time, releasing motions sets the round's start time. |
| Results | Results → **Publish round results** | Team outcomes on the public results page and team portals. Needs every ballot confirmed or a bye recorded. |
| Team speaks | Results → **Publish team speaks** | Speaker and team scores for that round. Same requirement. |
| Silent round | Results → **Silent round** | Hides that round's results from public results and standings, and unpublishes both result switches. A released team or speaker tab still includes completed silent rounds. |

## Tournament-wide switches: Configuration → Public visibility

Sidebar → **Admin → Configuration → Public visibility**. Save, then use **Upload and publish**.

| Setting | Default | Effect |
| --- | --- | --- |
| Public results and scores | on | Turns the Results tab on or off. Each round's results must still be published. |
| Public standings tab | on | A team standings tab over the rounds whose results are published and not silent. It appears once at least one such round also has team speaks published. |
| Public motions page | on | The Motions tab, with released motions and info slides. |
| Public check-in counts | off | The `/checkins/public` page. Shows per-round counts. When the participants list is also released, it shows each team and adjudicator as checked in or not, refreshed every 30 seconds. |
| Self check-in from private URLs | off | See [Private URLs and portals](Private-URLs-and-Portals). |
| Public pages and portals language | browser | Default language of public pages, portals and printed sheets. Viewers can still pick their own. |
| Public draw | All released rounds | Off / **Current round only** / **All released rounds**. Current round only shows the current round (and the other rounds of its schedule slot). Earlier rounds stay visible only through their released results. The projector follows this too. |
| Adjudicator tab shows | final | Base score, final (feedback-blended) score, or both plus per-round feedback averages. You release the tab itself on the Public release panel. |
| Team / speaker / replies tab limits | 0 (all) | Shows only the top N. Ties at the cutoff are kept. With a limit, rounds visible only through the tab publish no individual results, so ranks below the cutoff cannot be worked out from other pages. |
| Break page metrics | -1 (all) | How many team precedence metrics to show next to each breaking team (0 = none). |
| Show break categories on the participants page | off | Publishes each team's break eligibility. |
| Motions order | forward | Earliest round first, or reverse. Tabbycat's default is reverse. |
| Show motions in results | off | A Motion column on public results and record pages. Only released motions are shown. |
| Team code names | off | See [Code names](#code-names). |
| Speaker and adjudicator code names | off | Publishes speakers and adjudicators under their code names. |
| Show team / adjudicator institutions | on | When off, institutions are removed from public teams, adjudicators and tabs. |
| Show which adjudicators are always trainees | off | An "Always trainee" column on the participants list and adjudicator tab. |
| Show team emoji | on | |
| Show speakers in the draw | on | |
| Show splitting adjudicators | off | Marks voting adjudicators whose sheet chose the losing team, on ballots whose panel is public. |
| Search engines | all | All pages may be indexed / homepage only / none. Adds `noindex, nofollow` to the other pages, including the public schedule. Search engines may ignore it, so it is not a privacy control. |
| Welcome message, Tournament staff | empty | Plain text (no HTML, at most 5000 characters) on the public page's Home tab. The welcome message shows only while the public homepage is empty. |
| Public homepage | empty | Markdown (at most 20,000 characters) for the Home tab, the tab the public page opens on: headings, lists, tables, links, https images, maths (`$x^2$`, `$$...$$`) and YouTube videos (a YouTube link alone on its own line). HTML is removed. The editor shows a live preview and a syntax help. While registration is open the Home tab also shows a **Register** button. |

To hide one person's name, mark the speaker or adjudicator **anonymous** in their edit dialog. They
show as "Redacted" everywhere public, and an anonymous speaker also loses their team in tab rows.

## Public release panel: Results → Standings

The **Public release** panel at the bottom of the Standings page (administrators) holds the
switches you usually flip at the end of the tournament. Every item starts **Hidden**. Each
**Release** opens the one-step publish dialog. The header shows how many preliminary rounds are
complete, because tabs cover **completed** preliminary rounds only.

| Item | Shows |
| --- | --- |
| Team tab | Full team standings over completed preliminary rounds, silent rounds included |
| Speaker tab | Speaker scores and rankings |
| Speaker category tabs | A speaker tab per public speaker category (listed only when a category is public). Until you set it, it follows the speaker tab. |
| Replies tab | Reply speaker rankings (only when reply speeches are on) |
| Participants list | Every team with its speakers; every adjudicator with their institution |
| Institutions list | Names, codes, regions. Team and adjudicator counts appear only if participants are public too. |
| Adjudication core / Breaking adjudicators | Adjudicators flagged core or breaking in their edit dialog |
| Adjudicator tab | Adjudicator scores, as chosen in "Adjudicator tab shows". Feedback text is never published. |
| All round results | Results of every completed round, silent and elimination rounds included. Speaker scores of rounds whose team speaks were never published are included only with a speaker tab that has no limit. Meant for after the tournament. |
| Scoresheets | Each adjudicator's sheet, for rounds whose speaker scores and panels are public. Free-text fields are never published. |
| Scoresheets on team private URLs | Each team sees the full sheets of its own debates once the round's results are published |
| Break category team tabs | A team tab per break category (eligible teams ranked within it), cut at the category's public tab limit |
| Team and adjudicator record pages | Per-participant pages (default **on**). Anonymous adjudicators have none. |
| Pre-allocated sides | Each team's side in every preliminary round (only with pre-allocated sides) |
| Elimination bracket | Built from released elimination draws and results |
| Diversity statistics | Gender, region and category counts and averages only |
| Motion veto statistics | Vetoes per motion and side, from rounds with public results (only with vetoes on) |
| Motion statistics | How often each released motion was chosen and won. Follows the motions page until set. Released alone, it appears as its own tab. |
| Feedback progress | Who still owes feedback (counts only) |
| {Category} break | The generated break for that category. Nothing shows until the break is generated. |

**Release the tab** (panel header) applies Tabbycat's tab-release preset in one step. It releases
the team and speaker tabs, motion statistics, scoresheets, all round results, diversity, every
category's break and the breaking adjudicators. It switches off the public draw, the standings tab,
break categories on participants and public check-ins.

## Code names

Set code names in **Public visibility** (team code-name mode, plus **Generate missing code names**
from emoji or last names and **Assign missing emoji**; existing values are never overwritten). Decode them on
**Setup → Code names**.

| Team code-name mode | Public sees | Tab room sees |
| --- | --- | --- |
| Off | Real names | Real names |
| Real names, code names as tooltips | Real names, code name on hover | Real name, code name on hover |
| Code names publicly (real names for staff) | Code names only | Real name, code name on hover |
| Code names publicly (staff see both) | Code names only | Code name, real name on hover |
| Code names everywhere | Code names only | Code names only |

In the code-name-only modes, a team without a code name shows "(no public name)". Private portals
are participant pages, so they follow the public rule for other teams. A team's own portal keeps
its real name.

## Public forms (ballots and feedback without private URLs)

Sidebar → **Admin → Assistants** → **Public forms** card:

| Setting | Effect |
| --- | --- |
| Public ballot form | `/{slug}/public/ballots` lists the chairs and voting panellists of the current round. Each picks their name and enters their ballot. |
| Public feedback form | `/{slug}/public/feedback` lists teams and adjudicators. Each picks themselves, then someone they may rate under the feedback paths. Needs feedback switched on. |
| Require the tournament password | Every submission must include the tournament password you set on the same card. |

- The password is stored on the server only as a salted hash. It is never in settings, exports or
  the public snapshot. If the password is required but not set, every submission is refused. Wrong
  passwords are limited to 30 an hour per network.
- Ballots are taken only for the current round, and only once its draw is released to the public.
  The form refuses while the round's motions are unreleased, when the adjudicator has no debate or
  more than one debate, and when the debate has no chair. With several motions it asks which was
  debated, and asks for vetoes when vetoes are on.
- **Public ballots are always stored unconfirmed**, whatever the private-URL setting says. The tab
  room confirms them. Feedback is stored confirmed, as on private URLs.
- The pickers come from the published snapshot. A room is shown next to an adjudicator only once
  panels are public. Names follow the code-name settings.
- Unlike Tabbycat, public forms do not switch private URLs off. Turn private-URL ballots off
  separately on the same page if you want only the public form.

## Schedule and calendar

On **Setup → Schedule**, add events (briefing, draw, preparation, debate, adjudication, meal,
awards, other) with times and an optional round. Then click **Publish schedule** (or **Hide
schedule**). The public page `/{slug}/schedule/public` shows times in the viewer's time zone and
marks what is happening now and next. **Add to calendar (iCal)** links to an iCalendar feed.

## Links on the public tab

Above its tabs, the public page links to the pages outside its tabs. Each link appears
only while that page is on:

- the schedule and its calendar feed
- check-in status
- the audit log, once released (**Admin → Audit log → Release audit log**)
- the registration form, while it is open or opens later
- the public ballot and feedback forms

## What is never public

Email addresses and phone numbers, private URL keys and passcodes, the public-forms password,
conflicts, feedback text, break remarks, unreleased motions and draws, and the core and breaking
flags until their list is released. Base scores and feedback averages appear only through a
released adjudicator tab. Teams that are not in a public draw or a released break are included only
when the participants list is released. Unreleased break decisions are removed from every team.

## Differences from Tabbycat

- Results, standings and motions pages default to **on** (Tabbycat: off). Nothing shows until you
  also release each round or motion, so this is safe.
- A **teams-only** draw release shows on team portals only. Tabbycat also lists it on the public
  draw page without adjudicators.
- Tab-limit ties at the cutoff are all shown.
- Public forms and private URLs are separate switches. In Tabbycat they are one exclusive setting.
- Releases depend on publishing. There is no live push to public pages.

## Details

- The public snapshot is split by round, so neither a cache entry nor a response grows with the
  tournament. A publish is skipped when nothing public changed anywhere in the cloud copy.
- Public pages are served from a cache (see
  [Deploying](Deploying-to-Vercel-and-Firebase)). Opening them costs no Firestore reads per visitor.
- Motion statistics count one confirmed ballot per debate and skip forfeits.
- Developer detail:
  [public-pages-and-notifications.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/public-pages-and-notifications.md),
  [rounds-schedule-and-motions.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/rounds-schedule-and-motions.md),
  [storage-and-scale.md](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/storage-and-scale.md).
- Anonymous read access to the same public data through the REST API: [API and tokens](API-and-Tokens).
