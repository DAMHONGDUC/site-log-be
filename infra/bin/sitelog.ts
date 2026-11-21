import { App } from 'aws-cdk-lib';
import { DevStack } from '../lib/dev-stack.js';
import { EnvStack, type EnvSettings } from '../lib/env-stack.js';
import { SharedStack } from '../lib/shared-stack.js';
import { UptimeStack } from '../lib/uptime-stack.js';

// Every AWS resource of the backend. Deploy one stack at a time: npx cdk deploy SiteLog-Staging
const app = new App();
// Region from cdk.json; account from your AWS login (unset in CI, where synth needs no login).
const region = app.node.getContext('region') as string;
const account = process.env.CDK_DEFAULT_ACCOUNT;
const env = { account, region };

const githubRepo = app.node.getContext('githubRepo') as string;
const staging = app.node.getContext('staging') as EnvSettings;
const prod = app.node.getContext('prod') as EnvSettings;

// Container registry and the role GitHub Actions deploys with: shared by staging and prod.
new SharedStack(app, 'SiteLog-Shared', { env, githubRepo });

// Only an S3 bucket: your laptop runs the API and Postgres, files go to real S3.
new DevStack(app, 'SiteLog-Dev', { env });

new EnvStack(app, 'SiteLog-Staging', { env, envName: 'staging', settings: staging });
new EnvStack(app, 'SiteLog-Prod', { env, envName: 'prod', settings: prod });

// Route 53 health checks only report to us-east-1, so the uptime alarm lives there.
new UptimeStack(app, 'SiteLog-Prod-Uptime', {
  env: { account, region: 'us-east-1' },
  apiDomain: prod.apiDomain,
  alarmEmail: prod.alarmEmail,
});
