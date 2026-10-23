# Shutting it down

Three options, in increasing order of finality. Read the first two before assuming
you want the third.

Everything here is done in a web browser. Work top to bottom — the order matters,
because revoking credentials first means nothing can run up a bill while you are
still clicking through the rest.

---

## First: do you want your data?

There is no export. Your receipts, categories and learned rules live in DynamoDB,
and deleting the stack deletes them. If you want them, get them out **before** you
start — nothing below is reversible.

---

## Option A: mothball it

If what you actually want is to stop paying for something you are not using, you do
not need to delete anything.

At one user and no traffic, almost all of this is already free: DynamoDB on-demand
bills per request, idle Lambdas bill nothing, Cognito is free at this scale, and the
photos delete themselves after 30 days.

**The only meaningful ongoing cost is Secrets Manager — around $0.40 a month per
secret.** So:

1. **Revoke the Anthropic API key** (see Option C step 1). This stops all model spend
   and is worth doing even if you keep everything else.
2. **Delete the secret** holding it: Secrets Manager → `bill-analyser/anthropic-api-key`
   → **Actions** → **Delete secret**. Do this in *every* region you ever deployed to.

The app stays up, your data stays, your login stays, and scanning stops working until
you put a key back. Cost drops to roughly nothing. This is the reversible option.

---

## Option B: keep the data, delete the infrastructure

Export first (see above), then follow Option C. The data lives in the DynamoDB table,
which survives stack deletion by design — so you can also just leave that one table
alone and delete everything else.

---

## Option C: full decommission

### 1. Revoke the API key — do this first

[console.anthropic.com](https://console.anthropic.com/) → **API keys** → delete the
`bill-analyser` key.

This matters more than any deletion below. That key is a live credential and it
exists in at least one AWS secret, possibly two if the London stack was ever created.
Deleting a secret does not revoke the key; only this does. While you are there,
remove the payment method if you have no other use for the account.

### 2. Delete the CloudFormation stacks

AWS console → **CloudFormation**. For **each region you deployed to** — check Ireland
`eu-west-1` and London `eu-west-2`, since both were used at different points:

1. Delete the **`BillAnalyser`** stack.
2. Delete the **`CDKToolkit`** stack. This is the one-off scaffolding `cdk bootstrap`
   created. It will refuse to delete until its bucket is empty — see step 3.

### 3. Delete what the stack deliberately left behind

Four resources are marked *Retain* so that a mistyped stack operation could never
destroy years of receipts. That protection now works against you: they survive the
delete and have to go by hand. **In each region:**

| Service | What to delete | Note |
|---|---|---|
| **DynamoDB** | Table starting `BillAnalyser-Table` | Your receipts. Gone for good. |
| **S3** | Bucket starting `billanalyser-photos` | **Empty** it first, then delete |
| **S3** | Bucket starting `cdk-hnb659fds-assets-` | CDK's upload area; empty, then delete |
| **Cognito** | User pool `bill-analyser` | Your login |
| **Secrets Manager** | `bill-analyser/anthropic-api-key` | See below |

**Secrets Manager will not delete immediately.** It schedules deletion with a
recovery window of 7 to 30 days. Set the window to its minimum, or tick *Delete
immediately* if offered. The key itself is already dead if you did step 1, so the
wait is harmless.

**ECR**: if a repository starting `cdk-hnb659fds-container-assets-` exists, delete it
too. It may not — this project never used container images.

### 4. Delete the AWS credentials

**IAM → Users →** `bill-analyser-deploy` → delete. This removes the access keys with
it. If you also set up the OIDC route earlier:

- **IAM → Roles →** `github-bill-analyser` → delete
- **IAM → Identity providers →** `token.actions.githubusercontent.com` → delete, but
  **only if nothing else uses it**. It is shared across repositories, so if you ever
  connect another one, leave it.

### 5. Clean up GitHub

Repository → **Settings → Secrets and variables → Actions**:

- **Secrets tab**: delete `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. These are
  live AWS credentials; deleting the IAM user in step 4 already defanged them, but
  leaving them lying around is untidy and invites confusion later.
- **Variables tab**: delete `AWS_ROLE_ARN` and `AWS_REGION`.

Then **Settings → Pages** → set the source to **None**, which takes the site down.

### 6. The repository itself

Worth a moment's thought rather than reflex deletion. It contains a working reference
for Cognito auth, presigned uploads, async Lambda work behind an API Gateway timeout,
and a setup guide documenting a dozen traps that cost real hours to find. That has
value independent of whether you track groceries.

- **Keep it** — costs nothing, and the front end still runs on demo data for anyone
  who clones it.
- **Archive it** — Settings → General → Archive. Read-only, clearly finished.
- **Delete it** — Settings → General → Delete. Permanent.

---

## Afterwards

Check **Billing → Bills** in a few days. Charges lag by up to a day, so a zero right
after deletion does not prove much. If you set a budget alert earlier, delete that too
once the bill settles, or it will keep emailing you about a budget for a thing that no
longer exists.
