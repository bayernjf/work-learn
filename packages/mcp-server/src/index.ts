export type McpToolName =
  | "save_material"
  | "search_corpus"
  | "get_review_items"
  | "generate_practice"
  | "mark_mastered";

export const createMcpEndpoint = (apiUrl: string) => ({
  apiUrl,
  tools: [
    "save_material",
    "search_corpus",
    "get_review_items",
    "generate_practice",
    "mark_mastered"
  ] as McpToolName[]
});
