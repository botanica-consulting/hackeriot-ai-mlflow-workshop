import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const envPath = resolve(root, '.env');
const generatedDir = resolve(root, 'deployment', 'generated');

const values = parseEnv(await readFile(envPath, 'utf8'));
if (process.argv.includes('--require-secrets')) validateSecrets(values);
const count = integer(values.PARTICIPANT_COUNT ?? '50', 'PARTICIPANT_COUNT', 1, 200);
const domain = hostname(values.DEPLOY_DOMAIN ?? 'botanica.tools', 'DEPLOY_DOMAIN');
const appImage = optionValue('--app-image') || values.APP_IMAGE || 'greenhouse-app:local';
const mlflowImage = values.MLFLOW_IMAGE || 'ghcr.io/mlflow/mlflow:v3.10.0';
const traefikImage = values.TRAEFIK_IMAGE || 'traefik:v3.5';
const cloudflaredImage = values.CLOUDFLARED_IMAGE || 'cloudflare/cloudflared:latest';
const appMemory = values.APP_MEMORY_LIMIT || '256m';
const mlflowMemory = values.MLFLOW_MEMORY_LIMIT || '512m';

const compose = {
  name: 'greenhouse',
  services: {},
  networks: {
    edge: { name: 'greenhouse-edge' },
    workloads: { name: 'greenhouse-workloads' },
  },
  volumes: {},
};

const dynamic = {
  http: {
    routers: {},
    services: {},
    middlewares: {
      securityHeaders: {
        headers: {
          contentTypeNosniff: true,
          frameDeny: true,
          referrerPolicy: 'strict-origin-when-cross-origin',
        },
      },
    },
  },
};

for (let participant = 1; participant <= count; participant += 1) {
  const id = String(participant).padStart(2, '0');
  const appName = `app-${id}`;
  const mlflowName = `mlflow-${id}`;
  const volumeName = `mlflow-data-${id}`;
  const appHost = `greenhouse-${id}.${domain}`;
  const mlflowPath = '/mlflow';

  compose.volumes[volumeName] = { name: `greenhouse-${volumeName}` };

  compose.services[appName] = {
    image: appImage,
    build: { context: '.', dockerfile: 'Dockerfile' },
    restart: 'unless-stopped',
    env_file: ['.env'],
    environment: {
      PORT: '3000',
      SITE_URL: `https://${appHost}`,
      OPENROUTER_SITE_URL: `https://${appHost}`,
      MLFLOW_TRACKING_URI: `http://${mlflowName}:5000`,
      MLFLOW_PUBLIC_URL: `https://${appHost}${mlflowPath}`,
    },
    depends_on: { [mlflowName]: { condition: 'service_healthy' } },
    networks: ['workloads'],
    mem_limit: appMemory,
    pids_limit: 128,
    security_opt: ['no-new-privileges:true'],
    read_only: true,
    tmpfs: ['/tmp:rw,noexec,nosuid,size=64m'],
    logging: logPolicy(),
  };

  compose.services[mlflowName] = {
    image: mlflowImage,
    restart: 'unless-stopped',
    command: [
      'mlflow', 'server', '--host', '0.0.0.0', '--port', '5000', '--workers', '1',
      '--backend-store-uri', 'sqlite:////mlflow/mlflow.db',
      '--static-prefix', mlflowPath,
      '--allowed-hosts', `${appHost},${mlflowName}:*,localhost:*,127.0.0.1:*`,
    ],
    environment: {
      MLFLOW_SERVER_ENABLE_JOB_EXECUTION: 'false',
      MLFLOW_DISABLE_TELEMETRY: 'true',
    },
    volumes: [`${volumeName}:/mlflow`],
    networks: ['workloads'],
    mem_limit: mlflowMemory,
    pids_limit: 128,
    security_opt: ['no-new-privileges:true'],
    healthcheck: {
      test: ['CMD', 'python', '-c', `import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000${mlflowPath}/health', timeout=3)`],
      interval: '15s', timeout: '5s', retries: 6, start_period: '20s',
    },
    logging: logPolicy(),
  };

  dynamic.http.routers[`app-${id}`] = {
    entryPoints: ['web'], rule: `Host(\`${appHost}\`)`,
    service: `app-${id}`, middlewares: [`gateway-${id}`, 'securityHeaders'],
  };
  dynamic.http.services[`app-${id}`] = {
    loadBalancer: { servers: [{ url: `http://${appName}:3000` }] },
  };
  dynamic.http.routers[`mlflow-${id}`] = {
    entryPoints: ['web'], rule: `Host(\`${appHost}\`) && PathPrefix(\`${mlflowPath}\`)`,
    service: `mlflow-${id}`, middlewares: [`gateway-${id}`], priority: 100,
  };
  dynamic.http.services[`mlflow-${id}`] = {
    loadBalancer: { servers: [{ url: `http://${mlflowName}:5000` }] },
  };
  dynamic.http.middlewares[`gateway-${id}`] = {
    forwardAuth: {
      address: `http://${appName}:3000/api/gateway/check`,
      trustForwardHeader: true,
      preserveLocationHeader: true,
    },
  };
  dynamic.http.routers[`gateway-${id}`] = {
    entryPoints: ['web'], rule: `Host(\`${appHost}\`) && Path(\`/gateway\`)`,
    service: `app-${id}`, middlewares: ['securityHeaders'], priority: 200,
  };
}

compose.services.traefik = {
  image: traefikImage,
  restart: 'unless-stopped',
  command: ['--configFile=/etc/traefik/traefik.yml'],
  volumes: [
    './deployment/traefik.yml:/etc/traefik/traefik.yml:ro',
    './deployment/generated/dynamic.yml:/etc/traefik/dynamic.yml:ro',
  ],
  networks: ['edge', 'workloads'],
  mem_limit: '256m',
  pids_limit: 128,
  security_opt: ['no-new-privileges:true'],
  healthcheck: { test: ['CMD', 'traefik', 'healthcheck', '--ping'], interval: '15s', timeout: '5s', retries: 4 },
  logging: logPolicy(),
};

compose.services.cloudflared = {
  image: cloudflaredImage,
  restart: 'unless-stopped',
  command: ['tunnel', '--no-autoupdate', 'run', '--token', '${CLOUDFLARE_TUNNEL_TOKEN}'],
  depends_on: { traefik: { condition: 'service_healthy' } },
  networks: ['edge'],
  mem_limit: '256m',
  pids_limit: 128,
  security_opt: ['no-new-privileges:true'],
  read_only: true,
  logging: logPolicy(),
};

await mkdir(generatedDir, { recursive: true });
await writeFile(resolve(root, 'docker-compose.generated.json'), `${JSON.stringify(compose, null, 2)}\n`);
await writeFile(resolve(generatedDir, 'dynamic.yml'), yaml(dynamic));
console.log(`Generated ${count} isolated participant stacks for ${domain}.`);

function parseEnv(source) {
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function validateSecrets(source) {
  if (!source.CLOUDFLARE_TUNNEL_TOKEN) throw new Error('CLOUDFLARE_TUNNEL_TOKEN is empty in .env');
  const provider = source.AI_PROVIDER?.trim().toLowerCase();
  if (provider === 'openrouter' && !source.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is empty in .env');
  if (provider === 'openai' && !source.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is empty in .env');
  if (provider !== 'openrouter' && provider !== 'openai') throw new Error('AI_PROVIDER must be openrouter or openai in .env');
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function integer(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

function hostname(value, name) {
  const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)) throw new Error(`${name} must be a DNS hostname`);
  return normalized;
}

function logPolicy() {
  return { driver: 'json-file', options: { 'max-size': '10m', 'max-file': '3' } };
}

function yaml(value, depth = 0) {
  const indent = '  '.repeat(depth);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object') return `${indent}-\n${yaml(item, depth + 1)}`;
      return `${indent}- ${scalar(item)}\n`;
    }).join('');
  }

  return Object.entries(value).map(([key, item]) => {
    if (item && typeof item === 'object') return `${indent}${key}:\n${yaml(item, depth + 1)}`;
    return `${indent}${key}: ${scalar(item)}\n`;
  }).join('');
}

function scalar(value) {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value));
}
