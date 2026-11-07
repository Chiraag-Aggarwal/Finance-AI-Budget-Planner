// Multinomial Naive Bayes trained on the explicitly synthetic note dataset.
// A new model instance belongs to one mounted account; it retains no other users' notes.
import { STARTER_MODELS } from "./starter_models.mjs";
import { suggestCategoryFromHistory } from "./transaction_classifier.mjs";

const model = STARTER_MODELS.category;
const vocabulary = new Set(model.vocabulary);
const stopWords = new Set(model.stopWords);
const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
function terms(value) {
  return (normalize(value).match(/[\p{L}\p{N}\p{M}]+/gu) || []).filter(
    (word) => word.length > 1 && !stopWords.has(word) && !/^\p{N}+$/u.test(word),
  );
}

export function suggestStarterCategory(type, note) {
  const text = normalize(note);
  if (!text) return { status: "empty-note" };
  // Transfers, negation and mixed purposes need human context.
  if (/(?:\bnot\b|\bexcept\b|नहीं)/u.test(text)) return { status: "uncertain-match" };
  const words = terms(text).filter((word) => vocabulary.has(word));
  if (!words.length) return { status: "no-close-match" };
  const ranked = Object.entries(model.categories)
    .filter(([, item]) => item.type === type)
    .map(([category, item]) => ({
      category,
      score: words.reduce((sum, w) => sum + item.weights[w], 0),
    }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: "no-close-match" };
  // Subtract the best log score before exponentiating to avoid numerical overflow.
  const weights = ranked.map((item) => Math.exp(item.score - ranked[0].score));
  const total = weights.reduce((a, b) => a + b);
  const share = weights[0] / total;
  const margin = share - (weights[1] || 0) / total;
  if (share < model.minScore || margin < model.minMargin) return { status: "uncertain-match" };
  // Score is an internal ranking, not a calibrated probability of correctness.
  return { status: "suggestion", category: ranked[0].category, source: "synthetic-starter" };
}

export function createCategoryHelper(ownerId) {
  const owner = String(ownerId);
  let active = Boolean(ownerId);
  return {
    suggest(requestOwner, records, type, note) {
      if (!active || String(requestOwner) !== owner) return { status: "wrong-account" };
      const own = (Array.isArray(records) ? records : []).filter(
        (row) => row.ownerId == null || String(row.ownerId) === owner,
      );
      // Prefer an unambiguous note from this account, then similar history, then the starter.
      const exact = new Set(
        own
          .filter((row) => row.type === type && normalize(row.note) === normalize(note))
          .map((row) => row.category),
      );
      if (normalize(note) && exact.size === 1) {
        const category = [...exact][0];
        if (model.categories[category]?.type === type)
          return { status: "suggestion", category, source: "personal-history" };
      }
      if (exact.size > 1) return { status: "uncertain-match" };
      const personal = suggestCategoryFromHistory(own, type, note);
      if (personal.status === "suggestion") return { ...personal, source: "personal-history" };
      return suggestStarterCategory(type, note);
    },
    dispose() {
      active = false;
    },
  };
}
