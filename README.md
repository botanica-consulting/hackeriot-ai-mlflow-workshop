# Prompt Lab

An AI-only prompt debugging game for learning MLflow. Each level runs three prompts through the same model. Two reach their target; one fails until its prompt is made precise.

## Run locally

Requirements: Node.js 22.13+, Docker, and an OpenAI or OpenRouter API key.

```bash
npm install
docker compose up -d mlflow
npm run dev
```

Open the game at `http://localhost:3000` and MLflow at `http://127.0.0.1:5050`.

Copy `.env.example` to `.env` and configure one provider:

```text
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-4.1-mini

MLFLOW_TRACKING_URI=http://127.0.0.1:5050
MLFLOW_EXPERIMENT_NAME=Prompt Lab
```

Use `AI_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_MODEL` for direct OpenAI access.

## Workshop loop

1. Run all three prompts.
2. Open the failed run in MLflow.
3. Open the `tool.check_stats` spans and search their noisy readings and diagnostic logs.
4. Compare current and expected values, inspect the system prompt and enabled tools, then change the prompt or tool access.
5. Run the level again and compare the new trace.

Each AI action records model selection, tool execution, and an automatic noisy stats check. Level 4 may contain three ordered actions in one trace.

Level 1 is a basic prompt fix. Level 2 requires a precise prompt that avoids a side effect. Level 3 adds editable tool access and succeeds only after the legacy propagation tool is disabled. Level 4 combines a restrictive system prompt, tool access, exact hidden values, and a three-tool sequence.

## Validate

```bash
npm test
npm run typecheck
npm run build
```

Run the online system test against a deployed participant instance:

```bash
WORKSHOP_URL=https://greenhouse-01.botanica.tools \
WORKSHOP_ACCESS_CODE=women-in-tech-shape-the-future \
npm run test:system
```

The test authenticates through the gateway, solves all three level-one trials with the live model, and verifies that every trace was exported to that participant's MLflow instance.
