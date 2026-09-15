import { useEffect, useRef, useState } from 'react';
import { isMockBackend, type ParseStage } from '../api/index.js';
import { useAppData } from '../lib/store.js';
import { hrefFor, type Route } from '../lib/router.js';
import { Banner, Button, Card, EmptyState } from '../components/ui.js';

const STAGE_LABEL: Record<ParseStage, string> = {
  uploading: 'Uploading the photo',
  reading: 'Reading the receipt',
  categorising: 'Sorting items into categories',
  done: 'Done',
};

/** Photos off a modern phone camera are several megabytes; resize before uploading. */
const MAX_UPLOAD_EDGE = 2000;

export function CaptureScreen({ navigate }: { navigate: (route: Route) => void }) {
  const { api, upsertReceipt } = useAppData();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stage, setStage] = useState<ParseStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Object URLs hold the decoded image in memory until explicitly released.
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function onScan() {
    if (!file) return;
    setError(null);
    setStage('uploading');
    try {
      const prepared = await downscale(file);
      const receipt = await api.parseReceipt(prepared, setStage);
      upsertReceipt(receipt);
      navigate({ name: 'receipt', id: receipt.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that receipt.');
      setStage(null);
    }
  }

  const busy = stage !== null && stage !== 'done';

  return (
    <div className="screen">
      {isMockBackend && (
        <Banner tone="info">
          Demo mode: the photo is not sent anywhere and is not read. Scanning returns a
          sample receipt so you can try the review and categorising flow.
        </Banner>
      )}

      <Card title="Scan a receipt">
        {previewUrl ? (
          <div className="capture-preview">
            <img src={previewUrl} alt="The receipt you are about to scan" />
            <div className="capture-actions">
              <Button variant="primary" onClick={onScan} disabled={busy}>
                {busy ? STAGE_LABEL[stage] : 'Read this receipt'}
              </Button>
              <Button variant="ghost" onClick={() => setFile(null)} disabled={busy}>
                Choose another
              </Button>
            </div>
            {busy && (
              <ol className="stage-list" aria-live="polite">
                {(['uploading', 'reading', 'categorising'] as ParseStage[]).map((entry) => (
                  <li
                    key={entry}
                    className={
                      entry === stage ? 'is-current' : stageIndex(entry) < stageIndex(stage) ? 'is-done' : ''
                    }
                  >
                    {STAGE_LABEL[entry]}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <EmptyState
            title="Take a photo, or pick one from your library"
            body="Lay the receipt flat and get the whole thing in frame, including the total. A long receipt can be photographed in one go as long as the text is readable."
            action={
              <Button variant="primary" onClick={() => inputRef.current?.click()}>
                Choose a photo
              </Button>
            }
          />
        )}

        {/*
          `capture="environment"` asks a phone for the rear camera directly; on
          desktop the same input falls back to a file picker.
        */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) setFile(selected);
            // Clear so picking the same file twice still fires a change event.
            event.target.value = '';
          }}
        />

        {error && <Banner tone="critical">{error}</Banner>}
      </Card>

      <p className="muted-note">
        Scanned receipts land in <a href={hrefFor({ name: 'receipts' })}>your receipts</a> for review
        before they count towards any totals.
      </p>
    </div>
  );
}

function stageIndex(stage: ParseStage | null): number {
  return stage === null ? -1 : ['uploading', 'reading', 'categorising', 'done'].indexOf(stage);
}

/**
 * Shrink a photo to something worth uploading.
 *
 * A 12MP phone photo is ~4MB and no more readable than a 2000px one once the text is
 * in focus, so this cuts upload time and per-image model cost. Falls back to the
 * original file if anything about the decode fails.
 */
async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
