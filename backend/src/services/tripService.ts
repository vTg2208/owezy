import { generateId, generateRoomCode } from '../utils/helpers';
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
}

export interface TripDetails {
  trip: TripRecord;
  participants: Membership[];
  expenses: TripExpenseSummary[];
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
  setTripLocked(tripId: string, locked: boolean): Promise<void>;
  findMembership(tripId: string, membershipId: string): Promise<Membership | null>;
  leaveMembership(membershipId: string): Promise<void>;
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
    const normalizedTripName = tripName.trim();
    const normalizedOwnerName = ownerName.trim();
    if (!normalizedTripName || !normalizedOwnerName) {
      throw new ServiceError(400, 'tripName and adminName are required');
    }

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
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const normalizedName = memberName.trim();
    if (!normalizedRoomCode || !normalizedName) {
      throw new ServiceError(400, 'roomCode and memberName are required');
    }

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

  async setLocked(firebaseUid: string, tripId: string, locked: boolean): Promise<{ success: true }> {
    const actor = await this.requireActiveMembership(firebaseUid, tripId);
    if (actor.role !== 'owner') throw new ServiceError(403, 'Only admin can lock or unlock the trip');
    await this.repository.setTripLocked(tripId, locked);
    return { success: true };
  }

  async removeMember(
    firebaseUid: string,
    tripId: string,
    membershipId: string,
  ): Promise<{ success: true }> {
    const actor = await this.requireActiveMembership(firebaseUid, tripId);
    const target = await this.repository.findMembership(tripId, membershipId);
    if (!target || target.status !== 'active') throw new ServiceError(404, 'Member not found');

    if (actor.id !== target.id && actor.role !== 'owner') {
      throw new ServiceError(403, 'Only admin can remove other members');
    }

    await this.repository.leaveMembership(target.id);
    return { success: true };
  }

  private async requireActiveMembership(firebaseUid: string, tripId: string): Promise<Membership> {
    const membership = await this.repository.findActiveMembership(firebaseUid, tripId);
    if (!membership) throw new ServiceError(403, 'You are not a member of this trip');
    return membership;
  }
}
