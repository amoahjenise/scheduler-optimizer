import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-200 p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">About Us</h1>
        <p className="text-gray-700 mb-4">
          Chronofy helps healthcare teams coordinate schedules and handoff
          reports with faster workflows, clearer communication, and safer
          continuity of care.
        </p>
        <p className="text-gray-700 mb-8">
          Our platform is designed for clinical operations: shift handovers,
          staffing optimization, team collaboration, and audit-friendly activity
          tracking.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8 text-sm">
          <Link href="/privacy" className="text-blue-600 hover:underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="text-blue-600 hover:underline">
            Terms of Service
          </Link>
          <Link href="/cookies" className="text-blue-600 hover:underline">
            Cookie Policy
          </Link>
          <Link href="/legal" className="text-blue-600 hover:underline">
            Legal Center
          </Link>
        </div>

        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to Home
        </Link>
      </div>
    </main>
  );
}
