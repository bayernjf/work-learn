import type { LearningMaterial, SaveMaterialInput } from "@work-learn/shared-schema";

export type LearningRepository = {
  saveMaterial(input: SaveMaterialInput): Promise<LearningMaterial>;
  searchCorpus(query: string): Promise<LearningMaterial[]>;
};

export const createMaterialId = () => `mat_${crypto.randomUUID()}`;

export const createLearningMaterial = (input: SaveMaterialInput): LearningMaterial => ({
  ...input,
  id: createMaterialId(),
  createdAt: new Date().toISOString()
});

export const normalizeSearchQuery = (query: string) => query.trim().toLowerCase();
