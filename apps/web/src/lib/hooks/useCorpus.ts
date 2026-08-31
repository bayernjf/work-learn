import { useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  completeReview,
  deleteMaterial,
  deleteQuestionTranslation,
  fetchMaterials,
  fetchQuestionTranslations,
  fetchReviews,
  snoozeReview,
  updateMaterial,
  LearningMaterial,
  QuestionTranslation,
  ReviewItem
} from "../api";
import { facetCounts } from "../markup";
import { useI18n } from "../../i18n/context";

export function useCorpus(session: Session | null) {
  const { t } = useI18n();
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [results, setResults] = useState<LearningMaterial[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<"newest" | "oldest" | "topic" | "source">("newest");
  const [view, setView] = useState<"card" | "list">("card");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [questions, setQuestions] = useState<QuestionTranslation[]>([]);
  const [questionResults, setQuestionResults] = useState<QuestionTranslation[] | null>(null);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!session) {
      setMaterials([]);
      setResults(null);
      setQuery("");
      setTopic(null);
      setReviews([]);
      setQuestions([]);
      setQuestionResults(null);
      return;
    }
    setLoadingMaterials(true);
    setLoadError("");
    void Promise.all([fetchMaterials(session), fetchReviews(session), fetchQuestionTranslations(session)])
      .then(([materialResult, reviewResult, questionResult]) => {
        setMaterials(materialResult.data);
        setReviews(reviewResult.data);
        setQuestions(questionResult.data);
        setResults(null);
        setQuestionResults(null);
      })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : t.errors.loadCorpus))
      .finally(() => setLoadingMaterials(false));
  }, [session, reloadKey]);

  useEffect(() => {
    if (!session) return;
    const trimmed = query.trim();
    const filters = { source: source ?? undefined, tag: tag ?? undefined };
    if (!trimmed && !source && !tag) {
      setResults(null);
      setQuestionResults(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([fetchMaterials(session, trimmed, filters), fetchQuestionTranslations(session, trimmed, source ?? undefined)])
        .then(([materialResult, questionResult]) => {
          if (!cancelled) {
            setResults(materialResult.data);
            setQuestionResults(questionResult.data);
          }
        })
        .catch(() => { if (!cancelled) { setResults([]); setQuestionResults([]); } })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, session, source, tag]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const topics = useMemo(() => facetCounts(materials.map((material) => material.topic)), [materials]);
  const sources = useMemo(
    () => facetCounts(materials.map((material) => material.source).concat(questions.map((question) => question.source))),
    [materials, questions]
  );
  const tags = useMemo(() => facetCounts(materials.flatMap((material) => material.tags)), [materials]);

  const visible = useMemo(() => {
    const base = results ?? materials;
    const filtered = topic ? base.filter((material) => material.topic === topic) : base;
    const sorted = [...filtered];
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
  }, [results, materials, topic, sort]);

  useEffect(() => { setPage(1); }, [query, source, tag, topic, sort, view, pageSize]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleQuestions = questionResults ?? questions;
  const empty = materials.length === 0 && questions.length === 0;

  const handleCompleteReview = async (reviewId: string, grade: "again" | "hard" | "good" | "easy" = "good") => {
    if (!session) return;
    try {
      await completeReview(session, reviewId, grade);
      setReviews((current) => current.filter((review) => review.id !== reviewId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.completeReview);
    }
  };

  const handleSnoozeReview = async (reviewId: string) => {
    if (!session) return;
    try {
      await snoozeReview(session, reviewId, 1);
      setReviews((current) => current.filter((review) => review.id !== reviewId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.completeReview);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!session || !window.confirm(t.material.deleteConfirm)) return;
    try {
      await deleteMaterial(session, materialId);
      setMaterials((current) => current.filter((material) => material.id !== materialId));
      setResults((current) => current?.filter((material) => material.id !== materialId) ?? current);
      setReviews((current) => current.filter((review) => review.learning_materials.id !== materialId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.deleteMaterial);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!session || !window.confirm(t.qa.deleteConfirm)) return;
    try {
      await deleteQuestionTranslation(session, questionId);
      setQuestions((current) => current.filter((question) => question.id !== questionId));
      setQuestionResults((current) => current?.filter((question) => question.id !== questionId) ?? current);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.deleteQuestion);
    }
  };

  const handleUpdateMaterial = async (materialId: string, updates: Parameters<typeof updateMaterial>[2]) => {
    if (!session) return;
    try {
      const result = await updateMaterial(session, materialId, updates);
      const replace = (items: LearningMaterial[]) => items.map((m) => m.id === materialId ? result.data : m);
      setMaterials(replace);
      setResults((current) => current ? replace(current) : current);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.material.editError);
    }
  };

  const reload = () => setReloadKey((key) => key + 1);

  return {
    materials,
    results,
    query,
    setQuery,
    searching,
    topic,
    setTopic,
    source,
    setSource,
    tag,
    setTag,
    sort,
    setSort,
    view,
    setView,
    page,
    setPage,
    pageSize,
    setPageSize,
    reviews,
    questions,
    questionResults,
    loadingMaterials,
    loadError,
    reloadKey,
    reload,
    searchInput,
    topics,
    sources,
    tags,
    visible,
    totalPages,
    safePage,
    pageItems,
    visibleQuestions,
    empty,
    handleCompleteReview,
    handleSnoozeReview,
    handleDeleteMaterial,
    handleDeleteQuestion,
    handleUpdateMaterial
  };
}
