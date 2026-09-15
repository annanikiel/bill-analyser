import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolDomain,
} from 'aws-cdk-lib/aws-cognito';
import {
  AttributeType,
  Billing,
  TableEncryptionV2,
  TableV2,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  HttpMethods,
  ObjectOwnership,
} from 'aws-cdk-lib/aws-s3';
import { HttpApi, HttpMethod, CorsHttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const handlerDir = join(here, '..', 'src', 'handlers');

export interface BillAnalyserStackProps extends StackProps {
  /** Origin the web app is served from. The only origin the API will talk to. */
  siteOrigin: string;
  /** Path the app lives under on that origin, e.g. "/bill-analyser/". */
  sitePath: string;
  bedrockModelId: string;
  /** Days a receipt photo is kept before S3 deletes it. */
  photoRetentionDays: number;
}

export class BillAnalyserStack extends Stack {
  constructor(scope: Construct, id: string, props: BillAnalyserStackProps) {
    super(scope, id, props);

    const appUrl = `${props.siteOrigin}${props.sitePath}`;

    /* ---------------------------------------------------------------------
     * Who you are
     * ------------------------------------------------------------------ */

    const userPool = new UserPool(this, 'UserPool', {
      userPoolName: 'bill-analyser',
      // The single most important setting here. With self sign-up enabled, anyone
      // who found the app could create an account: they would see none of your data,
      // but they would be spending your Bedrock budget. Accounts exist only when you
      // create one from the console.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Your login is not something to lose to a stack typo.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPoolClient = new UserPoolClient(this, 'UserPoolClient', {
      userPool,
      // A browser cannot keep a secret, so there is none. PKCE is what protects the
      // authorisation code instead.
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        // Exact matches only - Cognito does not accept wildcards here, which is why
        // the site origin has to be known at deploy time.
        callbackUrls: [appUrl, 'http://localhost:5173/'],
        logoutUrls: [appUrl, 'http://localhost:5173/'],
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      // Long enough that you are not logging in constantly; revocable if a device
      // is lost.
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
      preventUserExistenceErrors: true,
    });

    // The hosted login page needs a domain. The prefix must be globally unique, so
    // it is salted with the account id rather than something guessable-by-collision.
    const userPoolDomain = new UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: { domainPrefix: `bill-analyser-${this.account}` },
    });

    /* ---------------------------------------------------------------------
     * Where the data lives
     * ------------------------------------------------------------------ */

    const table = new TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billing: Billing.onDemand(),
      /*
       * DynamoDB encrypts every table at rest unconditionally; this names which key
       * does it. The AWS-managed key (aws/dynamodb) is the tempting upgrade - it adds
       * CloudTrail visibility of key use - but AWS creates that key lazily on first
       * use in a region, so asking a brand new account for it fails with a KMS
       * NotFoundException before anything exists that would have created it. The
       * AWS-owned key has no such bootstrap problem and no monthly key charge.
       */
      encryption: TableEncryptionV2.dynamoOwnedKey(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Years of receipts should not evaporate because a stack was torn down.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const photos = new Bucket(this, 'Photos', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      lifecycleRules: [
        {
          id: 'delete-photos-after-retention',
          enabled: true,
          expiration: Duration.days(props.photoRetentionDays),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      cors: [
        {
          // Needed because the browser uploads straight to S3 with a presigned URL.
          allowedOrigins: [props.siteOrigin, 'http://localhost:5173'],
          allowedMethods: [HttpMethods.PUT, HttpMethods.GET, HttpMethods.HEAD],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    /* ---------------------------------------------------------------------
     * The API
     * ------------------------------------------------------------------ */

    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
        identitySource: ['$request.header.Authorization'],
      },
    );

    const api = new HttpApi(this, 'Api', {
      apiName: 'bill-analyser',
      corsPreflight: {
        allowOrigins: [props.siteOrigin, 'http://localhost:5173'],
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Authorization', 'Content-Type'],
        maxAge: Duration.hours(1),
      },
      // Every route below attaches the JWT authorizer explicitly. Requests without a
      // valid token are rejected by API Gateway and never reach a Lambda.
      defaultAuthorizer: authorizer,
    });

    const commonEnvironment = {
      TABLE_NAME: table.tableName,
      PHOTO_BUCKET: photos.bucketName,
      BEDROCK_MODEL_ID: props.bedrockModelId,
      // Trims cold starts by skipping the SDK's slow path for reusing connections.
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
    };

    const makeHandler = (name: string, file: string, timeout: Duration) =>
      new NodejsFunction(this, name, {
        entry: join(handlerDir, file),
        handler: 'handler',
        runtime: Runtime.NODEJS_22_X,
        architecture: Architecture.ARM_64,
        memorySize: 512,
        timeout,
        environment: commonEnvironment,
        // Logs are for debugging a bad parse, not an audit trail, and they can quote
        // receipt contents - so they expire rather than accumulating indefinitely.
        logGroup: new LogGroup(this, `${name}Logs`, {
          retention: RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
        bundling: {
          /*
           * CommonJS, not ESM.
           *
           * Bundling to ESM rewrites the CommonJS dependencies underneath, and any
           * require() esbuild cannot resolve statically becomes a shim that throws
           * "Dynamic require of X is not supported" the moment the module loads.
           * Parts of the AWS SDK's dependency tree do exactly that. It fails at
           * init, before any handler code runs, so it surfaces as API Gateway's bare
           * "Internal Server Error" with an empty-looking log.
           *
           * Nothing here needs ESM, and CommonJS is what the runtime wants anyway.
           */
          target: 'node22',
          minify: true,
          sourceMap: true,
          /*
           * Bundle everything, including the AWS SDK.
           *
           * NodejsFunction leaves `@aws-sdk/*` out of the bundle by default, because
           * the older Lambda Node runtimes shipped the SDK and importing the
           * provided copy kept deployments small. The Node 22 runtime does not ship
           * it. Left on the default, every handler here imports a module that is not
           * there and dies at cold start - which surfaces as API Gateway's bare
           * "Internal Server Error", with nothing in the handler's own logs, because
           * the failure happens before any of its code runs.
           */
          externalModules: [],
        },
      });

    /*
     * Reading a receipt is split in two. API Gateway will not hold an integration
     * open beyond 30 seconds whatever the Lambda's own timeout says, and a model
     * reading a photographed receipt can comfortably take longer - so the part
     * behind the API only records the job and returns, and the worker, which nothing
     * is waiting on, takes as long as it needs.
     */
    const parseWorkerFn = makeHandler('ParseWorkerFn', 'parse-worker.ts', Duration.minutes(5));
    const parseFn = makeHandler('ParseFn', 'parse.ts', Duration.seconds(15));
    const receiptsFn = makeHandler('ReceiptsFn', 'receipts.ts', Duration.seconds(30));
    const categoriesFn = makeHandler('CategoriesFn', 'categories.ts', Duration.seconds(15));
    const rulesFn = makeHandler('RulesFn', 'rules.ts', Duration.seconds(15));
    const uploadsFn = makeHandler('UploadsFn', 'uploads.ts', Duration.seconds(15));

    table.grantReadWriteData(receiptsFn);
    table.grantReadWriteData(categoriesFn);
    table.grantReadWriteData(rulesFn);
    table.grantReadWriteData(parseFn);
    table.grantReadWriteData(parseWorkerFn);

    photos.grantPut(uploadsFn);
    photos.grantRead(uploadsFn);
    photos.grantRead(parseWorkerFn);

    // The only thing the API-facing half may do beyond writing the receipt row.
    parseWorkerFn.grantInvoke(parseFn);
    parseFn.addEnvironment('PARSE_WORKER_FUNCTION', parseWorkerFn.functionName);

    /*
     * Bedrock serves newer Claude models through regional inference profiles
     * (`eu.anthropic.…`) rather than a bare foundation model id, and invoking through
     * a profile needs permission on both the profile and the underlying models in
     * every region it may route to. Naming only this region's foundation model ARN
     * works for a direct model id and then fails confusingly the moment a profile id
     * is used - so both forms are granted, still scoped to Anthropic models rather
     * than opened up to "*".
     */
    /*
     * The Messages-API endpoint on Bedrock ("Mantle") authorises under its own
     * service namespace: bedrock-mantle:CreateInference against a project, not
     * bedrock:InvokeModel against a model ARN. Granting only the latter produces a
     * 403 naming an action that does not appear anywhere in the policy, which reads
     * like a typo rather than a wrong service.
     */
    parseWorkerFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock-mantle:CreateInference'],
        /*
         * Resource "*", deliberately, after the scoped form did not work.
         *
         * Granting this against `arn:aws:bedrock-mantle:<region>:<account>:project/*`
         * - which is the resource the 403 itself names, and which that wildcard
         * matches - was still refused with "no identity-based policy allows the
         * bedrock-mantle:CreateInference action". That is the signature of an action
         * that does not support resource-level permissions: the statement simply
         * never matches, whatever ARN is written. Newer services often launch that
         * way while still echoing the resource in the denial message.
         *
         * The breadth is bounded by the action rather than the resource: this grants
         * exactly one operation, on a service whose only use here is reading
         * receipts. Worth re-scoping if AWS documents resource-level support later.
         */
        resources: ['*'],
      }),
    );

    // The legacy InvokeModel path, kept so switching to the non-Mantle Bedrock
    // client stays a one-line change rather than an IAM archaeology exercise.
    parseWorkerFn.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
          `arn:aws:bedrock:*:${this.account}:inference-profile/*.anthropic.*`,
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${props.bedrockModelId}`,
        ],
      }),
    );

    const route = (path: string, methods: HttpMethod[], fn: NodejsFunction, name: string) =>
      api.addRoutes({
        path,
        methods,
        integration: new HttpLambdaIntegration(name, fn),
      });

    route('/categories', [HttpMethod.GET, HttpMethod.POST], categoriesFn, 'CategoriesList');
    route('/categories/order', [HttpMethod.POST], categoriesFn, 'CategoriesOrder');
    route('/categories/{id}', [HttpMethod.PATCH, HttpMethod.DELETE], categoriesFn, 'CategoriesItem');

    route('/receipts', [HttpMethod.GET], receiptsFn, 'ReceiptsList');
    route('/receipts/{id}', [HttpMethod.GET, HttpMethod.PATCH, HttpMethod.DELETE], receiptsFn, 'ReceiptsItem');
    route('/receipts/{id}/confirm', [HttpMethod.POST], receiptsFn, 'ReceiptsConfirm');
    route('/receipts/{id}/image-url', [HttpMethod.GET], uploadsFn, 'ReceiptsImageUrl');

    route('/uploads', [HttpMethod.POST], uploadsFn, 'UploadsCreate');
    route('/parse', [HttpMethod.POST], parseFn, 'Parse');

    route('/rules', [HttpMethod.GET], rulesFn, 'RulesList');
    route('/rules/{id}', [HttpMethod.DELETE], rulesFn, 'RulesItem');

    /* ---------------------------------------------------------------------
     * What the web app needs to know
     *
     * All four are public identifiers, not credentials: they end up in the
     * JavaScript bundle either way. What protects the data is the login.
     * ------------------------------------------------------------------ */

    new CfnOutput(this, 'ApiBaseUrl', { value: api.apiEndpoint, description: 'VITE_API_BASE_URL' });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId, description: 'VITE_COGNITO_USER_POOL_ID' });
    new CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'VITE_COGNITO_CLIENT_ID',
    });
    new CfnOutput(this, 'CognitoDomain', {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'VITE_COGNITO_DOMAIN',
    });
    new CfnOutput(this, 'CreateUserConsoleLink', {
      value: `https://${this.region}.console.aws.amazon.com/cognito/v2/idp/user-pools/${userPool.userPoolId}/users`,
      description: 'Where to create your login',
    });

    // Cognito rejects an auth request whose redirect_uri is not listed above, so a
    // mismatch between SITE_ORIGIN and where the app is actually served shows up as
    // a login failure. Surfacing it makes that easy to check.
    new CfnOutput(this, 'ExpectedAppUrl', {
      value: appUrl,
      description: 'The app URL this stack was deployed for. Login fails if it differs.',
    });
  }
}
