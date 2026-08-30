import {
  MessageCursor,
  MessageMembership,
  MessageRecord,
  MessageRepository,
} from '../services/messageService';
import { defaultDatabase, QueryExecutor } from './database';

function mapMessage(row: Record<string, any>): MessageRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    membershipId: row.membership_id,
    memberName: row.display_name,
    message: row.message,
    createdAt: row.created_at,
  };
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly database: QueryExecutor = defaultDatabase()) {}

  async findActiveMembership(firebaseUid: string, tripId: string): Promise<MessageMembership | null> {
    const result = await this.database.query(
      `SELECT m.id, m.trip_id, u.firebase_uid, m.display_name
         FROM trip_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'`,
      [firebaseUid, tripId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      tripId: row.trip_id,
      firebaseUid: row.firebase_uid,
      name: row.display_name,
    } : null;
  }

  async createMessage(message: MessageRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO chat_messages (id, trip_id, membership_id, message, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [message.id, message.tripId, message.membershipId, message.message, message.createdAt],
    );
  }

  async listMessagesForMember(
    firebaseUid: string,
    tripId: string,
    limit: number,
    cursor?: MessageCursor,
  ): Promise<MessageRecord[] | null> {
    const authorization = await this.database.query(
      `SELECT EXISTS (
         SELECT 1
           FROM trip_memberships m
           JOIN users u ON u.id = m.user_id
          WHERE u.firebase_uid = $1 AND m.trip_id = $2 AND m.status = 'active'
       ) AS authorized`,
      [firebaseUid, tripId],
    );
    if (!authorization.rows[0]?.authorized) return null;

    const boundedLimit = Math.min(Math.max(limit, 1), 101);
    const result = cursor
      ? await this.database.query(
        `SELECT c.id, c.trip_id, c.membership_id, m.display_name, c.message, c.created_at
           FROM chat_messages c
           JOIN trip_memberships m ON m.id = c.membership_id AND m.trip_id = c.trip_id
          WHERE c.trip_id = $1
            AND (c.created_at, c.id) < ($3, $4)
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT $2`,
        [tripId, boundedLimit, cursor.createdAt, cursor.id],
      )
      : await this.database.query(
        `SELECT c.id, c.trip_id, c.membership_id, m.display_name, c.message, c.created_at
           FROM chat_messages c
           JOIN trip_memberships m ON m.id = c.membership_id AND m.trip_id = c.trip_id
          WHERE c.trip_id = $1
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT $2`,
        [tripId, boundedLimit],
      );
    return result.rows.map(mapMessage);
  }
}
