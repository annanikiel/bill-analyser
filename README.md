# Bill Analyser

Photograph a receipt, have it read and sorted into your own categories, and see
where the money actually went over any period you choose.

Built for grocery shopping in particular — the categories that matter there
(ingredients you cook with, versus ready meals, versus snacks) are not the ones a
bank statement can tell you, because the bank only sees "TESCO £47.31".

## Current state

Complete and deployable. The front end, the AWS backend, and the deployment
pipeline all exist.

**Try it without deploying anything.** With no backend configured the app runs
entirely in your browser on generated sample data — no AWS account, no cost, no
sign-in:

```bash
npm install
npm run dev      # http://localhost:5173
```

"Reset demo data" in the footer puts it back to the start.

**To run it for real:** [docs/setup.md](docs/setup.md) walks through deploying it,
click by click. Every step is in the AWS console or on the GitHub website — there is
no command line, and the deployment itself runs from the GitHub Actions tab.

## What it does

**Scan.** Take a photo or pick one from your library. On a phone this opens the
camera directly. The image is downscaled before upload, so it works on a bad signal.

**Review.** Every line item comes back with a readable name, a price and a suggested
category. Items the reader was unsure about, or could not place, are flagged — there
is a "needs a look" filter so you can deal with just those. Prices and names are
editable; so is the shop and the date.

If the line items don't add up to the printed total, the app says so and shows the
difference rather than quietly hiding it. That gap is usually a basket-wide discount,
but occasionally it means a line was missed.

**It remembers your corrections.** Change an item's category once and every future
receipt containing that item is sorted the same way, before anything is guessed.
Those remembered items are listed on the Categories screen, and you can delete any
of them. Simply *accepting* a suggestion does not create a rule — only correcting one
does, so the app never hardens a mistake into a habit.

**Categories are yours.** Rename, reorder, recolour, add and archive them. Each one
carries a hint describing what belongs in it, and that hint is given to the reader
along with the receipt — so editing "Fresh" to mention herbs genuinely changes how
the next receipt is sorted. Archiving rather than deleting is automatic when a
category is still used by old receipts, so history is never rewritten.

**Summaries.** Pick a period — presets or a custom range — and get the total, the
breakdown by category, spending over time, and what you spent most on. Select any
category to see what is inside it. Every chart has a table view.

Receipts you haven't confirmed are excluded from the totals, and the app tells you
when that is hiding something, so the numbers never shift under you while you edit.

## Security

The repository is public; the data is not, and never can be.

- The repo and the deployed site contain **no spending data and no credentials** —
  only the app's code. Data exists solely in AWS, behind a login.
- Sign-in is Amazon Cognito with **self-registration turned off**, so accounts exist
  only when you create one from the console. A stranger who finds the repository can
  read the code and open the app; they cannot get in.
- Every API route requires a valid token, checked by API Gateway *before* any code
  runs — an unauthenticated request never reaches a Lambda.
- Every record is keyed by the user id **taken from the token**, never from the
  request. There is no code path where a caller can name whose data to read, so a bug
  in a handler cannot return someone else's receipts.
- Receipt photos live in a private, encrypted bucket reached only through short-lived
  presigned URLs, and are deleted automatically after 30 days.
- Sign-in uses PKCE, so there is no client secret to leak, and an intercepted
  authorization code is useless on its own.

These are not just claims in a document: `packages/infra/lib/stack.test.ts` asserts
each of them against the synthesised infrastructure, and runs in CI. The reasoning,
including what is deliberately public and why, is in
[docs/architecture.md](docs/architecture.md).

## Layout

```
packages/
  shared/    Domain model and logic — money, dates, aggregation, rule learning.
             Unit tested, and imported by both the browser and the Lambdas, so the
             rule the app predicts and the rule the server writes cannot diverge.
  web/       React app and Cognito sign-in. Talks only to the ApiClient interface,
             so the demo and real backends are interchangeable.
  infra/     CDK stack and Lambda handlers, with tests that assert the security
             properties rather than trusting the source to still say what it said.
docs/
  setup.md          Click-by-click deployment. No terminal required.
  architecture.md   The design, and the reasoning behind the security model.
```

## Commands

```bash
npm run dev        # dev server
npm test           # unit tests for the domain logic
npm run typecheck  # whole workspace
npm run build      # production build into packages/web/dist
```

## Deploying

See [docs/setup.md](docs/setup.md). In short:

- **Deploy AWS infrastructure** (Actions tab) creates the stack.
- **Deploy web app to GitHub Pages** builds and publishes the front end, reading the
  API address and login settings straight out of the deployed stack — so those values
  are never copied by hand and cannot drift out of date.
- With no stack found, the same workflow publishes the demo-data version. That is
  what a fork of this repository gets, and it is why the app is always runnable.

Routing is hash-based (`#/receipts`) because a static host cannot serve a path with
no file behind it; this way refreshing on any screen works.
