import Link from "next/link";

export default function CookiesPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Cookie Policy</h1>
        <p className="text-sm text-gray-500 mb-6">
          Last updated: March 18, 2026
        </p>

        <div className="space-y-5 text-gray-700">
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              Essential Cookies
            </h2>
            <p>
              Essential cookies are used for authentication, session integrity,
              and core platform functionality.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              Performance Cookies
            </h2>
            <p>
              We may use analytics or performance data to improve reliability
              and user experience.
            </p>
          </section>
          <section>
            <h2 className="font-semibold text-gray-900 mb-1">
              Managing Cookies
            </h2>
            <p>
              You can manage cookie preferences in your browser settings. Some
              features may not function correctly if essential cookies are
              disabled.
            </p>
          </section>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link href="/privacy" className="text-blue-600 hover:underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-blue-600 hover:underline">
            Terms of Service
          </Link>
          <Link href="/" className="text-blue-600 hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </main>
  );
}
