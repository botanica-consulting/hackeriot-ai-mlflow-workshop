declare namespace Cloudflare {
  interface Env {
    AI_PROVIDER?: string;
    AI_MAX_OUTPUT_TOKENS?: string;
    AI_REASONING_EFFORT?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_BASE_URL?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENROUTER_BASE_URL?: string;
    OPENROUTER_SITE_URL?: string;
    OPENROUTER_APP_NAME?: string;
    MLFLOW_TRACKING_URI?: string;
    MLFLOW_EXPERIMENT_ID?: string;
    MLFLOW_EXPERIMENT_NAME?: string;
  }
}
