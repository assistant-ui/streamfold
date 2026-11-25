import { useEffect, useRef } from "react";
import { ControlIcon } from "./control-icon";

type FoldProps = {
  count: number;
  chunks: readonly string[];
  output: string;
  playing: boolean;
  disabled: boolean;
  onPlay: () => void;
};

// Paint the facets back to front. Each push seats the next piece of the same sheet.
const facets = [
  { path: "m153 87 255-66-188 97z", fill: "url(#paper-grain)" },
  { path: "m220 118 188-97-179 144z", fill: "url(#fold-grain)" },
  { path: "m229 165 179-144-148 116z", fill: "#797974" },
  { path: "m237 124 171-103-99 156z", fill: "url(#paper-grain)" },
  { path: "m237 124 171-103-145 119z", fill: "#a1a19a" },
];

// The five trails empty in parser order as their matching facets arrive.
const trails = [
  "M121 78l27-8 22 8-28 9z",
  "M155 135l27-11 18 11-28 12z",
  "M95 124l25-9 12 7-25 9zM116 150l18-7 11 6-19 8z",
  "M65 95l25-7 8 5-25 8zM42 141l13-4 7 5-14 5z",
  "M27 105l10-3 4 4-10 3zM61 168l8-3 4 4-8 3z",
];

export function Fold({ count, chunks, output, playing, disabled, onPlay }: FoldProps) {
  const drawing = useRef<SVGSVGElement>(null);
  const active = useRef<SVGPathElement>(null);
  const flight = useRef<Animation | null>(null);
  const visible = useRef(false);

  useEffect(() => {
    const svg = drawing.current;
    if (!svg) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    function stopIfNeeded() {
      if (document.hidden || preference.matches || !visible.current) flight.current?.cancel();
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = !!entry?.isIntersecting;
      stopIfNeeded();
    });
    observer.observe(svg);
    preference.addEventListener("change", stopIfNeeded);
    document.addEventListener("visibilitychange", stopIfNeeded);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", stopIfNeeded);
      document.removeEventListener("visibilitychange", stopIfNeeded);
    };
  }, []);

  useEffect(() => {
    if (
      !count ||
      !active.current ||
      !visible.current ||
      document.hidden ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    // The incoming sliver opens along the fold, then seats on the crease before the next push.
    const animation = active.current.animate(
      [
        { transform: "translate(-134px, 48px) rotate(-14deg) scale(.17, .34)", opacity: 0.52 },
        {
          transform: "translate(-52px, 18px) rotate(-8deg) scale(.62, .74)",
          opacity: 1,
          offset: 0.48,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: 640, easing: "cubic-bezier(.32,.05,.16,1)" },
    );
    flight.current = animation;
    return () => {
      animation.cancel();
      flight.current = null;
    };
  }, [count]);

  const complete = count === chunks.length;
  const action = playing ? "Pause" : complete ? "Replay" : count ? "Resume" : "Play";
  return (
    <figure className="fold-scene">
      <div className="fold-bar">
        <span>
          Fragment {String(count).padStart(2, "0")} / {String(chunks.length).padStart(2, "0")}
        </span>
        <button onClick={onPlay} disabled={disabled} aria-label={action + " fold"}>
          <ControlIcon name={playing ? "pause" : complete ? "replay" : "play"} />
          {action} fold
        </button>
      </div>
      <svg
        ref={drawing}
        className="drawing"
        viewBox="0 0 440 208"
        role="img"
        aria-label="JSON fragments folding into a paper plane"
      >
        <defs>
          <pattern
            id="paper-grain"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(57)"
          >
            <rect width="4" height="4" fill="#dfdfd8" />
            <path d="M0 0V4" stroke="#878782" strokeWidth="1.2" />
          </pattern>
          <pattern
            id="fold-grain"
            width="3.3"
            height="3.3"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(-34)"
          >
            <rect width="3.3" height="3.3" fill="#242424" />
            <path d="M0 0V3.3" stroke="#999994" />
          </pattern>
        </defs>
        <g fill="none" stroke="#464644" strokeWidth=".8" strokeDasharray="2 5">
          <path d="m20 114 181-47M8 154l175-52M52 185l171-59" />
        </g>
        <g fill="url(#paper-grain)">
          {trails.slice(count).map((path) => (
            <path key={path} d={path} />
          ))}
        </g>
        <g className="facets" strokeLinejoin="round">
          {facets.map((facet, i) => (
            <path
              key={facet.path}
              ref={count === i + 1 ? active : undefined}
              data-pending={count > 0 && i >= count}
              d={facet.path}
              fill={facet.fill}
            />
          ))}
        </g>
        {!complete && (
          <g fill="none" stroke="#686865" strokeWidth=".9">
            <path d="m151 99 38-11 13 6-39 12zM183 120l18-8 9 4-18 8z" />
          </g>
        )}
      </svg>
      <figcaption>
        <div>
          <span>{count ? "push" : "next"}</span>
          <code>{chunks[count ? count - 1 : 0]}</code>
        </div>
        <div>
          <span>{complete ? "complete" : count ? "partial" : "value"}</span>
          <code>{output || "Waiting for input"}</code>
        </div>
      </figcaption>
    </figure>
  );
}
