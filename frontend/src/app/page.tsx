"use client";

import React from "react";
import { SignedIn, SignedOut, SignInButton, SignUpButton } from "@clerk/nextjs";
import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Shield,
  Zap,
  Sparkles,
  ChevronRight,
  Check,
  ClipboardList,
  Users,
  FileText,
  CalendarDays,
  Mic,
  Brain,
  BookOpenText,
  Activity,
} from "lucide-react";
import Image from "next/image";
import TrustCompliancePanel from "./components/TrustCompliancePanel";
import LanguageSwitcher from "./components/LanguageSwitcher";

// GlassCard Component
const GlassCard = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={`bg-white/60 backdrop-blur-xl border border-white/50 rounded-3xl shadow-[0_4px_24px_rgba(0,0,0,0.06)] ${className}`}
  >
    {children}
  </div>
);

// FloatingBadge Component
const FloatingBadge = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.5, duration: 0.5 }}
    className={`inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur-md border border-white/50 rounded-full shadow-lg ${className}`}
  >
    {children}
  </motion.div>
);

// Navigation Component (floating pill with scroll detection)
const Navigation = () => {
  const [isScrolled, setIsScrolled] = React.useState(false);
  const t = useTranslations("landing");

  React.useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 100);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto">
        <div
          className={`flex items-center justify-between rounded-full px-6 py-3 transition-all duration-300 ${
            isScrolled
              ? "bg-white/95 backdrop-blur-xl border border-gray-200 shadow-lg"
              : "bg-white/10 backdrop-blur-xl border border-white/20 shadow-[0_4px_32px_rgba(0,0,0,0.25)]"
          }`}
        >
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span
              className={`text-lg font-bold tracking-tight transition-colors ${
                isScrolled ? "text-gray-900" : "text-white"
              }`}
            >
              Chronofy
            </span>
          </div>

          {/* Center Nav Links */}
          <div
            className={`hidden md:flex items-center gap-1 text-sm font-medium transition-colors ${
              isScrolled ? "text-gray-600" : "text-white/80"
            }`}
          >
            <a
              href="#features"
              className={`px-4 py-2 transition-colors ${
                isScrolled ? "hover:text-gray-900" : "hover:text-white"
              }`}
            >
              {t("nav.features")}
            </a>
            <span className={isScrolled ? "text-gray-300" : "text-white/30"}>
              /
            </span>
            <a
              href="#solutions"
              className={`px-4 py-2 transition-colors ${
                isScrolled ? "hover:text-gray-900" : "hover:text-white"
              }`}
            >
              {t("nav.solutions")}
            </a>
            <span className={isScrolled ? "text-gray-300" : "text-white/30"}>
              /
            </span>
            <a
              href="#about"
              className={`px-4 py-2 transition-colors ${
                isScrolled ? "hover:text-gray-900" : "hover:text-white"
              }`}
            >
              {t("nav.about")}
            </a>
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <SignedOut>
              <SignInButton mode="modal">
                <button
                  className={`text-sm font-medium px-4 py-2 transition-colors ${
                    isScrolled
                      ? "text-gray-600 hover:text-gray-900"
                      : "text-white/80 hover:text-white"
                  }`}
                >
                  {t("nav.signIn")}
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="flex items-center gap-2 px-5 py-2.5 bg-white text-gray-900 text-sm font-semibold rounded-full transition-all hover:bg-white/90 shadow-lg">
                  {t("nav.getStarted")}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <DashboardButton />
            </SignedIn>
          </div>
        </div>
      </div>
    </nav>
  );
};

// Dashboard Button Component
const DashboardButton = () => {
  const router = useRouter();
  const t = useTranslations("landing");
  return (
    <button
      onClick={() => router.push("/dashboard")}
      className="flex items-center gap-2 px-5 py-2.5 bg-white text-gray-900 text-sm font-semibold rounded-full transition-all hover:bg-white/90 shadow-lg"
    >
      {t("nav.dashboard")}
      <ArrowRight className="w-4 h-4" />
    </button>
  );
};

// Hero Section
const HeroSection = () => {
  const t = useTranslations("landing");
  return (
    <section className="relative min-h-screen flex items-center pt-24 pb-16">
      {/* Background Image */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/hospital.png"
          alt="Hospital Building"
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/70 via-blue-700/60 to-blue-500/40" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-8 w-full">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        >
          <FloatingBadge className="mb-6">
            <Sparkles className="w-4 h-4 text-[#2D7073]" />
            <span className="text-sm font-medium text-gray-700">
              {t("hero.badge")}
            </span>
          </FloatingBadge>

          <h1 className="text-5xl md:text-6xl font-bold text-white leading-[1.1] mb-6">
            {t("hero.headline1")}{" "}
            <span className="text-blue-200 italic font-light">
              {t("hero.headline2")}
            </span>
          </h1>

          <p className="text-lg text-white/90 max-w-lg mb-8 leading-relaxed">
            {t("hero.body")}
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <SignedIn>
              <DashboardButton />
            </SignedIn>
            <SignedOut>
              <SignUpButton mode="modal">
                <button className="flex items-center gap-2 px-8 py-4 bg-[#1A5CFF] hover:bg-[#1550E5] text-white font-semibold rounded-full transition-all shadow-xl shadow-blue-500/30">
                  {t("hero.cta")}
                  <ArrowRight className="w-5 h-5" />
                </button>
              </SignUpButton>
            </SignedOut>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

// Features Section
const FeaturesSection = () => {
  const t = useTranslations("landing");
  const features = [
    {
      icon: <Shield className="w-5 h-5" />,
      title: t("features.item0Title"),
      desc: t("features.item0Desc"),
    },
    {
      icon: <Zap className="w-5 h-5" />,
      title: t("features.item1Title"),
      desc: t("features.item1Desc"),
    },
    {
      icon: <Sparkles className="w-5 h-5" />,
      title: t("features.item2Title"),
      desc: t("features.item2Desc"),
    },
  ];

  return (
    <section id="features" className="py-24 bg-[#F5F7FA]">
      <div className="max-w-7xl mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <span className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-full text-sm font-medium text-[#2D7073] mb-4 shadow-sm">
            <Sparkles className="w-4 h-4" />
            {t("features.badge")}
          </span>
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            {t("features.headline")}
          </h2>
          <p className="text-lg text-gray-500 max-w-2xl mx-auto">
            {t("features.body")}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              viewport={{ once: true }}
            >
              <GlassCard className="p-8 h-full hover:shadow-xl transition-shadow duration-300 bg-white/80">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#1A5CFF] to-[#2D7073] flex items-center justify-center text-white mb-6">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">
                  {feature.title}
                </h3>
                <p className="text-gray-500 leading-relaxed">{feature.desc}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// Solutions Section
const SolutionsSection = () => {
  const t = useTranslations("landing");

  const tools = [
    {
      title: t("solutions.schedulerTitle"),
      desc: t("solutions.schedulerDesc"),
      cta: t("solutions.schedulerCta"),
      href: "/scheduler",
      gradient: "from-[#1A5CFF] to-indigo-600",
      glow: "hover:shadow-blue-500/20",
      icon: <ClipboardList className="w-7 h-7" />,
    },
    {
      title: t("solutions.handoverTitle"),
      desc: t("solutions.handoverDesc"),
      cta: t("solutions.handoverCta"),
      href: "/handover",
      gradient: "from-[#2D7073] to-teal-500",
      glow: "hover:shadow-teal-500/20",
      icon: <FileText className="w-7 h-7" />,
    },
    {
      title: t("solutions.nursesTitle"),
      desc: t("solutions.nursesDesc"),
      cta: t("solutions.nursesCta"),
      href: "/nurses",
      gradient: "from-purple-500 to-pink-500",
      glow: "hover:shadow-purple-500/20",
      icon: <Users className="w-7 h-7" />,
    },
    {
      title: t("solutions.schedulesTitle"),
      desc: t("solutions.schedulesDesc"),
      cta: t("solutions.schedulesCta"),
      href: "/schedules",
      gradient: "from-cyan-500 to-blue-500",
      glow: "hover:shadow-cyan-500/20",
      icon: <CalendarDays className="w-7 h-7" />,
    },
    {
      title: t("solutions.ambientTitle"),
      desc: t("solutions.ambientDesc"),
      cta: t("solutions.ambientCta"),
      href: "/ambient",
      gradient: "from-emerald-500 to-green-500",
      glow: "hover:shadow-emerald-500/20",
      icon: <Mic className="w-7 h-7" />,
    },
    {
      title: t("solutions.burnoutTitle"),
      desc: t("solutions.burnoutDesc"),
      cta: t("solutions.burnoutCta"),
      href: "/burnout",
      gradient: "from-rose-500 to-orange-500",
      glow: "hover:shadow-rose-500/20",
      icon: <Brain className="w-7 h-7" />,
    },
    {
      title: t("solutions.learningTitle"),
      desc: t("solutions.learningDesc"),
      cta: t("solutions.learningCta"),
      href: "/learning",
      gradient: "from-amber-500 to-yellow-500",
      glow: "hover:shadow-amber-500/20",
      icon: <BookOpenText className="w-7 h-7" />,
    },
    {
      title: t("solutions.activitiesTitle"),
      desc: t("solutions.activitiesDesc"),
      cta: t("solutions.activitiesCta"),
      href: "/activities",
      gradient: "from-slate-600 to-slate-800",
      glow: "hover:shadow-slate-500/20",
      icon: <Activity className="w-7 h-7" />,
    },
  ];

  return (
    <section id="solutions" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          viewport={{ once: true }}
          className="mb-16"
        >
          <h2 className="text-3xl font-bold text-gray-900 mb-3">
            {t("solutions.headline")}
          </h2>
          <p className="text-gray-500">{t("solutions.body")}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
          {tools.map((tool, index) => (
            <motion.div
              key={tool.href}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.06 * index }}
              viewport={{ once: true }}
              className={`group relative overflow-hidden bg-gradient-to-br ${tool.gradient} rounded-3xl p-8 text-white cursor-pointer hover:shadow-2xl ${tool.glow} transition-all`}
            >
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
              <div className="relative">
                <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
                  {tool.icon}
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-xl font-semibold">{tool.title}</h3>
                  <span className="px-2 py-0.5 bg-white/20 text-white text-xs font-medium rounded-full">
                    {t("solutions.live")}
                  </span>
                </div>
                <p className="text-white/80 text-sm mb-6 leading-relaxed">
                  {tool.desc}
                </p>
                <SignedIn>
                  <a
                    href={tool.href}
                    className="flex items-center gap-2 text-sm font-medium group-hover:gap-3 transition-all"
                  >
                    {tool.cta} <ChevronRight className="w-4 h-4" />
                  </a>
                </SignedIn>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button className="flex items-center gap-2 text-sm font-medium group-hover:gap-3 transition-all">
                      {tool.cta} <ChevronRight className="w-4 h-4" />
                    </button>
                  </SignInButton>
                </SignedOut>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

// About Section
const AboutSection = () => {
  const t = useTranslations("landing");
  return (
    <section id="about" className="py-24 bg-[#F5F7FA]">
      <div className="max-w-7xl mx-auto px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <h2 className="text-4xl font-bold text-gray-900 mb-6">
              {t("about.headline")}
            </h2>
            <div className="space-y-4 text-gray-600 leading-relaxed">
              <p>{t("about.para1")}</p>
              <p>{t("about.para2")}</p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
          >
            <GlassCard className="p-8 bg-white/90">
              <h3 className="text-xl font-semibold text-gray-900 mb-6">
                {t("about.cardTitle")}
              </h3>
              <div className="space-y-4">
                {[
                  t("about.bullet1"),
                  t("about.bullet2"),
                  t("about.bullet3"),
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#1A5CFF]/10 flex items-center justify-center flex-shrink-0">
                      <Check className="w-3.5 h-3.5 text-[#1A5CFF]" />
                    </div>
                    <span className="text-gray-700">{item}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

// Footer
const Footer = () => {
  const t = useTranslations("landing");
  return (
    <footer className="py-12 bg-white border-t border-gray-200">
      <div className="max-w-7xl mx-auto px-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <img
              src="/logo-placeholder.png"
              alt="Logo"
              className="h-14 w-auto"
            />
            <span className="text-xl font-bold text-gray-900">Chronofy</span>
          </div>
          <div className="text-sm text-gray-500 text-center md:text-right">
            <p>
              © {new Date().getFullYear()} Chronofy. {t("footer.tagline")}
            </p>
            <div className="mt-1 flex items-center justify-center md:justify-end gap-3">
              <Link
                href="/about"
                className="hover:text-gray-700 hover:underline"
              >
                {t("footer.about")}
              </Link>
              <Link
                href="/terms"
                className="hover:text-gray-700 hover:underline"
              >
                {t("footer.terms")}
              </Link>
              <Link
                href="/privacy"
                className="hover:text-gray-700 hover:underline"
              >
                {t("footer.privacy")}
              </Link>
              <Link
                href="/cookies"
                className="hover:text-gray-700 hover:underline"
              >
                {t("footer.cookies")}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

// Main Page Component
export default function LandingPage() {
  return (
    <main className="flex flex-col min-h-screen bg-white overflow-x-hidden">
      <Navigation />
      <HeroSection />
      <FeaturesSection />
      <SolutionsSection />
      <AboutSection />
      <section className="bg-[#F5F7FA] py-10">
        <div className="max-w-7xl mx-auto px-8">
          <TrustCompliancePanel />
        </div>
      </section>
      <Footer />
    </main>
  );
}
