import { describe, expect, it, beforeAll } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillAnalyserStack } from './bill-analyser-stack.js';

/**
 * These assert the security properties of the deployed infrastructure, not that the
 * code compiles. Each one corresponds to a claim made in docs/architecture.md, so a
 * change that quietly weakens the setup fails here rather than in production.
 */

let template: Template;
let app: App;

beforeAll(() => {
  app = new App();
  const stack = new BillAnalyserStack(app, 'TestStack', {
    env: { account: '111111111111', region: 'eu-west-2' },
    siteOrigin: 'https://example.github.io',
    sitePath: '/bill-analyser/',
    bedrockModelId: 'anthropic.claude-opus-4-5',
    photoRetentionDays: 30,
  });
  template = Template.fromStack(stack);
});

describe('who can get in', () => {
  it('does not let anyone register themselves an account', () => {
    // The single most important setting in the stack. Open sign-up would let a
    // stranger who found the app burn Bedrock budget, even seeing no data.
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it('offers app-based MFA', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      EnabledMfas: Match.arrayWith(['SOFTWARE_TOKEN_MFA']),
    });
  });

  it('issues no client secret, because a browser cannot keep one', () => {
    // Explicitly false rather than merely omitted, so the intent is on the record.
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
    });
  });

  it('can revoke a token when a device is lost', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      EnableTokenRevocation: true,
    });
  });

  it('does not reveal whether an email address has an account', () => {
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      PreventUserExistenceErrors: 'ENABLED',
    });
  });
});

describe('every route is behind the login', () => {
  it('attaches a JWT authorizer to every single route', () => {
    const routes = template.findResources('AWS::ApiGatewayV2::Route');
    const names = Object.keys(routes);
    expect(names.length).toBeGreaterThan(0);

    const unprotected = names.filter(
      (name) => routes[name]!.Properties?.AuthorizationType !== 'JWT',
    );
    expect(unprotected).toEqual([]);
  });

  it('pins the authorizer to this user pool and this client', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: {
        // An unpinned audience would accept a token minted for a different app.
        Audience: [{ Ref: Match.stringLikeRegexp('UserPoolClient') }],
        Issuer: Match.anyValue(),
      },
    });
  });

  it('only accepts requests from the site it was deployed for', () => {
    const apis = template.findResources('AWS::ApiGatewayV2::Api');
    const origins = Object.values(apis)[0]?.Properties?.CorsConfiguration?.AllowOrigins ?? [];
    expect(origins).toContain('https://example.github.io');
    expect(origins).not.toContain('*');
  });
});

describe('the data at rest', () => {
  it('keeps receipt photos private', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('refuses plaintext connections to the photo bucket', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('deletes photos on the retention schedule rather than keeping them forever', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 30, Status: 'Enabled' })]),
      },
    });
  });

  it('encrypts the photo bucket', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.anyValue(),
    });
  });

  it('leaves the receipt table on DynamoDB-managed encryption', () => {
    /*
     * DynamoDB encrypts every table at rest unconditionally, so there is no
     * "is it encrypted" property to assert - SSESpecification only selects a KMS
     * key, and SSEEnabled: false means the AWS-owned key rather than no encryption.
     * What is worth pinning is that no KMS key is named: asking for the AWS-managed
     * aws/dynamodb key fails on a new account, because AWS creates that key lazily
     * on first use and it does not exist yet at stack-creation time.
     */
    const tables = Object.values(template.findResources('AWS::DynamoDB::GlobalTable'));
    expect(tables).toHaveLength(1);
    expect(tables[0]!.Properties?.SSESpecification?.KMSMasterKeyId).toBeUndefined();
  });

  it('can recover the table to a point in time', () => {
    template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: Match.arrayWith([
        Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } }),
      ]),
    });
  });

  it('keeps the data if the stack is ever torn down', () => {
    for (const type of ['AWS::DynamoDB::GlobalTable', 'AWS::S3::Bucket', 'AWS::Cognito::UserPool']) {
      const resources = Object.values(template.findResources(type));
      expect(resources.length).toBeGreaterThan(0);
      for (const resource of resources) {
        expect(resource.DeletionPolicy).toBe('Retain');
      }
    }
  });
});

describe('what the functions are allowed to do', () => {
  it('grants the model permission the Messages endpoint actually checks', () => {
    // A 403 here names bedrock-mantle:CreateInference, which is a different service
    // namespace from bedrock:InvokeModel - so granting the familiar one is not enough.
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap(
      (policy) => policy.Properties?.PolicyDocument?.Statement ?? [],
    );

    const mantle = statements.filter((statement: { Action?: unknown }) =>
      JSON.stringify(statement.Action ?? '').includes('bedrock-mantle:CreateInference'),
    );
    expect(mantle).toHaveLength(1);
    expect(JSON.stringify(mantle[0].Resource)).toContain('bedrock-mantle');
    expect(mantle[0].Resource).not.toBe('*');
  });

  it('keeps every model permission on the worker, not the API-facing function', () => {
    const policies = Object.entries(template.findResources('AWS::IAM::Policy'));
    const modelPolicies = policies.filter(([, policy]) =>
      /bedrock(-mantle)?:/.test(JSON.stringify(policy.Properties?.PolicyDocument ?? '')),
    );

    expect(modelPolicies.length).toBeGreaterThan(0);
    for (const [name] of modelPolicies) {
      // The half behind the API never calls the model: it must return well inside
      // API Gateway's 30-second integration cap.
      expect(name).toMatch(/ParseWorker/);
    }
  });

  it('scopes the legacy Bedrock permission rather than opening it up', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap(
      (policy) => policy.Properties?.PolicyDocument?.Statement ?? [],
    );
    const bedrock = statements.filter((statement: { Action?: unknown }) =>
      JSON.stringify(statement.Action ?? '').includes('bedrock:InvokeModel'),
    );

    expect(bedrock).toHaveLength(1);
    const resources = JSON.stringify(bedrock[0].Resource);
    expect(resources).toContain('foundation-model/anthropic.*');
    expect(bedrock[0].Resource).not.toBe('*');
    expect(resources).not.toContain('"*"');
  });

  it('gives only the upload handler permission to write photos', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const writers = Object.entries(policies).filter(([, policy]) =>
      JSON.stringify(policy.Properties?.PolicyDocument?.Statement ?? '').includes('s3:PutObject'),
    );
    expect(writers).toHaveLength(1);
    expect(writers[0]![0]).toMatch(/Uploads/);
  });
});

describe('what actually gets deployed', () => {
  /*
   * Load every bundle the way the Lambda runtime does at cold start.
   *
   * This is the only check that catches a packaging fault, and packaging faults are
   * the worst kind to debug here: the CloudFormation template is byte-identical
   * whether or not a bundle can load, the failure happens before any handler code
   * runs, and what reaches the browser is API Gateway's bare "Internal Server
   * Error". Two real faults would have been caught by this and were not caught by
   * anything else - dependencies left out of the bundle, and an ESM output format
   * that turned a dependency's require() into a shim that throws on load.
   *
   * The copy into a temp directory matters: this repository is "type": "module", so
   * requiring a .js file in place makes Node treat it as ESM. Lambda deploys the
   * asset on its own, with no package.json above it, which means CommonJS.
   */
  it('produces bundles that load and export a handler', () => {
    const assembly = app.synth();
    const require_ = createRequire(import.meta.url);
    const staging = mkdtempSync(join(tmpdir(), 'bundle-check-'));

    const assetDirs = readdirSync(assembly.directory).filter((entry) => entry.startsWith('asset.'));

    // An .mjs bundle means the output format went back to ESM, which is the fault
    // this test exists for. Say so, rather than reporting "no bundles found".
    const esmBundles = assetDirs.filter((entry) =>
      existsSync(join(assembly.directory, entry, 'index.mjs')),
    );
    expect(esmBundles, 'bundles are ESM; CommonJS is required - see the stack').toEqual([]);

    const assets = assetDirs
      .map((entry) => join(assembly.directory, entry, 'index.js'))
      .filter((file) => existsSync(file));

    expect(assets.length, 'no Lambda bundles were produced').toBeGreaterThan(0);

    // The handlers read these at module scope; absent, they fail for the wrong reason.
    process.env.PHOTO_BUCKET ??= 'test-bucket';
    process.env.TABLE_NAME ??= 'test-table';
    process.env.PARSE_WORKER_FUNCTION ??= 'test-worker';
    process.env.AWS_REGION ??= 'eu-west-1';

    for (const [index, asset] of assets.entries()) {
      const dir = join(staging, String(index));
      mkdirSync(dir);
      copyFileSync(asset, join(dir, 'index.js'));

      const loaded = require_(join(dir, 'index.js')) as { handler?: unknown };
      expect(typeof loaded.handler, `${asset} does not export a handler`).toBe('function');
    }
  });
});
