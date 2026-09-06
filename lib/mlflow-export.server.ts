import type { LabTrace } from './prompt-lab.server';

interface MlflowConfig {
  trackingUri?: string;
  experimentId?: string;
  experimentName?: string;
}

type MlflowTraceResponse = {
  trace?: { trace_info?: { tags?: Record<string, string> } };
};

export async function exportToMlflow(
  trace: LabTrace,
  config: MlflowConfig,
): Promise<{ exported: boolean; experimentId?: string; error?: string }> {
  const trackingUri = config.trackingUri?.trim();
  if (!trackingUri) return { exported: false };

  try {
    const base = trackingUri.replace(/\/$/, '');
    const experimentId = config.experimentId?.trim()
      || await resolveExperimentId(base, config.experimentName?.trim() || 'Prompt Lab');
    const traceId = `tr-${hex(trace.id.replace(/^trace-/, ''), 32)}`;
    const payload = {
      trace: {
        trace_info: {
          trace_id: traceId,
          trace_location: {
            type: 'MLFLOW_EXPERIMENT',
            mlflow_experiment: { experiment_id: experimentId },
          },
          request_time: new Date(trace.spans[0]?.startTime ?? Date.now()).toISOString(),
          execution_duration: `${Math.max(1, trace.latencyMs) / 1000}s`,
          state: trace.passed ? 'OK' : 'ERROR',
          request_preview: JSON.stringify({ prompt: trace.prompt }),
          response_preview: JSON.stringify({ passed: trace.passed, score: trace.score }),
          trace_metadata: {
            'mlflow.trace_schema.version': '3',
            'mlflow.trace.tokenUsage': JSON.stringify({
              input_tokens: trace.tokenUsage.input,
              output_tokens: trace.tokenUsage.output,
              total_tokens: trace.tokenUsage.total,
            }),
          },
          tags: {
            'workshop.level': String(trace.levelId),
            'workshop.trial': trace.trialId,
            'workshop.result': trace.passed ? 'passed' : 'failed',
          },
          assessments: [],
        },
      },
    };

    const created = await fetch(`${base}/api/3.0/mlflow/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!created.ok) throw new Error(`MLflow returned ${created.status}: ${(await created.text()).slice(0, 300)}`);

    const response = await created.json() as MlflowTraceResponse;
    const artifactUri = response.trace?.trace_info?.tags?.['mlflow.artifactLocation'];
    if (!artifactUri) throw new Error('MLflow did not return a trace artifact location');

    const uploaded = await fetch(artifactUrl(base, artifactUri), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spans: trace.spans.map((span) => toMlflowSpan(trace, span)) }),
    });
    if (!uploaded.ok) throw new Error(`MLflow trace upload returned ${uploaded.status}: ${(await uploaded.text()).slice(0, 300)}`);

    return { exported: true, experimentId };
  } catch (error) {
    return { exported: false, error: error instanceof Error ? error.message : 'MLflow export failed' };
  }
}

async function resolveExperimentId(base: string, name: string) {
  const lookup = await fetch(`${base}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(name)}`);
  if (lookup.ok) {
    const payload = await lookup.json() as { experiment?: { experiment_id?: string } };
    if (payload.experiment?.experiment_id) return payload.experiment.experiment_id;
  }

  const created = await fetch(`${base}/api/2.0/mlflow/experiments/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!created.ok) {
    const concurrent = await fetch(`${base}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(name)}`);
    if (concurrent.ok) {
      const payload = await concurrent.json() as { experiment?: { experiment_id?: string } };
      if (payload.experiment?.experiment_id) return payload.experiment.experiment_id;
    }
    throw new Error(`Could not create the MLflow experiment (${created.status})`);
  }
  const payload = await created.json() as { experiment_id?: string };
  if (!payload.experiment_id) throw new Error('MLflow did not return an experiment id');
  return payload.experiment_id;
}

function toMlflowSpan(trace: LabTrace, span: LabTrace['spans'][number]) {
  const traceHex = hex(trace.id.replace(/^trace-/, ''), 32);
  return {
    trace_id: base64Hex(traceHex),
    span_id: base64Hex(hex(span.id, 16)),
    parent_span_id: span.parentId ? base64Hex(hex(span.parentId, 16)) : '',
    name: span.name,
    start_time_unix_nano: String(BigInt(span.startTime) * BigInt(1_000_000)),
    end_time_unix_nano: String(BigInt(Math.max(span.endTime, span.startTime + 1)) * BigInt(1_000_000)),
    status: { code: span.status === 'OK' ? 'STATUS_CODE_OK' : 'STATUS_CODE_ERROR' },
    attributes: {
      'mlflow.spanType': span.type,
      'mlflow.spanInputs': JSON.stringify(span.inputs),
      'mlflow.spanOutputs': JSON.stringify(span.outputs),
      'workshop.prompt': trace.prompt,
      'workshop.score': trace.score,
      ...span.attributes,
    },
    events: [],
  };
}

function artifactUrl(base: string, uri: string) {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'mlflow-artifacts:') throw new Error(`Unsupported MLflow artifact URI: ${parsed.protocol}`);
  return `${base}/api/2.0/mlflow-artifacts/artifacts${parsed.pathname}/traces.json`;
}

function base64Hex(value: string) {
  const bytes = Array.from({ length: value.length / 2 }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
  return btoa(String.fromCharCode(...bytes));
}

function hex(value: string, length: number) {
  const clean = value.replace(/[^a-f0-9]/gi, '').toLowerCase();
  return clean.padEnd(length, '0').slice(0, length);
}
