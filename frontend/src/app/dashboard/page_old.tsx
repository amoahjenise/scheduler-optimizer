"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import {
  fetchPatientsAPI,
  fetchTodaysHandoversAPI,
  fetchYesterdaysHandoversAPI,
  deleteHandoverAPI,
  updatePatientAPI,
  createHandoverAPI,
  fetchOptimizedSchedulesAPI,
  fetchOptimizedScheduleByIdAPI,
  deleteScheduleAPI,
  Patient,
  Handover,
  PatientCreate,
} from "../lib/api";

type ModalType = "patients" | "handovers" | "schedules" | null;

interface Schedule {
  id: string;
  schedule_id: string | null;
  finalized: boolean;
  created_at: string | null;
}

export default function Dashboard() {
  const { user } = useUser();
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [editForm, setEditForm] = useState<Partial<PatientCreate>>({});
  const [savingPatient, setSavingPatient] = useState(false);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [deletingHandoverId, setDeletingHandoverId] = useState<string | null>(
    null,
  );
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(
    null,
  );
  const [selectedSchedules, setSelectedSchedules] = useState<Set<string>>(
    new Set(),
  );
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [showYesterday, setShowYesterday] = useState(true);
  const [stats, setStats] = useState({
    activePatients: 0,
    handoversYesterday: 0,
    schedulesCreated: 0,
    loading: true,
  });

  // Fetch real stats and data
  useEffect(() => {
    async function loadStats() {
      try {
        const fetchHandoversAPI = showYesterday
          ? fetchYesterdaysHandoversAPI
          : fetchTodaysHandoversAPI;
        const [patientsRes, dayHandovers, nightHandovers, schedulesList] =
          await Promise.all([
            fetchPatientsAPI({ active_only: true }),
            fetchHandoversAPI("day"),
            fetchHandoversAPI("night"),
            fetchOptimizedSchedulesAPI(),
          ]);

        setPatients(patientsRes.patients || []);

        // Combine handovers and dedupe by patient_id (keep most recent per patient)
        const allHandovers = [
          ...(dayHandovers.handovers || []),
          ...(nightHandovers.handovers || []),
        ];
        const handoversByPatient = new Map<string, Handover>();
        for (const h of allHandovers) {
          const existing = handoversByPatient.get(h.patient_id);
          if (
            !existing ||
            new Date(h.updated_at) > new Date(existing.updated_at)
          ) {
            handoversByPatient.set(h.patient_id, h);
          }
        }
        const uniqueHandovers = Array.from(handoversByPatient.values());
        setHandovers(uniqueHandovers);

        // Set schedules
        setSchedules(Array.isArray(schedulesList) ? schedulesList : []);

        setStats({
          activePatients: patientsRes.patients?.length || 0,
          handoversYesterday: uniqueHandovers.length,
          schedulesCreated: Array.isArray(schedulesList)
            ? schedulesList.length
            : 0,
          loading: false,
        });
      } catch (err) {
        console.error("Failed to load stats:", err);
        setStats((prev) => ({ ...prev, loading: false }));
      }
    }
    loadStats();
  }, [showYesterday]);

  const tools = [
    {
      id: "handover",
      name: "Hand-off Report",
      description:
        "Prepare and manage patient hand-off reports for shift changes. Import from Word docs or enter manually.",
      href: "/handover",
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
      ),
      color: "blue",
      status: "active",
    },
    {
      id: "scheduler",
      name: "Schedule Optimizer",
      description:
        "Upload staff schedules and optimize assignments based on rules and constraints.",
      href: "/scheduler",
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      ),
      color: "green",
      status: "active",
    },
    {
      id: "nurses",
      name: "Nurse Management",
      description:
        "Manage nursing staff profiles, employment details, certifications, and work requirements.",
      href: "/nurses",
      icon: (
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
      color: "purple",
      status: "active",
    },
  ];

  const colorClasses: Record<
    string,
    { bg: string; icon: string; border: string; hover: string }
  > = {
    blue: {
      bg: "bg-blue-50",
      icon: "text-blue-600",
      border: "border-blue-200",
      hover: "hover:border-blue-400 hover:shadow-lg hover:shadow-blue-100",
    },
    green: {
      bg: "bg-green-50",
      icon: "text-green-600",
      border: "border-green-200",
      hover: "hover:border-green-400 hover:shadow-lg hover:shadow-green-100",
    },
    purple: {
      bg: "bg-purple-50",
      icon: "text-purple-600",
      border: "border-purple-200",
      hover: "hover:border-purple-400 hover:shadow-lg hover:shadow-purple-100",
    },
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-gray-500 text-sm mb-1">
              Welcome back{user?.firstName ? `, ${user.firstName}` : ""}
            </p>
            <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
          </motion.div>
        </div>
      </div>

      {/* Tools Grid */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <h2 className="text-lg font-medium text-gray-900 mb-6">Your Tools</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tools.map((tool, index) => {
            const colors = colorClasses[tool.color] || colorClasses.blue;

            return (
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.1 }}
                className="h-full"
              >
                <Link
                  href={tool.href}
                  className={`block h-full p-6 bg-white rounded-xl border ${colors.border} ${colors.hover} transition-all duration-200`}
                >
                  <div className="flex items-start gap-4 h-full">
                    <div
                      className={`w-14 h-14 ${colors.bg} rounded-xl flex items-center justify-center flex-shrink-0 ${colors.icon}`}
                    >
                      {tool.icon}
                    </div>
                    <div className="flex-1 min-h-[80px]">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {tool.name}
                        </h3>
                        {tool.status === "active" && (
                          <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full">
                            Active
                          </span>
                        )}
                      </div>
                      <p className="text-gray-500 text-sm leading-relaxed">
                        {tool.description}
                      </p>
                    </div>
                    <svg
                      className="w-5 h-5 text-gray-400 mt-1 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>

        {/* Quick Stats - Now clickable to show modals */}
        <div className="mt-12">
          <h2 className="text-lg font-medium text-gray-900 mb-6">
            Quick Overview
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Active Patients */}
            <button
              onClick={() => setActiveModal("patients")}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer group text-left w-full"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <svg
                    className="w-5 h-5 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-semibold text-gray-900">
                    {stats.loading ? (
                      <span className="inline-block w-8 h-6 bg-gray-200 rounded animate-pulse" />
                    ) : (
                      stats.activePatients
                    )}
                  </p>
                  <p className="text-sm text-gray-500">Active Patients</p>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400 group-hover:text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </div>
            </button>

            {/* Hand-offs Toggle */}
            <div
              onClick={(e) => {
                // Only open modal if click is not on toggle buttons
                if (!(e.target as Element).closest(".toggle-buttons")) {
                  setActiveModal("handovers");
                }
              }}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-green-400 hover:shadow-md transition-all cursor-pointer group text-left w-full"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center group-hover:bg-green-200 transition-colors">
                  <svg
                    className="w-5 h-5 text-green-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-2xl font-semibold text-gray-900">
                      {stats.loading ? (
                        <span className="inline-block w-8 h-6 bg-gray-200 rounded animate-pulse" />
                      ) : (
                        stats.handoversYesterday
                      )}
                    </p>
                    <div className="toggle-buttons inline-flex items-center bg-gray-100 rounded-full p-1">
                      <button
                        className={`px-3 py-1 text-xs rounded-full font-medium transition-all ${
                          showYesterday
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowYesterday(true);
                        }}
                        title="View yesterday's hand-offs"
                      >
                        Yesterday
                      </button>
                      <button
                        className={`px-3 py-1 text-xs rounded-full font-medium transition-all ${
                          !showYesterday
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowYesterday(false);
                        }}
                        title="View today's hand-offs"
                      >
                        Today
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500">
                    {showYesterday ? "Yesterday's" : "Today's"} Hand-offs
                  </p>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400 group-hover:text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </div>
            </div>

            {/* Schedules Created */}
            <button
              onClick={() => setActiveModal("schedules")}
              className="bg-white rounded-xl border border-gray-200 p-5 hover:border-purple-400 hover:shadow-md transition-all cursor-pointer group text-left w-full"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                  <svg
                    className="w-5 h-5 text-purple-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-semibold text-gray-900">
                    {stats.loading ? (
                      <span className="inline-block w-8 h-6 bg-gray-200 rounded animate-pulse" />
                    ) : (
                      stats.schedulesCreated
                    )}
                  </p>
                  <p className="text-sm text-gray-500">Schedules Created</p>
                </div>
                <svg
                  className="w-4 h-4 text-gray-400 group-hover:text-purple-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {activeModal && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveModal(null)}
              className="fixed inset-0 bg-black/50 z-40"
            />

            {/* Modal Content */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-x-4 top-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-lg bg-white rounded-2xl shadow-xl z-50 max-h-[80vh] overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <div className="flex items-center gap-2">
                  {activeModal === "patients" && (
                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-4 h-4 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </div>
                  )}
                  {activeModal === "handovers" && (
                    <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-4 h-4 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                  )}
                  {activeModal === "schedules" && (
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                      <svg
                        className="w-4 h-4 text-purple-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  )}
                  <span className="font-medium text-gray-900">
                    {activeModal === "patients" && "Active Patients"}
                    {activeModal === "handovers" &&
                      `${showYesterday ? "Yesterday's" : "Today's"} Hand-offs`}
                    {activeModal === "schedules" && "Schedules"}
                  </span>
                </div>
                <button
                  onClick={() => setActiveModal(null)}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                {/* Active Patients Modal Content */}
                {activeModal === "patients" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-gray-500">
                        {patients.length} patient(s)
                      </p>
                      <Link
                        href="/handover"
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                      >
                        Go to Hand-off →
                      </Link>
                    </div>
                    {patients.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">
                        No active patients
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {patients.map((patient) => (
                          <div
                            key={patient.id}
                            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                          >
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                              <span className="text-blue-600 font-semibold text-sm">
                                {patient.room_number?.slice(-2) || "?"}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {patient.last_name}, {patient.first_name}
                              </p>
                              <p className="text-xs text-gray-500">
                                Room {patient.room_number}
                                {patient.mrn ? ` • MRN: ${patient.mrn}` : ""}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xs text-gray-400">
                                {patient.diagnosis?.slice(0, 15) ||
                                  "No diagnosis"}
                                {patient.diagnosis &&
                                patient.diagnosis.length > 15
                                  ? "..."
                                  : ""}
                              </p>
                            </div>
                            {/* Edit button */}
                            <button
                              onClick={() => {
                                setEditingPatient(patient);
                                setEditForm({
                                  first_name: patient.first_name,
                                  last_name: patient.last_name,
                                  room_number: patient.room_number,
                                  mrn: patient.mrn || "",
                                  diagnosis: patient.diagnosis || "",
                                });
                              }}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                              title="Edit patient"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Edit Patient Inline Form */}
                    {editingPatient && (
                      <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="font-semibold text-blue-900">
                            Edit Patient
                          </h4>
                          <button
                            onClick={() => setEditingPatient(null)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <input
                            type="text"
                            placeholder="First Name"
                            value={editForm.first_name || ""}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                first_name: e.target.value,
                              }))
                            }
                            className="px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            placeholder="Last Name"
                            value={editForm.last_name || ""}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                last_name: e.target.value,
                              }))
                            }
                            className="px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            placeholder="Room Number"
                            value={editForm.room_number || ""}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                room_number: e.target.value,
                              }))
                            }
                            className="px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            placeholder="MRN (optional)"
                            value={editForm.mrn || ""}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                mrn: e.target.value,
                              }))
                            }
                            className="px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                          <input
                            type="text"
                            placeholder="Diagnosis"
                            value={editForm.diagnosis || ""}
                            onChange={(e) =>
                              setEditForm((f) => ({
                                ...f,
                                diagnosis: e.target.value,
                              }))
                            }
                            className="col-span-2 px-3 py-2 text-sm border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div className="flex justify-end gap-2 mt-3">
                          <button
                            onClick={() => setEditingPatient(null)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={async () => {
                              setSavingPatient(true);
                              try {
                                const updated = await updatePatientAPI(
                                  editingPatient.id,
                                  editForm,
                                );
                                setPatients((prev) =>
                                  prev.map((p) =>
                                    p.id === updated.id ? updated : p,
                                  ),
                                );
                                setEditingPatient(null);
                              } catch (err) {
                                alert("Failed to update patient");
                              } finally {
                                setSavingPatient(false);
                              }
                            }}
                            disabled={savingPatient}
                            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingPatient ? "Saving..." : "Save"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Hand-offs Modal Content */}
                {activeModal === "handovers" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm text-gray-500">
                        {handovers.length} hand-off(s){" "}
                        {showYesterday ? "yesterday" : "today"}
                      </p>
                      <Link
                        href="/handover"
                        className="text-sm text-green-600 hover:text-green-700 font-medium"
                      >
                        Go to Hand-off →
                      </Link>
                    </div>
                    {handovers.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">
                        No hand-offs created today
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {handovers.map((handover) => {
                          // Use patient from handover object first, fallback to lookup
                          const patient =
                            handover.patient ||
                            patients.find((p) => p.id === handover.patient_id);
                          const statusColors: Record<string, string> = {
                            stable: "bg-blue-100 text-blue-700",
                            improved: "bg-green-100 text-green-700",
                            unchanged: "bg-gray-100 text-gray-700",
                            worsening: "bg-orange-100 text-orange-700",
                            critical: "bg-red-100 text-red-700",
                          };
                          const lastUpdated = handover.updated_at
                            ? new Date(handover.updated_at).toLocaleString(
                                "en-US",
                                {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )
                            : null;
                          return (
                            <div
                              key={handover.id}
                              className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
                            >
                              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <span className="text-blue-600 font-semibold text-sm">
                                  {patient?.room_number?.slice(-2) || "?"}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">
                                  {patient
                                    ? `${patient.last_name}, ${patient.first_name}`
                                    : "Unknown Patient"}
                                  {patient?.room_number && (
                                    <span className="ml-2 text-sm font-normal text-gray-400">
                                      · Rm {patient.room_number}
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                  {lastUpdated
                                    ? `Last report ${lastUpdated}`
                                    : ""}
                                </p>
                              </div>
                              <span
                                className={`px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0 ${statusColors[handover.status] || statusColors.stable}`}
                              >
                                {handover.status}
                              </span>
                              {handover.is_completed && (
                                <span className="text-green-500 flex-shrink-0">
                                  ✓
                                </span>
                              )}
                              {/* Actions */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Link
                                  href={`/handover?patient=${handover.patient_id}&shift=${handover.shift_type || "day"}&edit=true`}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Open report"
                                  onClick={() => setActiveModal(null)}
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                    />
                                  </svg>
                                </Link>
                                {/* Duplicate report */}
                                <button
                                  onClick={async () => {
                                    // Create a report for the next day (today if viewing yesterday, tomorrow if viewing today)
                                    const targetDate = new Date();
                                    if (!showYesterday) {
                                      // If viewing today, duplicate to tomorrow
                                      targetDate.setDate(
                                        targetDate.getDate() + 1,
                                      );
                                    }
                                    targetDate.setHours(0, 0, 0, 0);

                                    // Check if a handover already exists for the target date
                                    const targetExists = handovers.some((h) => {
                                      const hDate = new Date(h.shift_date);
                                      hDate.setHours(0, 0, 0, 0);
                                      return (
                                        h.patient_id === handover.patient_id &&
                                        hDate.getTime() === targetDate.getTime()
                                      );
                                    });

                                    if (targetExists) {
                                      alert(
                                        `A handover report already exists for ${showYesterday ? "today" : "tomorrow"}.`,
                                      );
                                      return;
                                    }

                                    try {
                                      const newHandover =
                                        await createHandoverAPI({
                                          patient_id: handover.patient_id,
                                          shift_date: targetDate.toISOString(),
                                          shift_type:
                                            handover.shift_type || "day",
                                          outgoing_nurse:
                                            handover.outgoing_nurse || "",
                                          status: handover.status,
                                          acuity: handover.acuity,
                                          isolation: handover.isolation,
                                          code_status: handover.code_status,
                                          pertinent_issues:
                                            handover.pertinent_issues,
                                          admit_date: handover.admit_date,
                                          anticipated_discharge:
                                            handover.anticipated_discharge,
                                          allergies: handover.allergies,
                                          medications_summary:
                                            handover.medications_summary,
                                          prn_medications:
                                            handover.prn_medications,
                                          chemotherapies:
                                            handover.chemotherapies,
                                          iv_access: handover.iv_access,
                                          cvad_type: handover.cvad_type,
                                          cvad_dressing: handover.cvad_dressing,
                                          tpn: handover.tpn,
                                          tube_type: handover.tube_type,
                                          diet: handover.diet,
                                          activity: handover.activity,
                                          oxygen_needs: handover.oxygen_needs,
                                          braden_q_score:
                                            handover.braden_q_score,
                                          skin_care_plan:
                                            handover.skin_care_plan,
                                          mobility_restrictions:
                                            handover.mobility_restrictions,
                                          assistive_devices:
                                            handover.assistive_devices,
                                          positioning: handover.positioning,
                                          expected_discharge_date:
                                            handover.expected_discharge_date,
                                          discharge_teaching:
                                            handover.discharge_teaching,
                                          discharge_prescriptions:
                                            handover.discharge_prescriptions,
                                          home_enteral_feeding:
                                            handover.home_enteral_feeding,
                                          followup_appointments:
                                            handover.followup_appointments,
                                          events_this_shift: "", // Clear daily notes for new day
                                        });
                                      setHandovers((prev) => [
                                        ...prev,
                                        newHandover,
                                      ]);
                                      setStats((prev) => ({
                                        ...prev,
                                        handoversYesterday:
                                          prev.handoversYesterday + 1,
                                      }));
                                      setActiveModal(null);
                                      // Navigate to the new handover
                                      window.location.href = `/handover?patient=${handover.patient_id}&shift=${handover.shift_type || "day"}&edit=true`;
                                    } catch {
                                      alert("Failed to create new handover");
                                    }
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                  title={`Duplicate to ${showYesterday ? "today" : "tomorrow"} (copies medical info, clears daily notes)`}
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!confirm("Delete this report?")) return;
                                    setDeletingHandoverId(handover.id);
                                    try {
                                      await deleteHandoverAPI(handover.id);
                                      setHandovers((prev) =>
                                        prev.filter(
                                          (h) => h.id !== handover.id,
                                        ),
                                      );
                                      setStats((prev) => ({
                                        ...prev,
                                        handoversYesterday:
                                          prev.handoversYesterday - 1,
                                      }));
                                    } catch (e) {
                                      alert("Failed to delete report");
                                    } finally {
                                      setDeletingHandoverId(null);
                                    }
                                  }}
                                  disabled={deletingHandoverId === handover.id}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                                  title="Delete report"
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Schedules Modal Content */}
                {activeModal === "schedules" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <p className="text-sm text-gray-500">
                          {schedules.length} schedule(s)
                        </p>
                        {selectedSchedules.size > 0 && (
                          <button
                            onClick={async () => {
                              if (
                                !confirm(
                                  `Delete ${selectedSchedules.size} selected schedule(s)? This cannot be undone.`,
                                )
                              )
                                return;
                              setIsDeletingBulk(true);
                              try {
                                await Promise.all(
                                  Array.from(selectedSchedules).map((id) =>
                                    deleteScheduleAPI(id),
                                  ),
                                );
                                setSchedules((prev) =>
                                  prev.filter(
                                    (s) => !selectedSchedules.has(s.id),
                                  ),
                                );
                                setStats((prev) => ({
                                  ...prev,
                                  schedulesCreated:
                                    prev.schedulesCreated -
                                    selectedSchedules.size,
                                }));
                                setSelectedSchedules(new Set());
                              } catch {
                                alert("Failed to delete some schedules");
                              } finally {
                                setIsDeletingBulk(false);
                              }
                            }}
                            disabled={isDeletingBulk}
                            className="px-3 py-1 text-sm text-white bg-red-600 hover:bg-red-700 rounded transition-colors disabled:opacity-50"
                          >
                            Delete {selectedSchedules.size} selected
                          </button>
                        )}
                      </div>
                      <Link
                        href="/scheduler"
                        className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                      >
                        Create New →
                      </Link>
                    </div>
                    {schedules.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-gray-500 mb-4">
                          No schedules created yet
                        </p>
                        <Link
                          href="/scheduler"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 4v16m8-8H4"
                            />
                          </svg>
                          Create New Schedule
                        </Link>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {schedules.map((schedule) => {
                          const createdDate = schedule.created_at
                            ? new Date(schedule.created_at).toLocaleString(
                                undefined,
                                {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )
                            : "Unknown date";
                          const isSelected = selectedSchedules.has(schedule.id);
                          return (
                            <div
                              key={schedule.id}
                              className={`flex items-center gap-3 p-3 rounded-lg transition-colors group ${
                                isSelected
                                  ? "bg-purple-50 border border-purple-200"
                                  : "bg-gray-50 hover:bg-gray-100"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const newSelected = new Set(
                                    selectedSchedules,
                                  );
                                  if (e.target.checked) {
                                    newSelected.add(schedule.id);
                                  } else {
                                    newSelected.delete(schedule.id);
                                  }
                                  setSelectedSchedules(newSelected);
                                }}
                                className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500 flex-shrink-0"
                              />
                              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                <svg
                                  className="w-5 h-5 text-purple-600"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                                  />
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 truncate">
                                  Schedule {schedule.id.slice(0, 8)}
                                </p>
                                <p className="text-xs text-gray-500">
                                  Created {createdDate}
                                </p>
                              </div>
                              {schedule.finalized ? (
                                <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-100 rounded-full flex-shrink-0">
                                  Finalized
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 text-xs font-medium text-yellow-700 bg-yellow-100 rounded-full flex-shrink-0">
                                  In Progress
                                </span>
                              )}
                              {/* Actions */}
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Link
                                  href={`/scheduler?schedule_id=${schedule.id}`}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="View/Edit schedule"
                                  onClick={() => setActiveModal(null)}
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                    />
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                    />
                                  </svg>
                                </Link>
                                <button
                                  onClick={async () => {
                                    if (
                                      !confirm(
                                        "Are you sure you want to delete this schedule? This action cannot be undone.",
                                      )
                                    )
                                      return;
                                    setDeletingScheduleId(schedule.id);
                                    try {
                                      await deleteScheduleAPI(schedule.id);
                                      setSchedules((prev) =>
                                        prev.filter(
                                          (s) => s.id !== schedule.id,
                                        ),
                                      );
                                      setStats((prev) => ({
                                        ...prev,
                                        schedulesCreated:
                                          prev.schedulesCreated - 1,
                                      }));
                                    } catch (e) {
                                      alert("Failed to delete schedule");
                                    } finally {
                                      setDeletingScheduleId(null);
                                    }
                                  }}
                                  disabled={deletingScheduleId === schedule.id}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                                  title="Delete schedule"
                                >
                                  <svg
                                    className="w-3.5 h-3.5"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
