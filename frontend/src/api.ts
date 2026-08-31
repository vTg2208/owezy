import { auth } from './firebase';
import type {
  AuditEvent,
  ChatMessage,
  Payment,
  Trip,
  TripSnapshot,
} from './types';

const configuredBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
export const API_BASE = configuredBase.endsWith('/api') ? `${configuredBase}/v1` : configuredBase;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  json?: unknown;
  body?: BodyInit;
  contentType?: string | null;
  headers?: Record<string, string>;
  idempotencyKey?: string;
  timeoutMs?: number;
}

interface RequestClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

async function errorPayload(response: Response): Promise<{ code?: string; error?: string; message?: string }> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export function createRequestClient(options: RequestClientOptions) {
  const fetcher = options.fetcher ?? fetch;
  const defaultTimeout = options.timeoutMs ?? 15_000;
  const request = async <T>(path: string, requestOptions: RequestOptions = {}): Promise<T> => {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
      requestOptions.timeoutMs ?? defaultTimeout,
    );
    const abortFromCaller = () => controller.abort(requestOptions.signal?.reason);
    requestOptions.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
      const token = await options.getToken();
      const headers: Record<string, string> = { ...requestOptions.headers };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (requestOptions.idempotencyKey) headers['Idempotency-Key'] = requestOptions.idempotencyKey;
      let body = requestOptions.body;
      if (requestOptions.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(requestOptions.json);
      } else if (requestOptions.contentType) {
        headers['Content-Type'] = requestOptions.contentType;
      }
      const response = await fetcher(`${options.baseUrl}${path}`, {
        method: requestOptions.method ?? 'GET',
        credentials: 'omit',
        headers,
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = await errorPayload(response);
        throw new ApiError(
          response.status,
          payload.code ?? `HTTP_${response.status}`,
          payload.error ?? payload.message ?? 'Request failed',
          response.headers.get('x-request-id') ?? undefined,
        );
      }
      if (response.status === 204) return undefined as T;
      return await response.json() as T;
    } finally {
      globalThis.clearTimeout(timeout);
      requestOptions.signal?.removeEventListener('abort', abortFromCaller);
    }
  };
  return { request };
}

const client = createRequestClient({
  baseUrl: API_BASE,
  getToken: async () => auth.currentUser?.getIdToken(),
});

export const request = client.request;

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}

export const authAPI = {
  syncUser: async (_email?: string, _name?: string) => request<{ user: unknown }>('/auth/sync', {
    method: 'POST', json: {},
  }),
  getMyTrips: async () => (await request<{ trips: Trip[] }>('/auth/my-trips')).trips ?? [],
  deleteAccount: async () => request<{ success: true }>('/auth/me', { method: 'DELETE' }),
};

export interface ExpenseWrite {
  description: string;
  amount: string;
  splitType: 'equal' | 'custom' | 'percentage';
  splits: Array<{ participantId: string; amount: string }>;
  receiptId?: string;
}

export const api = {
  createTrip: (tripName: string, adminName: string) => request<{
    tripId: string; roomCode: string; member: { id: string; name: string; isAdmin: true };
  }>('/trips', { method: 'POST', json: { tripName, adminName } }),
  joinTrip: (roomCode: string, memberName: string) => request<{
    tripId: string; tripName: string; member: { id: string; name: string; isAdmin: boolean };
  }>('/trips/join', { method: 'POST', json: { roomCode, memberName } }),
  getTrip: (tripId: string, signal?: AbortSignal) => request<TripSnapshot>(`/trips/${tripId}`, { signal }),
  lockRoom: (tripId: string) => request<{ success: true }>(`/trips/${tripId}/lock`, { method: 'POST' }),
  unlockRoom: (tripId: string) => request<{ success: true }>(`/trips/${tripId}/unlock`, { method: 'POST' }),
  removeParticipant: (tripId: string, memberId: string) => request<{ success: true }>(
    `/trips/${tripId}/members/${memberId}`, { method: 'DELETE' },
  ),
  addExpense: (tripId: string, data: ExpenseWrite, idempotencyKey = createIdempotencyKey()) => request<{
    expenseId: string; splitType: string; memberCount: number;
  }>(`/trips/${tripId}/expenses`, { method: 'POST', json: data, idempotencyKey }),
  correctExpense: (
    tripId: string, expenseId: string, expectedVersion: number, data: ExpenseWrite,
    idempotencyKey = createIdempotencyKey(),
  ) => request(`/trips/${tripId}/expenses/${expenseId}/correct`, {
    method: 'POST', json: { expectedVersion, ...data }, idempotencyKey,
  }),
  voidExpense: (
    tripId: string, expenseId: string, expectedVersion: number,
    idempotencyKey = createIdempotencyKey(),
  ) => request(`/trips/${tripId}/expenses/${expenseId}/void`, {
    method: 'POST', json: { expectedVersion }, idempotencyKey,
  }),
  uploadReceipt: (tripId: string, file: File) => request<{
    receipt_id: string; receipt_url: string; content_type: string; byte_size: number;
    checksum_sha256: string; status: 'pending'; pending_expires_at: string;
  }>(`/trips/${tripId}/receipts`, {
    method: 'POST', body: file, contentType: file.type || 'application/octet-stream',
  }),
  readReceipt: async (receiptUrl: string, signal?: AbortSignal): Promise<Blob> => {
    const path = receiptUrl.startsWith('/api/') ? receiptUrl.slice('/api'.length) : receiptUrl;
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch(path.startsWith('http') ? path : `${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}, signal,
    });
    if (!response.ok) {
      const payload = await errorPayload(response);
      throw new ApiError(
        response.status, payload.code ?? `HTTP_${response.status}`,
        payload.error ?? 'Failed to load receipt', response.headers.get('x-request-id') ?? undefined,
      );
    }
    return response.blob();
  },
  getBalances: async (tripId: string) => request<Pick<TripSnapshot, 'balances' | 'settlements'>>(
    `/trips/${tripId}/balances`,
  ),
  createPayment: (
    tripId: string, payeeMembershipId: string, amount: string, note?: string,
    idempotencyKey = createIdempotencyKey(),
  ) => request<Payment>(`/trips/${tripId}/payments`, {
    method: 'POST', json: { payeeMembershipId, amount, note }, idempotencyKey,
  }),
  listPayments: async (tripId: string) => (await request<{ payments: Payment[] }>(
    `/trips/${tripId}/payments`,
  )).payments,
  transitionPayment: (
    tripId: string, paymentId: string, action: 'confirm' | 'reject' | 'cancel',
    idempotencyKey = createIdempotencyKey(),
  ) => request<Payment>(`/trips/${tripId}/payments/${paymentId}/${action}`, {
    method: 'POST', json: {}, idempotencyKey,
  }),
  createInvite: (
    tripId: string, email: string, expiresInHours = 168,
    idempotencyKey = createIdempotencyKey(),
  ) => request<{ inviteId: string; token: string; expiresInHours: number }>(
    `/trips/${tripId}/invites`, { method: 'POST', json: { email, expiresInHours }, idempotencyKey },
  ),
  revokeInvite: (tripId: string, inviteId: string) => request<{ success: true }>(
    `/trips/${tripId}/invites/${inviteId}`, { method: 'DELETE' },
  ),
  acceptInvite: (token: string, idempotencyKey = createIdempotencyKey()) => request<{
    tripId: string; membershipId: string;
  }>('/invites/accept', { method: 'POST', json: { token }, idempotencyKey }),
  getAudit: async (tripId: string) => (await request<{ events: AuditEvent[] }>(
    `/trips/${tripId}/audit`,
  )).events,
  sendMessage: (tripId: string, message: string) => request<{ messageId: string; success: true }>(
    `/trips/${tripId}/messages`, { method: 'POST', json: { message } },
  ),
  getMessages: (tripId: string, cursor?: string, signal?: AbortSignal) => request<{
    messages: ChatMessage[]; nextCursor?: string;
  }>(`/trips/${tripId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { signal }),
};
