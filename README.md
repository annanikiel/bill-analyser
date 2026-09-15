# Bill Analyser

Photograph a receipt, have it read and sorted into your own categories, and see
where the money actually went over any period you choose.

Built for grocery shopping in particular — the categories that matter there
(ingredients you cook with, versus ready meals, versus snacks) are not the ones a
bank statement can tell you, because the bank only sees "TESCO £47.31".

## Current state

The **front end is complete and runs on sample data**. You can try the whole flow —
scan, review, correct, confirm, summarise — without an AWS account or a penny of
spend. The AWS backend is designed and documented but not yet built; see
[docs/architecture.md](docs/architecture.md).

```bash
npm install
npm run dev      # http://localhost:5173
```

Everything is held in your browser's local storage. Nothing is uploaded. "Reset demo
data" in the footer puts it back to the start.

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
  only when you create one. MFA is a few clicks and worth it.
- Every API route requires a valid token, checked by API Gateway before any code
  runs. Every record is keyed by the user id **taken from the token**, never from the
  request — so there is no code path where a caller can ask for someone else's data.
- Receipt photos live in a private S3 bucket and are only ever reached through
  short-lived presigned URLs.

The full reasoning, including what is deliberately public and why, is in
[docs/architecture.md](docs/architecture.md).

## Layout

```
packages/
  shared/    Domain model and logic — money, dates, aggregation, rule learning.
             Unit tested, and shared with the backend when it is built.
  web/       React app. Talks only to the ApiClient interface in src/api/types.ts,
             so the mock and the real backend are interchangeable.
docs/
  architecture.md    The AWS design, the security model, and what comes next.
```

## Commands

```bash
npm run dev        # dev server
npm test           # unit tests for the domain logic
npm run typecheck  # whole workspace
npm run build      # production build into packages/web/dist
```

## Deploying the front end

Pushing to `main` builds and publishes to GitHub Pages via
`.github/workflows/deploy-web.yml`. Enable Pages for the repository with "GitHub
Actions" as the source and it works with no further configuration — it will publish
the demo-data version until the backend exists.

Once the backend is built, set these as repository **variables** (not secrets —
neither is a credential, and both are visible in any shipped front end):

- `VITE_API_BASE_URL`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_CLIENT_ID`

Routing is hash-based (`#/receipts`) because a static host cannot serve a path that
has no file behind it; this way refreshing on any screen works.
