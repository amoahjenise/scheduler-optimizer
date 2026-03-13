// Scheduler utility functions
import { ShiftEntry, OCRWarning, SHIFT_CODES } from "../types";

/**
 * Parse a shift code string into a ShiftEntry object
 */
export function parseShiftCode(shiftCode: string, date: string): ShiftEntry {
  const code = shiftCode.trim().toUpperCase();

  // Find matching shift code from our reference
  const matchedShift = SHIFT_CODES.find(
    (s) => s.code.toUpperCase() === code || code.includes(s.code.toUpperCase()),
  );

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
      for (const ocrPart of ocrParts) {
        for (const nursePart of nurseParts) {
          if (calculateSimilarity(ocrPart, nursePart) >= 0.85) {
            matchedParts++;
            break;
          }
        }
      }
      const partMatchRatio = matchedParts / ocrParts.length;
      if (partMatchRatio >= 0.8) {
        score = Math.max(score, 0.85 + partMatchRatio * 0.1);
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

    // Check individual name parts
    if (ocrParts.length > 0 && nurseParts.length > 0) {
      let matchedParts = 0;
      for (const ocrPart of ocrParts) {
        for (const nursePart of nurseParts) {
          if (calculateSimilarity(ocrPart, nursePart) >= 0.8) {
            matchedParts++;
            break;
          }
        }
      }
      const partMatchRatio = matchedParts / ocrParts.length;
      if (partMatchRatio > 0.5) {
        score = Math.max(score, 0.5 + partMatchRatio * 0.4);
      }
    }

    // Check first names match
    if (ocrParts.length >= 1 && nurseParts.length >= 1) {
      const firstNameScore = calculateSimilarity(ocrParts[0], nurseParts[0]);
      if (firstNameScore >= 0.8) {
        score = Math.max(score, firstNameScore * 0.7);
      }
    }

    // Boost score if employee IDs match
    const { employeeId } = extractNurseMetadata(ocrName);
    if (employeeId && nurse.employee_id === employeeId) {
      score = Math.max(score, 0.95);
    }

    if (score >= minThreshold) {
      matches.push({ nurse, score });
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
