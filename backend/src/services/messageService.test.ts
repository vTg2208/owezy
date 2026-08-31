import { describe, expect, it } from 'vitest';
import {
  MessageMembership,
  MessageRecord,
  MessageRepository,
  MessageService,
  MessageCursor,
} from './messageService';

class MemoryMessageRepository implements MessageRepository {
  readonly memberships: MessageMembership[] = [
    { id: 'member-a', tripId: 'trip-1', firebaseUid: 'user-a', name: 'Alice' },
    { id: 'member-b', tripId: 'trip-1', firebaseUid: 'user-b', name: 'Bob' },
  ];
  readonly messages: MessageRecord[] = [];
  receivedLimit = 0;
  receivedCursor?: MessageCursor;

  async findActiveMembership(firebaseUid: string, tripId: string): Promise<MessageMembership | null> {
    return this.memberships.find(
      (membership) => membership.firebaseUid === firebaseUid && membership.tripId === tripId,
    ) ?? null;
  }

  rejectNextInsert = false;

  async createMessageForMember(
    firebaseUid: string,
    message: Omit<MessageRecord, 'membershipId' | 'memberName'>,
  ): Promise<MessageRecord | null> {
    const membership = await this.findActiveMembership(firebaseUid, message.tripId);
    if (!membership || this.rejectNextInsert) return null;
    const created = { ...message, membershipId: membership.id, memberName: membership.name };
    this.messages.push(created);
    return created;
  }

  async listMessagesForMember(
    firebaseUid: string,
    tripId: string,
    limit: number,
    cursor?: MessageCursor,
  ): Promise<MessageRecord[] | null> {
    if (!await this.findActiveMembership(firebaseUid, tripId)) return null;
    this.receivedLimit = limit;
    this.receivedCursor = cursor;
    return this.messages.slice(0, limit);
  }
}

describe('MessageService', () => {
  it('derives the sender from authenticated membership and ignores a client member ID', async () => {
    const repository = new MemoryMessageRepository();
    const service = new MessageService(repository, () => 'message-1', () => new Date('2026-08-31T01:00:00.000Z'));

    const result = await service.sendMessage('user-a', 'trip-1', { memberId: 'member-b', message: ' Hello ' });

    expect(result).toEqual({ messageId: 'message-1', success: true });
    expect(repository.messages[0]).toMatchObject({ membershipId: 'member-a', memberName: 'Alice', message: 'Hello' });
  });

  it('requires active membership for message reads and writes', async () => {
    const service = new MessageService(new MemoryMessageRepository(), () => 'message-1');

    await expect(service.sendMessage('outsider', 'trip-1', { message: 'Hello' })).rejects.toMatchObject({ status: 403 });
    await expect(service.listMessages('outsider', 'trip-1', {})).rejects.toMatchObject({ status: 403 });
  });

  it('rejects the message when membership becomes inactive at the insert boundary', async () => {
    const repository = new MemoryMessageRepository();
    repository.rejectNextInsert = true;
    const service = new MessageService(repository, () => 'message-1');

    await expect(service.sendMessage('user-a', 'trip-1', { message: 'Hello' }))
      .rejects.toMatchObject({ status: 403 });
    expect(repository.messages).toHaveLength(0);
  });

  it('returns a controlled validation error for a non-string message', async () => {
    const service = new MessageService(new MemoryMessageRepository(), () => 'message-1');

    await expect(service.sendMessage('user-a', 'trip-1', { message: null as unknown as string }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('bounds message limits and exposes a stable cursor from the extra row', async () => {
    const repository = new MemoryMessageRepository();
    for (let index = 0; index < 101; index += 1) {
      repository.messages.push({
        id: `message-${String(200 - index).padStart(3, '0')}`,
        tripId: 'trip-1',
        membershipId: 'member-a',
        memberName: 'Alice',
        message: String(index),
        createdAt: new Date(`2026-08-31T01:${String(59 - Math.floor(index / 2)).padStart(2, '0')}:00.000Z`),
      });
    }
    const service = new MessageService(repository, () => 'unused');

    const page = await service.listMessages('user-a', 'trip-1', { limit: '500' });

    expect(page.messages).toHaveLength(100);
    expect(repository.receivedLimit).toBe(101);
    expect(page.nextCursor).toBe('2026-08-31T01:10:00.000Z,message-101');
  });
});
