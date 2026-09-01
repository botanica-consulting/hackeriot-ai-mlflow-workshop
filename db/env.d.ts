declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    MLFLOW_TRACKING_URI?: string;
    MLFLOW_EXPERIMENT_ID?: string;
    MLFLOW_EXPERIMENT_NAME?: string;
    INSTRUCTOR_TOKEN?: string;
  }
}
