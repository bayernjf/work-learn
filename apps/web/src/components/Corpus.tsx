import { useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import type { LearningMaterial, QuestionTranslation } from "../lib/api";
import { PracticeButton } from "./Practice";

export function MaterialDetail({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <p className="material-detail">
      <span className="material-detail-label">{label}</span>
      {value}
    </p>
  );
}

export function MaterialCard({ session, material, index, onDelete, onUpdate }: { session: Session; material: LearningMaterial; index: number; onDelete: (id: string) => void; onUpdate: (id: string, updates: { topic?: string; explanation?: string; tags?: string[] }) => void }) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(material.topic);
  const [explanation, setExplanation] = useState(material.explanation);
  const [tags, setTags] = useState(material.tags.join(", "));

  const save = () => {
    onUpdate(material.id, { topic: topic.trim() || material.topic, explanation, tags: tags.split(",").map((s) => s.trim()).filter(Boolean) });
    setEditing(false);
  };

  return (
    <article className={index % 4 === 0 ? "material-card featured" : "material-card"} key={material.id}>
      {editing ? (
        <>
          <label className="edit-label">{t.material.editTopic}<input value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
          <label className="edit-label">{t.material.editExplanation}<textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} /></label>
          <label className="edit-label">{t.material.editTags}<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
          <div className="card-actions">
            <button type="button" className="text-button" onClick={() => setEditing(false)}>{t.material.cancel}</button>
            <button type="button" className="complete-button" onClick={save}>{t.material.save}</button>
          </div>
        </>
      ) : (
        <>
          <p className="material-topic">{material.topic}</p>
          <h2>{material.useful_expressions[0] ?? t.material.fallback}</h2>
          <p>{material.original_text}</p>
          <MaterialDetail label={t.material.better} value={material.corrections[0]} />
          <MaterialDetail label={t.material.why} value={material.explanation} />
          <MaterialDetail label={t.material.reuse} value={material.practice_prompts[0]} />
          <MaterialDetail label={t.material.vocabulary} value={material.vocabulary.join(", ")} />
          {material.tags.length > 0 ? <p className="material-tags">{material.tags.map((tag) => <span key={tag}>{tag}</span>)}</p> : null}
          <PracticeButton session={session} materialId={material.id} />
          <div className="card-actions">
            <span>{formatDate(material.created_at)}</span>
            <span className="card-action-buttons">
              <button type="button" className="text-button" onClick={() => setEditing(true)}>{t.material.edit}</button>
              <button type="button" className="text-button" onClick={() => onDelete(material.id)}>{t.common.delete}</button>
            </span>
          </div>
        </>
      )}
    </article>
  );
}

export function MaterialList({ session, materials, view, onDelete, onUpdate }: { session: Session; materials: LearningMaterial[]; view: "card" | "list"; onDelete: (id: string) => void; onUpdate: (id: string, updates: { topic?: string; explanation?: string; tags?: string[] }) => void }) {
  return (
    <div className={view === "list" ? "material-list list" : "material-list"}>
      {materials.map((material, index) => (
        view === "list"
          ? <MaterialRow key={material.id} session={session} material={material} onDelete={onDelete} onUpdate={onUpdate} />
          : <MaterialCard key={material.id} session={session} material={material} index={index} onDelete={onDelete} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function MaterialRow({ session, material, onDelete, onUpdate }: { session: Session; material: LearningMaterial; onDelete: (id: string) => void; onUpdate: (id: string, updates: { topic?: string; explanation?: string; tags?: string[] }) => void }) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(material.topic);
  const [explanation, setExplanation] = useState(material.explanation);
  const [tags, setTags] = useState(material.tags.join(", "));

  const save = () => {
    onUpdate(material.id, {
      topic: topic.trim() || material.topic,
      explanation: explanation.trim(),
      tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    });
    setEditing(false);
  };

  const title = material.useful_expressions[0] ?? t.material.fallback;

  return (
    <article className="material-row">
      <div className="row-main">
        <p className="material-topic">{material.topic}</p>
        <h3>{title}</h3>
        {!editing && <p className="row-original">{material.original_text}</p>}
        {!editing && material.tags.length > 0 && (
          <p className="material-tags">
            {material.tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}
          </p>
        )}
        {editing && (
          <div className="edit-fields">
            <label className="edit-label">{t.material.editTopic}<input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
            <label className="edit-label">{t.material.editExplanation}<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} rows={2} /></label>
            <label className="edit-label">{t.material.editTags}<input value={tags} onChange={(event) => setTags(event.target.value)} /></label>
            <div className="edit-actions">
              <button type="button" className="text-button" onClick={() => setEditing(false)}>{t.material.cancel}</button>
              <button type="button" className="complete-button" onClick={save}>{t.material.save}</button>
            </div>
          </div>
        )}
      </div>
      <div className="row-side">
        <PracticeButton session={session} materialId={material.id} />
        <span className="row-date">{formatDate(material.created_at)}</span>
        {!editing
          ? <div className="card-action-buttons">
            <button type="button" className="text-button" onClick={() => setEditing(true)}>{t.material.edit}</button>
            <button type="button" className="text-button danger" onClick={() => onDelete(material.id)}>{t.common.delete}</button>
          </div>
          : null}
      </div>
    </article>
  );
}

export function QuestionTranslationsSection({ questions, searching, loading, onDelete }: { questions: QuestionTranslation[]; searching: boolean; loading: boolean; onDelete: (id: string) => void }) {
  const { t, formatDate } = useI18n();
  if (loading && questions.length === 0) return null;
  if (questions.length === 0) return null;
  return (
    <section className="qa-section">
      <div className="section-heading">
        <div><p className="eyebrow">{t.qa.eyebrow}</p><h2>{t.qa.heading}</h2></div>
        <span className="qa-count">{questions.length}</span>
      </div>
      <div className="qa-list">
        {questions.map((question) => (
          <article className="qa-card" key={question.id}>
            <p className="qa-question">{question.question}</p>
            <p className="qa-translation-label">{t.qa.translation}</p>
            <p className="qa-translation">{question.translation}</p>
            <div className="qa-meta">
              {question.topic && <span className="material-topic">{question.topic}</span>}
              <span>{formatDate(question.created_at)}</span>
              <button type="button" className="text-button" onClick={() => onDelete(question.id)}>{t.common.delete}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
