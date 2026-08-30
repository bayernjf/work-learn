import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import type { ReviewItem } from "../lib/api";
import { MaterialDetail } from "./Corpus";
import { PracticeButton } from "./Practice";

function ReviewCard({ session, review, index, onComplete, onSnooze }: { session: Session; review: ReviewItem; index: number; onComplete: (reviewId: string, grade?: "again" | "hard" | "good" | "easy") => void; onSnooze: (reviewId: string) => void }) {
  const { t } = useI18n();
  const [showAnswer, setShowAnswer] = useState(false);
  const material = review.learning_materials;
  return (
    <article className="review-card" data-revealed={showAnswer}>
      <span className="review-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="review-body">
        <p className="material-topic">{material.topic}</p>
        <h3>{material.useful_expressions[0] ?? t.review.fallback}</h3>
        <p className="review-original">{material.original_text}</p>
        {!showAnswer ? (
          <p className="review-hint">{t.review.recallHint}</p>
        ) : (
          <div className="review-answer">
            <MaterialDetail label={t.material.better} value={material.corrections[0]} />
            <MaterialDetail label={t.material.why} value={material.explanation} />
            <MaterialDetail label={t.material.reuse} value={material.practice_prompts[0]} />
            <MaterialDetail label={t.material.vocabulary} value={material.vocabulary.join(", ")} />
            <PracticeButton session={session} materialId={material.id} />
          </div>
        )}
      </div>
      <div className="review-actions">
        <button type="button" className="text-button" onClick={() => setShowAnswer((value) => !value)}>
          {showAnswer ? t.review.hideAnswer : t.review.showAnswer}
        </button>
        {showAnswer ? <><button type="button" className="text-button" onClick={() => onSnooze(review.id)}>{t.review.snooze}</button>
          <span className="grade-buttons">
            <button type="button" className="grade-button again" onClick={() => onComplete(review.id, "again")}>{t.review.gradeAgain}</button>
            <button type="button" className="grade-button hard" onClick={() => onComplete(review.id, "hard")}>{t.review.gradeHard}</button>
            <button type="button" className="grade-button good" onClick={() => onComplete(review.id, "good")}>{t.review.gradeGood}</button>
            <button type="button" className="grade-button easy" onClick={() => onComplete(review.id, "easy")}>{t.review.gradeEasy}</button>
          </span></> : null}
      </div>
    </article>
  );
}

export function ReviewList({ session, reviews, onComplete, onSnooze }: { session: Session; reviews: ReviewItem[]; onComplete: (reviewId: string) => void; onSnooze: (reviewId: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="review-section">
      <div className="section-heading"><div><p className="eyebrow">{t.review.eyebrow}</p><h2>{t.review.heading}</h2></div><span className="review-count">{t.review.due(reviews.length)}</span></div>
      {reviews.length === 0 ? <p className="review-empty">{t.review.empty}</p> : (
        <div className="review-list">
          {reviews.map((review, index) => <ReviewCard key={review.id} session={session} review={review} index={index} onComplete={onComplete} onSnooze={onSnooze} />)}
        </div>
      )}
    </section>
  );
}
