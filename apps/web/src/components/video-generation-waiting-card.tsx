export function VideoGenerationWaitingCard() {
  return (
    <div
      role="status"
      aria-label="视频生成中"
      className="video-dream-card relative aspect-video w-full max-w-[20rem] overflow-hidden rounded-2xl border border-white/35 shadow-sm"
    >
      <span aria-hidden="true" className="video-dream-card__aura video-dream-card__aura--one" />
      <span aria-hidden="true" className="video-dream-card__aura video-dream-card__aura--two" />
      <span aria-hidden="true" className="video-dream-card__grain" />
    </div>
  );
}
