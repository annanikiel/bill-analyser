# Setting it up

Everything here is done in a web browser — the AWS console and the GitHub website.
There is no command line at any point.

Work through it in order; each step depends on the one before. Budget about half an
hour the first time. AWS moves its console around periodically, so if a button has
been renamed, the thing you are looking for is still there under a similar name.

---

## 1. Turn on GitHub Pages

1. Go to the repository on GitHub → **Settings** → **Pages** (left sidebar).
2. Under **Source**, choose **GitHub Actions**.

Nothing else. You do not need to pick a branch.

**Check it worked:** go to the **Actions** tab, run **Deploy web app to GitHub
Pages** (left sidebar → the workflow name → **Run workflow**). When it finishes, the
app is live at `https://<your-username>.github.io/bill-analyser/`, running on demo
data. The run summary will say "Published in demo mode", which is correct at this
stage — there is no backend yet.

---

## 2. Let GitHub deploy to your AWS account

GitHub needs permission to create things in your AWS account. The good way to do this
gives GitHub no password at all: AWS is told to trust GitHub for this one repository,
and hands out a credential that expires in minutes.

### 2a. Tell AWS to trust GitHub

1. AWS console → **IAM** → **Identity providers** (left sidebar) → **Add provider**.
2. Choose **OpenID Connect**.
3. **Provider URL:** `https://token.actions.githubusercontent.com` → click
   **Get thumbprint**.
4. **Audience:** `sts.amazonaws.com`
5. **Add provider**.

### 2b. Create the role GitHub will use

1. IAM → **Roles** → **Create role**.
2. **Trusted entity type:** *Web identity*.
3. **Identity provider:** the `token.actions.githubusercontent.com` one you just made.
   **Audience:** `sts.amazonaws.com`.
4. Fill in **GitHub organization** = your GitHub username, **Repository** =
   `bill-analyser`, **Branch** = `main`. → **Next**
5. **Permissions:** tick **AdministratorAccess**. → **Next**
6. **Role name:** `github-bill-analyser` → **Create role**.
7. Open the role you just created and copy the **ARN** at the top. It looks like
   `arn:aws:iam::123456789012:role/github-bill-analyser`.

> **About AdministratorAccess.** This role can do anything in the account, so it is
> worth knowing exactly who can use it: only workflow runs on the `main` branch of
> this one repository, which means only someone who can write to the repository.
> Nobody who merely *reads* your public repo, and nobody opening a pull request from
> a fork, can reach it. Creating this stack genuinely needs broad permissions —
> it makes IAM roles, a Cognito pool and a CloudFormation stack — and the
> narrower policy that would cover it exactly is long, fragile, and a common
> way to get stuck. If you would rather tighten it later, you can: the role is only
> used by these two workflows.
>
> **If you deploy from a branch other than `main`,** the role will refuse it. Either
> merge to `main` first, or add the other branch under the role's **Trust
> relationships** tab.

### 2c. Give the ARN to GitHub

1. Repository → **Settings** → **Secrets and variables** → **Actions**.
2. The **Variables** tab (*not* Secrets — this is an identifier, not a password).
3. **New repository variable**: name `AWS_ROLE_ARN`, value = the ARN you copied.
4. Add a second variable: name `AWS_REGION`, value `eu-west-2`.

---

## 3. Check Claude works in Bedrock, and note its id

AWS used to require you to tick a box on a "Model access" page. **That page has been
retired** — serverless models now enable themselves the first time they are invoked,
so there is nothing to switch on.

Two things still need doing, and skipping them means the deploy succeeds and then
scanning a receipt fails, which is a much more annoying way to find out.

### 3a. Invoke Claude once, by hand

The retirement notice carries a caveat: *for Anthropic models, first-time users may
need to submit use case details before they can access the model.* That form is
easiest to deal with now, deliberately, rather than from inside a failing Lambda.

1. Check the region selector (top right) says **Europe (London) eu-west-2**.
2. **Amazon Bedrock** → **Playground** (under *Test* in the left sidebar).
3. Pick a **Claude** model, type anything, and send it.
4. If a use case form appears, fill it in. It is a short form about what you are
   building; approval is normally immediate.

When you get a reply back, Bedrock is working in your account and region. That is the
whole point of this step.

### 3b. Find a model your account can actually use

**Bedrock gates its newest flagship models per AWS account.** A personal account will
commonly be refused the current generation while the previous one works fine. The
refusal is unmistakable:

> `AccessDeniedException: anthropic.claude-opus-5 is not available for this account.`
> `For additional access options, contact AWS Sales…`

Note the wording — *not available for this account*, rather than *not authorized to
perform*. That is an entitlement decision above IAM, and it affects other vendors'
flagship models on the same account too, so it is not about Anthropic specifically
and not something the use case form in 3a changes.

So: in the **Playground**, work down from newest until one answers. If Opus 5 is
refused, try **Opus 4.5**; if the newest Sonnet is refused, try the one before it.
The app works well on either.

### 3c. The model id to use

**Do not copy the id from the model catalogue or the Playground.** This is the one
place the console will actively mislead you, and it cost a long detour here.

Bedrock has two model-naming schemes, for two different endpoints:

| Endpoint | Model id looks like | Where you see it |
|---|---|---|
| `bedrock-runtime` (InvokeModel / Converse) | `eu.anthropic.claude-opus-4-5-20251101-v1:0`, or an `inference-profile/...` ARN | The Playground, the model catalogue, "View API request" |
| **The Messages API endpoint** — what this app uses | `anthropic.claude-opus-4-5` | Nowhere in the console |

The console only ever shows you the first kind, because that is what the console
itself uses. Passing one of those to this app gives:

> `404 ... The model 'arn:aws:bedrock:...:inference-profile/eu.anthropic.claude-opus-4-5-20251101-v1:0' does not exist`

So use the **second** form: the plain Anthropic model name with an `anthropic.`
prefix, no region prefix, no date, no `-v1:0`.

| Model | Use this |
|---|---|
| Claude Opus 4.5 | `anthropic.claude-opus-4-5` |
| Claude Sonnet 4.5 | `anthropic.claude-sonnet-4-5` |
| Claude Haiku 4.5 | `anthropic.claude-haiku-4-5` |
| Claude Opus 5, once your account is allowed it | `anthropic.claude-opus-5` |

The workflow already defaults to `anthropic.claude-opus-4-5`, so in most cases you
change nothing. Step 3a still matters — it is what tells you *which* model your
account may use; it just is not where the id comes from.

## 4. Create the infrastructure

1. Repository → **Actions** tab.
2. **Deploy AWS infrastructure** in the left sidebar → **Run workflow**.
3. Check the region matches what you chose. Leave the **model** box at its default
   `anthropic.claude-opus-4-5` unless step 3a showed that model is not available to
   you, in which case use the matching name from the table in 3c. Leave the retention
   as it is. → **Run workflow**.

It takes roughly 5–10 minutes, mostly creating the Cognito pool.

**Check it worked:** open the finished run. The summary at the bottom lists the API
address, your user pool, and a link straight to the page where you create your login.

If it fails, the failing step names the problem. The two common ones are the role ARN
being wrong (step 2c) and the trust policy naming a different branch (step 2b).

---

## 5. Create your login

Nobody can sign up for this app — that is deliberate, and it is why a stranger
finding your public repository cannot create an account. So you have to create your
own.

1. Use the Cognito link from the run summary, or: AWS console → **Cognito** →
   **User pools** → **bill-analyser** → **Users** → **Create user**.
2. **Email address:** yours. Tick **Mark email address as verified**.
3. **Temporary password:** choose **Generate a password** and have it emailed, or set
   one yourself. You will be made to change it at first sign-in either way.
4. **Create user**.

### Turn on two-factor

Worth the two minutes — it is the difference between a leaked password being an
annoyance and being a problem.

1. Same user pool → **Sign-in** tab → **Multi-factor authentication** → **Edit**.
2. Set it to **Require MFA**, with **Authenticator apps** ticked. → **Save changes**.

Cognito will then walk you through pairing your authenticator app the next time you
sign in.

---

## 6. Publish the app against the real backend

1. **Actions** → **Deploy web app to GitHub Pages** → **Run workflow**.

This one reads the API address and login settings straight out of the stack you just
created, so there is nothing to copy across. The run summary should now say
"Published against the deployed AWS backend" rather than "demo mode".

Open `https://<your-username>.github.io/bill-analyser/` on your phone. You should get
a **Sign in** button rather than sample receipts.

---

## 7. Use it

Sign in with the email and temporary password from step 5, set a real password when
asked, and pair your authenticator app. Then scan a receipt.

The first receipt is the one to watch: check the line items against the paper, fix
any categories that are wrong, and confirm it. Those corrections become rules, so the
second receipt from the same shop should need noticeably less work than the first.

**Add the app to your home screen** so it opens like an app rather than a tab: in
Safari, Share → *Add to Home Screen*; in Chrome, the ⋮ menu → *Add to Home screen*.

---

## When something goes wrong

**"Sign in" does nothing, or Cognito shows an error about redirect_uri.**
The URL you are visiting does not exactly match what the stack registered. The run
summary from step 4 lists `ExpectedAppUrl` — compare it to your address bar, watching
for a missing trailing slash or a capital letter in your username. Re-run step 4 if
they differ.

**A fix was deployed but nothing changed.**
Check you started a *fresh* run rather than re-running an old one. In the Actions
tab, **Re-run jobs** replays that run's original commit — so anything merged since is
silently left out, the deploy succeeds, and the old code stays live. Always go to the
workflow in the left sidebar and use the **Run workflow** button. The deploy now
refuses to run if it is not on the current `main`, and says so.

**Scanning fails with a message about reading the receipt.**
Look at AWS console → **CloudWatch** → **Log groups** → the group with `ParseFn` in
its name. The most recent entry says plainly what happened. The two usual causes are
both from step 3. A model id in the console's `bedrock-runtime` form — anything with
a region prefix, a date, a `-v1:0` suffix or an ARN — gives *"The model ... does not
exist"*; use the `anthropic.`-prefixed name from the table in 3c instead. A model your
account is not entitled to gives *"is not available for this account"*; pick one that
answered in the Playground. Both are fixed by re-running step 4 with a corrected id.

**The app shows demo data even though the backend is deployed.**
The Pages build could not find the stack. Check `AWS_ROLE_ARN` and `AWS_REGION` are
set as *variables* (step 2c) and that the region matches where you deployed.

**You get signed out constantly.**
Expected if your browser is set to clear site data on close — the app keeps your
session in local storage. Private browsing does the same.

---

## What it costs

At personal volume — a few receipts a week — this sits within or near the AWS free
tier for everything except the model call.

| | Roughly |
|---|---|
| Reading a receipt | A few pence each. This is nearly the whole bill. |
| Lambda, API Gateway, DynamoDB, S3 | Pennies a month at this volume |
| Cognito | Free at one user |

Bedrock is billed separately from the Anthropic API and at its own rates, so treat
"a few pence" as the right order of magnitude rather than an exact figure — check the
Bedrock pricing page for your region. If it matters, re-run step 4 with a Sonnet or Haiku
id from the catalogue: cheaper, and somewhat worse at the cryptic abbreviations on
supermarket receipts, which is the thing the model is really there for.

**To set a hard limit:** AWS console → **Billing** → **Budgets** → create a monthly
budget of a few pounds with an email alert. Worth doing regardless.

## Taking it down

Delete the CloudFormation stack (**CloudFormation** → **BillAnalyser** → **Delete**).
The receipt table, the photo bucket and your user pool are all marked *Retain*, so
they deliberately survive — a mistyped stack operation should not take years of
receipts with it. Delete those three by hand afterwards if you really want them gone.
