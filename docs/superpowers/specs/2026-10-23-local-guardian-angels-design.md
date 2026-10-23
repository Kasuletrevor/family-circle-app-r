# Guardian Angels on this computer — design

Date: 2026-10-23
Status: approved by Trevor (2026-10-23), ready for planning
Builds on: `2026-10-20-my-guardian-angels-design.md` (connect, list, add, remove)

## Goal

A person can talk with one of their own Guardian Angels inside Family Circle. The conversation runs on
their computer, on Family Circle's private AI (llama.cpp with the local Qwen model). The angel can use the
person's confirmed My Story memories. Nothing from the conversation leaves the computer.

## Decisions (Trevor, 2026-10-23)

- Angels run locally on llama.cpp and the installed Qwen model. The marketplace's model and provider
  settings (granite, gpt-4o-mini, `execution_backend`) are never used to pick or describe the local run.
- Family content starts with **My Story** only (confirmed memories). Reading the Vault is allowed later,
  as a separate slice with a per-angel switch that is off by default.
- Conversations are saved **on this computer only**. Nothing is sent to Kin-Keepers.ai or anywhere else.
- The Kin-Keepers test agents (Trevor, Marvin, Olivia, Jose, "Mom's morning status report") are out of
  scope. They are not curated, so the app never shows them.

## Constraints that shape the design

- The local model is `Qwen3.5-0.8B-Q4_K_M` with a 4,096-token context window (`AiRuntimeManager`).
  It cannot reliably choose and call tools, and it cannot be trusted to notice danger on its own.
- So **the app does the tool work, the model only writes**. Before each reply the app gathers what the
  angel's tools ask for, fits it into the window, and makes one chat request. This is the same shape
  as private search (`PrivateArchiveQueryService`).
- **The app does the safety checks.** Escalation triggers are matched by fixed word lists before the model
  runs. On a match the person gets a fixed safety message, not a model reply.

## Which angels run here

An angel runs on this computer when the template it was added from is in this list (by template slug):

| Template | Slug |
| --- | --- |
| Elder Companion | `elder-companion` |
| Family Content Storyteller | `family-content-storyteller` |
| Gentle Storytelling | `gentle-storytelling-template` |
| Post-Visit Follow-Up | `post-visit-follow-up` |
| Elder Tech Confidence Coach | `elder-tech-confidence-coach` |

Held back, with the reason:

- Bereavement Companion, Memory Screening Guide: need a stronger model and human review.
- Live Well Challenge: its scoring screen exists only on the website.
- Weekly Family Report: needs care records (care fields) that Family Circle does not keep.
- Professional and Kin-Keeper templates (shift handoff, coverage, facility, oversight, training):
  need care-team data Family Circle does not have.

Other angels keep the existing Settings and Test buttons (website) and show no Talk button.

## The angel's recipe

The recipe is the angel's own instructions, tools and safety rules. It comes from
`GET /api/agno/agents/{id}/export` (allowed for app tokens on the person's own angels), shape
`KinKeepersAgentPackage` v1:

- `config.instructions` (string), cut to 4,000 characters and cleaned of control characters.
- `config.tools` (string array), only names matching `^[a-z0-9_]{1,64}$`, at most 20.
- `safety.trust_boundaries`, `safety.escalation_triggers` (string arrays), raw keys kept for matching,
  humanised for display.
- `config.model`, `runtime.*` and `execution_backend` are ignored.

The last good recipe is cached in the local database, so an angel still works while the account is
disconnected or the server is down. Opening a conversation refreshes the cache when connected.

## What the app gathers, per tool

| Tool in the recipe | What the app gives the model |
| --- | --- |
| `get_elder_profile` | The signed-in person's first name |
| `get_family_content` | Up to 3 confirmed My Story sections that match the message (existing private search ranking) |
| `get_recent_interactions` | The last 6 messages with this angel, from local history |
| `log_conversation`, `log_mood_observation` | Nothing extra; every exchange is saved to local history anyway |
| `draft_email`, `send_email`, `send_family_notification` | Nothing is sent. The model is told it may write a draft; the person copies it |
| anything else | Skipped |

## Fitting the 4,096-token window

Characters stand in for tokens (about 4 per token):

- fixed preamble and safety rules: about 1,200 characters
- instructions: at most 4,000 characters
- stories: 3 sections, at most 900 characters each
- recent history: at most 6 messages and 1,800 characters in total
- the message: at most 1,000 characters
- reply: at most 256 tokens

That stays under about 3,200 tokens, leaving room for the reply.

## Safety

- Every message is checked before the model runs. Always-on groups apply to every angel: self-harm,
  medical emergency, abuse. The angel's own escalation triggers add groups when their keys are known
  (for example `severe_confusion`, `extreme_distress`). Unknown keys are ignored.
- On a match the reply is a fixed message for that group, for example: "I'm worried about what you just
  said. Please contact someone now: a family member, your carer, or emergency services if you are in
  danger." The model is not called. The entry is saved with the group name.
- No phone numbers are shown, because the person's country is not known.
- The model's prompt always starts with Family Circle's own rules, before the angel's instructions: plain
  short sentences, use only the given memories for family facts, never invent family details, no medical,
  legal or money advice, never say a message was sent.

## Honesty about where it runs

Every saved reply records `executionBackend: 'llama.cpp'` and the model name from the installed model file
(`Qwen_Qwen3.5-0.8B-Q4_K_M`). The conversation page shows "Runs on this computer · llama.cpp ·
Qwen3.5-0.8B". Replies that used memories list them as sources, like private search.

## Local history

- New table `angel_messages`: local user, angel id, role (`person` / `angel`), text, sources (JSON),
  escalation group, backend, model, time. Kept to the newest 200 per angel.
- New table `angel_recipes`: local user, angel id, recipe JSON, fetched time.
- "Clear this angel's history" deletes that angel's messages. Removing the angel in Family Circle deletes its
  messages and recipe. Deleting the Family Circle user cascades.

## Errors the person can see

| Situation | What they see |
| --- | --- |
| Private AI not set up or not ready | "Set up private AI in Settings to talk with your angels here." Link to Settings |
| No recipe yet and not connected | "Connect your Kin-Keepers.ai account once so Family Circle can get this angel." |
| Angel not runnable here | No Talk button; opening the address directly shows "This angel runs only on Kin-Keepers.ai." |
| Story search unavailable | The angel answers without memories; no sources shown |
| Generation fails | "The angel couldn't answer just now. Try again." The person's message is kept |

## Out of scope for this slice

Vault access, a bigger model download, voice, sending email or notifications, syncing history,
reporting runs to Kin-Keepers.ai, and the held-back templates.

## Testing

Unit tests for each part (recipe sanitiser, safety matcher, history repository, Qwen chat, story search,
runner, IPC, renderer page), then a live check: add Elder Companion with the test account, talk with it
offline after disconnecting, confirm memories are cited, a self-harm phrase gets the fixed message, and
Clear history empties the page.
