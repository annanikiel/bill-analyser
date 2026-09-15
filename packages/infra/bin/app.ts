import { App } from 'aws-cdk-lib';
import { BillAnalyserStack } from '../lib/bill-analyser-stack.js';

/*
 * Configuration comes from environment variables so the deploy workflow can set it
 * without anyone editing code. Every value has a working default except the account,
 * which CDK takes from whichever credentials are deploying.
 */

const app = new App();

const siteOrigin = process.env.SITE_ORIGIN;
if (!siteOrigin) {
  throw new Error(
    'SITE_ORIGIN is required, e.g. https://yourname.github.io. It is the only origin ' +
      'the API will accept requests from, and where Cognito returns you after login.',
  );
}

new BillAnalyserStack(app, process.env.STACK_NAME ?? 'BillAnalyser', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION ?? process.env.CDK_DEFAULT_REGION ?? 'eu-west-2',
  },
  siteOrigin,
  sitePath: process.env.SITE_PATH ?? '/bill-analyser/',
  // Anthropic's own naming: no prefix, no region, no version suffix.
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5',
  photoRetentionDays: Number(process.env.PHOTO_RETENTION_DAYS ?? 30),
  description: 'Receipt scanning and spend categorisation (bill-analyser)',
});
