import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AgentUserQuestion } from '@supermind/sdk';

import { buildAnswerRequest, isQuestionAnswered } from './agent-user-question-state';

const question: AgentUserQuestion = {
  id: 'batch-1',
  runId: 'run-1',
  status: 'pending',
  questions: [
    {
      id: 'item-1',
      header: '人数',
      question: '几个人出行？',
      options: [
        { id: 'option-1', label: '2 人', description: '双人同行' },
        { id: 'option-2', label: '3–5 人', description: '小团体' },
      ],
      multiSelect: false,
    },
  ],
  createdAt: '2026-08-04T08:00:00.000Z',
  settledAt: null,
};

describe('agent user question state', () => {
  it('submits a fixed option by its stable id', () => {
    assert.deepEqual(buildAnswerRequest(question, { 'item-1': ['option-1'] }, {}, {}), {
      answers: [{ questionId: 'item-1', selectedOptionIds: ['option-1'] }],
    });
  });

  it('submits Other exclusively with trimmed custom text', () => {
    assert.deepEqual(
      buildAnswerRequest(
        question,
        { 'item-1': ['option-1'] },
        { 'item-1': '  带一名儿童  ' },
        { 'item-1': true },
      ),
      {
        answers: [{ questionId: 'item-1', selectedOptionIds: [], customText: '带一名儿童' }],
      },
    );
  });

  it('requires non-blank custom text when Other is selected', () => {
    assert.equal(isQuestionAnswered('item-1', {}, { 'item-1': '   ' }, { 'item-1': true }), false);
  });
});
