// Scheduler utility functions
import {
  ShiftEntry,
  GridRow,
  OCRWarning,
  SHIFT_CODES,
  NIGHT_DEDUP_PAIRS,
} from "../types";

/**
 * Deduplicate wrap-around night shifts.
 *
 * Hospital schedules show overnight shifts across two calendar-day columns.
 * Only a plain Z23 (without "B") on day N+1 is a ghost/tail:
 *   Day N: Z19 / Z23 / Z23 B  →  Day N+1: Z23 (ghost — zero it out)
 * A Z23 B on day N+1 is always a REAL consecutive overnight shift:
 *   Day N: Z23 B  →  Day N+1: Z23 B (new shift — keep it)
 *
 * Example: Z19, Z23 B, Z23 B, Z23 → 3 real shifts + 1 ghost (last Z23)
 *
 * The shifts array MUST be sorted by date before calling this function.
 */
export function deduplicateNightShifts(shifts: ShiftEntry[]): ShiftEntry[] {
  if (shifts.length < 2) return shifts;

  // Work on a shallow copy so we don't mutate the original
  const result = shifts.map((s) => ({ ...s }));

  for (let i = 1; i < result.length; i++) {
    const prev = result[i - 1];
    const curr = result[i];

    // Skip empty entries
    if (!prev.shift || !curr.shift) continue;

    const prevCode = prev.shift
      .replace(/\s*\*\s*$/, "")
      .trim()
      .toUpperCase();
    const currCode = curr.shift
      .replace(/\s*\*\s*$/, "")
      .trim()
      .toUpperCase();

    // Check consecutive dates (day N → day N+1)
    const prevDate = new Date(prev.date + "T00:00:00");
    const currDate = new Date(curr.date + "T00:00:00");
    const diffMs = currDate.getTime() - prevDate.getTime();
    const isConsecutive = diffMs === 86400000; // exactly 1 day

    if (!isConsecutive) continue;

    // If (prevCode → currCode) is a known night dedup pair,
    // curr is the wrap-around continuation — zero it out.
    const validTails = NIGHT_DEDUP_PAIRS[prevCode];
    if (validTails && validTails.has(currCode)) {
      // Ensure the start shift carries the full block hours (11.25h)
      const startShiftDef = SHIFT_CODES.find(
        (s) => s.code.toUpperCase() === prevCode,
      );
      if (startShiftDef) {
        result[i - 1].hours = startShiftDef.hours; // 11.25
      }

      // Zero out the tail — it's not a separate shift
      result[i] = {
        ...result[i],
        hours: 0,
        shiftType: "night",
        startTime: "",
        endTime: "",
        // Keep the original shift text for display (add visual marker)
        shift: result[i].shift + " ↩",
      };
    }
  }

  return result;
}

/**
 * Apply night-shift ghost dedup to every row in a grid.
 * Convenience wrapper so every code path that sets ocrGrid can just call
 * `deduplicateGridGhosts(rows)` instead of manually iterating.
 *
 * Also removes duplicate nurse rows (same nurse name appearing multiple times).
 */
export function deduplicateGridGhosts(rows: GridRow[]): GridRow[] {
  // First, deduplicate rows by nurse name (case-insensitive)
  // If two rows have the same nurse name, merge their shifts (prefer non-empty shifts)
  const seenNurses = new Map<string, GridRow>();

  for (const row of rows) {
    const normalizedName = row.nurse.toLowerCase().trim();
    const existing = seenNurses.get(normalizedName);

    if (!existing) {
      seenNurses.set(normalizedName, row);
    } else {
      // Merge shifts - prefer non-empty shifts from either row
      const mergedShifts = existing.shifts.map((shift, idx) => {
        const otherShift = row.shifts[idx];
        if (!otherShift) return shift;
        // If existing shift is empty but other has data, use other
        if (
          (!shift.shift || shift.hours === 0) &&
          otherShift.shift &&
          otherShift.hours > 0
        ) {
          return otherShift;
        }
        return shift;
      });
      seenNurses.set(normalizedName, { ...existing, shifts: mergedShifts });
    }
  }

  const uniqueRows = Array.from(seenNurses.values());

  // Then apply night-shift ghost deduplication to each row
  return uniqueRows.map((row) => ({
    ...row,
    shifts: deduplicateNightShifts(
      [...row.shifts].sort((a, b) => a.date.localeCompare(b.date)),
    ),
  }));
}

/**
 * Parse a shift code string into a ShiftEntry object
 */
export function parseShiftCode(shiftCode: string, date: string): ShiftEntry {
  const code = shiftCode.trim().toUpperCase();

  // Find matching shift code from our reference.
  // IMPORTANT: Try exact match first, then fall back to substring matching
  // with longest-code-first ordering.  This prevents "Z07" from matching the
  // shorter "07" code (7.5h) instead of the correct "Z07" (11.25h).
  const exactMatch = SHIFT_CODES.find((s) => s.code.toUpperCase() === code);
  // For substring matching, sort candidates by code length DESC so longer
  // codes (Z07, Z23 B) are tested before shorter ones (07, 23).
  const substringMatch = !exactMatch
    ? [...SHIFT_CODES]
        .sort((a, b) => b.code.length - a.code.length)
        .find((s) => code.includes(s.code.toUpperCase()))
    : undefined;
  const matchedShift = exactMatch || substringMatch;

  if (matchedShift) {
    return {
      date,
      shift: shiftCode.trim(),
      shiftType: matchedShift.type,
      hours: matchedShift.hours,
      startTime: matchedShift.start,
      endTime: matchedShift.end,
    };
  }

  // Handle common codes
  if (
    !shiftCode ||
    shiftCode.trim() === "" ||
    shiftCode.toLowerCase() === "off" ||
    shiftCode === "c"
  ) {
    return {
      date,
      shift: shiftCode.trim() || "",
      shiftType: "day",
      hours: 0,
      startTime: "",
      endTime: "",
    };
  }

  // Detect night shifts by code pattern
  const codeUpper = shiftCode.trim().toUpperCase();
  const isNightShift =
    codeUpper.startsWith("N") ||
    codeUpper.startsWith("ZN") ||
    codeUpper === "23" ||
    codeUpper === "Z19" ||
    codeUpper === "Z23" ||
    codeUpper.startsWith("Z23") ||
    codeUpper.includes("ZE2");

  // Default for unknown codes
  return {
    date,
    shift: shiftCode.trim(),
    shiftType: isNightShift ? "night" : "day",
    hours: 8,
    startTime: isNightShift ? "19:00" : "07:00",
    endTime: isNightShift ? "07:00" : "15:00",
  };
}

/**
 * Clean and normalize nurse names for deduplication
 * Returns object with cleaned name and extracted employee ID
 */
export function cleanNurseName(name: string): string {
  if (!name) return name;

  // Replace newlines with spaces (handles multi-line names like "Trong Khoi\nTran")
  let cleaned = name.replace(/[\n\r]+/g, " ").trim();
  // Consolidate multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ");

  // Remove common OCR garbage patterns:
  // Pattern: "42564 7Y-339.27D" or "783 8.40D" or "197.40D 33:45"
  cleaned = cleaned.replace(/\s+\d+\s+\d*Y?-?\d*\.?\d*D?\s*$/i, ""); // Employee ID + code
  cleaned = cleaned.replace(/\s+\d+\s+\d+\.\d+D?\s*$/i, ""); // "783 8.40D"
  cleaned = cleaned.replace(/\s+\d+\.\d+D\s*\d*:?\d*\s*$/i, ""); // "197.40D 33:45"
  cleaned = cleaned.replace(/\s+\d+:?\d*\s*$/i, ""); // Trailing time "45:00"
  cleaned = cleaned.replace(/\s+\d{3,}\s*$/i, ""); // Trailing 3+ digit numbers
  cleaned = cleaned.replace(/\s+Y-\d+\.\d+D?\s*$/i, ""); // "Y-318.18D"
  cleaned = cleaned.replace(/\s+\d+Y-\d+\.\d+D?\s*$/i, ""); // "7Y-339.27D"

  // Remove any remaining numeric/ID patterns at start or end
  cleaned = cleaned.replace(/^\d+[\s-]*/g, ""); // Leading numbers
  cleaned = cleaned.replace(/[\s-]*\d+$/g, ""); // Trailing numbers

  // Remove patterns with decimal numbers (employee codes)
  cleaned = cleaned.replace(/\s*\d+\.\d+[A-Z]*\s*/gi, " ");

  // Remove standalone numbers
  cleaned = cleaned.replace(/\b\d+\b/g, "");

  // Clean up: remove non-letter characters except spaces, hyphens, apostrophes
  cleaned = cleaned.replace(/[^a-zA-ZÀ-ÿ\s'-]/g, "");

  // Remove trailing dashes, hyphens, and any trailing single characters after dash
  // This handles OCR issues like "Glodovizay-" or "Smith-X" where garbage appears at the end
  cleaned = cleaned.replace(/[-–—]+[a-zA-Z]?$/g, "");
  cleaned = cleaned.replace(/\s+[a-zA-Z][-–—]*$/g, ""); // Single letter at end after space

  // Additional: Remove trailing single letter if it appears to be OCR garbage
  // (e.g., "Glodovizay" -> "Glodoviza" if last word ends with single letter that makes word look odd)
  // Only remove if the last character is 'y', 'x', 'z' followed by nothing (common OCR mistakes)
  const words = cleaned.split(" ");
  if (words.length > 0) {
    const lastWord = words[words.length - 1];
    // If last word ends with 'ay' or 'ey' or other suspicious patterns and word is long enough
    if (lastWord.length > 4 && /[aeiouy]y$/i.test(lastWord)) {
      // Check if removing the trailing 'y' results in a valid-looking name ending
      const withoutY = lastWord.slice(0, -1);
      if (/[aeiou]$/.test(withoutY)) {
        // Ends with a vowel after removing 'y' - likely correct (e.g., "Glodovizay" -> "Glodoviza")
        words[words.length - 1] = withoutY;
        cleaned = words.join(" ");
      }
    }
  }

  // Clean up whitespace
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  // Capitalize first letter of each word
  cleaned = cleaned
    .split(" ")
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

  return cleaned;
}

/**
 * Extract employee ID and seniority from nurse name if present
 * Example input: "Tiffany Glodoviza 47554 3Y-283.95D"
 * Returns: { employeeId: "47554", seniority: "3Y-283.95D" }
 */
export function extractNurseMetadata(name: string): {
  employeeId?: string;
  seniority?: string;
} {
  if (!name) return {};

  // Pattern to match: employee ID (3-5 digits) followed by seniority (XY-XXX.XXD format)
  // Example: "47554 3Y-283.95D" or "7580 197.40D"
  const fullPattern = /\s+(\d{3,5})\s+(\d*Y?-?\d+\.?\d*D)\s*$/i;
  const fullMatch = name.match(fullPattern);
  if (fullMatch) {
    return {
      employeeId: fullMatch[1],
      seniority: fullMatch[2],
    };
  }

  // Pattern for just seniority without employee ID: "Y-268.22D" or "197.40D"
  const seniorityOnlyPattern = /\s+(\d*Y?-?\d+\.\d+D)\s*$/i;
  const seniorityMatch = name.match(seniorityOnlyPattern);
  if (seniorityMatch) {
    return {
      seniority: seniorityMatch[1],
    };
  }

  // Pattern for just employee ID
  const idOnlyPattern = /\s+(\d{3,5})\s*$/i;
  const idMatch = name.match(idOnlyPattern);
  if (idMatch) {
    return {
      employeeId: idMatch[1],
    };
  }

  return {};
}

/**
 * Extract employee ID from nurse name if present
 * @deprecated Use extractNurseMetadata instead
 */
export function extractEmployeeId(name: string): string | undefined {
  if (!name) return undefined;

  // Match patterns like "42564 7Y-339.27D" or "783 8.40D" at the end
  const patterns = [
    /\s+(\d{3,})\s+\d*Y?-?\d*\.?\d*D?\s*$/i, // "42564 7Y-339.27D"
    /\s+(\d{3,})\s+\d+\.\d+D?\s*$/i, // "783 8.40D"
    /\s+(\d{3,})\s*$/i, // Just "783"
  ];

  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Detect potential OCR issues with a name
 */
export function detectOCRIssues(name: string): OCRWarning | null {
  if (!name) return null;
  const cleaned = cleanNurseName(name);
  if (!cleaned) return null;

  const parts = cleaned.split(" ");

  // Check for names that start with lowercase (likely missing first letter)
  for (const part of parts) {
    if (part.length > 0) {
      const firstChar = part[0];
      // Check if first letter is lowercase but rest has uppercase
      if (
        firstChar === firstChar.toLowerCase() &&
        /[A-Z]/.test(part.slice(1))
      ) {
        return {
          name: cleaned,
          issue: `Possible missing first letter: "${part}" - might be "${firstChar.toUpperCase()}${part.slice(1)}"`,
          severity: "warning",
        };
      }
      // Check if first letter is lowercase when it should be uppercase
      if (
        part.length >= 2 &&
        firstChar === firstChar.toLowerCase() &&
        firstChar !== firstChar.toUpperCase()
      ) {
        return {
          name: cleaned,
          issue: `Name starts with lowercase: "${part}" - may be OCR error`,
          severity: "warning",
        };
      }
    }
  }

  // Check for very short first or last names (1-2 chars) - possible truncation
  if (parts.length >= 2) {
    if (parts[0].length <= 2 && !/^[A-Z]\.?$/i.test(parts[0])) {
      return {
        name: cleaned,
        issue: `Very short first name: "${parts[0]}" - possible OCR truncation`,
        severity: "warning",
      };
    }
    if (parts[parts.length - 1].length <= 2) {
      return {
        name: cleaned,
        issue: `Very short last name: "${parts[parts.length - 1]}" - possible OCR truncation`,
        severity: "warning",
      };
    }
  }

  // Check for unusual characters that might indicate OCR garbage
  if (/[0-9]/.test(cleaned)) {
    return {
      name: cleaned,
      issue: `Contains numbers - possible OCR artifact`,
      severity: "warning",
    };
  }

  return null;
}

/**
 * Normalize nurse names for deduplication
 */
export function normalizeNurseName(name: string): string {
  // First clean the name
  const cleaned = cleanNurseName(name);

  // Normalize: lowercase, collapse whitespace
  let normalized = cleaned.toLowerCase().replace(/\s+/g, " ").trim();

  // Remove any remaining trailing numeric suffixes
  const parts = normalized.split(" ");
  const nameParts: string[] = [];
  for (const part of parts) {
    // Stop when we hit a numeric-only part or something that looks like a code
    if (/^\d+$/.test(part) || /^\d*[yd]?-?\d*\.?\d*[yd]?$/i.test(part)) {
      break;
    }
    nameParts.push(part);
  }

  normalized = nameParts.join(" ");
  return normalized;
}

/**
 * Extract OFF dates from autoComments
 */
export function extractOffDatesFromComments(
  autoComments: string,
): Record<string, string[]> {
  const nurseOffDates: Record<string, string[]> = {};

  if (!autoComments) return nurseOffDates;

  const commentLines = autoComments.split("\n").filter(Boolean);
  for (const line of commentLines) {
    const parts = line.split("|");
    if (parts.length >= 3) {
      const nurseName = parts[0].trim();
      const date = parts[1].trim();
      const commentText = parts.slice(2).join("|").trim().toLowerCase();
      const shiftCode = commentText.split(/[\s(]/)[0].toUpperCase();

      const isOffKeyword =
        commentText.includes("off") || commentText.includes("vacation");
      const isOffShiftCode =
        shiftCode === "C" ||
        shiftCode === "CF" ||
        shiftCode === "OFF" ||
        shiftCode.startsWith("CF");

      if (isOffKeyword || isOffShiftCode) {
        if (!nurseOffDates[nurseName]) nurseOffDates[nurseName] = [];
        if (!nurseOffDates[nurseName].includes(date)) {
          nurseOffDates[nurseName].push(date);
        }
      }
    }
  }

  return nurseOffDates;
}

/**
 * Get default dates (today and two weeks later)
 */
export function getDefaultDates(): { today: string; twoWeeksLater: string } {
  const today = new Date().toISOString().split("T")[0];
  const twoWeeksLater = new Date(Date.now() + 13 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  return { today, twoWeeksLater };
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * Returns a score between 0 (completely different) and 1 (identical)
 */
export function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Create matrix for Levenshtein distance
  const matrix: number[][] = [];
  for (let i = 0; i <= s1.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= s2.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= s1.length; i++) {
    for (let j = 1; j <= s2.length; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  const distance = matrix[s1.length][s2.length];
  const maxLength = Math.max(s1.length, s2.length);
  return 1 - distance / maxLength;
}

/**
 * Find the best matching nurse from a list of existing nurses
 * Uses fuzzy matching to handle OCR errors
 * Returns the matched nurse and similarity score, or null if no good match
 */
export function findBestNurseMatch(
  ocrName: string,
  existingNurses: Array<{
    name: string;
    employee_id?: string;
    [key: string]: any;
  }>,
  threshold: number = 0.75,
): { nurse: (typeof existingNurses)[0]; score: number } | null {
  if (!ocrName || existingNurses.length === 0) return null;

  const cleanedOcrName = cleanNurseName(ocrName);
  if (!cleanedOcrName) return null;

  let bestMatch: (typeof existingNurses)[0] | null = null;
  let bestScore = 0;

  const ocrLower = cleanedOcrName.toLowerCase();
  const ocrParts = cleanedOcrName.split(" ");

  for (const nurse of existingNurses) {
    const nurseLower = nurse.name.toLowerCase();
    const nurseParts = nurse.name.split(" ");

    // Try full name match
    let score = calculateSimilarity(cleanedOcrName, nurse.name);

    // IMPORTANT: Check if OCR name is a single word that matches any part of DB name
    // e.g., "Khoi" should match "Trong Khoi Tran" (Khoi is the middle name)
    // e.g., "Imoya" should match "Maki Shimoya" (partial match on last name)
    if (ocrParts.length === 1) {
      for (const nursePart of nurseParts) {
        // Exact match with any name part
        if (nursePart.toLowerCase() === ocrLower) {
          score = Math.max(score, 0.92); // Very high score for exact match of a name part
        }
        // OCR truncation: Check if OCR name matches the END of a DB name part
        // e.g., "Omi" matching end of "Naomi", "Zabeth" matching end of "Elizabeth"
        else if (
          nursePart.toLowerCase().endsWith(ocrLower) &&
          ocrLower.length >= 3
        ) {
          // Strong match if it's a suffix - common OCR error
          const suffixRatio = ocrLower.length / nursePart.length;
          score = Math.max(score, 0.75 + suffixRatio * 0.15);
        }
        // Partial match - OCR name is contained within a name part
        // e.g., "Imoya" in "Shimoya"
        else if (
          nursePart.toLowerCase().includes(ocrLower) &&
          ocrLower.length >= 3
        ) {
          const containmentScore = ocrLower.length / nursePart.length;
          score = Math.max(score, 0.8 + containmentScore * 0.1);
        }
        // Partial match - name part is contained within OCR
        else if (
          ocrLower.includes(nursePart.toLowerCase()) &&
          nursePart.length >= 3
        ) {
          const containmentScore = nursePart.length / ocrLower.length;
          score = Math.max(score, 0.8 + containmentScore * 0.1);
        }
        // Fuzzy match on individual name parts
        else {
          const partScore = calculateSimilarity(
            ocrLower,
            nursePart.toLowerCase(),
          );
          if (partScore >= 0.8) {
            score = Math.max(score, partScore * 0.95);
          }
        }
      }
    }

    // Also check first name + last initial match (common in schedules)
    if (ocrParts.length >= 1 && nurseParts.length >= 2) {
      // Check if first names match well
      const firstNameScore = calculateSimilarity(ocrParts[0], nurseParts[0]);

      // Check last name initial if OCR only has first name + initial
      if (ocrParts.length === 2 && ocrParts[1].length <= 2) {
        const lastNameInitial = nurseParts[nurseParts.length - 1][0];
        if (
          ocrParts[1].toUpperCase().startsWith(lastNameInitial.toUpperCase())
        ) {
          score = Math.max(score, firstNameScore * 0.9); // Boost but not full score
        }
      }

      // Check if first name matches and last name is similar
      if (ocrParts.length >= 2 && nurseParts.length >= 2) {
        const lastNameScore = calculateSimilarity(
          ocrParts[ocrParts.length - 1],
          nurseParts[nurseParts.length - 1],
        );
        const combinedScore = firstNameScore * 0.5 + lastNameScore * 0.5;
        score = Math.max(score, combinedScore);
      }
    }

    // Check if OCR multi-word name matches parts of DB name
    // e.g., "Trong Khoi" should match "Trong Khoi Tran"
    if (ocrParts.length >= 2) {
      let matchedParts = 0;
      let totalPartScore = 0;
      for (const ocrPart of ocrParts) {
        let bestPartMatch = 0;
        for (const nursePart of nurseParts) {
          const partSimilarity = calculateSimilarity(ocrPart, nursePart);
          bestPartMatch = Math.max(bestPartMatch, partSimilarity);
          // Lower threshold to catch OCR variations like "Asmine" vs "Jasmine"
          if (partSimilarity >= 0.7) {
            matchedParts++;
            totalPartScore += partSimilarity;
            break;
          }
        }
        // Even if not matched above threshold, add the best score
        if (bestPartMatch < 0.7) {
          totalPartScore += bestPartMatch;
        }
      }
      const partMatchRatio = matchedParts / ocrParts.length;
      if (partMatchRatio >= 0.6) {
        // Lower threshold from 0.8 to 0.6 to catch partial matches
        const avgScore = totalPartScore / ocrParts.length;
        score = Math.max(score, 0.75 + avgScore * 0.15);
      }
    }

    // Special case: Check first name similarity with suffix matching
    // Handles cases like "Heila" vs "Sheila", "Omi" vs "Naomi"
    if (ocrParts.length >= 1 && nurseParts.length >= 1) {
      const ocrFirst = ocrParts[0].toLowerCase();
      const dbFirst = nurseParts[0].toLowerCase();

      // Check if OCR first name is a suffix of DB first name (truncated start)
      if (dbFirst.endsWith(ocrFirst) && ocrFirst.length >= 3) {
        const suffixRatio = ocrFirst.length / dbFirst.length;
        const baseScore = 0.7 + suffixRatio * 0.2;

        // If last names also match well, boost the score significantly
        if (ocrParts.length >= 2 && nurseParts.length >= 2) {
          const lastScore = calculateSimilarity(
            ocrParts[ocrParts.length - 1],
            nurseParts[nurseParts.length - 1],
          );
          if (lastScore >= 0.7) {
            score = Math.max(score, baseScore + lastScore * 0.2);
          }
        } else {
          score = Math.max(score, baseScore);
        }
      }
    }

    // Boost score if employee IDs match
    const { employeeId } = extractNurseMetadata(ocrName);
    if (employeeId && nurse.employee_id === employeeId) {
      score = Math.max(score, 0.95); // Strong match if employee ID matches
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = nurse;
    }
  }

  if (bestMatch && bestScore >= threshold) {
    return { nurse: bestMatch, score: bestScore };
  }

  return null;
}

/**
 * Get all potential matches for an OCR nurse name with their similarity scores
 * Returns matches above a low threshold for user selection
 */
export function getPotentialMatches<
  T extends { name: string; employee_id?: string },
>(
  ocrName: string,
  existingNurses: T[],
  minThreshold: number = 0.4, // Low threshold to show potential matches
): Array<{ nurse: T; score: number }> {
  const matches: Array<{ nurse: T; score: number }> = [];
  const cleanedOcrName = cleanNurseName(ocrName);
  const ocrParts = cleanedOcrName
    .toLowerCase()
    .split(/\s+/)
    .filter((p) => p.length > 0);

  console.log(
    `[getPotentialMatches] Matching OCR name: "${ocrName}" -> cleaned: "${cleanedOcrName}"`,
  );
  console.log(`[getPotentialMatches] OCR parts:`, ocrParts);
  console.log(
    `[getPotentialMatches] Checking against ${existingNurses.length} nurses`,
  );

  for (const nurse of existingNurses) {
    let score = 0;
    const cleanedDbName = cleanNurseName(nurse.name);
    const nurseParts = cleanedDbName
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length > 0);

    // Full name similarity
    score = calculateSimilarity(
      cleanedOcrName.toLowerCase(),
      cleanedDbName.toLowerCase(),
    );

    const debugScores: string[] = [`base=${score.toFixed(3)}`];

    // ENHANCED: Single word OCR name matching
    if (ocrParts.length === 1) {
      const ocrLower = ocrParts[0];
      for (const nursePart of nurseParts) {
        const nursePartLower = nursePart.toLowerCase();

        // Exact match with any name part
        if (nursePartLower === ocrLower) {
          score = Math.max(score, 0.92);
          debugScores.push(`exact=0.92`);
        }
        // OCR truncation: Check if OCR name matches the END of a DB name part
        else if (nursePartLower.endsWith(ocrLower) && ocrLower.length >= 3) {
          const suffixRatio = ocrLower.length / nursePartLower.length;
          const suffixScore = 0.75 + suffixRatio * 0.15;
          score = Math.max(score, suffixScore);
          debugScores.push(`suffix(${nursePart})=${suffixScore.toFixed(3)}`);
        }
        // Partial containment
        else if (nursePartLower.includes(ocrLower) && ocrLower.length >= 3) {
          const containmentScore = ocrLower.length / nursePartLower.length;
          const contScore = 0.8 + containmentScore * 0.1;
          score = Math.max(score, contScore);
          debugScores.push(`contains=${contScore.toFixed(3)}`);
        }
        // Fuzzy match on individual parts
        else {
          const partScore = calculateSimilarity(ocrLower, nursePartLower);
          if (partScore >= 0.7) {
            const fuzzyScore = partScore * 0.95;
            score = Math.max(score, fuzzyScore);
            debugScores.push(`fuzzy(${nursePart})=${fuzzyScore.toFixed(3)}`);
          }
        }
      }
    }

    // Check individual name parts with LOWER threshold
    if (ocrParts.length > 0 && nurseParts.length > 0) {
      let matchedParts = 0;
      let totalPartScore = 0;
      for (const ocrPart of ocrParts) {
        let bestPartMatch = 0;
        for (const nursePart of nurseParts) {
          const partSim = calculateSimilarity(ocrPart, nursePart);
          bestPartMatch = Math.max(bestPartMatch, partSim);
          // Lower threshold to 0.7 to catch OCR variations
          if (partSim >= 0.7) {
            matchedParts++;
            totalPartScore += partSim;
            break;
          }
        }
        if (bestPartMatch < 0.7) {
          totalPartScore += bestPartMatch;
        }
      }
      const partMatchRatio = matchedParts / ocrParts.length;
      if (partMatchRatio >= 0.6) {
        const avgScore = totalPartScore / ocrParts.length;
        const multiScore = 0.75 + avgScore * 0.15;
        score = Math.max(score, multiScore);
        debugScores.push(
          `multiPart(${matchedParts}/${ocrParts.length})=${multiScore.toFixed(3)}`,
        );
      } else if (partMatchRatio > 0) {
        // Even partial matches should contribute
        const avgScore = totalPartScore / ocrParts.length;
        const partialScore = avgScore * 0.9;
        score = Math.max(score, partialScore);
        debugScores.push(`partial=${partialScore.toFixed(3)}`);
      }
    }

    // Check first name with suffix matching
    if (ocrParts.length >= 1 && nurseParts.length >= 1) {
      const ocrFirst = ocrParts[0];
      const dbFirst = nurseParts[0].toLowerCase();

      // Check if OCR first name is a suffix of DB first name
      // This catches OCR truncations like "Arianna" vs "Marianna" (missing leading "M")
      if (dbFirst.endsWith(ocrFirst) && ocrFirst.length >= 3) {
        const suffixRatio = ocrFirst.length / dbFirst.length;
        const baseScore = 0.7 + suffixRatio * 0.2;

        // If last names also match well, boost significantly
        if (ocrParts.length >= 2 && nurseParts.length >= 2) {
          const lastScore = calculateSimilarity(
            ocrParts[ocrParts.length - 1],
            nurseParts[nurseParts.length - 1],
          );
          if (lastScore >= 0.7) {
            const comboScore = baseScore + lastScore * 0.2;
            score = Math.max(score, comboScore);
            debugScores.push(`firstSuffix+last=${comboScore.toFixed(3)}`);
          }
        } else {
          score = Math.max(score, baseScore);
          debugScores.push(`firstSuffix=${baseScore.toFixed(3)}`);
        }
      }

      // NEW: Check if OCR first name differs by only 1-2 leading chars from DB first name
      // This catches cases like "Arianna" (OCR) vs "Marianna" (DB) where leading char is mangled/dropped
      if (ocrFirst.length >= 4 && dbFirst.length >= 4) {
        // Check if removing 1 or 2 chars from start of dbFirst gives ocrFirst
        const db1 = dbFirst.slice(1); // "arianna" from "marianna"
        const db2 = dbFirst.slice(2); // "rianna" from "marianna"
        if (db1 === ocrFirst || db2 === ocrFirst) {
          // OCR truncated first chars of first name
          if (ocrParts.length >= 2 && nurseParts.length >= 2) {
            const lastScore = calculateSimilarity(
              ocrParts[ocrParts.length - 1],
              nurseParts[nurseParts.length - 1],
            );
            if (lastScore >= 0.7) {
              const truncScore = 0.85 + lastScore * 0.1;
              score = Math.max(score, truncScore);
              debugScores.push(`truncFirst+last=${truncScore.toFixed(3)}`);
            }
          } else {
            score = Math.max(score, 0.82);
            debugScores.push(`truncFirst=0.82`);
          }
        }
        // Also check if ocrFirst is similar to dbFirst but with leading char mismatch
        // e.g., "Arianna" vs "Marianna" - suffix "rianna" matches
        const ocrSuffix = ocrFirst.slice(1); // "rianna" from "arianna"
        if (ocrSuffix.length >= 4 && dbFirst.includes(ocrSuffix)) {
          if (ocrParts.length >= 2 && nurseParts.length >= 2) {
            const lastScore = calculateSimilarity(
              ocrParts[ocrParts.length - 1],
              nurseParts[nurseParts.length - 1],
            );
            if (lastScore >= 0.7) {
              const suffixMatchScore = 0.8 + lastScore * 0.15;
              score = Math.max(score, suffixMatchScore);
              debugScores.push(
                `innerSuffix+last=${suffixMatchScore.toFixed(3)}`,
              );
            }
          }
        }
      }

      // Also check standard first name matching
      const firstNameScore = calculateSimilarity(ocrFirst, dbFirst);
      if (firstNameScore >= 0.7) {
        const firstScore = firstNameScore * 0.8;
        score = Math.max(score, firstScore);
        debugScores.push(`firstName=${firstScore.toFixed(3)}`);
      }
    }

    // Boost score if employee IDs match
    const { employeeId } = extractNurseMetadata(ocrName);
    if (employeeId && nurse.employee_id === employeeId) {
      score = Math.max(score, 0.95);
      debugScores.push(`empId=0.95`);
    }

    if (score >= minThreshold) {
      console.log(
        `  ✓ "${nurse.name}" score=${score.toFixed(3)} [${debugScores.join(", ")}]`,
      );
      matches.push({ nurse, score });
    } else if (score >= 0.3) {
      // Log near-misses for debugging
      console.log(
        `  ✗ "${nurse.name}" score=${score.toFixed(3)} (below ${minThreshold}) [${debugScores.join(", ")}]`,
      );
    }
  }

  // Sort by score descending
  return matches.sort((a, b) => b.score - a.score).slice(0, 5); // Top 5 matches
}

/**
 * Match OCR-extracted nurses against existing database nurses
 * Returns arrays of matched and unmatched nurses
 */
export function matchNursesWithDatabase(
  ocrNames: string[],
  existingNurses: Array<{
    name: string;
    employee_id?: string;
    [key: string]: any;
  }>,
  threshold: number = 0.75,
): {
  matched: Array<{
    ocrName: string;
    dbNurse: (typeof existingNurses)[0];
    score: number;
  }>;
  unmatched: string[];
} {
  const matched: Array<{
    ocrName: string;
    dbNurse: (typeof existingNurses)[0];
    score: number;
  }> = [];
  const unmatched: string[] = [];
  const usedDbNurses = new Set<string>();

  // Sort OCR names by length (longer names first for better matching)
  const sortedOcrNames = [...ocrNames].sort((a, b) => b.length - a.length);

  for (const ocrName of sortedOcrNames) {
    // Filter out already-matched DB nurses
    const availableNurses = existingNurses.filter(
      (n) => !usedDbNurses.has(n.name),
    );
    const match = findBestNurseMatch(ocrName, availableNurses, threshold);

    if (match) {
      matched.push({ ocrName, dbNurse: match.nurse, score: match.score });
      usedDbNurses.add(match.nurse.name);
    } else {
      unmatched.push(ocrName);
    }
  }

  return { matched, unmatched };
}
