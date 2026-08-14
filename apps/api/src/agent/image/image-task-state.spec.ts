import { canTransitionImageTask, isTerminalImageTaskStatus } from './image-task-state';

describe('image task state', () => {
  it('allows legal forward transitions and makes terminal states immutable', () => {
    expect(canTransitionImageTask('PENDING', 'SUBMITTING')).toBe(true);
    expect(canTransitionImageTask('RUNNING', 'PERSISTING')).toBe(true);
    expect(canTransitionImageTask('PERSISTING', 'SUCCEEDED')).toBe(true);
    expect(canTransitionImageTask('SUCCEEDED', 'RUNNING')).toBe(false);
    expect(isTerminalImageTaskStatus('SUBMISSION_UNKNOWN')).toBe(true);
  });
});
