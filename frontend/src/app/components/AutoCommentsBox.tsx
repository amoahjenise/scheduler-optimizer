import React, { useState } from "react";
import SectionCard from "./SectionCard";
import { User2, Info, Search } from "lucide-react";

export default function AutoCommentsBox({
  autoComments,
  setAutoComments,
  validationErrors,
}: {
  autoComments: string;
  setAutoComments: React.Dispatch<React.SetStateAction<string>>;
  validationErrors: string[];
}) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showFindReplace, setShowFindReplace] = useState(false);

  // Escape special regex characters for safe string matching
  const escapeRegex = (str: string) => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  };

  const handleReplace = () => {
    if (!findText) return;
    // Use plain string replacement with split/join for exact matching
    const updated = autoComments
      .split("\n")
      .map((line) => line.split(findText).join(replaceText))
      .join("\n");
    setAutoComments(updated);
  };

  const handleReplaceAll = () => {
    if (!findText) return;
    // Use plain string replacement with split/join for exact matching
    // This avoids regex issues with special characters like () and spaces
    const updated = autoComments.split(findText).join(replaceText);
    setAutoComments(updated);
  };

  const lineCount = autoComments.split("\n").filter((l) => l.trim()).length;

  return (
    <SectionCard
      title="Detected Marker Comments (Employee Notes)"
      icon={<User2 className="text-sky-600" size={24} aria-hidden="true" />}
    >
      <div className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700">
        <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <span>
          <strong>Tip:</strong> For requested days off or vacation, add{" "}
          <code className="bg-amber-100 px-1 rounded">OFF</code> at the start of
          the comment.
          <br />
          Example:{" "}
          <code className="bg-amber-100 px-1 rounded">
            Jane Doe|2025-06-02|OFF vacation week
          </code>
        </span>
      </div>

      {/* Find/Replace toolbar */}
      <div className="mb-2">
        <button
          onClick={() => setShowFindReplace(!showFindReplace)}
          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
        >
          <Search className="h-3 w-3" />
          {showFindReplace ? "Hide" : "Show"} Find & Replace
        </button>

        {showFindReplace && (
          <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Find
                </label>
                <input
                  type="text"
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  placeholder="Text to find..."
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Replace with
                </label>
                <input
                  type="text"
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  placeholder="Replacement text..."
                  className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleReplaceAll}
                disabled={!findText}
                className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Replace All
              </button>
              <button
                onClick={() => {
                  setFindText("");
                  setReplaceText("");
                }}
                className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-1 text-xs text-gray-500">
        {lineCount} {lineCount === 1 ? "comment" : "comments"} detected
      </div>

      <textarea
        value={autoComments}
        onChange={(e) => setAutoComments(e.target.value)}
        placeholder="Jane Doe|2025-06-02|OFF vacation\nJohn Smith|2025-06-05|training day"
        rows={8}
        className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm font-mono"
      />
      {validationErrors.length > 0 && (
        <ul className="mt-2 text-red-600 text-sm list-disc pl-5">
          {validationErrors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
