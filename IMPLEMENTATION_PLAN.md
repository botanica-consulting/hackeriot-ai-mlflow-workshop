# Agent Escape Room implementation plan

## Product outcome

Deliver a two-hour workshop application where participants run a deliberately inefficient hidden agent, inspect a sanitized execution trace, replace its strategy prompt, and measure improvements in efficiency and security.

## Architecture

1. **Workshop workstation** — resizable Game, Prompt Lab, and MLflow windows in one responsive interface.
2. **Authoritative game engine** — deterministic greenhouse state, validated tools, objectives, bounties, security violations, and scoring.
3. **Prompt lifecycle** — private safety kernel and baseline on the server; participant strategies stored as immutable D1 versions.
4. **Agent runner** — one tool call per turn through the OpenAI Responses API, with a deterministic fallback for offline teaching.
5. **Observability** — sanitized span tree in the application and optional OTLP export to a real MLflow server.
6. **Workshop operations** — instructor reveal/reset controls, per-team records, fixed turn budgets, and reproducible runs.

## Delivery phases

- [x] Scaffold Sites project with shadcn and D1.
- [x] Establish visual workstation and responsive multi-window layout.
- [x] Implement game engine, tools, objectives, bounties, and scoring.
- [x] Implement server-only baseline and participant prompt versions.
- [x] Implement Responses API and deterministic fallback agent.
- [x] Implement sanitized traces and MLflow OTLP export.
- [x] Implement instructor controls and prompt comparison flow.
- [x] Complete automated validation and production build.
- [ ] Run a facilitator rehearsal with concurrent teams and a real API key.

## Acceptance criteria

- Participants cannot obtain the baseline from browser requests or participant-visible traces.
- A baseline run completes, visibly repeats work, and follows one injected instruction.
- A well-written replacement prompt completes in fewer turns, with fewer tokens and no security violation.
- The application remains fully demonstrable without an API key or MLflow server.
- When configured, the same run uses GPT-5.6 Terra and exports sanitized spans to MLflow.
