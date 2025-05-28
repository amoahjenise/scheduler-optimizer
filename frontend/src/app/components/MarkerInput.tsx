// MarkerInput.tsx
interface MarkerInputProps {
    customMarker: string;                 // not 'marker'
    setCustomMarker: React.Dispatch<React.SetStateAction<string>>; // or (m: string) => void
  }

  export default function MarkerInput({ customMarker, setCustomMarker }: MarkerInputProps) {
    return (
      <input
        value={customMarker}
        onChange={e => setCustomMarker(e.target.value)}
        placeholder="Enter marker (e.g., ✱ or 🌟)"
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm"
      />
    );
  }