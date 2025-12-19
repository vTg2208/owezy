import { Participant } from '../types';

interface ParticipantListProps {
  participants: Participant[];
  isAdmin: boolean;
  isLocked: boolean;
  onRemove: (memberId: string) => void;
}

export default function ParticipantList({ participants, isAdmin, isLocked, onRemove }: ParticipantListProps) {
  return (
    <div>
      <h3 className="font-semibold text-gray-700 mb-3">
        Fellow Travellers
      </h3>
      <div className="flex flex-wrap gap-2">
        {participants.map((participant) => (
          <div
            key={participant.id}
            className="bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full flex items-center gap-2"
          >
            <span>{participant.name}</span>
            {isAdmin && !isLocked && (
              <button
                onClick={() => onRemove(participant.id)}
                className="text-red-500 hover:text-red-700 font-bold"
                title="Remove participant"
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
