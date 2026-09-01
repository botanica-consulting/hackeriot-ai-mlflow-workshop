import type { TraceSpan, WorkshopTrace } from './workshop-types';

interface MlflowConfig {
  trackingUri?: string;
  experimentId?: string;
  experimentName?: string;
}

export async function exportToMlflow(trace: WorkshopTrace, config: MlflowConfig): Promise<{ exported: boolean; error?: string }> {
  if (!config.trackingUri) return { exported: false };
  try {
    const experimentId = config.experimentId ?? await resolveExperimentId(config.trackingUri, config.experimentName ?? 'AI Escape Room');
    const url = `${config.trackingUri.replace(/\/$/, '')}/v1/traces`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-mlflow-experiment-id': experimentId },
      body: JSON.stringify(toOtlp(trace)),
    });
    if (!response.ok) throw new Error(`MLflow OTLP endpoint returned ${response.status}`);
    return { exported: true };
  } catch (error) {
    return { exported: false, error: error instanceof Error ? error.message : 'Unknown MLflow export error' };
  }
}

async function resolveExperimentId(uri: string, name: string) {
  const base = uri.replace(/\/$/, '');
  const lookup = await fetch(`${base}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(name)}`);
  if (lookup.ok) {
    const payload = await lookup.json() as { experiment?: { experiment_id?: string } };
    if (payload.experiment?.experiment_id) return payload.experiment.experiment_id;
  }
  const created = await fetch(`${base}/api/2.0/mlflow/experiments/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  });
  if (!created.ok) throw new Error(`Could not create MLflow experiment (${created.status})`);
  const payload = await created.json() as { experiment_id?: string };
  if (!payload.experiment_id) throw new Error('MLflow did not return an experiment id');
  return payload.experiment_id;
}

function toOtlp(trace: WorkshopTrace) {
  return {
    resourceSpans: [{
      resource: { attributes: [attribute('service.name', 'ai-escape-room'), attribute('workshop.team_id', trace.teamId)] },
      scopeSpans: [{
        scope: { name: 'ai-escape-room', version: '1.0.0' },
        spans: trace.spans.map((span) => otlpSpan(trace, span)),
      }],
    }],
  };
}

function otlpSpan(trace: WorkshopTrace, span: TraceSpan) {
  return {
    traceId: hex(trace.id, 32), spanId: hex(span.id, 16), parentSpanId: span.parentId ? hex(span.parentId, 16) : undefined,
    name: span.name, kind: 1, startTimeUnixNano: `${span.startTime}000000`, endTimeUnixNano: `${span.endTime}000000`,
    attributes: [
      attribute('mlflow.spanType', span.type),
      attribute('mlflow.spanInputs', JSON.stringify(span.inputs)),
      attribute('mlflow.spanOutputs', JSON.stringify(span.outputs)),
      ...Object.entries(span.attributes ?? {}).map(([key, value]) => attribute(key, value)),
    ],
    status: { code: span.status === 'OK' ? 1 : 2 },
  };
}

function attribute(key: string, value: string | number | boolean) {
  if (typeof value === 'number') return { key, value: { doubleValue: value } };
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return { key, value: { stringValue: value } };
}

function hex(value: string, length: number) {
  const clean = value.replace(/[^a-f0-9]/gi, '').toLowerCase();
  return clean.padEnd(length, '0').slice(0, length);
}
