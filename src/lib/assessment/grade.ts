import { badRequest } from '../errors.ts';

export type QuestionType = 'SINGLE_CHOICE' | 'MULTIPLE_CHOICE' | 'TRUE_FALSE' | 'SHORT_ANSWER';
export type QuizOptionRecord = { id: string; text: string; isCorrect: boolean; position: number };
export type QuizQuestionRecord = {
  id: string; type: QuestionType; prompt: string; explanation: string | null;
  points: number; position: number; options: QuizOptionRecord[];
};
export type QuizRecord = {
  id: string; title: string; description: string | null; timeLimitSeconds: number | null;
  passingScorePct: number; questions: QuizQuestionRecord[];
};
export type SubmittedAnswerInput = { questionId: string; selectedOptionIds?: string[]; textAnswer?: string };

/** Student-safe DTO: no isCorrect, no explanations, and no accepted answers for SHORT_ANSWER. */
export function toStudentQuiz(quiz: QuizRecord) {
  return {
    id: quiz.id, title: quiz.title, description: quiz.description, timeLimitSeconds: quiz.timeLimitSeconds,
    questions: [...quiz.questions].sort((a, b) => a.position - b.position).map((q) => ({
      id: q.id, type: q.type, prompt: q.prompt, points: q.points,
      options: q.type === 'SHORT_ANSWER' ? [] :
        [...q.options].sort((a, b) => a.position - b.position).map((o) => ({ id: o.id, text: o.text })),
    })),
  };
}

export function validateSubmission(quiz: QuizRecord, answers: readonly SubmittedAnswerInput[]): string[] {
  const errs: string[] = [];
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  const seen = new Set<string>();
  for (const a of answers) {
    const q = byId.get(a.questionId);
    if (!q) { errs.push(`Unknown question ${a.questionId}`); continue; }
    if (seen.has(q.id)) errs.push(`Duplicate answer for question ${q.id}`);
    seen.add(q.id);
    const sel = a.selectedOptionIds ?? [];
    if (q.type === 'SHORT_ANSWER') {
      if (sel.length) errs.push(`Question ${q.id} does not accept option selections`);
      if ((a.textAnswer ?? '').length > 2000) errs.push(`Answer to ${q.id} is too long`);
      continue;
    }
    if (a.textAnswer) errs.push(`Question ${q.id} does not accept text answers`);
    const valid = new Set(q.options.map((o) => o.id));
    if (new Set(sel).size !== sel.length) errs.push(`Duplicate options for question ${q.id}`);
    for (const id of sel) if (!valid.has(id)) errs.push(`Option ${id} does not belong to question ${q.id}`);
    if (q.type !== 'MULTIPLE_CHOICE' && sel.length > 1) errs.push(`Question ${q.id} allows one selection`);
  }
  return errs;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

function isCorrect(q: QuizQuestionRecord, a: SubmittedAnswerInput | undefined): boolean {
  if (!a) return false;
  if (q.type === 'SHORT_ANSWER') {
    const given = norm(a.textAnswer ?? '');
    return given !== '' && q.options.some((o) => o.isCorrect && norm(o.text) === given);
  }
  const sel = new Set(a.selectedOptionIds ?? []);
  const correct = new Set(q.options.filter((o) => o.isCorrect).map((o) => o.id));
  if (correct.size === 0 || sel.size !== correct.size) return false; // MULTIPLE_CHOICE is all-or-nothing
  for (const id of sel) if (!correct.has(id)) return false;
  return true;
}

export function gradeAttempt(quiz: QuizRecord, answers: readonly SubmittedAnswerInput[]) {
  const errs = validateSubmission(quiz, answers);
  if (errs.length) throw badRequest(errs.join('; '));
  const given = new Map(answers.map((a) => [a.questionId, a]));
  let score = 0, maxScore = 0;
  const results = quiz.questions.map((q) => {
    const ok = isCorrect(q, given.get(q.id));
    const pointsAwarded = ok ? q.points : 0;
    score += pointsAwarded; maxScore += q.points;
    return { questionId: q.id, isCorrect: ok, pointsAwarded };
  });
  const percentage = maxScore === 0 ? 0 : Math.round((score / maxScore) * 10_000) / 100;
  return { score, maxScore, percentage, passed: percentage >= quiz.passingScorePct, results };
}

/** Correctness/explanations are only revealed when the quiz policy allows it, and only after grading. */
export function toStudentResult(quiz: QuizRecord, grade: ReturnType<typeof gradeAttempt>, revealAnswers: boolean) {
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  return {
    score: grade.score, maxScore: grade.maxScore, percentage: grade.percentage, passed: grade.passed,
    questions: grade.results.map((r) => {
      if (!revealAnswers) return { questionId: r.questionId, pointsAwarded: r.pointsAwarded };
      const q = byId.get(r.questionId)!;
      return { ...r, explanation: q.explanation,
        correctOptionIds: q.type === 'SHORT_ANSWER' ? [] : q.options.filter((o) => o.isCorrect).map((o) => o.id) };
    }),
  };
}

export const canSubmitAttempt = (status: string) => status === 'IN_PROGRESS';

export function isWithinTimeLimit(startedAt: Date, submittedAt: Date, timeLimitSeconds: number | null, graceSeconds = 5) {
  if (timeLimitSeconds === null) return true;
  return submittedAt.getTime() - startedAt.getTime() <= (timeLimitSeconds + graceSeconds) * 1000;
}
