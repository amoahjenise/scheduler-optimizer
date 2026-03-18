import Link from "next/link";

const links = [
  { href: "/about", label: "About Us" },
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/cookies", label: "Cookie Policy" },
];

export default function LegalPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl border border-gray-200 p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Legal Center</h1>
        <p className="text-gray-700 mb-6">
          Access Chronofy legal and policy pages from one place.
        </p>
        <ul className="space-y-2 mb-8">
          {links.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-blue-600 hover:underline">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back to Home
        </Link>
      </div>
    </main>
  );
}
