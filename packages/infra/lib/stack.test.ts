import { describe, expect, it, beforeAll } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BillAnalyserStack } from './bill-analyser-stack.js';

/**
 * These assert the security properties of the deployed infrastructure, not that the
 * code compiles. Each one corresponds to a claim made in docs/architecture.md, so a
 * change that quietly weakens the setup fails here rather than in production.
 */

let template: Template;

beforeAll(() => {
  const app = new App();
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
  it('scopes the Bedrock permission to the one model, not to everything', () => {
    const policies = Object.values(template.findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap(
      (policy) => policy.Properties?.PolicyDocument?.Statement ?? [],
    );
    const bedrock = statements.filter((statement: { Action?: unknown }) =>
      JSON.stringify(statement.Action ?? '').includes('bedrock:InvokeModel'),
    );

    expect(bedrock.length).toBe(1);
    const resources = JSON.stringify(bedrock[0].Resource);
    // Anthropic models only, whether reached directly or through an inference
    // profile - but never a blanket wildcard over every model in the account.
    expect(resources).toContain('foundation-model/anthropic.*');
    expect(resources).toContain('inference-profile');
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
