# My Circles + Create Circle + Invite Member Design

Date: 2026-09-03
Status: Approved design
Branch: `feature/circles-create-invite`
Base: `main` at `b9dd2f33972a4cf6717412e0a4fbfc5b8d355575`

## Goal

Turn the current placeholder My Circles area into the first safe shared-data mutation flow in the Family Circle rebuild. A signed-in user must be able to see their real Circles, create a new Circle, open an existing Circle, and—when they are the Circle owner—invite another person using a fixed family-role dropdown.

This work must preserve Jose's current Circle API behind the Electron main-process compatibility boundary. The renderer must not receive or supply shared-service identities, API credentials, legacy endpoint URLs, invitation tokens, or temporary passwords.

## Scope

### Included

- Real `/circles` page.
- Real My Circles list sourced from the existing protected Circle read path.
- Empty state for users with no Circle.
- Create Circle mutation.
- Automatic shared-identity bootstrap when a local authenticated user has no persisted `server_user_id`.
- Persist the returned shared user ID locally after successful identity bootstrap.
- Invite Member mutation for Circle owners.
- Fixed invitation-role dropdown.
- Open/View Circle action.
- Cache invalidation and authoritative refresh after successful mutations.
- Stable user-facing mutation outcomes.
- TDD coverage at adapter, service, IPC/preload, renderer, and boundary levels.

### Excluded

- Rename Circle.
- Delete Circle.
- Leave Circle.
- Cancel invitation.
- Remove member.
- Transfer ownership.
- Family Tree editing.
- Directly adding placeholder family members.
- Relationship editing.
- Node-position editing.
- New `/v2` backend work.

These remain later management/tree slices.

## Existing Backend Compatibility

Jose's current service already provides the legacy endpoints needed by this slice:

- `GET /api/me/{userId}/groups`
- `POST /api/register`
- `POST /api/group/create`
- `POST /api/group/invite-email`
- `GET /api/group/{groupId}/tree/{userId}`
- `GET /api/me/{userId}/notifications`

The existing backend requires a valid shared user ID for Circle creation and owner-scoped invitations. The desktop rebuild must derive that identity from the protected local session and persisted user record; it must never trust an identity supplied by React.

## Architecture

```text
React: My Circles / Create / Invite
                |
                v
          CircleClient
                |
                v
      typed Electron preload
                |
                v
          CircleService
                |
       protected session
                |
                v
   LegacyCircleAuthAdapter
                |
                v
   Jose's existing Circle API
```

### Renderer boundary

The renderer may submit only business input:

```ts
createCircle({ name: 'Kasule Family' })

inviteMember({
  circleId: '<circle-id>',
  email: 'relative@example.com',
  role: 'Sibling',
})
```

The renderer must not supply or receive:

- `fromUserId`
- `serverUserId`
- `CIRCLE_API_KEY`
- `X-Kin-Keepers-Key`
- legacy API base URL
- invitation token
- temporary password

All legacy identity/header/path shaping stays in `LegacyCircleAuthAdapter`.

## Identity Bootstrap

A registered local account may legitimately have no `server_user_id`. Creating a Circle must make this transparent to the user.

```text
Create Circle
    |
    v
CircleService restores protected local user
    |
    v
Does local user have serverUserId?
    | yes
    +-------------------------> create Circle
    |
    no
    v
Legacy adapter POST /api/register
using protected user's name/email
    |
    v
persist returned shared user ID locally
    |
    v
POST /api/group/create
```

Rules:

1. No separate "link account" screen is shown.
2. Identity bootstrap occurs only in the main process.
3. If identity bootstrap succeeds but Circle creation fails, keep the valid persisted `server_user_id`; retrying Circle creation must reuse it.
4. If shared identity cannot be established, Circle creation fails without mutating Circle state.
5. The renderer receives a stable business error, not raw backend internals.

## My Circles UX

### Existing Circles

The page displays real Circle cards:

```text
My Circles                                  + Create Circle

+------------------------------------------+
| Kasule Family                            |
| Circle owner                             |
| 8 members                                |
|                                          |
| [Open Circle]              [Invite]      |
+------------------------------------------+

+------------------------------------------+
| Ramos Family                             |
| Sibling                                  |
| 14 members                               |
|                                          |
| [Open Circle]                            |
+------------------------------------------+
```

Rules:

- Member counts come from real normalized Circle/tree data.
- Circle owner is a permission state, not an invitation role.
- Only Circle owners see Invite.
- Open Circle navigates into the selected Circle's view context; this slice does not add management mutations there.
- The page must not fabricate counts or pending state.

### No Circles

```text
Your family starts here

Create a private family circle, then invite
the people you want to connect with.

[ Create your first Circle ]
```

This replaces the current placeholder messaging that Circle setup will be available later.

## Create Circle UX

```text
Create a family circle

Circle name
[ Kasule Family                         ]

Private to invited members.

[ Cancel ]                  [ Create Circle ]
```

Validation and behavior:

- required;
- trimmed;
- maximum 120 characters;
- duplicate submissions disabled while in flight;
- backend remains authoritative—no optimistic fabricated Circle;
- inline error does not erase the entered name;
- success closes the dialog, invalidates Circle caches, refreshes authoritative data, and makes the new Circle visible to My Circles, Home, and shell state.

Jose's existing backend creates the Circle and inserts the creator as a Circle member with owner semantics.

## Invite Member UX

Owners may invite from their Circle card or selected Circle context.

```text
Invite to Kasule Family

Email address
[ relative@example.com                  ]

Family role
[ Sibling                         v      ]

[ Cancel ]                    [ Send invitation ]
```

### Fixed role values

- Family member
- Parent
- Child
- Spouse / Partner
- Sibling
- Grandparent
- Grandchild
- Guardian / Caregiver

`Circle owner` is deliberately excluded. Ownership is acquired by creating a Circle or a future explicit ownership-transfer feature.

Family roles are descriptive labels only. They do not grant administrative permission.

### Invite outcomes

The renderer receives normalized outcomes, for example:

- `sent`
- `already-pending`
- `already-member`
- `delivery-failed`

User-facing messages should be clear and non-technical:

- Invitation sent.
- An invitation is already pending.
- This person is already a member.
- The invitation was created, but email delivery failed.
- Only the Circle owner can invite members.

If the legacy endpoint returns an invitation token or temporary password, those values remain internal to the main-process adapter and are stripped before public desktop DTOs are constructed.

## Service Responsibilities

### `LegacyCircleAuthAdapter`

Add narrowly typed methods for:

- ensuring/resolving a shared user registration;
- creating a Circle;
- inviting a member;
- normalizing legacy success/error variants into safe internal results.

Only this adapter may know the current legacy endpoint paths, API key header, temporary-password fields, or token fields.

### `CircleService`

Responsible for:

- restoring the protected local session;
- resolving the local user record;
- deriving the persisted shared identity;
- bootstrapping and persisting a shared identity when required;
- ensuring mutation authorization comes from protected state;
- validating allowed invitation roles;
- invoking the legacy adapter;
- invalidating any cached Circle overview after successful writes;
- returning safe desktop DTOs.

The renderer must never be able to impersonate another shared user through mutation input.

### User repository

The existing repository needs a narrow operation to persist a resolved `server_user_id` for the authenticated local user without altering unrelated local profile/authentication state.

## IPC / Preload Contract

Add narrow public desktop operations analogous to:

```ts
circle.getMyCircles()
circle.createCircle({ name })
circle.inviteMember({ circleId, email, role })
```

Names may be adjusted to match existing conventions, but the contract must preserve these rules:

- no renderer-provided acting user ID;
- no renderer-provided server user ID;
- no raw `fetch` from feature UI;
- no API URL or API key in public DTOs;
- no invitation token or temporary password in public DTOs.

## Refresh and Cache Semantics

The shared service is authoritative.

### Create

```text
successful create
      |
      v
invalidate cached Circle overview
      |
      v
fetch authoritative overview/list
      |
      v
refresh My Circles + Home + shell
```

### Invite

```text
successful invite / already-pending retry
      |
      v
invalidate relevant Circle overview
      |
      v
fetch authoritative selected Circle data
```

No optimistic mutation should invent successful remote state before the server confirms it.

## Error Handling

Public errors must be stable and useful while avoiding raw backend leakage.

Examples:

### Create Circle

- Circle name is required.
- Circle name is too long.
- We couldn't create the Circle. Please try again.

### Invite Member

- Enter a valid email address.
- This person is already a member.
- An invitation is already pending.
- The invitation was created, but email delivery failed.
- Only the Circle owner can invite members.

Unexpected backend/network failures should use a generic safe failure message while retaining enough structured internal information for tests/logging without exposing secrets in the renderer.

## Security and Privacy Invariants

1. Every mutation starts from a valid protected desktop session.
2. The main process re-derives the acting local/shared user on every mutation.
3. React cannot supply `fromUserId` or `serverUserId`.
4. `CIRCLE_API_KEY` and `X-Kin-Keepers-Key` remain main-process only.
5. Legacy endpoint literals remain quarantined to `LegacyCircleAuthAdapter`.
6. Temporary passwords and invitation tokens never cross the desktop API.
7. Ownership authorization comes from shared Circle state, not from a role selected in React.
8. Invitation roles are validated against the fixed allow-list in the main process, not only in the UI.
9. Shared identity bootstrap never changes the user's local password/session semantics.
10. Existing local/private data boundaries remain unchanged.

## Testing Strategy

### Legacy adapter

Tests cover:

- shared identity registration/normalization;
- Circle creation request and response normalization;
- invitation request and response normalization;
- allowed legacy variants for already-member and already-pending;
- email delivery failure normalization;
- stripping temporary password and token from safe results.

### CircleService

Tests cover:

- no protected session -> mutation rejected;
- renderer mutation inputs contain no acting identity;
- existing `server_user_id` is reused;
- missing identity -> register once -> persist ID -> create Circle;
- successful identity bootstrap followed by failed Circle creation retains the valid shared ID;
- create success invalidates cached overview;
- fixed invitation roles accepted;
- unknown role rejected in main process;
- non-owner invite is rejected/normalized;
- invite success invalidates relevant cached overview.

### IPC / preload

Tests cover:

- create Circle channel/capability;
- invite Member channel/capability;
- only approved business fields cross IPC;
- no acting identity, token, password, URL, or API credential fields.

### Renderer

Tests cover:

- no-Circle empty state;
- real Circle list;
- member counts;
- owner sees Invite;
- non-owner does not see Invite;
- Create Circle validation;
- duplicate-submit prevention;
- create success and safe errors;
- fixed role dropdown contents;
- Circle owner absent from dropdown;
- invite success;
- already pending;
- already member;
- email delivery failed;
- refresh behavior after successful mutations.

### Boundary verifier

Extend enforcement to reject:

- `fetch` from Circle feature UI;
- production renderer references to `fromUserId` or `serverUserId` in Circle mutation code;
- `CIRCLE_API_KEY` / `X-Kin-Keepers-Key` in renderer;
- legacy Circle endpoint literals outside `LegacyCircleAuthAdapter`;
- temporary-password/token fields in the desktop Circle public contract.

## Verification Gate

The slice is complete only when the exact final head passes:

```text
npm ci
npm audit --audit-level=high
npm run typecheck
npm run test
npm run verify:boundaries
npm run build:electron
npm run build:renderer
```

The existing aggregate `npm run check` may cover several of these commands, but dependency audit must still be verified explicitly.

## Follow-on Slice

After this write path is proven, the recommended next slice is Circle management:

- Members + Invitations;
- pending invitation list/cancel;
- remove member;
- leave Circle;
- rename/delete Circle;
- later ownership transfer.

Family Tree editing follows after shared Circle management is stable.
