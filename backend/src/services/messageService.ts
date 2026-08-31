import { generateId } from '../utils/helpers';
import { z } from 'zod';
import { ServiceError } from './errors';

export interface MessageMembership {
  id: string;
  tripId: string;
  firebaseUid: string;
  name: string;
}

export interface MessageRecord {
  id: string;
  tripId: string;
  membershipId: string;
  memberName: string;
  message: string;
  createdAt: Date;
}

export interface MessageCursor {
  createdAt: Date;
  id: string;
}

export interface MessageRepository {
  findActiveMembership(firebaseUid: string, tripId: string): Promise<MessageMembership | null>;
  createMessageForMember(
    firebaseUid: string,
    message: Omit<MessageRecord, 'membershipId' | 'memberName'>,
  ): Promise<MessageRecord | null>;
  listMessagesForMember(
    firebaseUid: string,
    tripId: string,
    limit: number,
    cursor?: MessageCursor,
  ): Promise<MessageRecord[] | null>;
}

function parseLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

function parseCursor(value: unknown): MessageCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ServiceError(400, 'Invalid message cursor');
  const separator = value.lastIndexOf(',');
  if (separator < 1 || separator === value.length - 1) throw new ServiceError(400, 'Invalid message cursor');
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) throw new ServiceError(400, 'Invalid message cursor');
  return { createdAt, id };
}

export class MessageService {
  constructor(
    private readonly repository: MessageRepository,
    private readonly createId: () => string = generateId,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendMessage(
    firebaseUid: string,
    tripId: string,
    input: { memberId?: string; message: string },
  ): Promise<{ messageId: string; success: true }> {
    const parsed = z.object({ message: z.string().trim().min(1) }).safeParse(input);
    if (!parsed.success) throw new ServiceError(400, 'message is required');
    const message = parsed.data.message;
    if (message.length > 500) throw new ServiceError(400, 'message must be at most 500 characters');

    const messageId = this.createId();
    const created = await this.repository.createMessageForMember(firebaseUid, {
      id: messageId,
      tripId,
      message,
      createdAt: this.now(),
    });
    if (!created) throw new ServiceError(403, 'You are not a member of this trip');
    return { messageId, success: true };
  }

  async listMessages(
    firebaseUid: string,
    tripId: string,
    query: { limit?: unknown; cursor?: unknown },
  ): Promise<{ messages: MessageRecord[]; nextCursor?: string }> {
    const pageLimit = parseLimit(query.limit);
    const rows = await this.repository.listMessagesForMember(
      firebaseUid,
      tripId,
      pageLimit + 1,
      parseCursor(query.cursor),
    );
    if (!rows) throw new ServiceError(403, 'You are not a member of this trip');

    const hasNextPage = rows.length > pageLimit;
    const messages = rows.slice(0, pageLimit);
    const lastMessage = messages[messages.length - 1];
    return {
      messages,
      nextCursor: hasNextPage && lastMessage
        ? `${lastMessage.createdAt.toISOString()},${lastMessage.id}`
        : undefined,
    };
  }
}
