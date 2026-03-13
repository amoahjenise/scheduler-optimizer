"use client";

import React from "react";

interface Step {
  key: string;
  label: string;
  sublabel?: string; // Made optional
}

interface ProgressStepsProps {
  steps: Step[];
  currentStepIndex: number;
}

export default function ProgressSteps({
  steps,
  currentStepIndex,
}: ProgressStepsProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, idx) => (
        <div key={step.key} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              idx < currentStepIndex
                ? "bg-green-500 text-white"
                : idx === currentStepIndex
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-500"
            }`}
          >
            {idx < currentStepIndex ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              idx + 1
            )}
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`w-8 h-0.5 mx-1 ${
                idx < currentStepIndex ? "bg-green-500" : "bg-gray-200"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
