'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Circle, FlaskConical, Play, RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LAB_LEVELS } from '@/lib/prompt-lab';
import type { TrialRun } from '@/lib/prompt-lab.server';

type TrialStatus = 'passed' | 'failed' | 'ready' | 'running';
type PublicLevel = {
  id: number;
  title: string;
  tools: string[];
  toolsEditable: boolean;
  trials: Array<{ id: string; label: string; prompt: string }>;
};
type GameConfig = {
  levels: PublicLevel[];
  configuration: { liveModelAvailable: boolean; model: string; mlflowConfigured: boolean; mlflowUrl?: string };
};

const fallbackConfig: GameConfig = {
  levels: LAB_LEVELS.map((level) => ({
    id: level.id,
    title: level.title,
    tools: level.tools,
    toolsEditable: Boolean(level.toolsEditable),
    trials: level.trials.map((trial) => ({ id: trial.id, label: trial.label, prompt: trial.prompt })),
  })),
  configuration: { liveModelAvailable: false, model: '', mlflowConfigured: false },
};

export function WorkshopClient() {
  const [config, setConfig] = useState<GameConfig>(fallbackConfig);
  const [levelId, setLevelId] = useState(1);
  const [unlockedLevel, setUnlockedLevel] = useState(1);
  const [prompts, setPrompts] = useState<Record<string, string>>(() => defaultPrompts(fallbackConfig.levels));
  const [allowedTools, setAllowedTools] = useState<Record<number, string[]>>(() => defaultAllowedTools(fallbackConfig.levels));
  const [results, setResults] = useState<Record<string, TrialRun>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetch('/api/game')
      .then(async (response) => {
        if (!response.ok) throw new Error('Game unavailable');
        return response.json() as Promise<GameConfig>;
      })
      .then((next) => {
        setConfig(next);
        setPrompts((current) => ({ ...defaultPrompts(next.levels), ...current }));
        setAllowedTools((current) => ({ ...defaultAllowedTools(next.levels), ...current }));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Game unavailable'));
  }, []);

  const level = config.levels.find((item) => item.id === levelId) ?? config.levels[0];
  const levelResults = useMemo(() => level.trials.map((trial) => results[trialKey(level.id, trial.id)]).filter(Boolean), [level, results]);
  const selectedTools = allowedTools[level.id] ?? level.tools;
  const score = levelResults.reduce((sum, result) => sum + result.score, 0);
  const complete = levelResults.length === level.trials.length && levelResults.every((result) => result.status === 'passed');

  function updatePrompt(trialId: string, prompt: string) {
    const key = trialKey(level.id, trialId);
    setPrompts((current) => ({ ...current, [key]: prompt }));
    setResults((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function toggleTool(tool: string) {
    setAllowedTools((current) => {
      const selected = current[level.id] ?? level.tools;
      const next = selected.includes(tool) ? selected.filter((name) => name !== tool) : [...selected, tool];
      return { ...current, [level.id]: level.tools.filter((name) => next.includes(name)) };
    });
    setResults((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${level.id}:`))));
  }

  async function runLevel() {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      const response = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          levelId: level.id,
          allowedTools: selectedTools,
          prompts: level.trials.map((trial) => ({ trialId: trial.id, prompt: prompts[trialKey(level.id, trial.id)] })),
        }),
      });
      const payload = await response.json() as { results?: TrialRun[]; error?: string };
      if (!response.ok || !payload.results) throw new Error(payload.error ?? 'AI run failed');
      setResults((current) => ({
        ...current,
        ...Object.fromEntries(payload.results!.map((result) => [trialKey(level.id, result.trialId), result])),
      }));
      if (payload.results.every((result) => result.status === 'passed')) {
        setUnlockedLevel((current) => Math.max(current, Math.min(config.levels.length, level.id + 1)));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI run failed');
    } finally {
      setRunning(false);
    }
  }

  function nextLevel() {
    const next = Math.min(config.levels.length, level.id + 1);
    setUnlockedLevel((current) => Math.max(current, next));
    setLevelId(next);
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#0b0c10] text-[#f4f2ea]">
      <div className="lab-grid" aria-hidden="true" />
      <div className="relative mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 py-4 sm:px-7 sm:py-6 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl bg-[#c7ff3f] text-[#10120c] shadow-[0_0_28px_rgba(199,255,63,.16)]">
              <FlaskConical className="size-5" strokeWidth={2.4} />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Prompt Lab</h1>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-white/45">Level 0{level.id} · {level.title}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-5">
            <nav className="flex items-center gap-2" aria-label="Levels">
              {config.levels.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Level ${item.id}: ${item.title}`}
                  aria-current={item.id === level.id ? 'step' : undefined}
                  disabled={item.id > unlockedLevel}
                  onClick={() => setLevelId(item.id)}
                  className={`grid size-8 place-items-center rounded-full border font-mono text-xs transition ${item.id === level.id ? 'border-[#c7ff3f] bg-[#c7ff3f] text-[#10120c]' : item.id <= unlockedLevel ? 'border-white/25 text-white/65 hover:border-white/50' : 'cursor-not-allowed border-white/10 text-white/25'}`}
                >
                  {item.id}
                </button>
              ))}
            </nav>
            <div className="h-7 w-px bg-white/10" />
            <div className="text-right">
              <p className="font-mono text-xs tracking-[0.18em] text-white/45">SCORE</p>
              <p className="font-mono text-xl font-semibold leading-none text-[#c7ff3f]">{score}<span className="text-xs text-white/30"> / 300</span></p>
            </div>
          </div>
        </header>

        <section className="flex flex-1 flex-col justify-center py-7 lg:py-9">
          <div className="mb-5 max-w-3xl">
            <p className="text-base font-semibold text-white/90">Welcome to the AI Greenhouse. You are now the Greenhouse Orchestrator.</p>
            <p className="mt-1 text-base leading-6 text-white/55">Make sure all greenhouse components function correctly by fixing the prompts in the red boxes.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {level.trials.map((trial, index) => {
              const result = results[trialKey(level.id, trial.id)];
              return (
                <TrialCard
                  key={trial.id}
                  trial={trial}
                  number={index + 1}
                  prompt={prompts[trialKey(level.id, trial.id)] ?? trial.prompt}
                  status={running ? 'running' : result?.status ?? 'ready'}
                  result={result}
                  mlflowUrl={config.configuration.mlflowUrl}
                  onPromptChange={(value) => updatePrompt(trial.id, value)}
                />
              );
            })}
          </div>

          {level.toolsEditable && (
            <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Allowed AI tools">
              <span className="mr-1 font-mono text-xs font-semibold tracking-[0.16em] text-white/40">AGENT TOOLS</span>
              {level.tools.map((tool) => {
                const enabled = selectedTools.includes(tool);
                return (
                  <label key={tool} className={`cursor-pointer rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${enabled ? 'border-[#8d82ff]/55 bg-[#8d82ff]/10 text-[#b8b1ff]' : 'border-white/10 bg-white/[0.02] text-white/30'}`}>
                    <input type="checkbox" className="sr-only" checked={enabled} disabled={running} onChange={() => toggleTool(tool)} />
                    {tool}
                  </label>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex min-h-11 items-center justify-end gap-3">
            {error && <p role="alert" className="mr-auto text-sm text-[#ff8d8d]">{error}</p>}
            {complete && level.id < config.levels.length ? (
              <Button onClick={nextLevel} size="lg" className="h-11 rounded-xl bg-[#c7ff3f] px-5 font-semibold text-[#11140b] hover:bg-[#d5ff6b]">
                Next level <ArrowRight />
              </Button>
            ) : (
              <Button onClick={runLevel} disabled={running || !config.configuration.liveModelAvailable || selectedTools.length === 0} size="lg" className="h-11 rounded-xl bg-[#c7ff3f] px-5 font-semibold text-[#11140b] hover:bg-[#d5ff6b]">
                {running ? <RotateCcw className="animate-spin" /> : <Play className="fill-current" />}
                {running ? 'Running…' : 'Run'}
              </Button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function TrialCard({ trial, number, prompt, status, result, mlflowUrl, onPromptChange }: {
  trial: PublicLevel['trials'][number];
  number: number;
  prompt: string;
  status: TrialStatus;
  result?: TrialRun;
  mlflowUrl?: string;
  onPromptChange: (value: string) => void;
}) {
  const isPassed = status === 'passed';
  const isFailed = status === 'failed';
  const call = status === 'running' ? 'AI is choosing a tool…' : result?.toolCall ?? '—';
  return (
    <article className={`trial-card relative flex min-h-[390px] flex-col overflow-hidden rounded-2xl border bg-[#111319]/92 ${isPassed ? 'border-[#52e394]/45' : isFailed ? 'border-[#ff6b6b]/55' : 'border-white/12'}`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${isPassed ? 'bg-[#52e394]' : isFailed ? 'bg-[#ff6b6b]' : 'bg-white/15'}`} />
      <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-white/35">0{number}</span>
          <span className="font-mono text-xs font-semibold tracking-[0.16em] text-white/75">{trial.label}</span>
        </div>
        <Status status={status} />
      </div>

      <div className="flex flex-1 flex-col gap-5 p-5">
        <div className="flex flex-1 flex-col gap-2">
          <span className="font-mono text-xs font-semibold tracking-[0.16em] text-white/45">PROMPT</span>
          <Textarea
            aria-label={`${trial.label} prompt`}
            value={prompt}
            disabled={status === 'running'}
            onChange={(event) => onPromptChange(event.target.value)}
            className="min-h-[116px] flex-1 resize-none rounded-xl border-white/10 bg-black/20 p-4 text-base leading-6 text-white/90 focus-visible:border-[#8d82ff] focus-visible:ring-[#8d82ff]/20"
          />
        </div>

        <div>
          <p className="mb-2 font-mono text-xs font-semibold tracking-[0.16em] text-white/45">AI TOOL CALL</p>
          <code className={`block min-h-[54px] rounded-xl border px-3 py-3 font-mono text-[13px] leading-5 ${isPassed ? 'border-[#52e394]/15 bg-[#52e394]/[0.055] text-[#8ceab6]' : isFailed ? 'border-[#ff6b6b]/18 bg-[#ff6b6b]/[0.06] text-[#ff9999]' : 'border-white/8 bg-white/[0.025] text-white/45'}`}>
            {call}
          </code>
        </div>
      </div>

      <div className="flex items-center justify-end border-t border-white/[0.07] px-5 py-3.5">
        {result?.exportedToMlflow && mlflowUrl ? (
          <a href={mlflowUrl} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-xs font-semibold tracking-[0.1em] text-[#8d82ff] hover:text-[#b1aaff]">MLFLOW ↗</a>
        ) : (
          <span className="shrink-0 font-mono text-xs tracking-[0.1em] text-white/25">MLFLOW</span>
        )}
      </div>
    </article>
  );
}

function Status({ status }: { status: TrialStatus }) {
  if (status === 'passed') return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#52e394]/10 px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.1em] text-[#7ce8aa]"><Check className="size-3" /> PASSED</span>;
  if (status === 'failed') return <span className="inline-flex items-center gap-1.5 rounded-full bg-[#ff6b6b]/10 px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.1em] text-[#ff8d8d]"><TriangleAlert className="size-3" /> REVIEW</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 font-mono text-xs font-semibold tracking-[0.1em] text-white/45"><Circle className={`size-2.5 ${status === 'running' ? 'animate-pulse fill-current' : ''}`} /> {status === 'running' ? 'RUNNING' : 'READY'}</span>;
}

function defaultPrompts(levels: PublicLevel[]) {
  return Object.fromEntries(levels.flatMap((level) => level.trials.map((trial) => [trialKey(level.id, trial.id), trial.prompt])));
}

function defaultAllowedTools(levels: PublicLevel[]) {
  return Object.fromEntries(levels.map((level) => [level.id, level.tools]));
}

function trialKey(levelId: number, trialId: string) {
  return `${levelId}:${trialId}`;
}
