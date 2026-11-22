function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export default function ContainerFill({
  curvature,
  fill,
}: {
  curvature: number;
  fill: number;
}) {
  const curve = clamp01(curvature);
  const level = clamp01(fill);
  const rimY = 26;
  const cx = 82;
  const halfW = 64;
  const left = cx - halfW;
  const right = cx + halfW;
  const depth = 6 + curve * (halfW - 6);
  const sphereR = (halfW * halfW + depth * depth) / (2 * depth);
  const surfaceY = rimY + depth * (1 - level);
  const centerY = rimY + depth - sphereR;
  const dy = surfaceY - centerY;
  const meniscus = Math.sqrt(Math.max(0, sphereR * sphereR - dy * dy));
  const arc = `M ${left} ${rimY} A ${sphereR} ${sphereR} 0 0 0 ${right} ${rimY}`;
  const depthToDiameter = Math.round(curve * 50);
  const bottom = rimY + depth;

  return (
    <svg
      viewBox="0 0 300 150"
      className="h-40 w-full"
      role="img"
      aria-label={`높이 ${depthToDiameter}%, 지름 대비, 담긴 정도 ${Math.round(level * 100)}%`}
    >
      <defs>
        <clipPath id="vessel-cavity">
          <path d={`${arc} Z`} />
        </clipPath>
        <linearGradient id="vessel-food" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6c56b" />
          <stop offset="100%" stopColor="#c47a2c" />
        </linearGradient>
      </defs>
      <g clipPath="url(#vessel-cavity)">
        <rect
          x="0"
          y={surfaceY}
          width="220"
          height="140"
          fill="url(#vessel-food)"
        />
        {level > 0.02 ? (
          <ellipse
            cx={cx}
            cy={surfaceY}
            rx={Math.min(meniscus, halfW - 2)}
            ry={Math.max(3, 8 * curve)}
            fill="#fbe3a4"
          />
        ) : null}
      </g>
      <path
        d={arc}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <line
        x1={right + 10}
        y1={rimY}
        x2={right + 10}
        y2={bottom}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1={right + 6}
        y1={rimY}
        x2={right + 14}
        y2={rimY}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <line
        x1={right + 6}
        y1={bottom}
        x2={right + 14}
        y2={bottom}
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <text
        x={right + 18}
        y={(rimY + bottom) / 2}
        dominantBaseline="middle"
        fontSize="13"
        fontWeight="700"
        fill="currentColor"
      >
        지름의 {depthToDiameter}%
      </text>
    </svg>
  );
}
