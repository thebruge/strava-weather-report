import type { Env } from './index';

export async function log(env: Env, fields: Record<string, unknown>): Promise<void> {
  const entry = { _time: new Date().toISOString(), ...fields };
  console.log(JSON.stringify(entry));

  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return;

  try {
    await fetch(`https://api.axiom.co/v1/datasets/${env.AXIOM_DATASET}/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AXIOM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([entry]),
    });
  } catch {
    // Never let logging failures affect enrichment
  }
}
