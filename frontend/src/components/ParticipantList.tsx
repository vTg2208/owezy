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
    <div>
      <h3 className="font-semibold text-gray-700 mb-3 text-base sm:text-lg">
        Fellow Travellers
      </h3>
      <div className="flex flex-wrap gap-2">
        {participants.map((participant) => (
          <div
            key={participant.id}
            className="bg-indigo-50 text-indigo-700 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full flex items-center gap-2 text-sm sm:text-base"
          >
            <span>{participant.name}</span>
            {isAdmin && participant.id !== currentUserId && participant.id !== ownerId && (
              <button
                type="button"
                onClick={() => onRemove(participant.id)}
                className="text-red-700 hover:text-red-900 font-bold min-h-11 min-w-11"
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
