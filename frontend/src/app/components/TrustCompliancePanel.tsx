"use client";

import { CheckCircle2 } from "lucide-react";

export default function TrustCompliancePanel() {
  const items = [
    {
      title: "Signed BAA",
      detail:
        "Business Associate Agreement available for healthcare organizations handling PHI.",
    },
    {
      title: "AES-256 Encryption",
      detail:
        "Data protection at rest with strong encryption standards, plus TLS in transit.",
    },
    {
      title: "Audit Logs",
      detail:
        "Administrative access logs for who accessed data, what changed, and when.",
    },
    {
      title: "Uptime & Support",
      detail:
        "Reliability-focused operations and support readiness for clinical workflows.",
    },
  ];

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-gray-900">
          Trust & Compliance (Medical Context)
        </h2>
        <p className="text-sm text-gray-600">
          Controls expected for healthcare-grade scheduling tools.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-gray-200 bg-gray-50/70 p-4"
          >
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-blue-600" />
              <div>
                <p className="text-sm font-semibold text-gray-900">
                  {item.title}
                </p>
                <p className="mt-1 text-sm text-gray-600">{item.detail}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
