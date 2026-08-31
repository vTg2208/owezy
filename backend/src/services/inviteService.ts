import { createHash, randomBytes } from 'node:crypto';
import type { QueryExecutor } from '../repositories/database';
import { generateId } from '../utils/helpers';
import { ServiceError } from './errors';

export interface InvitePrincipal { uid: string; email: string; name: string }

export interface InviteRepository {
  createForOwner(
    firebaseUid: string,
    tripId: string,
    invite: { id: string; email: string; tokenHash: string; expiresAt: Date },
    database?: QueryExecutor,
  ): Promise<{ kind: 'created'; inviteId: string } | { kind: 'forbidden' }>;
  revokeForOwner(
    firebaseUid: string,
    tripId: string,
    inviteId: string,
    database?: QueryExecutor,
  ): Promise<'revoked' | 'forbidden' | 'not-found' | 'conflict'>;
  acceptForUser(
    principal: InvitePrincipal,
    tokenHash: string,
    membershipId: string,
    database?: QueryExecutor,
  ): Promise<
    | { kind: 'accepted'; tripId: string; membershipId: string }
    | { kind: 'not-found' | 'expired' | 'email-mismatch' | 'conflict' | 'account-missing' }
  >;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class InviteService {
  constructor(
    private readonly repository: InviteRepository,
    private readonly createId: () => string = generateId,
    private readonly createToken: () => string = () => randomBytes(32).toString('base64url'),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(
    firebaseUid: string,
    tripId: string,
    input: { email?: unknown; expiresInHours?: unknown },
    database?: QueryExecutor,
  ) {
    const email = typeof input?.email === 'string' ? input.email.trim() : '';
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ServiceError(400, 'A valid invite email is required');
    }
    const expiresInHours = input.expiresInHours === undefined ? 168 : Number(input.expiresInHours);
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
      throw new ServiceError(400, 'expiresInHours must be between 1 and 720');
    }
    const token = this.createToken();
    const result = await this.repository.createForOwner(firebaseUid, tripId, {
      id: this.createId(),
      email: email.toLowerCase(),
      tokenHash: hashToken(token),
      expiresAt: new Date(this.now().getTime() + expiresInHours * 60 * 60 * 1_000),
    }, database);
    if (result.kind === 'forbidden') throw new ServiceError(403, 'Only the trip owner can create invitations');
    return { inviteId: result.inviteId, token, expiresInHours };
  }

  async revoke(firebaseUid: string, tripId: string, inviteId: string, database?: QueryExecutor) {
    const result = await this.repository.revokeForOwner(firebaseUid, tripId, inviteId, database);
    if (result === 'forbidden') throw new ServiceError(403, 'Only the trip owner can revoke invitations');
    if (result === 'not-found') throw new ServiceError(404, 'Invitation not found');
    if (result === 'conflict') throw new ServiceError(409, 'Invitation is no longer pending');
    return { success: true as const };
  }

  async accept(principal: InvitePrincipal, token: string, database?: QueryExecutor) {
    if (!token || token.length > 256) throw new ServiceError(400, 'Invitation token is invalid');
    const result = await this.repository.acceptForUser(
      principal, hashToken(token), this.createId(), database,
    );
    if (result.kind !== 'accepted') {
      if (result.kind === 'not-found') throw new ServiceError(404, 'Invitation not found');
      if (result.kind === 'expired') throw new ServiceError(410, 'Invitation has expired');
      if (result.kind === 'email-mismatch') throw new ServiceError(403, 'Invitation belongs to another email address');
      if (result.kind === 'account-missing') throw new ServiceError(409, 'Sync your account before accepting an invitation');
      throw new ServiceError(409, 'Invitation is no longer pending');
    }
    return { tripId: result.tripId, membershipId: result.membershipId };
  }
}
