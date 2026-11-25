export function Fold() {
  return (
    <svg
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
        <path d="m27 105 10-3 4 4-10 3zM65 95l25-7 8 5-25 8zM121 78l27-8 22 8-28 9z" />
        <path d="m42 141 13-4 7 5-14 5zM95 124l25-9 12 7-25 9z" />
        <path d="m61 168 8-3 4 4-8 3zM116 150l18-7 11 6-19 8zM155 135l27-11 18 11-28 12z" />
      </g>
      <g strokeLinejoin="round">
        <path d="m153 87 255-66-188 97z" fill="url(#paper-grain)" stroke="#dadad3" />
        <path d="m220 118 188-97-179 144z" fill="url(#fold-grain)" stroke="#969691" />
        <path d="m229 165 179-144-148 116z" fill="#797974" stroke="#aaa9a2" />
        <path d="m237 124 171-103-99 156z" fill="url(#paper-grain)" stroke="#e8e8e2" />
        <path d="m237 124 171-103-145 119z" fill="#a1a19a" />
        <path
          d="m238 124 170-103M163 89l234-63M306 172l94-140"
          fill="none"
          stroke="#f5f5ee"
          strokeWidth="1.15"
        />
      </g>
      <g fill="none" stroke="#686865" strokeWidth=".9">
        <path d="m151 99 38-11 13 6-39 12zM183 120l18-8 9 4-18 8z" />
      </g>
    </svg>
  );
}
