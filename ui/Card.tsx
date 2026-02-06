import React from "react"

interface CardProps {
  children: React.ReactNode
  className?: string
  hover?: boolean
}

export function Card({ children, className = "", hover = false }: CardProps) {
  return (
    <div
      className={[
        "bg-white rounded-lg border border-gray-200",
        hover && "transition-colors hover:border-gray-300",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={["px-6 py-4 border-b border-gray-200", className].join(" ")}>
      {children}
    </div>
  )
}

export function CardContent({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return <div className={["px-6 py-4", className].join(" ")}>{children}</div>
}

export function CardFooter({
  children,
  className = "",
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={["px-6 py-4 border-t border-gray-200 bg-gray-50", className].join(
        " "
      )}
    >
      {children}
    </div>
  )
}
