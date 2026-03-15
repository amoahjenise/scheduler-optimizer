import React, { useState, useMemo, useCallback } from "react";
import SectionCard from "./SectionCard";
import {
  User2,
  Plus,
  Trash2,
  Search,
  MessageSquare,
  Plane,
} from "lucide-react";

interface CommentEntry {
  name: string;
  date: string;
  comment: string;
}

function parseComments(raw: string): CommentEntry[] {
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split("|");
      return {
        name: (parts[0] || "").trim(),
        date: (parts[1] || "").trim(),
        comment: parts.slice(2).join("|").trim(),
      };
    });
}

function serializeComments(entries: CommentEntry[]): string {
  return entries
    .filter((e) => e.name || e.date || e.comment)
    .map((e) => `${e.name}|${e.date}|${e.comment}`)
    .join("\n");
}

export default function AutoCommentsBox({
  autoComments,
  setAutoComments,
  validationErrors,
}: {
  autoComments: string;
  setAutoComments: React.Dispatch<React.SetStateAction<string>>;
  validationErrors: string[];
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [showFindReplace, setShowFindReplace] = useState(false);

  const entries = useMemo(() => parseComments(autoComments), [autoComments]);

  const updateEntry = useCallback(
    (index: number, field: keyof CommentEntry, value: string) => {
      const updated = [...entries];
      updated[index] = { ...updated[index], [field]: value };
      setAutoComments(serializeComments(updated));
    },
    [entries, setAutoComments],
  );

  const removeEntry = useCallback(
    (index: number) => {
      const updated = entries.filter((_, i) => i !== index);
      setAutoComments(serializeComments(updated));
    },
    [entries, setAutoComments],
  );

  const addEntry = useCallback(() => {
    const updated = [...entries, { name: "", date: "", comment: "" }];
    setAutoComments(serializeComments(updated));
  }, [entries, setAutoComments]);

  const toggleOff = useCallback(
    (index: number) => {
      const entry = entries[index];
      const comment = entry.comment;
      if (comment.toUpperCase().startsWith("OFF")) {
        // Remove OFF prefix — restore original marker note.
        // If only our placeholder remains, clear it entirely.
        const stripped = comment.replace(/^OFF\s*/i, "").trim();
        const restored =
          stripped.toLowerCase() === "time off request" ? "" : stripped;
        updateEntry(index, "comment", restored);
      } else {
        // Strip OCR "(marker note)" suffix — it's only a processing
        // hint and shouldn't appear in the user-facing comment.
        const cleaned = comment.replace(/\s*\(marker note\)\s*$/i, "").trim();
        updateEntry(
          index,
          "comment",
          cleaned ? `OFF ${cleaned}` : "OFF Time Off Request",
        );
      }
    },
    [entries, updateEntry],
  );

  const toggleAllOff = useCallback(() => {
    // Check if all entries are already marked OFF
    const allOff = entries.every((entry) =>
      entry.comment.toUpperCase().startsWith("OFF"),
    );

    const updated = entries.map((entry) => {
      if (allOff) {
        // Remove OFF prefix from all — restore original marker note.
        // If the remaining text is just our default placeholder
        // ("Time Off Request"), drop it so the original note shows as empty.
        const stripped = entry.comment.replace(/^OFF\s*/i, "").trim();
        return {
          ...entry,
          comment:
            stripped.toLowerCase() === "time off request" ? "" : stripped,
        };
      } else {
        // Mark as time-off — prepend "OFF" while keeping the original note
        // so it can be restored later.
        if (entry.comment.toUpperCase().startsWith("OFF")) {
          return entry;
        }
        // Strip OCR "(marker note)" before prepending OFF
        const cleaned = entry.comment
          .replace(/\s*\(marker note\)\s*$/i, "")
          .trim();
        return {
          ...entry,
          comment: cleaned ? `OFF ${cleaned}` : "OFF Time Off Request",
        };
      }
    });

    setAutoComments(serializeComments(updated));
  }, [entries, setAutoComments]);

  const handleReplaceAll = () => {
    if (!findText) return;
    const updated = autoComments.split(findText).join(replaceText);
    setAutoComments(updated);
  };

  const isOff = (comment: string) => comment.toUpperCase().startsWith("OFF");

  return (
    <SectionCard
      title="Employee Notes & Time-Off Requests"
      icon={<User2 className="text-sky-600" size={24} aria-hidden="true" />}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-500">
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAllOff}
            disabled={entries.length === 0}
            className="text-xs text-gray-500 hover:text-orange-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-orange-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              entries.every((e) => e.comment.toUpperCase().startsWith("OFF"))
                ? "Remove time-off from all entries"
                : "Mark all entries as time-off requests"
            }
          >
            <Plane className="h-3 w-3" />
            {entries.every((e) => e.comment.toUpperCase().startsWith("OFF"))
              ? "Clear All Time-Off"
              : "Mark All Time-Off"}
          </button>
          <button
            onClick={() => setShowFindReplace(!showFindReplace)}
            className="text-xs text-gray-500 hover:text-blue-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
          >
            <Search className="h-3 w-3" />
            Find & Replace
          </button>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
          >
            {showRaw ? "Visual Editor" : "Raw Editor"}
          </button>
        </div>
      </div>

      {/* Find & Replace (collapsed by default) */}
      {showFindReplace && (
        <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
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

      {showRaw ? (
        /* Raw textarea mode */
        <div>
          <div className="mb-2 flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 p-2 text-xs text-amber-700">
            <span>
              Format:{" "}
              <code className="bg-amber-100 px-1 rounded">
                Name|Date|Comment
              </code>{" "}
              — prefix comment with{" "}
              <code className="bg-amber-100 px-1 rounded">OFF</code> for
              time-off requests.
            </span>
          </div>
          <textarea
            value={autoComments}
            onChange={(e) => setAutoComments(e.target.value)}
            placeholder="Jane Doe|2025-06-02|OFF vacation&#10;John Smith|2025-06-05|training day"
            rows={8}
            className="w-full rounded-md border border-blue-200 bg-white p-3 text-sm font-mono"
          />
        </div>
      ) : (
        /* Visual card mode */
        <div className="space-y-2">
          {entries.length === 0 && (
            <div className="text-center py-8 text-gray-400 text-sm">
              <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
              No employee notes yet. Click &quot;Add Note&quot; or upload a
              schedule to auto-detect.
            </div>
          )}

          {entries.map((entry, idx) => {
            const off = isOff(entry.comment);
            return (
              <div
                key={idx}
                className={`group flex items-start gap-2 p-2.5 rounded-lg border transition-colors ${
                  off
                    ? "bg-orange-50 border-orange-200"
                    : "bg-white border-gray-200 hover:border-blue-200"
                }`}
              >
                {/* Off indicator */}
                <button
                  type="button"
                  onClick={() => toggleOff(idx)}
                  title={off ? "Remove time-off flag" : "Mark as time-off"}
                  className={`mt-1 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                    off
                      ? "bg-orange-500 text-white"
                      : "bg-gray-100 text-gray-400 hover:bg-orange-100 hover:text-orange-500"
                  }`}
                >
                  <Plane className="w-3.5 h-3.5" />
                </button>

                {/* Fields */}
                <div className="flex-1 grid grid-cols-[1fr_auto_1fr] gap-2 items-center min-w-0">
                  <input
                    type="text"
                    value={entry.name}
                    onChange={(e) => updateEntry(idx, "name", e.target.value)}
                    placeholder="Employee name"
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 min-w-0"
                  />
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(e) => updateEntry(idx, "date", e.target.value)}
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  />
                  <input
                    type="text"
                    value={
                      off
                        ? entry.comment
                            .replace(/^OFF\s*/i, "")
                            .replace(/\s*\(marker note\)\s*$/i, "")
                        : entry.comment.replace(/\s*\(marker note\)\s*$/i, "")
                    }
                    onChange={(e) =>
                      updateEntry(
                        idx,
                        "comment",
                        off ? `OFF ${e.target.value}` : e.target.value,
                      )
                    }
                    placeholder={
                      off ? "Reason (e.g., vacation)" : "Note / comment"
                    }
                    className="px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-1 focus:ring-blue-400 focus:border-blue-400 min-w-0"
                  />
                </div>

                {/* Delete */}
                <button
                  type="button"
                  onClick={() => removeEntry(idx)}
                  className="mt-1 flex-shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}

          {/* Add button */}
          <button
            type="button"
            onClick={addEntry}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Note
          </button>
        </div>
      )}

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
