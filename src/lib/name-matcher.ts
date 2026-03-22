export function cleanName(name: string): string {
  if (!name) return "";
  
  return name
    .toLowerCase()
    // Remove common titles
    .replace(/\b(mr|mrs|ms|dr|miss|rev)\b\.?/gi, "")
    // Remove all punctuation
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    // Collapse multiple spaces into one and trim
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Calculates the Levenshtein distance between two strings.
 * Represents the minimum number of single-character edits required to change one word into the other.
 */
export function calculateLevenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // increment along the first column of each row
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // increment each column in the first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1  // deletion
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Attempts to map a newly discovered raw name into a pre-existing canonical bucket.
 * Matches using full substring inclusion OR a tight Levenshtein distance.
 */
export function findCanonicalName(rawName: string, existingNames: string[]): string {
  if (!rawName) return rawName;
  if (rawName.toLowerCase() === "current resident" || rawName.toLowerCase() === "null") return rawName;

  const cleanedRaw = cleanName(rawName);
  if (!cleanedRaw) return rawName;

  for (const existing of existingNames) {
    if (!existing) continue;
    
    // Ignore matching against "Current Resident" dynamically to avoid false positives
    if (existing.toLowerCase() === "current resident") continue;

    const cleanedExisting = cleanName(existing);
    if (!cleanedExisting) continue;

    if (cleanedExisting.includes(cleanedRaw) || cleanedRaw.includes(cleanedExisting)) {
      return existing;
    }

    // Tokenized Word Intersection (solves "Leo Wu-Hacohen" vs "Leo Song Wu-Hacohen")
    const wordsRaw = cleanedRaw.split(" ").filter(Boolean);
    const wordsExisting = cleanedExisting.split(" ").filter(Boolean);
    
    if (wordsRaw.length > 0 && wordsExisting.length > 0) {
      let matchCount = 0;
      for (const w of wordsRaw) {
        if (wordsExisting.includes(w)) matchCount++;
      }
      
      const minWords = Math.min(wordsRaw.length, wordsExisting.length);
      const requiredMatches = minWords >= 2 ? 2 : 1;
      const hasSignificantMatch = wordsRaw.some(w => wordsExisting.includes(w) && w.length > 2);

      if (matchCount >= requiredMatches && hasSignificantMatch) {
         return existing;
      }
    }

    // Mathematical Levenshtein threshold (tolerates up to 2 character typos/mistakes)
    const distance = calculateLevenshtein(cleanedRaw, cleanedExisting);
    
    // Only apply fuzzy distances on strings long enough to warrant it (avoids matching "Ed" to "Al")
    if (cleanedRaw.length > 3 && cleanedExisting.length > 3 && distance <= 2) {
       return existing;
    }
  }

  // No close match found; return the raw string so it becomes a new canonical bucket
  return rawName;
}
