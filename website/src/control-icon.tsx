const paths = {
  book: "M9 4.5c-1.8-1.5-4.5-1.8-7-1v10c2.5-.8 5.2-.5 7 1 1.8-1.5 4.5-1.8 7-1v-10c-2.5-.8-5.2-.5-7 1zm0 0v10",
  code: "m5.5 5-4 4 4 4m7-8 4 4-4 4m-2-10-3 12",
  branch:
    "M5 6v6m8-6c0 4-4 3.5-8 5M7 4a2 2 0 1 1-4 0 2 2 0 1 1 4 0zm0 10a2 2 0 1 1-4 0 2 2 0 1 1 4 0zm8-10a2 2 0 1 1-4 0 2 2 0 1 1 4 0z",
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
