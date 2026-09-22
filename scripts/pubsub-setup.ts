import { readFlag, requireFlag } from './shared';

const project = requireFlag('--project');
const topic = readFlag('--topic') ?? 'gmail-events';
const subscription = readFlag('--subscription') ?? 'gmail-agent';
const appIdentity = requireFlag('--app-identity');

if (!/^(user|serviceAccount):[^\s]+$/.test(appIdentity)) {
  throw new Error('--app-identity must start with user: or serviceAccount:.');
}

function run(args: string[], quiet = false): number {
  const result = Bun.spawnSync({
    cmd: ['gcloud', ...args],
    stdout: quiet ? 'ignore' : 'inherit',
    stderr: quiet ? 'ignore' : 'inherit',
  });
  return result.exitCode;
}

function ensureResource(args: string[], createArgs: string[], label: string) {
  if (run(args, true) === 0) {
    console.log(`${label} already exists.`);
    return;
  }
  if (run(createArgs) !== 0) {
    throw new Error(`Could not create ${label}. Check gcloud access and the project ID.`);
  }
}

if (run(['services', 'enable', 'pubsub.googleapis.com', `--project=${project}`]) !== 0) {
  throw new Error('Could not enable the Pub/Sub API.');
}

ensureResource(
  ['pubsub', 'topics', 'describe', topic, `--project=${project}`],
  ['pubsub', 'topics', 'create', topic, `--project=${project}`],
  `Topic ${topic}`
);
ensureResource(
  ['pubsub', 'subscriptions', 'describe', subscription, `--project=${project}`],
  ['pubsub', 'subscriptions', 'create', subscription, `--topic=${topic}`, `--project=${project}`],
  `Subscription ${subscription}`
);

for (const [resource, member, role] of [
  ['topics', 'serviceAccount:gmail-api-push@system.gserviceaccount.com', 'roles/pubsub.publisher'],
  ['subscriptions', appIdentity, 'roles/pubsub.subscriber'],
]) {
  const resourceName = resource === 'topics' ? topic : subscription;
  if (
    run([
      'pubsub',
      resource,
      'add-iam-policy-binding',
      resourceName,
      `--project=${project}`,
      `--member=${member}`,
      `--role=${role}`,
    ]) !== 0
  ) {
    throw new Error(`Could not grant ${role} to ${member} on ${resourceName}.`);
  }
}

console.log(`Pub/Sub is ready. Topic: projects/${project}/topics/${topic}`);
console.log(`Subscription: projects/${project}/subscriptions/${subscription}`);
