import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Terms of Service
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          Last updated: March 18, 2026
        </p>

        <div className="space-y-5 text-gray-700">
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">Use of Service</h2>
            <p>
              You agree to use Chronofy only for lawful healthcare workflow and
              staffing operations within your organization.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              Account Responsibility
            </h2>
            <p>
              You are responsible for access control, credential protection, and
              all actions performed under your account.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              Data and Availability
            </h2>
            <p>
              We aim for high availability, but uptime and uninterrupted access
              are not guaranteed in all environments.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">Limitation</h2>
            <p>
              Chronofy supports care coordination and does not replace clinical
              judgment, medical orders, or regulatory obligations.
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link href="/privacy" className="text-blue-600 hover:underline">
            Privacy Policy
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
