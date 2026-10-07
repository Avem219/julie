import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStudentQuiz, gradeAttempt, validateSubmission, toStudentResult, canSubmitAttempt, isWithinTimeLimit, type QuizRecord } from './grade.ts';

const quiz: QuizRecord = {
  id: 'q', title: 'T', description: null, timeLimitSeconds: 600, passingScorePct: 60,
  questions: [
    { id: 'q1', type: 'SINGLE_CHOICE', prompt: '2+2', explanation: 'four', points: 2, position: 1,
      options: [{ id: 'a', text: '3', isCorrect: false, position: 1 }, { id: 'b', text: '4', isCorrect: true, position: 2 }] },
    { id: 'q2', type: 'MULTIPLE_CHOICE', prompt: 'primes', explanation: 'e', points: 2, position: 2,
      options: [{ id: 'c', text: '2', isCorrect: true, position: 1 }, { id: 'd', text: '4', isCorrect: false, position: 2 }, { id: 'e', text: '5', isCorrect: true, position: 3 }] },
    { id: 'q3', type: 'SHORT_ANSWER', prompt: 'Capital of France', explanation: null, points: 1, position: 3,
      options: [{ id: 'f', text: 'Paris', isCorrect: true, position: 1 }] },
  ],
};

test('student DTO never exposes isCorrect, explanations, or short-answer keys', () => {
  const json = JSON.stringify(toStudentQuiz(quiz));
  assert.ok(!json.includes('isCorrect')); assert.ok(!json.includes('explanation')); assert.ok(!json.includes('Paris'));
});
test('perfect score', () => {
  const g = gradeAttempt(quiz, [{ questionId: 'q1', selectedOptionIds: ['b'] }, { questionId: 'q2', selectedOptionIds: ['e', 'c'] },
    { questionId: 'q3', textAnswer: '  paris ' }]);
  assert.equal(g.score, 5); assert.equal(g.percentage, 100); assert.ok(g.passed);
});
test('multiple choice is all-or-nothing; unanswered scores zero', () => {
  const g = gradeAttempt(quiz, [{ questionId: 'q1', selectedOptionIds: ['b'] }, { questionId: 'q2', selectedOptionIds: ['c'] }]);
  assert.equal(g.score, 2); assert.equal(g.percentage, 40); assert.equal(g.passed, false);
});
test('invalid submissions are rejected', () => {
  assert.ok(validateSubmission(quiz, [{ questionId: 'nope' }]).length);
  assert.ok(validateSubmission(quiz, [{ questionId: 'q1', selectedOptionIds: ['c'] }]).length); // option from another question
  assert.ok(validateSubmission(quiz, [{ questionId: 'q1', selectedOptionIds: ['a', 'b'] }]).length);
  assert.ok(validateSubmission(quiz, [{ questionId: 'q1' }, { questionId: 'q1' }]).length);
  assert.throws(() => gradeAttempt(quiz, [{ questionId: 'q1', selectedOptionIds: ['zzz'] }]));
});
test('results hide answers unless policy allows', () => {
  const g = gradeAttempt(quiz, []);
  assert.ok(!JSON.stringify(toStudentResult(quiz, g, false)).includes('correctOptionIds'));
  assert.ok(JSON.stringify(toStudentResult(quiz, g, true)).includes('correctOptionIds'));
});
test('attempt state and time limit', () => {
  assert.ok(canSubmitAttempt('IN_PROGRESS')); assert.ok(!canSubmitAttempt('SUBMITTED'));
  const s = new Date('2026-09-19T10:00:00Z');
  assert.ok(isWithinTimeLimit(s, new Date('2026-09-19T10:10:04Z'), 600));
  assert.ok(!isWithinTimeLimit(s, new Date('2026-09-19T10:11:00Z'), 600));
  assert.ok(isWithinTimeLimit(s, new Date('2027-01-01T00:00:00Z'), null));
});
