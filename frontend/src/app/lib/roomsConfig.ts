/**
 * Rooms configuration management
 * Allows admin users to configure available rooms for patient assignments
 */

const STORAGE_KEY = "patient_rooms_config";

// Default rooms (B7 wing for HEMA-ONC unit)
export const DEFAULT_ROOMS = [
  "B7.01",
  "B7.02",
  "B7.03",
  "B7.04",
  "B7.05",
  "B7.06",
  "B7.07",
  "B7.08",
  "B7.09",
  "B7.10",
  "B7.11",
  "B7.12",
  "B7.13",
  "B7.14",
  "B7.15",
  "B7.16",
];

export function loadRooms(): string[] {
  if (typeof window === "undefined") return DEFAULT_ROOMS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ROOMS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_ROOMS;
  } catch {
    return DEFAULT_ROOMS;
  }
}

export function saveRooms(rooms: string[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
  // Dispatch event so other components can react
  window.dispatchEvent(new CustomEvent("roomsConfigChanged"));
}

export function addRoom(room: string): string[] {
  const rooms = loadRooms();
  const trimmed = room.trim();
  if (!trimmed || rooms.includes(trimmed)) {
    return rooms;
  }
  const updated = [...rooms, trimmed].sort((a, b) => {
    // Natural sort for room numbers
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  saveRooms(updated);
  return updated;
}

export function removeRoom(room: string): string[] {
  const rooms = loadRooms();
  const updated = rooms.filter((r) => r !== room);
  saveRooms(updated);
  return updated;
}

export function updateRoom(oldRoom: string, newRoom: string): string[] {
  const rooms = loadRooms();
  const trimmed = newRoom.trim();
  if (!trimmed) return rooms;

  const updated = rooms
    .map((r) => (r === oldRoom ? trimmed : r))
    .sort((a, b) => {
      return a.localeCompare(b, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  saveRooms(updated);
  return updated;
}

export function resetRooms(): string[] {
  saveRooms(DEFAULT_ROOMS);
  return DEFAULT_ROOMS;
}
