"use client";

import { AlertTriangle, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import type { QuestionType } from "@/lib/types";
import { createOptionDraft, createQuestionDraft, moveItem, optionsForType, type ParticipationQuestionDraft } from "@/lib/participation-form-editor";

const questionTypeLabels: Record<QuestionType, string> = {
  single_choice: "단일 선택",
  multiple_choice: "복수 선택",
  yes_no: "찬반",
  short_text: "짧은 답변",
  long_text: "긴 답변",
  rating: "평점",
};

export default function ParticipationFormQuestionEditor({ questions, hasResponses, responseState, onChange }: {
  questions: ParticipationQuestionDraft[];
  hasResponses: boolean;
  responseState: "clear" | "loading" | "has-responses" | "error";
  onChange: (questions: ParticipationQuestionDraft[]) => void;
}) {
  const updateQuestion = (index: number, update: (question: ParticipationQuestionDraft) => ParticipationQuestionDraft) => {
    onChange(questions.map((question, questionIndex) => questionIndex === index ? update(question) : question));
  };

  return <section className="form-question-editor" aria-labelledby="form-question-editor-title">
    <header>
      <div><span className="eyebrow">QUESTION BUILDER</span><h3 id="form-question-editor-title">문항 구성</h3></div>
      <button type="button" className="cta small secondary" onClick={() => {
        const question = createQuestionDraft();
        onChange([...questions, hasResponses ? { ...question, isRequired: false } : question]);
      }}><Plus size={16} /> 문항 추가</button>
    </header>
    {responseState === "loading" && <div className="read-box form-response-policy"><b>기존 응답을 확인하고 있습니다</b><p>응답 보존 정책을 확인한 뒤 저장할 수 있습니다.</p></div>}
    {responseState === "error" && <div className="read-box form-response-policy danger"><AlertTriangle size={18} /><div><b>응답 상태를 확인하지 못했습니다</b><p>데이터 보호를 위해 현재는 저장할 수 없습니다. 잠시 후 편집기를 다시 열어 주세요.</p></div></div>}
    {hasResponses && <div className="read-box form-response-policy warning"><AlertTriangle size={18} /><div><b>이미 응답이 있는 항목입니다</b><p>기존 응답은 보존됩니다. 문항·선택지 삭제, 유형·평점 범위 변경, 기존 선택지 문구 변경, 선택 문항의 필수 전환은 차단됩니다. 문항 문구 변경은 저장 전 한 번 더 확인합니다.</p></div></div>}
    <div className="form-question-list">
      {questions.map((question, index) => {
        const isChoice = question.type === "single_choice" || question.type === "multiple_choice" || question.type === "yes_no";
        return <article className="form-question-card" key={question.clientId}>
          <header>
            <b>문항 {index + 1}</b>
            <div className="form-question-actions">
              <button type="button" aria-label={`${index + 1}번 문항 위로 이동`} disabled={index === 0} onClick={() => onChange(moveItem(questions, index, -1))}><ChevronUp size={17} /></button>
              <button type="button" aria-label={`${index + 1}번 문항 아래로 이동`} disabled={index === questions.length - 1} onClick={() => onChange(moveItem(questions, index, 1))}><ChevronDown size={17} /></button>
              <button type="button" aria-label={`${index + 1}번 문항 삭제`} title={hasResponses && Boolean(question.id) ? "응답이 있는 기존 문항은 삭제할 수 없습니다" : undefined} disabled={questions.length === 1 || (hasResponses && Boolean(question.id))} onClick={() => onChange(questions.filter((_, questionIndex) => questionIndex !== index))}><Trash2 size={17} /></button>
            </div>
          </header>
          <label>문항 내용<input required maxLength={500} value={question.prompt} placeholder="회원에게 물어볼 내용을 입력하세요" onChange={(event) => updateQuestion(index, (current) => ({ ...current, prompt: event.target.value }))} /></label>
          <div className="field-row">
            <label>답변 형식<select value={question.type} disabled={hasResponses && Boolean(question.id)} title={hasResponses && Boolean(question.id) ? "응답이 있는 문항의 형식은 바꿀 수 없습니다" : undefined} onChange={(event) => updateQuestion(index, (current) => {
              const type = event.target.value as QuestionType;
              return { ...current, type, options: optionsForType(type, current.options) };
            })}>{Object.entries(questionTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="check form-required-toggle"><input type="checkbox" checked={question.isRequired} disabled={hasResponses && question.initialIsRequired !== true} onChange={(event) => updateQuestion(index, (current) => ({ ...current, isRequired: event.target.checked }))} /> 답변 필수</label>
          </div>
          {isChoice && <fieldset className="form-option-editor">
            <legend>선택지</legend>
            {question.options.map((option, optionIndex) => <div className="form-option-row" key={option.clientId}>
              <span aria-hidden="true">{optionIndex + 1}</span>
              <input aria-label={`${index + 1}번 문항 ${optionIndex + 1}번 선택지`} required maxLength={200} value={option.label} disabled={hasResponses && Boolean(option.id)} title={hasResponses && Boolean(option.id) ? "응답에 사용된 기존 선택지 문구는 바꿀 수 없습니다" : undefined} placeholder={`선택지 ${optionIndex + 1}`} onChange={(event) => updateQuestion(index, (current) => ({ ...current, options: current.options.map((item, itemIndex) => itemIndex === optionIndex ? { ...item, label: event.target.value } : item) }))} />
              <button type="button" aria-label={`${optionIndex + 1}번 선택지 위로 이동`} disabled={optionIndex === 0} onClick={() => updateQuestion(index, (current) => ({ ...current, options: moveItem(current.options, optionIndex, -1) }))}><ChevronUp size={16} /></button>
              <button type="button" aria-label={`${optionIndex + 1}번 선택지 아래로 이동`} disabled={optionIndex === question.options.length - 1} onClick={() => updateQuestion(index, (current) => ({ ...current, options: moveItem(current.options, optionIndex, 1) }))}><ChevronDown size={16} /></button>
              <button type="button" aria-label={`${optionIndex + 1}번 선택지 삭제`} title={hasResponses && Boolean(option.id) ? "응답에 사용된 기존 선택지는 삭제할 수 없습니다" : undefined} disabled={question.type === "yes_no" || question.options.length <= 2 || (hasResponses && Boolean(option.id))} onClick={() => updateQuestion(index, (current) => ({ ...current, options: current.options.filter((_, itemIndex) => itemIndex !== optionIndex) }))}><Trash2 size={16} /></button>
            </div>)}
            {question.type !== "yes_no" && <button type="button" className="form-option-add" onClick={() => updateQuestion(index, (current) => ({ ...current, options: [...current.options, createOptionDraft()] }))}><Plus size={15} /> 선택지 추가</button>}
          </fieldset>}
          {question.type === "rating" && <div className="field-row form-rating-range">
            <label>최소 점수<input type="number" min={0} max={9} required value={question.minValue} disabled={hasResponses && Boolean(question.id)} onChange={(event) => updateQuestion(index, (current) => ({ ...current, minValue: Number(event.target.value) }))} /></label>
            <label>최대 점수<input type="number" min={1} max={10} required value={question.maxValue} disabled={hasResponses && Boolean(question.id)} onChange={(event) => updateQuestion(index, (current) => ({ ...current, maxValue: Number(event.target.value) }))} /></label>
          </div>}
        </article>;
      })}
    </div>
  </section>;
}
