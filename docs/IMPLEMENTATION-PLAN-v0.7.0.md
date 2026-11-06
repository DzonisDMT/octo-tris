# OCTO-TRIS v0.7.0 — implementation plan

## Release approach

Incremental delivery. The production `main` branch remains unchanged while work is developed on `octotris/v0.7.0-foundation`. Merge only after review, tests, and deployment verification.

## Release objective

Stabilise the existing arcade game and prepare a trustworthy competitive foundation for later $OCTAVIO holder qualification and MINIMA rewards. Ordinary gameplay remains open to everyone; token ownership only affects reward eligibility.

## Engineering tickets

| ID | Priority | Task | Acceptance criteria |
|---|---|---|---|
| OT-001 | P0 | Isolated development branch | Feature branch created from current main; production untouched |
| OT-002 | P0 | Golden-brick spawn collision | Special collision rules are used at spawn; golden brick can spawn above occupied cells without false game-over |
| OT-003 | P1 | Gameplay regression suite | Tests cover rotation, wall/floor collisions, row clears, scoring, level progression, all power-ups, mirror-room entry/exit and game-over |
| OT-004 | P1 | Leaderboard semantics | One best eligible score per player per period; deterministic tie-break; daily/weekly/all-time boundaries use UTC |
| OT-005 | P0 | Server-authoritative game sessions | Server creates session ID and seed; client submits replay/events; server independently replays and calculates score |
| OT-006 | P0 | Supabase security hardening | No direct anonymous score insertion into canonical scores; writes go through validated server/RPC path; least-privilege grants and RLS tests |
| OT-007 | P1 | Wallet proof-of-control | Nonce-based, expiring challenge; signature verification; wallet address normalisation; replay protection |
| OT-008 | P1 | Holder eligibility | Configurable token contract, chain/network, minimum USD threshold (initial proposal: $20), price source, snapshot time and eligibility history |
| OT-009 | P1 | Competition and reward ledger | Period definitions, qualifying entries, immutable winner snapshots, approval workflow, payout transaction references |
| OT-010 | P1 | Operations and release safety | CI checks, deployment checklist, rollback instructions, audit log and admin access controls |

## Current repository observations

- The playable game and most UI/gameplay logic live in a single `index.html`.
- Supabase is used for player registration, nickname updates and leaderboard reads/writes.
- Browser local storage currently holds player ID and Octavio ID.
- The current SQL grants anonymous insert access to `octotris_scores`; its check validates numeric ranges and non-null player ID, but does not prove that the submitted score was earned in a real game.
- Client-side score submission is therefore not suitable as the source of truth for a prize competition.
- The current leaderboard query orders submitted score rows; it does not itself select each player's best score before ranking.

## Architecture target

1. **Game client:** rendering, input and gameplay only; never trusted to declare a final score.
2. **Session API:** creates a game session, server-generated seed, ruleset/version and expiry.
3. **Verification service:** validates ordered gameplay events by deterministic replay and calculates the authoritative score.
4. **Supabase:** player profiles, verified scores, wallet links, eligibility snapshots, competitions and payout ledger.
5. **Wallet verifier:** verifies signed challenges and reads token balances from a configured, trusted chain/indexer source.
6. **Reward operations:** selects winners from frozen eligible snapshots; requires explicit admin approval before MINIMA transfer.

## Proposed data model

- `octotris_game_sessions`: id, player_id, seed, ruleset_version, started_at, expires_at, status.
- `octotris_score_submissions`: session_id, event_payload, client_score, submitted_at, verification_status, rejection_reason.
- `octotris_wallets`: player_id, network, address, verified_at, verification_method, revoked_at.
- `octotris_holder_snapshots`: wallet_id, token_id, raw_balance, decimals, token_usd_price, balance_usd, threshold_usd, eligible, observed_at, source.
- `octotris_competitions`: id, period_type, starts_at, ends_at, status, ruleset_version, reward_pool.
- `octotris_competition_entries`: competition_id, player_id, verified_score_id, wallet_id, eligibility_snapshot_id, rank.
- `octotris_rewards`: competition_id, player_id, amount_raw, asset, approval_status, approved_by, approved_at.
- `octotris_payouts`: reward_id, destination, transaction_id, status, submitted_at, confirmed_at.
- `octotris_admin_audit`: actor, action, target, metadata, created_at.

All monetary/token values should be stored as integer base units or precise numeric values, never floating-point. The token contract, network, decimals, price source and threshold must be configuration, not guessed constants.

## Security requirements

- Do not treat a browser-supplied score, player UUID or local-storage value as proof of identity or gameplay.
- Do not expose service-role keys in the browser.
- Wallet linking requires a fresh, single-use, expiring signed challenge.
- Eligibility must be calculated from an identified source and timestamp; define handling for stale prices, transfers and chain/indexer outages.
- Freeze eligibility and leaderboard inputs at competition close; retain evidence for disputes.
- Separate public masked leaderboard fields from private wallet and identity data.
- Reward transfers require idempotency, admin approval and transaction confirmation.
- Rate-limit registration, session creation, score submission and wallet challenges.

## Acceptance and release gates

- Gameplay tests pass on desktop Chromium and mobile Safari/Chrome.
- Special-piece collision and row-clear regressions pass.
- Leaderboard tests cover duplicate submissions, ties, UTC boundaries and best-score selection.
- RLS/grant tests prove anonymous users cannot directly create trusted scores or read private wallet data.
- Tampered, replayed, expired and impossible game sessions are rejected.
- No reward payout can be triggered by a client request alone.
- Production deployment is performed only after the branch is reviewed and merged deliberately.

## Current progress

- [x] OT-001 — feature branch created.
- [x] OT-002 — golden-brick spawn collision corrected to use the special-piece collision handler.
- [ ] OT-003 through OT-010 — queued for implementation and validation.

## Important scope note

This release does not yet implement wallet verification, live token pricing, holder qualification, anti-cheat replay verification or MINIMA transfers. Those require confirmed Minima wallet/signature interfaces, the exact $OCTAVIO token network/contract and a trusted token-balance/price source.
