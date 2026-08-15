import { canTransitionVideo, isVideoTerminal } from './video-task-state';
describe('video task state', () => {
  it('allows the success path', () => {
    expect(canTransitionVideo('PENDING', 'SUBMITTING')).toBe(true);
    expect(canTransitionVideo('RUNNING', 'PERSISTING')).toBe(true);
    expect(canTransitionVideo('PERSISTING', 'SUCCEEDED')).toBe(true);
  });
  it('keeps terminal states immutable', () => {
    expect(isVideoTerminal('CANCELLED')).toBe(true);
    expect(canTransitionVideo('CANCELLED', 'RUNNING')).toBe(false);
  });
});
