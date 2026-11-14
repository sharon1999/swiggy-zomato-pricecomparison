export const cx = (...a) => a.filter(Boolean).join(" ");

const VARIANTS = {
  default: "border-line bg-panel",
  primary: "border-accent bg-accent text-accent-ink",
  swiggy: "border-swiggy bg-swiggy-soft text-swiggy hover:enabled:bg-swiggy hover:enabled:text-white",
  swiggyOutline: "border-swiggy bg-panel text-swiggy",
  dashed: "border-dashed border-line bg-panel",
};
const SIZES = {
  md: "rounded-xl px-4 py-2.5",
  sm: "rounded-xl px-3 py-2 text-[13px]",
  xs: "rounded-lg px-2.5 py-1 text-xs",
};

export function Button({ variant = "default", size = "md", className, ...props }) {
  return (
    <button
      className={cx(
        "cursor-pointer border text-center font-semibold disabled:cursor-default disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({ className, ...props }) {
  return (
    <button
      className={cx("cursor-pointer justify-self-start border-0 bg-transparent p-0 text-xs text-muted underline disabled:opacity-50", className)}
      {...props}
    />
  );
}

/** Indian veg (green dot) / non-veg (red triangle) mark. */
export function VegDot({ veg }) {
  const color = veg ? "border-[#2e9d4f]" : "border-[#b5452f]";
  return (
    <span className={cx("relative mt-1 size-3 flex-none rounded-[2px] border-[1.5px]", color)}>
      <span
        className={cx(
          "absolute inset-0.5",
          veg ? "rounded-full bg-[#2e9d4f]" : "bg-[#b5452f] [clip-path:polygon(50%_0,100%_100%,0_100%)]",
        )}
      />
    </span>
  );
}

export function Plat({ p, className }) {
  return (
    <span
      className={cx(
        "flex-none rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        p === "zomato" ? "bg-zomato-soft text-zomato" : "bg-swiggy-soft text-swiggy",
        className,
      )}
    >
      {p}
    </span>
  );
}

export function Spinner() {
  return <span className="inline-block size-2.5 flex-none animate-spin rounded-full border-2 border-line border-t-accent" />;
}

export function Status({ children }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted">
      <Spinner />
      <span>{children}</span>
    </div>
  );
}

export const card = "relative flex flex-col gap-2 rounded-[14px] border border-line bg-panel p-3.5 shadow-card";

export function Meta({ children }) {
  return <div className="flex flex-wrap gap-2.5 text-xs text-muted">{children}</div>;
}

export function SourceTag({ source }) {
  return source === "demo" ? (
    <span className="rounded-md border border-dashed border-line px-1.5 text-[10px] text-muted">demo</span>
  ) : (
    <span className="rounded-md border border-accent px-1.5 text-[10px] font-semibold text-accent">live</span>
  );
}
