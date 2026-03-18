import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Last updated: March 18, 2026
        </p>

        <div className="space-y-5 text-gray-700">
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              What We Collect
            </h2>
            <p>
              We process account, scheduling, and handoff data needed to provide
              the service and support your organization’s workflow.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              How We Use Data
            </h2>
            <p>
              Data is used for feature delivery, reliability, support,
              auditability, and security monitoring.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              Retention and Access
            </h2>
            <p>
              Data retention follows your organization configuration and legal
              obligations. Authorized users can access data based on role.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">Your Rights</h2>
            <p>
              Depending on jurisdiction, you may request access, correction,
              export, or deletion through your organization administrator.
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link href="/terms" className="text-blue-600 hover:underline">
            Terms of Service
          </Link>
          <Link href="/cookies" className="text-blue-600 hover:underline">
            Cookie Policy
          </Link>
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
