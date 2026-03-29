interface NeuralChipProps {
  label: string;
  variant?: "primary" | "secondary";
}

export default function NeuralChip({ label, variant = "secondary" }: NeuralChipProps) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full font-label text-[10px] uppercase tracking-widest border
        ${variant === "primary"
          ? "bg-surface-container-highest text-primary border-primary/20"
          : "bg-surface-container-highest text-secondary border-secondary/20"
        }`}
    >
      {label}
    </span>
  );
}
