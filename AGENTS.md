# Qravy — notes for AI coding agents

Qravy is a restaurant platform: the storefront and digital menu with an AI waiter (`apps/tastebud`), the restaurant
admin (`apps/braincell`), the company admin (`apps/cortex`), the API (`services/auth-service`), the AI waiter
(`services/ai-waiter-service`), and supporting services.

## Before you change anything
- **The AI waiter** (`services/ai-waiter-service`): read `services/ai-waiter-service/CLAUDE.md` first. It defines the
  architecture (restaurant data → facts → the AI writes the reply → safety checks), what is forbidden (keyword rules
  that answer guests, reply sentences or menu words in code, one-off special cases), where cuisine and language
  knowledge goes (`knowledge/`), and the proof required before shipping (unit tests + the replay set).
- **Availability** ("can this dish be ordered now?") is decided in one place: `services/auth-service/src/utils/
  orderability.ts`; the menu, checkout and the waiter all use it.
- The owner does not review code. Tests and these rules are the review: never weaken a test or an expectation to
  make a change pass.

## Working rules
- Commit only the files you changed (no `git add -A` / `.` / folders); another session may share the checkout.
- `fine_tuning/*.jsonl` stays untracked.
- Changes reach `main` (and production) only after the owner approves.
