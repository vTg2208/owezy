import { generateId, generateRoomCode } from '../utils/helpers';
import { z } from 'zod';
import { ServiceError } from './errors';

export type MembershipRole = 'owner' | 'member';
export type MembershipStatus = 'active' | 'left' | 'anonymized';

export interface Membership {
  id: string;
  tripId: string;
  firebaseUid: string | null;
  name: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
}

export interface TripRecord {
  id: string;
  name: string;
  roomCode: string;
  ownerMembershipId: string;
  isLocked: boolean;
  createdAt: Date;
  currency?: string;
}

export interface TripExpenseSummary {
  id: string;
  tripId: string;
  paidBy: string;
  paidByName: string;
  description: string;
  amountMinor: bigint;
  splitType: 'equal' | 'custom' | 'percentage';
  receiptUrl?: string;
  createdAt: Date;
  expenseKey?: string;
  version?: number;
  status?: 'active' | 'voided';
  currency?: string;
}

export interface TripDetails {
  trip: TripRecord;
  participants: Membership[];
  expenses: TripExpenseSummary[];
  currentMembershipId?: string;
  expenseNextCursor?: string;
}

export interface TripExpensePage {
  expenses: TripExpenseSummary[];
  nextCursor?: string;
}

export type JoinResult =
  | { kind: 'not-found' }
  | { kind: 'locked' }
  | { kind: 'name-conflict' }
  | { kind: 'existing' | 'joined'; trip: TripRecord; membership: Membership };

export interface TripRepository {
  createTripForUser(
    firebaseUid: string,
    trip: TripRecord,
    owner: Membership,
  ): Promise<{ trip: TripRecord; owner: Membership }>;
  joinTripForUser(
    firebaseUid: string,
    roomCode: string,
    displayName: string,
    membershipId: string,
  ): Promise<JoinResult>;
  findActiveMembership(firebaseUid: string, tripId: string): Promise<Membership | null>;
  getTripDetailsForMember(firebaseUid: string, tripId: string): Promise<TripDetails | null>;
  getExpensePageForMember(firebaseUid: string, tripId: string, cursor?: string): Promise<TripExpensePage | null>;
  setTripLockedForOwner(
    firebaseUid: string,
    tripId: string,
    locked: boolean,
  ): Promise<'updated' | 'forbidden' | 'not-found'>;
  removeMemberForActor(
    firebaseUid: string,
    tripId: string,
    membershipId: string,
  ): Promise<'removed' | 'forbidden' | 'not-found' | 'owner-required'>;
}

export interface CreatedTripResponse {
  tripId: string;
  roomCode: string;
  member: { id: string; name: string; isAdmin: true };
}

export interface JoinedTripResponse {
  tripId: string;
  tripName: string;
  member: { id: string; name: string; isAdmin: boolean };
  created: boolean;
}

export class TripService {
  constructor(
    private readonly repository: TripRepository,
    private readonly createId: () => string = generateId,
    private readonly createRoomCode: () => string = generateRoomCode,
  ) {}

  async createTrip(firebaseUid: string, tripName: string, ownerName: string): Promise<CreatedTripResponse> {
    const input = z.object({
      tripName: z.string().trim().min(1),
      ownerName: z.string().trim().min(1),
    }).safeParse({ tripName, ownerName });
    if (!input.success) {
      throw new ServiceError(400, 'tripName and adminName are required');
    }
    const { tripName: normalizedTripName, ownerName: normalizedOwnerName } = input.data;

    const now = new Date();
    const tripId = this.createId();
    const membershipId = this.createId();
    const trip: TripRecord = {
      id: tripId,
      name: normalizedTripName,
      roomCode: this.createRoomCode(),
      ownerMembershipId: membershipId,
      isLocked: false,
      createdAt: now,
    };
    const owner: Membership = {
      id: membershipId,
      tripId,
      firebaseUid,
      name: normalizedOwnerName,
      role: 'owner',
      status: 'active',
      createdAt: now,
    };

    await this.repository.createTripForUser(firebaseUid, trip, owner);
    return {
      tripId,
      roomCode: trip.roomCode,
      member: { id: membershipId, name: normalizedOwnerName, isAdmin: true },
    };
  }

  async joinTrip(firebaseUid: string, roomCode: string, memberName: string): Promise<JoinedTripResponse> {
    const input = z.object({
      roomCode: z.string().trim().min(1).transform((value) => value.toUpperCase()),
      memberName: z.string().trim().min(1),
    }).safeParse({ roomCode, memberName });
    if (!input.success) {
      throw new ServiceError(400, 'roomCode and memberName are required');
    }
    const { roomCode: normalizedRoomCode, memberName: normalizedName } = input.data;

    const result = await this.repository.joinTripForUser(
      firebaseUid,
      normalizedRoomCode,
      normalizedName,
      this.createId(),
    );
    if (result.kind === 'not-found') throw new ServiceError(404, 'Trip not found');
    if (result.kind === 'locked') throw new ServiceError(403, 'Trip is locked');
    if (result.kind === 'name-conflict') {
      throw new ServiceError(400, 'A member with this name already exists in the trip');
    }

    return {
      tripId: result.trip.id,
      tripName: result.trip.name,
      member: {
        id: result.membership.id,
        name: result.membership.name,
        isAdmin: result.membership.role === 'owner',
      },
      created: result.kind === 'joined',
    };
  }

  async getTrip(firebaseUid: string, tripId: string): Promise<TripDetails> {
    const details = await this.repository.getTripDetailsForMember(firebaseUid, tripId);
    if (!details) throw new ServiceError(403, 'You are not a member of this trip');
    return details;
  }

  async getExpenses(firebaseUid: string, tripId: string, cursor?: string): Promise<TripExpensePage> {
    const page = await this.repository.getExpensePageForMember(firebaseUid, tripId, cursor);
    if (!page) throw new ServiceError(403, 'You are not a member of this trip');
    return page;
  }

  async setLocked(firebaseUid: string, tripId: string, locked: boolean): Promise<{ success: true }> {
    const result = await this.repository.setTripLockedForOwner(firebaseUid, tripId, locked);
    if (result === 'not-found') throw new ServiceError(404, 'Trip not found');
    if (result === 'forbidden') throw new ServiceError(403, 'Only admin can lock or unlock the trip');
    return { success: true };
  }

  async removeMember(
    firebaseUid: string,
    tripId: string,
    membershipId: string,
  ): Promise<{ success: true }> {
    const result = await this.repository.removeMemberForActor(firebaseUid, tripId, membershipId);
    if (result === 'not-found') throw new ServiceError(404, 'Member not found');
    if (result === 'forbidden') throw new ServiceError(403, 'Only admin can remove other members');
    if (result === 'owner-required') {
      throw new ServiceError(409, 'The owner cannot leave until another active member joins');
    }
    return { success: true };
  }

  private async requireActiveMembership(firebaseUid: string, tripId: string): Promise<Membership> {
    const membership = await this.repository.findActiveMembership(firebaseUid, tripId);
    if (!membership) throw new ServiceError(403, 'You are not a member of this trip');
    return membership;
  }
}
