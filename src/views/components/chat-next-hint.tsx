/** One-line chat discovery hint under a completed view card. */

export function ChatNextHint({ example }: { example: string }) {
  return (
    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
      💬 채팅에{" "}
      <span className="font-semibold text-foreground">“{example}”</span> 라고
      치면 이어갈 수 있어요.
    </p>
  );
}
