# Staff invitations

Tournament administrators can give someone a tournament role (administrator or data-entry staff)
by email, whether or not that person already has a CrabbyTab account. This replaces the old
requirement that the account exist in Firebase Authentication before it could be assigned
(roadmap item #11 in `tabbycat-parity-plan.md`). Assigning an existing account directly on the
staff page still works.

## Workflow

1. **Invite.** On **Staff** (`/{tournament}/staff`), an administrator enters up to 50 addresses,
   picks a role and how long the link stays valid (1–30 days, default 7), and sends. Each address
   gets an email with a single-use link to `/invite#…`.
2. **Accept.** The invitee opens the link. The page shows the tournament and role, then:
   - if an account exists for the invited address, the invitee signs in and accepts;
   - if not, the invitee chooses a name and password (at least 8 characters) and the server
     creates the account for exactly the invited address and accepts in one step;
   - if the invitee is signed in with a different account, the page says so and offers sign-out.
3. **Manage.** The staff page lists open invitations (pending or expired) with their delivery
   status. **Resend** issues a new link (the old one stops working) and restarts the expiry;
   **Revoke** stops the link at once. Accepted and revoked invitations are kept for reference.

When an email cannot be sent (SMTP not configured, or the provider refused it), the invitation
is still created and its link is shown once on the staff page so it can be shared another way.
Only a hash of the link's secret is stored, so a link cannot be shown again later: resend instead.

## Security model

- **Tokens.** A link token is `{tournamentId}.{invitationId}.{secret}` with a 256-bit random
  secret (`src/lib/linkTokens.ts`). Firestore stores only `SHA-256(secret)`, compared in constant
  time. The token is in the URL fragment, so it never reaches server logs or `Referer` headers,
  and the page removes it from the address bar after use.
- **Single use, one per address.** An invitation's id is a hash of the email, so an address has at
  most one live link per tournament; inviting it again replaces the previous link. Acceptance runs
  in a Firestore transaction that re-reads the invitation, checks it is still pending, unexpired
  and has the same token hash, writes the `staff/{uid}` role and marks the invitation accepted
  together.
- **Bound to the address.** The role is granted only to an account whose email equals the invited
  address (case-insensitive). An existing higher role is never lowered by an invitation.
- **No open sign-up.** CrabbyTab's client never creates accounts. The only account creation path is
  `POST /api/invitations` with `action: "register"`, which requires a valid pending invitation and
  creates the account for the invited address only (marked verified, since the link reached it).
  For defence in depth, also turn off client sign-up in the Firebase console
  (Authentication → Settings → User actions → uncheck *Enable create (sign-up)*); the Admin SDK used
  by the server is not affected by that setting.
- **Throttling.** Wrong or unknown tokens count against a per-address failure limit (30 per hour,
  `checkPrivateFailureLimit`), checked before any lookup. Account creation is limited to 10 per
  address per hour.
- **Storage.** Invitations live in `tournaments/{id}/serverOnly/staffInvitations/items/{id}`.
  `firestore.rules` deny every client read and write under `serverOnly`; only server routes (Admin
  SDK) touch it. Creating, resending and revoking re-check the administrator's role inside the
  same transaction as the write.

## API

| Route | Who | Purpose |
|---|---|---|
| `GET /api/tournaments/{id}/staff/invitations` | administrators | list invitations (never the hash) |
| `POST …/staff/invitations` `{emails, role, expiryDays}` | administrators | create or renew and email; returns the links once |
| `PATCH …/staff/invitations` `{action: "resend", invitationId, expiryDays}` | administrators | new link, new expiry, email again |
| `DELETE …/staff/invitations` `{invitationId}` | administrators | revoke a pending invitation |
| `POST /api/invitations` `{action: "preview", token}` | anyone with the link | tournament, role, address, expiry, state |
| `POST /api/invitations` `{action: "accept", token}` + Bearer ID token | the invited account | grant the role |
| `POST /api/invitations` `{action: "register", token, password, displayName}` | anyone with the link | create the invited account and accept |

## Configuration

Emailed links use `NEXT_PUBLIC_APP_URL` (falling back to the request's origin, which is only
appropriate for local development). Invitations need the same server configuration as other
server routes (`FIREBASE_SERVICE_ACCOUNT_JSON`) and the SMTP variables for delivery.

## Limitations

- Invitations are only for cloud tournaments (they are stored in Firestore). A local-only
  tournament has no server copy to grant roles on.
- The staff list does not refresh by itself when an invitation is accepted; reload the page.
- Deleting a tournament does not delete its `serverOnly` records; a global administrator can remove
  them from the Firebase console.
