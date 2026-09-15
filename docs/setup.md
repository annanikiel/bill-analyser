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
4. Add a second variable: name `AWS_REGION`, value `eu-west-1` (Ireland) or
   `eu-west-2` (London) — whichever you want your data in.

> **This one variable decides the region for everything**, and both deploy workflows
> read it. That is deliberate: when the region was chosen per-deploy instead, picking
> a different one quietly built a second complete stack somewhere else and left the
> app talking to the first. Both deploys reported success. Change it only if you mean
> to move, and expect to migrate your data and login if you do.

---

## 3. Get an Anthropic API key

The app reads receipts by calling the Anthropic API directly.

It originally went through Amazon Bedrock, which would have kept everything inside
one AWS account and one bill. That did not work out: Bedrock withheld the newest
Claude models from this account entirely, and the ones it did offer returned *"the
model does not exist"* for every id AWS documents. Calling the API directly has none
of that ambiguity. The trade is that model usage is billed by Anthropic rather than
appearing on your AWS bill, and that there is now one secret to look after.

1. Go to the [Anthropic Console](https://console.anthropic.com/) and sign up or sign in.
2. **API keys** → **Create key**. Name it `bill-analyser`.
3. Copy it now — the console will not show it again.
4. Add some credit under **Billing**. A few pounds lasts a long time at a few pence
   per receipt.

**Do not put the key in GitHub, and do not paste it into the workflow.** It goes into
AWS Secrets Manager in step 5, after the infrastructure that holds it exists. Nothing
in this repository ever contains it.

### Which model

Leave the deploy workflow's **model** box at `claude-opus-5`.

If you paste a Bedrock-style id — anything starting `anthropic.`, carrying a region
prefix, or ending `-v1:0` — the deploy refuses it with an explanation. The Anthropic
API uses plain names: `claude-opus-5`, `claude-opus-4-5`, `claude-sonnet-5`,
`claude-haiku-4-5`.

## 4. Create the infrastructure

1. Repository → **Actions** tab.
2. **Deploy AWS infrastructure** in the left sidebar → **Run workflow**.
3. Leave the **model** box at its default `claude-opus-5` and the retention as it is.
   → **Run workflow**. The region comes from the `AWS_REGION` variable, not from this
   form, so there is nothing to keep in sync by hand.

It takes roughly 5–10 minutes, mostly creating the Cognito pool.

**Check it worked:** open the finished run. The summary at the bottom lists the API
address, your user pool, and a link straight to the page where you create your login.

If it fails, the failing step names the problem. The two common ones are the role ARN
being wrong (step 2c) and the trust policy naming a different branch (step 2b).

---

## 5. Set the API key, and create your login

### 5a. Paste in the API key

The stack created an empty secret for it. Until you fill it in, scanning fails with a
message saying exactly that.

1. Use the **SetApiKeyConsoleLink** from the run summary in step 4, or: AWS console →
   **Secrets Manager** → **bill-analyser/anthropic-api-key**.
2. **Retrieve secret value** → **Edit**.
3. Replace `replace-me-with-your-anthropic-api-key` with the key from step 3.
   Use the **Plaintext** tab and make sure the key is the entire contents — no quotes,
   no braces, no trailing spaces.
4. **Save**.

The key is only ever read by the worker Lambda, at the moment it reads a receipt.

### 5b. Create your login

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

**Everything deploys fine but the app behaves as though it did not.**
Check the region. The run summary prints it; compare it against the `AWS_REGION`
variable and against where your data actually is (CloudFormation → your stack). A
stack in the wrong region is a complete, healthy, entirely unused copy of the app,
and every deploy of it succeeds. If you find a stray one, delete its CloudFormation
stack — and note the table, bucket, user pool and secret are marked *Retain*, so
they survive and need deleting by hand if you want them gone.

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
