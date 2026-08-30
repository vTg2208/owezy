import { generateId } from '../utils/helpers';
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
  createMessage(message: MessageRecord): Promise<void>;
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
    const membership = await this.repository.findActiveMembership(firebaseUid, tripId);
    if (!membership) throw new ServiceError(403, 'You are not a member of this trip');
    const message = input.message?.trim();
    if (!message) throw new ServiceError(400, 'message is required');
    if (message.length > 500) throw new ServiceError(400, 'message must be at most 500 characters');

    const messageId = this.createId();
    await this.repository.createMessage({
      id: messageId,
      tripId,
      membershipId: membership.id,
      memberName: membership.name,
      message,
      createdAt: this.now(),
    });
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
