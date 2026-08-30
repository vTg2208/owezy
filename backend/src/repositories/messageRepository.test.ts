import { describe, expect, it } from 'vitest';
import { PostgresMessageRepository } from './messageRepository';

class MessageQueryBoundary {
  tupleCursorUsed = false;
  stableOrderUsed = false;

  async query(text: string) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (sql.includes('AS authorized')) return { rows: [{ authorized: true }], rowCount: 1 };
    if (sql.includes('FROM chat_messages c')) {
      this.tupleCursorUsed = sql.includes('(c.created_at, c.id) < ($3, $4)');
      this.stableOrderUsed = sql.includes('ORDER BY c.created_at DESC, c.id DESC');
      return {
        rows: [{
          id: 'message-2', trip_id: 'trip-1', membership_id: 'member-a', display_name: 'Alice',
          message: 'Second', created_at: new Date('2026-08-31T01:00:00.000Z'),
        }],
        rowCount: 1,
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

describe('PostgresMessageRepository', () => {
  it('orders and paginates messages by created_at and id together', async () => {
    const database = new MessageQueryBoundary();
    const repository = new PostgresMessageRepository(database);

    const messages = await repository.listMessagesForMember(
      'firebase-1',
      'trip-1',
      25,
      { createdAt: new Date('2026-08-31T02:00:00.000Z'), id: 'message-9' },
    );

    expect(messages).toEqual([{
      id: 'message-2', tripId: 'trip-1', membershipId: 'member-a', memberName: 'Alice',
      message: 'Second', createdAt: new Date('2026-08-31T01:00:00.000Z'),
    }]);
    expect(database.tupleCursorUsed).toBe(true);
    expect(database.stableOrderUsed).toBe(true);
  });
});
