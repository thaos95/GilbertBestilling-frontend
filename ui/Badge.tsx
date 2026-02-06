type BadgeVariant = "success" | "warning" | "error" | "info" | "neutral"

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
}

const variantStyles = {
  success: "bg-green-100 text-green-800",
  warning: "bg-yellow-100 text-yellow-800",
  error: "bg-red-100 text-red-800",
  info: "bg-blue-100 text-blue-800",
  neutral: "bg-gray-100 text-gray-800",
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center px-2 py-1 rounded-full text-xs font-medium",
        variantStyles[variant],
      ].join(" ")}
    >
      {children}
    </span>
  )
}
