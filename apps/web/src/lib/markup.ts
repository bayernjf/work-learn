import type { Strings } from "../i18n/strings";
import type { LearningMaterial, QuestionTranslation } from "./api";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function facetCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function buildExportMarkdown(materials: LearningMaterial[], questions: QuestionTranslation[], t: Strings) {
  const lines = [
    "# Work Learn export",
    "",
    `- ${t.export.generatedAt} ${new Date().toISOString()}`,
    `- ${materials.length} ${materials.length === 1 ? t.export.material : t.export.materials}`,
    `- ${questions.length} ${questions.length === 1 ? t.export.question : t.export.questions}`,
    ""
  ];
  for (const material of materials) {
    lines.push(`## ${material.topic}`, "");
    lines.push(`- ${t.export.source}: ${material.source}`);
    lines.push(`- ${t.export.created}: ${material.created_at}`);
    if (material.tags.length) lines.push(`- ${t.export.tags}: ${material.tags.join(", ")}`);
    lines.push("", material.original_text, "");
    if (material.explanation) lines.push(`**${t.material.why}:** ${material.explanation}`, "");
    if (material.corrections.length) lines.push(`**${t.material.better}:** ${material.corrections.join("; ")}`, "");
    if (material.useful_expressions.length) lines.push(`**${t.practice.types.reuse}:** ${material.useful_expressions.join("; ")}`, "");
  }
  if (questions.length) {
    lines.push(`## ${t.qa.heading}`, "");
    for (const question of questions) {
      lines.push(`- ${question.question}`, `  - ${question.translation}`, `  - ${question.source} · ${question.created_at}`, "");
    }
  }
  return lines.join("\n");
}

export function relativeTime(iso: string, t: Strings) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t.time.minutes(minutes);
  if (minutes < 60 * 24) return t.time.hours(Math.round(minutes / 60));
  return t.time.days(Math.round(minutes / (60 * 24)));
}

export function corpusSummary(materials: LearningMaterial[], t: Strings) {
  if (materials.length === 0) return t.desk.summaryEmpty;
  const sources = new Set(materials.map((material) => material.source)).size;
  let newest = "";
  for (const material of materials) if (material.created_at > newest) newest = material.created_at;
  return t.desk.summary(materials.length, sources, relativeTime(newest, t));
}
