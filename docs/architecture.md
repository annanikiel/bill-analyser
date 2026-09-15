# Architecture

## The shape of it

```
  Phone / laptop
        │
        │  https
        ▼
  GitHub Pages ──────────────►  static files only (HTML, JS, CSS)
  (public repo)                 no data, no credentials
        │
        │  fetch, with a Cognito JWT in the Authorization header
        ▼
  API Gateway (HTTP API)  ──►  JWT authorizer validates the token
        │                       against the Cognito user pool
        ▼
  Lambda  ────────────────┬──►  DynamoDB   (receipts, categories, rules)
                          ├──►  S3          (receipt photos, private)
                          └──►  Bedrock     (Claude reads the photo)
```

Two things are worth stating plainly, because they are the whole security answer:

1. **The public repository contains no data and no secrets.** It contains the app's
   source. The built app contains a Cognito user pool id and an API URL, which are
   public identifiers, not credentials — the same way a front door number is not a key.
2. **Every byte of spending data lives in AWS, behind a login that only you have.**
   Someone who finds the repository can read the code and open the app. They cannot
   sign in, and every API route refuses an unauthenticated request.

## Why GitHub Pages is fine here

The concern with a public repo is usually "will my data end up in it". It cannot:
the deployed bundle is built from `packages/web`, which never sees a receipt. Data
only enters the picture at runtime, after a login, and goes straight to AWS.

What *is* public: the app's HTML/JS/CSS, and the configuration compiled into it.
That configuration is deliberately limited to identifiers that are safe to publish.
Anything that must stay secret (AWS keys, the Bedrock call, the DynamoDB table name)
lives server-side in Lambda, which the browser never talks to directly.

If you would rather the app itself not be publicly reachable, the alternative is
S3 + CloudFront with the same Cognito login in front of it. That costs a few pence
a month instead of nothing, and buys obscurity rather than security — the login is
what actually protects the data either way.

## Authentication

**Amazon Cognito user pool, with self-registration disabled.**

That last part is the important setting. A Cognito pool with open sign-up would let
anyone who found the app create an account — they would see none of your data, since
every record is scoped to a user id, but they would be using your Lambda and your
Bedrock quota. With self-registration off, accounts exist only when you create one
from the console or the CLI.

- Sign-in issues a short-lived JWT (1 hour) plus a refresh token.
- API Gateway validates the JWT itself, before Lambda is invoked. An unauthenticated
  request never reaches your code and never costs you a Lambda invocation.
- Turn on MFA. It is a few clicks in the pool settings and it is the difference
  between a password leak being an inconvenience and being a breach.

**The user id comes from the token, never from the request.** Every handler reads
`event.requestContext.authorizer.jwt.claims.sub` and uses that as the partition key.
It never accepts a user id from the body or the path. This is the single rule that
makes the data model safe: even a bug in a handler cannot read another user's data,
because there is no code path where the caller chooses whose data to touch.

## Data model

One DynamoDB table, on-demand billing, encrypted at rest.

That encryption is unconditional — DynamoDB encrypts every table, and the only
choice is which key. This uses the AWS-owned key, which costs nothing and has no
setup. The AWS-managed `aws/dynamodb` key is the tempting upgrade, since it adds
CloudTrail visibility of key use, but AWS creates that key lazily on first use in a
region: asking a brand new account for it fails with a KMS `NotFoundException`
before anything exists that would have created it. A customer-managed key is the
option worth taking if you ever want the audit trail, and it has to be created
alongside the table rather than assumed to exist.

| PK | SK | Item |
|---|---|---|
| `USER#<sub>` | `RECEIPT#<YYYY-MM-DD>#<receiptId>` | A receipt, with its line items embedded |
| `USER#<sub>` | `CATEGORY#<categoryId>` | A category |
| `USER#<sub>` | `RULE#<matchKey>` | A learned item → category mapping |

Line items are embedded in the receipt document rather than stored as separate rows.
A grocery receipt is at most a few dozen lines and well under the 400KB item limit,
and it means reading a receipt is one request and writing an edit is one atomic put —
there is no state where half a receipt has been saved.

**Date ranges come for free.** Because the sort key starts with the ISO date, a
summary for a period is a single `Query` with `BETWEEN` on the sort key. No scans,
no secondary index, no date filtering in application code.

Rules are keyed by the normalised item text (see `packages/shared/src/matching.ts`),
so looking up "have I categorised this before?" is a direct `GetItem`.

## Receipt photos

- Private S3 bucket, all public access blocked, encrypted at rest.
- The browser never gets credentials. It asks the API for a **presigned PUT URL**,
  uploads straight to S3, and the API records the key.
- Displaying a photo works the same way in reverse: a short-lived presigned GET,
  minted only after the JWT has been checked and the key confirmed to belong to
  the calling user.
- Keys are `receipts/<sub>/<receiptId>.jpg`. The user id in the path is belt and
  braces — the ownership check is the authoritative one.
- A lifecycle rule moving photos to Glacier after a year keeps storage at pennies.
  You can also drop the photo entirely once a receipt is confirmed, if you would
  rather not keep images at all; the parsed data is what the summaries use.

The app downscales photos to 2000px before upload. A 12MP phone photo is around 4MB
and no more readable than the resized one once the text is in focus, so this cuts
upload time on a phone signal and reduces per-image model cost.

## Reading the receipt

**Claude via Amazon Bedrock**, one call that does OCR, item extraction and
categorisation together.

The reason to do it in one call rather than OCR-then-classify is that grocery
receipts are written in a private language — `TESCO SEMI SKIM MLK 2PT`,
`WALKERS CHS ON 6PK`. A dedicated OCR service returns those strings faithfully and
has no idea what they mean; a keyword layer on top of them is exactly the brittle
thing you do not want to maintain. A model that can read the abbreviation, expand it
to "semi-skimmed milk, 2 pints" and place it in *your* categories does the whole job,
and gets better at the long tail rather than needing a new rule each time.

Setup notes:

- Use the Mantle Bedrock client (`AnthropicBedrockMantle` in the Anthropic SDK), not
  the legacy `bedrock-runtime` InvokeModel path.
- Bedrock model ids take an `anthropic.` prefix: `anthropic.claude-opus-5`.
- Model access has to be enabled for your account in the Bedrock console, per region.
  Check which region has it before picking one; for UK data residency London or
  Ireland are the obvious candidates, but confirm availability rather than assuming.
- Keep the model id in an environment variable. Swapping to a cheaper model is then
  a config change, not a deployment.

### What the model is asked for

The prompt carries three things: the image, the user's current category list **with
their hints** (which is why editing a hint in the app immediately changes how new
receipts are read), and a request for structured JSON:

```jsonc
{
  "merchant": "Tesco Extra",
  "purchasedAt": "2026-09-15",
  "currency": "GBP",
  "totalMinor": 2773,          // integer pence, never a float
  "items": [
    {
      "rawText": "TESCO SEMI SKIM MLK 2PT",  // verbatim, for rule matching and audit
      "name": "Semi-skimmed milk, 2 pints",  // the expansion
      "quantity": 1,
      "totalMinor": 145,
      "categoryId": "cat_…",
      "confidence": 0.96
    }
  ]
}
```

Use structured outputs (`output_config.format`) so the response is schema-valid by
construction rather than parsed hopefully.

**Rules are applied before the model's guesses are accepted.** An item the user has
already corrected is settled by a DynamoDB lookup — free, instant, and not subject
to the model changing its mind. Only genuinely new items depend on the guess.

### Cost

Roughly a few pence per receipt: a receipt image is on the order of 1,500 input
tokens and the JSON reply under 1,000 output tokens. At first-party Opus 5 rates
($5 / $25 per million) that is about 2p. **Bedrock is billed separately from the
Anthropic API and its rates differ** — check the Bedrock pricing page for your
region rather than taking that figure as exact. Everything else (Lambda, DynamoDB
on-demand, S3, API Gateway at this volume) sits inside or near the free tier.

If per-receipt cost matters more than getting the awkward ones right, the model id
is an environment variable; a smaller model will be cheaper and somewhat worse at
cryptic abbreviations.

## How the app learns

This is deliberately not machine learning. It is a lookup table the user controls.

1. While reviewing a receipt, changing an item's category marks that line
   `source: 'user'`.
2. Confirming the receipt turns each such correction into a rule, keyed by the
   normalised item text.
3. The next receipt containing that item gets the category applied before the model
   is consulted, and the item is tagged "Remembered" in the UI.

Accepting a guess by saying nothing does **not** create a rule. Agreement is weaker
evidence than correction, and promoting every accepted guess to a rule would freeze
the model's mistakes in place where they could never be revised.

Every rule is visible and deletable on the Categories screen, so the behaviour is
never mysterious — you can see exactly why something was categorised the way it was.

## What is built

All of it. The front end, the AWS stack, the handlers, and the model call.

- `packages/shared` — the domain model and logic: money arithmetic, date bucketing,
  summary aggregation, item-text normalisation and rule derivation. Unit tested, and
  imported by both the browser and the Lambda handlers, so the rule the app predicts
  and the rule the server writes cannot drift apart.
- `packages/web` — the React app, Cognito sign-in, and two interchangeable backends
  (`MockApiClient` for demo data, `HttpApiClient` for the real one) behind one
  interface.
- `packages/infra` — the CDK stack and the Lambda handlers, with tests that assert
  the security properties below rather than trusting the source to still say what it
  said.

`docs/setup.md` is the click-by-click deployment guide. Nothing in it needs a terminal.

### The infrastructure tests

`packages/infra/lib/stack.test.ts` synthesises the stack and asserts the claims this
document makes — that self-registration is off, that every route carries the JWT
authorizer, that the photo bucket blocks public access and refuses plaintext, that
photos expire, that the Bedrock permission names one model rather than `*`, and that
the data stores survive a stack deletion. They run in CI on every change.

This matters more than the usual test: a security property that is quietly weakened
by an unrelated refactor produces no failing feature and no error, just a system that
is no longer what its documentation says it is.

### Where demo mode comes from

The app is built without backend configuration unless a deployed stack is found, and
in that state it runs entirely in the browser on generated sample data. That is not a
leftover scaffold — it is what makes the repository useful to clone, what the Pages
site serves before AWS exists, and what the UI can be developed against without
spending anything.

## Possible next steps

None of these are needed for the app to do its job.

- **Server-side summaries.** Right now the browser fetches the receipts and
  aggregates locally, which keeps range changes instant and guarantees every figure
  on screen comes from one consistent snapshot. Past a few years of receipts the
  initial fetch would be worth moving to a Lambda that returns the aggregate — the
  aggregation function is already shared, so it would move unchanged.
- **A written record of what the model got wrong.** The confidence score is captured
  per item but never looked at afterwards. Comparing it against which items you
  actually corrected would say whether the model's uncertainty is honest, and whether
  the low-confidence threshold in the review screen is set in the right place.
- **Multiple people.** The data model is already partitioned by user id, so a second
  login needs no migration. A *shared household view* would be a real change: it
  needs a notion of a household that owns receipts, rather than a person.
