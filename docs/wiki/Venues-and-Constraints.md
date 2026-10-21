# Venues and constraints

Rooms ("venues") are managed on Setup → **Venues**; soft room preferences on Setup → **Room preferences**. Rooms are allocated after the draw from the Draw page, and again after adjudicator allocation when adjudicators have room needs.

## Venues

A venue has:

| Field | Meaning |
| --- | --- |
| **Room name** | Shown in the draw, portals and emails |
| **Priority rank** | Higher = better room, used for top-bracket and important debates (default 10 on import) |
| **Category** | One or more room categories, comma-separated (e.g. "Large, Accessible") |
| **Capacity (seats)** | Optional; blank means no limit |
| **Accessible**, **Online-capable**, near tab room | Capabilities matched against requirements. *Near tab room* is set through the CSV `near_tab_room` column (not in the dialog). |
| **Room link** | Optional http(s) map or meeting link, shown in the draw, private URLs, public draw data and emails (`{{venue_url}}`) |
| **Availability** | The room's default availability, and an override per round |

**Add venue** adds one; **Import CSV** imports many at once (columns `name`, `priority`, `category`/`categories`, `capacity`, `accessible`, `online`, `near_tab_room`, `url`; see [CSV formats](CSV-Formats)). The venue CSV imports directly, without a preview.

### Availability

A room is used in a round when it is **available**: its per-round setting (the *In {round}* toggle on the Venues page) if set, otherwise its default. An unavailable room is never allocated. Rooms used by a concurrent round in the same schedule slot are never offered either.

Rooms can also be **checked in** on the round's Availability page (tick, or barcode). The check-in is informational: it records a time, and with *Room check-in expiry* (Configuration → Public visibility) old check-ins show as *Expired*. Allocation uses availability, not check-in.

### Room categories

The **Room categories** card on the Venues page describes each category (the text follows "This room …" in tooltips; shown on public pages only when ticked) and whether its name is shown as a **prefix** or **suffix** of room names. Requirements, preferences and filters match any of a room's categories.

## Hard requirements

Requirements must hold; a debate is never put in an unsuitable room. They can be set on:

- **debates** — on the Draw page room card: *Required category*, *Minimum seats*, *Accessible*, *Online-capable*, *Near tab room*;
- **teams, adjudicators and institutions** — through the CSV import columns `required_venue_category`, `min_venue_capacity`, `requires_accessible_venue`, `requires_online_venue`, `requires_near_tab_room` (or the API).

When a draw is generated, the requirements of the debate's teams and their institutions are combined: the largest capacity wins and the flags add up. Two different required categories among a debate's teams is an error ("Teams in a debate require incompatible venue categories"). Adjudicator requirements are added when adjudicators are allocated; if a panel's adjudicators need different categories, the debate keeps its own category and the conflict is reported instead of stopping the allocation.

## Soft room preferences

Setup → **Room preferences** (Tabbycat's venue constraints): a team, adjudicator or institution prefers rooms of a **category**, with a whole-number **priority**. Add them one at a time (**Add preference**) or import a CSV (one row per preference: `team`, `adjudicator` or `institution`, plus `category` and `priority`; preview first). Allocation meets them where it can: missing one preference of a priority costs more than missing every lower-priority one together, any preference outweighs room ranking, and none is ever met at the cost of a hard requirement. Unmet preferences appear as warnings in the draw check.

## Allocating rooms

On the Draw page, **Allocate venues** assigns compatible available rooms by debate priority. Rooms are also allocated when a draw is generated, and again after auto-allocating adjudicators when any adjudicator has room requirements or preferences.

The allocator finds a minimum-cost assignment (CrabbyTab finds the best assignment where Tabbycat assigns greedily, debate by debate):

1. Hard requirements must hold.
2. Room preferences are met where possible, by priority.
3. Higher-ranked debates (bracket, importance) get higher-priority rooms.

Byes and postponed debates get no room.

**Too few rooms never stops a draw** (as Tabbycat's room allocator): as many debates as possible get a room, the lowest-ranked go without, the Draw page says so before generating ("Only X venues are available for Y rooms…"), and the draw check lists every debate without a room. Messages are explicit:

- *Not enough available venues: X required, but only Y available, so {room} has no room.*
- *No available venue meets the requirements for {room}.*
- *Available venues cannot satisfy all debate requirements at the same time, so {room} has no room.*

Add or enable rooms, then press **Allocate venues** again.

### Assigning by hand

Choose a room from the venue menu on a room card. Rooms that are unavailable in this round, already used by another debate, or that do not meet the debate's requirements are refused with the reason. An existing mismatch is shown on the card (*Assigned venue does not meet requirements: …*). Changing rooms after the draw is released needs no override.

## Details

- Room changes (venues, categories, availability, preferences) are saved on this device and reach other devices and the public pages with **Upload now**. A debate's assigned room is part of the draw, which is live on administrator devices.
- Availability of every room in every round is in Admin → **Data exports → Availability**.
- Logic: `src/lib/draw/venueAllocator.ts`, `src/lib/venues/`. Developer details: [`docs/adjudicator-allocation.md`](https://github.com/The-Studio-of-Sadiq/crabbytab/blob/beta/docs/adjudicator-allocation.md) (section "Rooms").

## Limitations

- Team, adjudicator and institution requirements can only be set by CSV (or the API), not in the participant dialogs.
- There are no room constraints by time slot beyond concurrent rounds.
