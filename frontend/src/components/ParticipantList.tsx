import { Participant } from '../types';

interface ParticipantListProps {
  participants: Participant[];
  isAdmin: boolean;
  currentUserId: string;
  ownerId: string;
  onRemove: (memberId: string) => void;
}

export default function ParticipantList({ participants, isAdmin, currentUserId, ownerId, onRemove }: ParticipantListProps) {
  return (
    <div className="min-w-0">
      <p className="eyebrow mb-2">Travelling together</p>
      <div className="member-list">
        {participants.map((participant) => (
          <div
            key={participant.id}
            className="member-chip"
          >
            <span>{participant.name}</span>
            {isAdmin && participant.id !== currentUserId && participant.id !== ownerId && (
              <button
                type="button"
                onClick={() => onRemove(participant.id)}
                className="member-remove"
                aria-label={`Remove ${participant.name}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
