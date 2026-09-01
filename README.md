# Agent Escape Room

A complete local workshop application for teaching LLM agents, tool use, observability, prompt optimization, prompt injection, and least privilege. The interface contains three synchronized windows:

- **Greenhouse 07:** the visual escape-room game, objectives, score, and hidden bounties.
- **Prompt Lab:** immutable participant prompt versions; the intentionally poor baseline stays server-only.
- **MLflow:** an embedded sanitized span tree plus optional export to a real MLflow server.

## Quick start

Requirements: Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The deterministic demo agent works immediately and intentionally behaves differently based on the participant strategy, so the workshop does not depend on conference Wi-Fi.

## Enable the live model

Add an OpenAI API key to `.env.local`:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6-terra
```

The key and hidden baseline remain in the server environment. The browser sends only public game state, a rendered game image, the team identifier, and participant-authored prompt content. If a live model request fails, the current run automatically continues with the deterministic agent and reports the fallback in its trace.

## Enable MLflow

Start the included local server:

```bash
docker compose up -d mlflow
```

Then set:

```text
MLFLOW_TRACKING_URI=http://127.0.0.1:5000
MLFLOW_EXPERIMENT_NAME=AI Escape Room
```

Completed runs are exported through MLflow's OpenTelemetry-compatible trace endpoint. The app creates the named experiment when necessary. The embedded trace viewer remains available even if MLflow is offline.

## Instructor controls

Set `INSTRUCTOR_TOKEN` to protect the reveal and reset actions. During the final debrief, open **Instructor** and reveal the baseline. Never place credentials or genuine secrets in any model prompt.

## Workshop flow

1. Run the hidden baseline.
2. Inspect repeated screenshots, manual reads, tool calls, token use, and the failed policy check.
3. Create a replacement strategy in Prompt Lab.
4. Run the new version against the identical initial state.
5. Compare score, tokens, calls, bounties, and security violations.
6. Reveal the baseline and discuss why prompts are not security boundaries.

## Validation

```bash
npm test
npm run typecheck
npm run build
```

The game engine tests prove that the baseline is inefficient and unsafe, while an optimized prompt completes faster and resists the injected sensor instruction.

## Important security properties

- The hidden prompt is never returned by normal workshop endpoints or stored in participant-visible traces.
- OpenAI requests use `store: false`.
- Model-selected actions are constrained to declared game tools and validated by the game engine.
- Logs and visual notices are explicitly untrusted data.
- Trace input contains `[HIDDEN BASELINE]`, not the private instructions.
- The baseline contains challenge clues only; prompt confidentiality is not treated as a secure secret store.
