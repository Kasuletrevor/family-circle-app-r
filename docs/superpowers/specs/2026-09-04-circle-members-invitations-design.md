# Circle Members and Invitations Management — Design

Date: 2026-09-04
Branch: `feature/circle-members-invitations`
Status: Approved in chat; implementation not started

## Goal

Turn the existing Members and Invitations placeholders into real management views for the active Circle while preserving the security boundary established by the Create/Invite slice.

This slice adds:

- authoritative Circle details read;
- confirmed member list;
- pending invitation list;
- resend invitation;
- cancel pending invitation;
- remove confirmed member;
- leave Circle for non-owners;
- owner/member-specific UI states and destructive confirmations.

It does not add Circle rename/delete, ownership transfer, or family-tree editing.

## Product shape

`My Circles` remains the place to choose or create Circles. Each existing Circle card gains a **Manage** action.

The app reuses the existing active-Circle viewer preference rather than introducing a second selected-management state:

```text
My Circles
   │
   ├── Open Circle -> select active Circle -> Home
   │
   └── Manage -> select active Circle -> Members
                                  │
                                  ├── Members
                                  └── Invitations
```

The existing sidebar routes become real management entry points:

- `/members` renders the active Circle details with the Members section primary;
- `/invitations` renders the same Circle details surface with Invitations primary.

If no active Circle exists, both routes show a safe empty state linking back to My Circles.

## UX

### Members

```text
Kasule Family
Circle owner
8 members · 2 pending invitations

[ Invite member ]

Members
------------------------------------------------
Trevor Kasule          Circle owner
Sarah Kasule           Parent
John Kasule            Sibling              [•••]
```

Owner controls:

- Invite member
- Remove a confirmed member other than the Circle owner

Normal members can view the member list but cannot see owner-only mutation controls.

### Invitations

```text
Pending invitations
------------------------------------------------
mary@example.com       Parent
Pending
                               [Resend] [Cancel]
```

Only the current Circle owner can resend or cancel pending invitations.

### Leave Circle

A non-owner sees:

```text
Circle membership
[ Leave Circle ]
```

The Circle owner does not receive a Leave action. Main-process authorization also rejects an owner leave attempt if a compromised renderer calls it directly.

### Destructive confirmations

Remove member:

```text
Remove John from Kasule Family?

They will lose access to this Circle and their shared
family-tree relationships may be removed.

[ Cancel ]   [ Remove member ]
```

Cancel invitation:

```text
Cancel the invitation to mary@example.com?

They will no longer be able to join using this pending invitation.

[ Keep invitation ]   [ Cancel invitation ]
```

Leave Circle:

```text
Leave Kasule Family?

You will lose access to its members, relationships and shared
family tree. Your account and private information remain.

[ Cancel ]   [ Leave Circle ]
```

## Architecture

The renderer continues to send business inputs only.

```text
React Circle Details
       │
       ▼
CircleClient
       │
       ▼
typed preload / IPC
       │
       ▼
CircleService
       │
       ├── protected session -> local user -> persisted server_user_id
       ├── current membership / owner authorization
       ├── safe personId -> internal member/invitation identity resolution
       ▼
LegacyCircleAuthAdapter
       │
       ▼
Jose's existing Circle API
```

React never sends or receives trusted actor identity such as `fromUserId` or `serverUserId`.

## Safe public contract

Add a dedicated Circle-details DTO:

```ts
interface CircleDetails {
  circle: {
    id: string
    name: string
    role: string
    memberCount: number
    pendingInvitationCount: number
  }
  members: Array<{
    personId: string
    name: string
    email: string | null
    role: string
    isViewer: boolean
    isOwner: boolean
  }>
  invitations: Array<{
    personId: string
    email: string
    role: string
    status: 'pending'
  }>
}
```

No public details record may contain:

- `serverUserId`;
- `fromUserId`;
- trusted owner/member user IDs;
- invitation token;
- invitation temporary password;
- legacy API URLs or API keys.

Add these public Circle capabilities:

```ts
getCircleDetails(): Promise<CircleDetails | null>
resendInvitation(input: { personId: string }): Promise<{ outcome: 'sent' | 'delivery-failed' }>
cancelInvitation(input: { personId: string }): Promise<{ success: true }>
removeMember(input: { personId: string }): Promise<{ success: true }>
leaveCircle(): Promise<{ success: true }>
```

The operations act on the current protected active Circle. React does not choose or supply an actor ID. A Manage action first selects the requested Circle through the existing protected `selectCircle()` capability, then navigates to the management view.

Using the active Circle keeps management aligned with Home/TopBar and avoids a second competing Circle-selection state.

## Internal identity resolution

`CircleService` owns all sensitive mapping.

For member removal:

```text
protected session
  -> local user
  -> persisted server_user_id
  -> active Circle membership
  -> fetch internal tree
  -> resolve public personId to confirmed internal member
  -> verify caller owns Circle
  -> verify target is not owner
  -> call legacy member/remove with internal IDs
```

For invitation cancel/resend:

```text
protected session
  -> active Circle
  -> fetch internal tree/pending invites
  -> resolve public invite personId to pending invitation
  -> verify caller owns Circle
  -> cancel using internal invitation ID
     OR resend through existing invite-email behavior using authoritative pending email/role
```

The renderer-provided `personId` is only a lookup handle. Main re-fetches authoritative state before mutation; it never trusts renderer-supplied email, role, invitation ID, or member ID for management actions.

For leave:

```text
protected session
  -> active Circle membership
  -> reject if current user is owner
  -> legacy leave endpoint using session-derived shared identity
  -> clear/fallback active Circle preference
```

## Legacy API compatibility

Preserve Jose's current semantics through `LegacyCircleAuthAdapter`:

- invitation cancel: `POST /api/group/{groupId}/invitation/cancel`;
- member removal: `POST /api/group/{groupId}/member/remove`;
- leave Circle: `POST /api/group/{groupId}/leave`;
- resend invitation: reuse the existing `POST /api/group/invite-email` behavior for an already-pending invitation, which retries delivery rather than creating a duplicate.

All endpoint strings and legacy identity fields remain quarantined in main-process compatibility code.

## Authorization rules

Main process is authoritative regardless of which controls React renders.

| Operation | Allowed | Rejected |
| --- | --- | --- |
| View details | Current Circle member | No membership/session |
| Resend invitation | Circle owner | Non-owner |
| Cancel invitation | Circle owner | Non-owner |
| Remove member | Circle owner | Non-owner, owner target, unknown target |
| Leave Circle | Non-owner member | Circle owner, non-member |

Owner status is derived from the authoritative Circle owner identity, not merely a descriptive family-role string.

## Refresh and active-Circle behavior

No optimistic deletion/removal is used.

After a successful resend/cancel/remove:

1. invalidate any in-flight/cached Circle overview/details;
2. re-read authoritative Circle details;
3. refresh Home/TopBar data on the next read.

After leave:

1. invalidate Circle reads;
2. refresh the user's Circle memberships;
3. if another Circle exists, persist a safe fallback active Circle;
4. otherwise clear `active_circle_id`;
5. navigate to My Circles.

If a selected Circle or membership disappears between render and mutation, show a safe stale-state message and reload rather than pretending success.

## Error handling

Renderer copy stays stable and non-sensitive.

Examples:

- `Only the Circle owner can manage invitations.`
- `Only the Circle owner can remove members.`
- `The Circle owner cannot be removed.`
- `Circle owners cannot leave their own Circle.`
- `That member is no longer in this Circle.`
- `That invitation is no longer pending.`
- `We couldn't resend the invitation. Please try again.`
- `We couldn't update the Circle. Please try again.`

Raw backend, SMTP, SQL, API-key, token, and internal-ID details are never displayed in React.

## Client and cache behavior

Extend `CircleClient` / `DesktopCircleClient` with the details read and four mutations.

The production renderer may access `window.familyCircle.circle` only through `DesktopCircleClient`, preserving the current architectural boundary.

Mutations invalidate overview/details in-flight state before authoritative refresh. Test/demo `MockCircleClient` receives explicit compatible methods; production does not fall back to mock data.

## Testing strategy

Use TDD for each layer.

### Legacy adapter

- cancel endpoint/payload;
- remove endpoint/payload;
- leave endpoint/payload;
- resend pending invitation uses the existing invite endpoint;
- normalize delivery failure without exposing secrets.

### CircleService

- no session or no membership rejected;
- owner/non-owner authorization;
- owner cannot be removed;
- owner cannot leave;
- stale/unknown person IDs rejected;
- safe personId resolves internally to member/invitation identity;
- renderer cannot choose actor identity;
- leave clears or replaces active Circle safely.

### IPC / preload

- approved capabilities only;
- business payloads only;
- injected `fromUserId`, `serverUserId`, member IDs, invitation IDs, token/temp-password fields are stripped or ignored.

### Renderer client

- authoritative details read;
- no fabricated members/invitations;
- mutation invalidation behavior;
- safe normalized errors.

### UI

- Members and Invitations routes are no longer placeholders;
- Manage selects Circle then opens management;
- owner controls visible only to owners;
- non-owner Leave visible only to non-owners;
- confirmations required for remove/cancel/leave;
- resend/cancel/remove/leave success reloads authoritative details;
- empty/stale/error states are safe and recoverable.

### Boundaries and full gate

Strengthen `scripts/verify-boundaries.mjs` for the new management surface, then run:

```text
typecheck
all tests
architecture boundary verifier
npm audit --audit-level=high
Electron build
Vite build
```

## Implementation slices

The implementation plan should use seven green checkpoints:

1. safe Circle-details DTOs and internal management models;
2. legacy adapter management operations;
3. `CircleService` details read, authorization, identity resolution, mutations and leave fallback;
4. IPC/preload management contract;
5. `DesktopCircleClient` details/mutations/cache invalidation;
6. Members + Invitations management UI and Manage navigation;
7. confirmations, boundary hardening, docs, full CI/security review.

## Explicitly out of scope

- Circle rename;
- Circle delete;
- ownership transfer;
- editing family relationships;
- adding/removing tree placeholders;
- tree node positioning;
- Stories/Memories/Upcoming real data sources;
- changing Jose's backend contract or introducing `/v2` migration in this slice.

Those remain subsequent slices, with Circle settings next and Family Tree editing after that.
