import type { Category, CategoryRule, Receipt, ReceiptId } from '@bill/shared';
import type { BackendConfig } from '../auth/config.js';
import { clearLocalSession, currentIdToken } from '../auth/cognito.js';
import { ApiError, type ApiClient, type ParseStage } from './types.js';

/**
 * The real backend, talking to API Gateway.
 *
 * Implements exactly the interface MockApiClient does, so swapping between them
 * changes nothing above this file.
 */
export class HttpApiClient implements ApiClient {
  constructor(
    private readonly config: BackendConfig,
    /** Called when the session has ended, so the UI can show the login screen. */
    private readonly onSignedOut: () => void,
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit & { parseJson?: boolean } = {},
  ): Promise<T> {
    // Sending the id token rather than the access token: its `aud` claim is the app
    // client id, which is exactly what the API Gateway authorizer is pinned to.
    const token = await currentIdToken(this.config);
    if (!token) {
      this.onSignedOut();
      throw new ApiError('Your session has ended. Please sign in again.', 401);
    }

    const response = await fetch(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401 || response.status === 403) {
      clearLocalSession();
      this.onSignedOut();
      throw new ApiError('Your session has ended. Please sign in again.', response.status);
    }

    if (!response.ok) {
      const message = await response
        .json()
        .then((body: { message?: string }) => body.message)
        .catch(() => undefined);
      throw new ApiError(message ?? `Request failed (${response.status})`, response.status);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  /* ------------------------------------------------------------ categories */

  listCategories(): Promise<Category[]> {
    return this.request('/categories');
  }

  createCategory(input: Pick<Category, 'name'> & Partial<Category>): Promise<Category> {
    return this.request('/categories', { method: 'POST', body: JSON.stringify(input) });
  }

  updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Promise<Category> {
    return this.request(`/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  deleteCategory(id: string): Promise<{ archived: boolean }> {
    return this.request(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  reorderCategories(orderedIds: string[]): Promise<Category[]> {
    return this.request('/categories/order', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    });
  }

  /* -------------------------------------------------------------- receipts */

  listReceipts(): Promise<Receipt[]> {
    return this.request('/receipts');
  }

  getReceipt(id: ReceiptId): Promise<Receipt | null> {
    return this.request<Receipt | null>(`/receipts/${encodeURIComponent(id)}`).catch(
      (cause: unknown) => {
        if (cause instanceof ApiError && cause.status === 404) return null;
        throw cause;
      },
    );
  }

  /**
   * Upload the photo and have it read.
   *
   * The image goes straight from the browser to S3 on a presigned URL - it never
   * passes through the API, which keeps a several-megabyte photo out of a Lambda
   * request body and off the API Gateway payload limit.
   */
  async parseReceipt(image: Blob, onProgress?: (stage: ParseStage) => void): Promise<Receipt> {
    onProgress?.('uploading');

    const contentType = image.type || 'image/jpeg';
    const { url, key } = await this.request<{ url: string; key: string }>('/uploads', {
      method: 'POST',
      body: JSON.stringify({ contentType }),
    });

    const upload = await fetch(url, {
      method: 'PUT',
      body: image,
      headers: { 'content-type': contentType },
    });
    if (!upload.ok) throw new ApiError('The photo could not be uploaded.', upload.status);

    onProgress?.('reading');
    const receipt = await this.request<Receipt>('/parse', {
      method: 'POST',
      body: JSON.stringify({ imageKey: key }),
    });

    onProgress?.('done');
    return receipt;
  }

  updateReceipt(id: ReceiptId, patch: Partial<Omit<Receipt, 'id'>>): Promise<Receipt> {
    return this.request(`/receipts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  confirmReceipt(id: ReceiptId): Promise<{ receipt: Receipt; rulesLearned: number }> {
    return this.request(`/receipts/${encodeURIComponent(id)}/confirm`, { method: 'POST' });
  }

  deleteReceipt(id: ReceiptId): Promise<void> {
    return this.request(`/receipts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async getReceiptImageUrl(id: ReceiptId): Promise<string | null> {
    const { url } = await this.request<{ url: string | null }>(
      `/receipts/${encodeURIComponent(id)}/image-url`,
    );
    return url;
  }

  /* ----------------------------------------------------------------- rules */

  listRules(): Promise<CategoryRule[]> {
    return this.request('/rules');
  }

  deleteRule(id: string): Promise<void> {
    return this.request(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}
