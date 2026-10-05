# Evals Roadmap

This document lists future Pineapple eval suites. It separates an eval suite
from its cases:

- An eval suite measures one behavior family.
- A case is one example inside that suite.
- Deterministic adapter logic belongs in unit or integration tests, not evals.

## Current Eval Suites

### Root Manager Routing

Status: started

Purpose:
- Verify that `root_manager` chooses the right specialist for natural-language
  requests.

Existing cases include:
- reminders route to `scheduler`
- coding work routes to `codex`
- general questions route to `general_assistant`
- immediate Spotify requests route to `assistant_audio_bridge`
- future Spotify requests route to `scheduler`
- Shortcut coding stories route to `codex`

## Future Eval Suites

### Telegram Model Behavior

Status: started

Purpose:
- Verify model-dependent behavior when the input came from Telegram.
- This should focus on interpretation, tool choice, reply style, and
  cross-adapter context.

Implementation checklist:
- [x] Shortcut-bound Telegram continuation
- [x] Telegram reply style
- [x] Telegram send tool choice
- [x] Shortcut tool choice from Telegram
- [x] Delegation from Telegram
- [x] Clarifying question
- [x] No false tool claim
- [x] Reminder delivery from Telegram context
- [x] Unsupported Telegram content grace

Candidate cases:

1. Shortcut-bound Telegram continuation
   - Input: a Telegram message lands in a thread whose subject is a Shortcut
     story.
   - Expected: the model understands the Shortcut story context and uses the
     correct story id when an update/comment is requested.

2. Telegram reply style
   - Input: a normal Telegram message.
   - Expected: concise, natural plain text with no Markdown-heavy formatting
     unless explicitly requested.

3. Telegram send tool choice
   - Input: a Telegram-originated task that requires proactive Telegram
     delivery.
   - Expected: call `telegram_send_message` with the correct `chat_id`.

4. Shortcut tool choice from Telegram
   - Input: "post an update that this is fixed" in a Shortcut-bound Telegram
     thread.
   - Expected: call `shortcut_post_comment` with the correct
     `story_public_id`.

5. Delegation from Telegram
   - Input: "inspect the repo and fix this bug" from Telegram.
   - Expected: delegate to `codex` or call `ask_codex` instead of answering
     directly.

6. Clarifying question
   - Input: an ambiguous Telegram request.
   - Expected: ask one concise clarifying question instead of inventing missing
     details or taking a risky action.

7. No false tool claim
   - Input: a request to send, update, or comment through an external system.
   - Expected: do not claim the action happened unless the relevant tool was
     called successfully.

8. Reminder delivery from Telegram context
   - Input: a reminder tick whose thread has Telegram delivery context.
   - Expected: call `telegram_send_message` with the stored chat id.

9. Unsupported Telegram content grace
   - Input: Telegram content that lacks usable text or references unsupported
     content.
   - Expected: briefly explain the limitation and ask for usable context.

Do not include group-chat behavior until the app intentionally supports it.

### Spotify Tool Choice

Purpose:
- Verify that `assistant_audio_bridge` chooses the right Spotify tool and
  arguments.

Candidate cases:

1. Playlist playback
   - Input: "Play my focus playlist."
   - Expected: call `assistant_bridge_spotify_play_playlist`, not
     `assistant_bridge_spotify_play`.

2. Track playback
   - Input: "Play Blinding Lights by The Weeknd."
   - Expected: call `assistant_bridge_spotify_play` with a track query.

3. Pause playback
   - Input: "Pause Spotify."
   - Expected: call `assistant_bridge_spotify_pause`.

4. Resume playback
   - Input: "Resume Spotify."
   - Expected: call `assistant_bridge_spotify_resume`.

5. Playlist listing
   - Input: "What playlists do I have?"
   - Expected: call `assistant_bridge_spotify_list_playlists`.

6. Add tracks to playlist
   - Input: "Add this song to my vibe playlist."
   - Expected: call `assistant_bridge_spotify_add_tracks_to_playlist` when the
     track context is available, or ask for the missing track when it is not.

7. Ambiguous playlist
   - Input: "Play my playlist."
   - Expected: ask a clarifying question or list playlists instead of guessing.

8. Device targeting
   - Input: "Play my focus playlist on my desk speaker."
   - Expected: pass a useful device hint, or list devices and retry with a
     concrete device id if device targeting fails.

9. Future Spotify request
   - Input: "At 6pm, play my focus playlist."
   - Expected: do not execute Spotify playback immediately; route/schedule the
     future action.

10. Scheduled action deferral
   - Input: "Create a schedule to play music 1 minute from now."
   - Expected: call `cron_schedule_reminder` with `agent_id` targeting the
     audio bridge, reply that the schedule was created, and do not call any
     Spotify playback tool in the scheduling turn.

11. Scheduled mixed-action deferral
   - Input: a batch of future actions, for example "in 1 minute play music, in
     2 minutes remind me to stretch, and tomorrow morning check the deployment
     dashboard."
   - Expected: create schedules for each future action, route each scheduled
     job to the appropriate future agent, and do not execute any future action
     immediately.

### Telegram To Spotify Flow

Purpose:
- Verify cross-adapter behavior when a Spotify request starts from Telegram.
- This suite should come after the Telegram and Spotify suites are stable.

Candidate cases:

1. Telegram auto-mode Spotify request
   - Input: Telegram message "play my focus playlist" with no direct agent
     selected.
   - Expected: root manager delegates to `assistant_audio_bridge`.

2. Telegram direct audio bridge mode
   - Input: Telegram message after `/agent assistant_audio_bridge` selection.
   - Expected: trigger payload uses `agent_id = assistant_audio_bridge`.

3. Telegram scheduled Spotify request
   - Input: Telegram message "At 6pm, play my focus playlist."
   - Expected: schedule the future action, send or return a concise schedule
     confirmation, and do not call a Spotify playback tool immediately.

4. Reminder tick executes Spotify and notifies Telegram
   - Input: reminder tick on a thread with Telegram delivery context.
   - Expected: use the Spotify playback tool and send a concise Telegram
     confirmation.

### Cron Trigger Routing

Purpose:
- Verify model-dependent routing when scheduled cron work re-enters Pineapple as
  a `pineapple-cron` trigger.
- Confirm that the cron tick goes to the agent selected when the schedule was
  created, instead of returning to the scheduler by default.

Candidate cases:

1. Music tick routes to audio bridge
   - Input: a `reminder.tick` trigger produced from a scheduled music job with
     `agent_id = assistant_audio_bridge`.
   - Expected: execution starts with `assistant_audio_bridge`, uses the
     appropriate Spotify playback tool, and does not route back to `scheduler`
     except for ordinary reminder delivery.

2. Reminder tick routes to scheduler
   - Input: a `reminder.tick` trigger produced from a normal reminder with no
     specialist override.
   - Expected: execution starts with `scheduler` and uses the available
     outbound delivery channel.

3. Repository tick routes to Codex
   - Input: a `reminder.tick` trigger produced from scheduled repository work
     with `agent_id = codex`.
   - Expected: execution starts with `codex` and does not route through the
     audio bridge or general assistant.

### Shortcut Cross-Adapter Behavior

Status: started

Purpose:
- Verify model behavior when work moves between Shortcut, Telegram, and the
  agent runtime.

Implementation checklist:
- [x] Shortcut story starts implementation
- [x] Telegram continues Shortcut story
- [ ] Shortcut completion comment model behavior, if a real failure appears

Candidate cases:

1. Shortcut story starts implementation
   - Input: Shortcut story/comment asking to start backend or repo work.
   - Expected: delegate to `codex`.

2. Telegram continues Shortcut story
   - Input: Telegram message in a Shortcut-bound thread.
   - Expected: preserve the Shortcut story id and use Shortcut tools when asked
     to update the story.

3. Shortcut completion comment
   - Input: completed run with reply text and no explicit
     `shortcut_post_comment` tool call.
   - Expected: fallback comment behavior is covered by integration tests; eval
     should only cover whether the model should have used the tool itself.

## Unit Or Integration Tests, Not Evals

These are deterministic and should stay as normal tests:

- Telegram `/help` returns the command list.
- Telegram `/agents` lists available agents.
- Telegram `/agent <agent-id>` stores selected agent routing.
- Telegram `/agent auto` clears selected agent routing.
- Telegram `/new [title]` creates and selects a thread.
- Telegram `/select <thread-prefix>` selects the matching thread.
- Normal Telegram message uses the selected thread.
- Normal Telegram message creates a new thread if none is selected.
- Telegram webhook rejects an invalid secret.
- Unsupported Telegram updates are ignored.
- Shortcut trigger routing reuses or creates threads by `shortcut_story`
  subject.
- Spotify client methods call the expected Spotify API behavior.
- Assistant audio bridge route pins the resolved thread id.

## Suggested Order

1. Expand the current root manager routing eval with any missing routing cases.
2. Add the Spotify tool choice eval.
3. Add the Telegram model behavior eval.
4. Add the Telegram to Spotify flow eval.
5. Add the cron trigger routing eval.
6. Add Shortcut cross-adapter eval cases as real bugs or workflows appear.
