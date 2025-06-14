// components/SectionCard.tsx
import React from 'react'

export default function SectionCard({
  title,
  children,
  icon,
  className = '',
  actions
}: {
  title: string
  children: React.ReactNode
  icon?: React.ReactNode
  className?: string
  actions?: React.ReactNode
}) {
  return (
    <section
      className={`bg-white rounded-xl shadow-sm border border-blue-200 p-4 flex flex-col justify-between gap-4 w-full h-full ${className}`}
    >
      <div className="flex items-center gap-3">
        {icon && <div className="text-2xl">{icon}</div>}
        <h2 className="text-lg font-semibold text-blue-800">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
