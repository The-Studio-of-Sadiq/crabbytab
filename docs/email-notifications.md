# Email settings, templates, delivery status and SMS

Roadmap #21 (as corrected in the source-level audit): per-tournament saved templates for every
automatic email, Reply-To, the "ballot confirmed" and "motions released" events, private/feedback
URL and registration emails, delivery status through a signed provider webhook, and an SMS hook.
SMTP stays the only built-in transport. Code: `src/lib/email/settings.ts`,
`src/lib/email/notifications.ts`, `src/lib/email/notificationService.ts`,
`src/lib/email/deliveryStatus.ts`, `src/lib/email/templatedEmail.ts`, `src/lib/sms/provider.ts`.

## Email settings (Email page → "Email settings and templates")

Stored server-side in `tournaments/{id}/serverOnly/emailSettings` (clients cannot read it; only
`GET/PUT /api/tournaments/{id}/email/settings`, administrators only). Changes apply to the next
email at once; no upload is needed.

- **Reply-To name and address**: added to every email the tournament sends (campaigns, retries,
  automatic notifications, receipts, registration and representative emails). Tabbycat's
  `reply_to_name` / `reply_to_address`.
- **Templates**: one saved subject and message per event. A template equal to the default is not
  stored, so improvements to the defaults still apply. Unknown `{{variables}}` are refused on save.
- **Email registrants**: sends "Registration received" and "Registration approved".

| Event | Sent to | When | Extra variables |
|---|---|---|---|
| Draw released (teams / adjudicators) | speakers / allocated adjudicators | as before | `side`, `debate`, `venue`, `chair`, `panellists` |
| Team results | speakers | as before | `result`, `points` |
| Ballot receipt | submitting adjudicator | private-URL ballot | `ballot` |
| **Ballot confirmed** | every adjudicator of the debate | the tab room confirms a result (`notifyBallotConfirmed`) | `ballot` (with voting ballots, also their own sheet) |
| **Motions released** | speakers and revealed adjudicators of the round | motions released and draw visible (`notifyMotionsReleased`) | `motions` (released motions with info slides) |
| **Private URL** / **Feedback URL** | chosen in the compose form | sent by hand ("Use in the compose form") | `private_url`, `passcode` |
| **Registration received / approved** | registrant's contact address | public submission / approval (with *Email registrants*) | `entry`, `institution` |
| **Places allocated** | institution representative | their link is issued or re-sent | `institution`, `teams_allocated`, `adjudicators_allocated`, `url` |

Common variables: `name`, `email`, `tournament`, `round`, `institution`, `team`.

### When the new automatic emails go out

- *Motions released* is a round notification like the draw: due when `areRoundMotionsReleased`
  holds on the cloud copy (one place to change when motion release gains more states), sent in
  chunks with the existing log, baseline (opting in skips rounds already released) and retry.
- *Ballot confirmed* scans only the confirmed ballots of running rounds (draw out, not cancelled,
  not completed) plus one log document per round recording which ballots were emailed; each
  ballot is claimed in a transaction before it is sent. Opting in marks existing confirmations as
  sent. An administrator device asks the server to send right after confirming (after flushing
  live writes), and uploads and **Send due notifications now** also trigger it. Confirmations in
  completed rounds are not emailed.

## Delivery status

Every message carries `X-CrabbyTab-Ref: {tournamentId}/{campaignId}`. Configure the provider (or
a small adapter in front of it) to post events to `POST /api/email/webhook`:

```
POST /api/email/webhook
X-CrabbyTab-Signature: sha256=<hex HMAC-SHA256 of the raw body with EMAIL_WEBHOOK_SECRET>
{ "events": [ { "ref": "t1/abc", "email": "a@b.org", "event": "delivered", "timestamp": 1700000000, "reason": "…" } ] }
```

Events are Tabbycat's EmailStatus kinds: processed, deferred, delivered, bounce, dropped, open,
click, spamreport, unsubscribe, failed. Unknown kinds and malformed refs are skipped; at most 500
events and 256 kB per request. The latest stage per address is stored on the campaign
(`delivery`); a later open never hides a bounce. Campaign history shows the counts. Without
`EMAIL_WEBHOOK_SECRET` the endpoint answers 404; wrong signatures 401. SendGrid, Mailgun, SES and
others all support custom headers or arguments that can carry the ref; no provider is built in.

## SMS

`src/lib/sms/provider.ts` defines `SmsProvider` and a generic webhook implementation: with
`SMS_WEBHOOK_URL` (https) set, each SMS is POSTed as `{ to, text, ref? }`, signed like the
delivery webhook with `SMS_WEBHOOK_SECRET`, to a relay you control (Twilio, Vonage, a gateway…).
Numbers must be international (`+country code`). Nothing sends SMS yet: participants have no
phone field until the registration work adds one, so this is the interface for that work.

## Web push

Not implemented. Push to participants needs a service worker with push handling, VAPID keys,
per-device subscriptions stored server-side and permission prompts; on iOS it works only for a
home-screen-installed PWA. CrabbyTab's private portals are plain pages without a service worker,
so push would be a separate project; email (and the SMS hook) cover the same events.
