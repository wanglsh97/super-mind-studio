import type { VideoTaskStatus } from '../../generated/prisma/client';

const TERMINAL = new Set<VideoTaskStatus>([
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
  'EXPIRED',
]);
export function isVideoTerminal(status: VideoTaskStatus): boolean {
  return TERMINAL.has(status);
}
export function canTransitionVideo(from: VideoTaskStatus, to: VideoTaskStatus): boolean {
  if (from === to) return true;
  if (isVideoTerminal(from)) return false;
  if (to === 'FAILED' || to === 'TIMED_OUT' || to === 'CANCELLED' || to === 'EXPIRED') return true;
  return (
    (
      {
        PENDING: ['SUBMITTING'],
        SUBMITTING: ['RUNNING'],
        RUNNING: ['PERSISTING'],
        PERSISTING: ['SUCCEEDED'],
      } as Partial<Record<VideoTaskStatus, VideoTaskStatus[]>>
    )[from]?.includes(to) ?? false
  );
}
