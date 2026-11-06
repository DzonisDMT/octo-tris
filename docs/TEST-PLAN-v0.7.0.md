# OCTO-TRIS v0.7.0 — regression and release test plan

## Automated test targets

The current game is embedded in a single HTML document. Before extracting the engine into modules, establish a small browser test harness and keep these scenarios as regression tests.

### Core board and scoring
- A new game starts with an empty 10×20 board, score 0, lines 0 and level 1.
- Each tetromino can move within bounds and cannot overlap locked cells.
- Rotation uses wall kicks without placing cells outside the board.
- Soft-drop and hard-drop scoring match the published rules.
- Single, double, triple and four-row clears award the expected score multiplier.
- Level increases once per ten cleared lines; fall speed never exceeds configured limits.
- Game-over occurs when a normal piece cannot spawn, not merely because a special piece can pass through occupied cells.

### Special pieces
- Golden brick: spawns when its milestone is reached; occupied cells do not block its spawn; it settles only in an empty cell; row completion and no-space cases are handled.
- Slow: falls at the intended reduced speed and locks as a normal piece.
- Bomb: clears only the intended 3×3 neighbourhood.
- Lightning: clears the intended column.
- Rainbow: clears only matching-colour blocks.
- Tentacle: selects no more than the configured nearby targets and never clears outside the board.
- Level-up: uses the intended faster fall speed.
- Mirror room: starts at the configured milestone, reverses controls, uses its own timer, awards bonus points once and restores normal controls on exit.

### Identity and leaderboard
- Registration rejects empty/invalid nicknames and enforces the 16-character limit.
- Nickname changes preserve the permanent player identifier.
- Failed network requests do not erase a locally displayed identity.
- Daily/weekly filters use UTC and have explicit inclusive/exclusive boundaries.
- Duplicate submissions cannot create duplicate competition entries.
- Rankings select one best verified score per player; ties use a documented deterministic tie-break.
- Public responses expose only masked IDs and public profile fields.

### Security tests
- Anonymous direct inserts into canonical verified scores are rejected.
- A player cannot submit a score for another player's session.
- Expired, reused, malformed or tampered session events are rejected.
- A wallet challenge cannot be reused or signed for a different network/address.
- Public API responses never expose service-role credentials, private wallet links or full Octavio IDs.
- Admin-only payout approval cannot be invoked by an anonymous or ordinary authenticated player.

## Manual device matrix

| Device/browser | Controls | Audio | Layout | Background/resume |
|---|---|---|---|---|
| iPhone / Safari | Touch and hold | Unlock/mute | Safe areas and portrait | Pause on hidden; resume safely |
| Android / Chrome | Touch and hold | Unlock/mute | Small-screen sizing | Pause/resume |
| Desktop / Chrome | Keyboard | Mute | Responsive canvas | Tab blur |
| Desktop / Firefox | Keyboard | Mute | Responsive canvas | Tab blur |

## Release checklist

- [ ] Branch CI is green.
- [ ] Browser test suite is green.
- [ ] SQL migration reviewed and tested against a staging Supabase project.
- [ ] RLS and grants tested using anon, authenticated and service roles.
- [ ] No secrets committed to repository or browser bundle.
- [ ] Staging deployment smoke-tested.
- [ ] Existing player records and IDs preserved.
- [ ] Rollback commit and deployment procedure documented.
- [ ] Production release approved.
