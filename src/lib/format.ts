export const money = (value: number | string | null | undefined) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";

  return n.toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
};

export const number = (value: number | string | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-AR") : "—";
};

export const percent = (value: number | string | null | undefined) => {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString("es-AR")}%` : "—";
};

export const date = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
};

export const dateTime = (value: string | null | undefined) => {
  if (!value) return "—";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "—";

  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

export const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;

  return new Date(y, m - 1, 1).toLocaleDateString("es-AR", { month: "short", year: "2-digit" });
};
