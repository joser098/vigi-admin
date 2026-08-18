import type { ReactNode } from "react";

export const PageTitle = ({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) => (
  <div className="mb-6 flex items-end justify-between gap-4">
    <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
    {action}
  </div>
);

export const Stat = ({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) => (
  <div className="card p-5">
    <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
      {label}
    </p>
    <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    {hint && <p className="mt-1 text-xs text-neutral-400">{hint}</p>}
  </div>
);

export const Badge = ({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "amber" | "red" | "violet";
}) => {
  const tonos = {
    neutral: "bg-neutral-100 text-neutral-600",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tonos[tone]}`}
    >
      {children}
    </span>
  );
};

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="card px-6 py-16 text-center">
    <p className="text-sm text-neutral-500">{children}</p>
  </div>
);

export const Loading = () => (
  <div className="px-6 py-16 text-center">
    <p className="text-sm text-neutral-400">Cargando…</p>
  </div>
);

export const ErrorBox = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
    <p className="text-sm text-red-700">{children}</p>
  </div>
);
