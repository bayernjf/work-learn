import type { LearningMaterial } from "./api";

export type CorpusSort = "newest" | "oldest" | "topic" | "source";

/** Sort the corpus view without mutating the fetched arrays. */
export function sortMaterials(materials: LearningMaterial[], sort: CorpusSort): LearningMaterial[] {
  const sorted = [...materials];
  switch (sort) {
    case "oldest":
      sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
      break;
    case "topic":
      sorted.sort((a, b) => a.topic.localeCompare(b.topic));
      break;
    case "source":
      sorted.sort((a, b) => a.source.localeCompare(b.source));
      break;
    case "newest":
    default:
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
      break;
  }
  return sorted;
}

/**
 * Window a list for the current page, clamping both ends. The pagination
 * controls derive their disabled state and labels from this result, so an
 * off-by-one here silently hides rows instead of throwing.
 */
export function pageWindow<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    totalPages,
    safePage,
    items: items.slice((safePage - 1) * pageSize, safePage * pageSize)
  };
}
