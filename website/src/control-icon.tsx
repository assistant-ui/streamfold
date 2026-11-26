const paths = {
  copy: "M6.5 6.5h8v9h-8z M10.5 4.5V2.5h-8v9h2",
  check: "m3 9 3.6 3.6L14 5",
  play: "m5 3 9 6-9 6z",
  pause: "M5.5 3.5v11m6-11v11",
  step: "m3.5 3.5 7.5 5.5-7.5 5.5z M14 3.5v11",
  replay: "M2.5 8.5a6.5 6.5 0 1 1 1.8 5 M2.5 4.5v4.3h4.3",
  reset: "m7 2.8-4.3 4L7 10.5 M3.3 6.8h6a4 4 0 0 1 0 8H6",
};

export function ControlIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 18 18"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
