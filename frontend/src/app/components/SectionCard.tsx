import React from 'react'

export default function SectionCard({
  title,
  children,
  icon,
}: {
  title: string
  children: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <section className="bg-white rounded-xl shadow-sm border border-blue-200 p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {icon && <div className="text-2xl">{icon}</div>}
        <h2 className="text-xl font-semibold text-blue-800">{title}</h2>
      </div>
      {children}
    </section>
  )
}
