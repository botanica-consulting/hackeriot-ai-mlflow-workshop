# Greenhouse Lockdown implementation plan

## Product outcome

Deliver a two-hour workshop application where participants explore a greenhouse, run their own prompt through an agent, inspect a sanitized execution trace, and measure improvements in efficiency and security.

## Architecture

1. **Workshop workstation** — resizable Game, Prompt Lab, and MLflow windows in one responsive interface.
2. **Authoritative game engine** — deterministic greenhouse state, validated tools, objectives, bounties, security violations, and scoring.
3. **Prompt lifecycle** — private safety kernel on the server; each free-form participant prompt is stored and run immediately.
4. **Agent runner** — one live provider-reported tool call per turn through the Responses API; provider failures stop the run.
5. **Observability** — sanitized span tree in the application and optional OTLP export to a real MLflow server.
6. **Workshop operations** — per-team records, fixed turn budgets, and reproducible runs.

## Delivery phases

- [x] Scaffold Sites project with shadcn and D1.
- [x] Establish visual workstation and responsive multi-window layout.
- [x] Implement game engine, tools, objectives, bounties, and scoring.
- [x] Implement a free-form participant prompt flow with a private Kernel Prompt.
- [x] Implement live OpenAI and OpenRouter Responses API agents with no simulation fallback.
- [x] Implement sanitized traces and MLflow OTLP export.
- [x] Implement prompt comparison flow.
- [x] Complete automated validation and production build.
- [ ] Run a facilitator rehearsal with concurrent teams and a real API key.

## Acceptance criteria

- Participants can submit any prompt without a content checklist or minimum length.
- Pressing Run prompt starts the AI immediately on a fresh randomized scenario.
- A well-written prompt can complete in fewer turns, with fewer tokens and no security violation.
- The application requires a live OpenAI or OpenRouter key and never reports simulated results.
- When configured, the same run uses GPT-5.6 Terra and exports sanitized spans to MLflow.
