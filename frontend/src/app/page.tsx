'use client'

import { SignedIn, SignedOut, SignInButton, SignUpButton } from '@clerk/nextjs'
import { motion } from 'framer-motion'
 
export default function Home() {
  return (
    <main className="flex flex-col min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-black text-white px-6 py-16">
      <div className="max-w-6xl mx-auto flex flex-col items-center text-center gap-5">
        
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-center gap-4"
        >
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight" style={{ fontFamily: 'var(--font-geist-sans)' }}>
            Chronofy
          </h1>
          <p className="max-w-2xl text-lg md:text-xl text-indigo-300 font-light">
            Designed for teams who manage schedules. Upload, organize, and optimize shifts — all in one place.
          </p>

          <div className="flex flex-wrap justify-center gap-4 mt-4">
            <SignedOut>
              <SignUpButton mode="modal">
                <button className="px-6 py-3 rounded-md bg-indigo-600 hover:bg-indigo-700 transition font-semibold">
                  Get Started
                </button>
              </SignUpButton>
              <SignInButton mode="modal">
                <button className="px-6 py-3 rounded-md border border-indigo-600 hover:bg-indigo-800 transition font-semibold">
                  Sign In
                </button>
              </SignInButton>
            </SignedOut>

            <SignedIn>
              <a
                href="/dashboard"
                className="px-6 py-3 rounded-md bg-indigo-600 hover:bg-indigo-700 transition font-semibold"
              >
                Go to Dashboard
              </a>
            </SignedIn>
          </div>
        </motion.div>

        {/* Hero Illustration */}
        {/* <motion.img
          src="/hero-illustration.svg"
          alt="Illustration of calendar scheduling"
          className="w-full max-w-3xl mt-12"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        /> */}

        {/* Feature Section */}
        <section className="mt-20 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-10 w-full">
          {features.map(({ icon, title, description }) => (
            <motion.div
              key={title}
              className="bg-indigo-800/30 rounded-xl p-6 flex flex-col items-center text-center gap-3"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              viewport={{ once: true }}
            >
              <div className="text-4xl">{icon}</div>
              <h3 className="text-xl font-semibold">{title}</h3>
              <p className="text-indigo-300 text-sm">{description}</p>
            </motion.div>
          ))}
        </section>

        {/* FAQ Section */}
        <section className="mt-24 w-full max-w-3xl text-left">
          <h2 className="text-3xl font-semibold mb-6 text-center">FAQs</h2>
          <div className="space-y-6">
            <FAQ
              question="Who is Chronofy for?"
              answer="Chronofy is made for team leads, managers, and schedulers — especially in healthcare — who need a faster way to build and share shift calendars."
            />
            <FAQ
              question="What file types can I upload?"
              answer="You can upload common image formats like PNG, JPG, and screenshots of schedules."
            />
            <FAQ
              question="Is this fully automated?"
              answer="It helps a lot — using smart suggestions and templates — but you stay in control. You can review and adjust before exporting."
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-24 text-sm text-indigo-400 text-center">
          © {new Date().getFullYear()} Chronofy. Built with care.
        </footer>
      </div>
    </main>
  )
}

const features = [
  {
    icon: '📸',
    title: 'Upload Schedules',
    description: 'Add multiple screenshots and notes to start building your schedule.',
  },
  {
    icon: '📝',
    title: 'Smart Suggestions',
    description: 'Detects nurses and shift info automatically so you can tweak fast.',
  },
  {
    icon: '📋',
    title: 'Clean Editing UI',
    description: 'A visual schedule that’s easy to tag, edit, and manage.',
  },
  {
    icon: '⚙️',
    title: 'One-Click Optimize',
    description: 'Just press a button and watch Chronofy organize your calendar (demo feature).',
  },
  {
    icon: '📤',
    title: 'Export & Share',
    description: 'Download your schedule as a neat calendar to distribute or print.',
  },
  {
    icon: '🔐',
    title: 'Secure Access',
    description: 'Only approved users can sign in and manage the schedule.',
  },
]

function FAQ({ question, answer }: { question: string; answer: string }) {
  return (
    <div>
      <h4 className="text-lg font-medium text-white">{question}</h4>
      <p className="text-indigo-300 mt-1 text-sm">{answer}</p>
    </div>
  )
}
