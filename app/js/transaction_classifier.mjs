/*
  A small, account-specific machine-learning helper.

  It compares a new note with the notes this signed-in user has already
  categorized. It never sends text to an AI service.
*/
const MIN_EXAMPLES = 8;
const MIN_NOTES_PER_CATEGORY = 3;
const MINIMUM_SIMILARITY = 0.55;
const MINIMUM_VOTE_SHARE = 0.72;

function normalizeNote(note) {
  return String(note ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function makeTerms(note) {
  const words = normalizeNote(note).match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words.filter((word) => word.length > 1).map((word) => "word:" + word);
  for (let index = 0; index < words.length - 1; index += 1) {
    terms.push("pair:" + words[index] + "_" + words[index + 1]);
  }
  return terms;
}

function makeVector(terms, inverseDocumentFrequency) {
  const counts = new Map();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);

  const vector = new Map();
  let squaredLength = 0;
  for (const [term, count] of counts) {
    const weight = count * inverseDocumentFrequency(term);
    vector.set(term, weight);
    squaredLength += weight * weight;
  }

  const length = Math.sqrt(squaredLength);
  if (length > 0) {
    for (const [term, weight] of vector) vector.set(term, weight / length);
  }
  return vector;
}

function cosineSimilarity(first, second) {
  let similarity = 0;
  for (const [term, weight] of first) {
    similarity += weight * (second.get(term) ?? 0);
  }
  return similarity;
}

/* Return a suggestion only when the user's own history has enough examples. */
export function suggestCategoryFromHistory(transactions, type, note) {
  const queryTerms = makeTerms(note);
  if (queryTerms.length === 0) return { status: "empty-note" };

  // Count each different note once so repeated entries do not dominate learning.
  const examplesByKey = new Map();
  for (const entry of Array.isArray(transactions) ? transactions : []) {
    if (entry?.type !== type || typeof entry?.category !== "string") continue;
    const normalized = normalizeNote(entry.note);
    if (!normalized) continue;
    const key = normalized + "\u0000" + entry.category;
    if (!examplesByKey.has(key)) {
      examplesByKey.set(key, { note: normalized, category: entry.category });
    }
  }

  const examples = [...examplesByKey.values()];
  const examplesPerCategory = new Map();
  for (const example of examples) {
    examplesPerCategory.set(
      example.category,
      (examplesPerCategory.get(example.category) ?? 0) + 1,
    );
  }
  const trainedCategories = [...examplesPerCategory.values()]
    .filter((count) => count >= MIN_NOTES_PER_CATEGORY).length;
  if (examples.length < MIN_EXAMPLES || trainedCategories < 2) {
    return { status: "not-enough-history" };
  }

  // Weight distinctive words more heavily than words used in every note.
  const documentFrequency = new Map();
  const exampleTerms = examples.map((example) => makeTerms(example.note));
  for (const terms of exampleTerms) {
    for (const term of new Set(terms)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const inverseDocumentFrequency = (term) =>
    Math.log((examples.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;

  const queryVector = makeVector(queryTerms, inverseDocumentFrequency);
  const neighbors = examples
    .map((example, index) => ({
      category: example.category,
      similarity: cosineSimilarity(
        queryVector,
        makeVector(exampleTerms[index], inverseDocumentFrequency),
      ),
    }))
    .filter((neighbor) => neighbor.similarity > 0)
    .sort((first, second) => second.similarity - first.similarity)
    .slice(0, 3);

  if (!neighbors.length || neighbors[0].similarity < MINIMUM_SIMILARITY) {
    return { status: "no-close-match" };
  }

  const votes = new Map();
  for (const neighbor of neighbors) {
    votes.set(neighbor.category, (votes.get(neighbor.category) ?? 0) + neighbor.similarity);
  }
  const rankedVotes = [...votes.entries()].sort((first, second) => second[1] - first[1]);
  const totalVote = rankedVotes.reduce((sum, [, weight]) => sum + weight, 0);
  const [category, winningVote] = rankedVotes[0];
  if (winningVote / totalVote < MINIMUM_VOTE_SHARE) {
    return { status: "uncertain-match" };
  }
  return { status: "suggestion", category };
}
