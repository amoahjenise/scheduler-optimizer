"use client";

import React from "react";

interface ClearCacheButtonProps {
  onClick: () => void;
}

export default function ClearCacheButton({ onClick }: ClearCacheButtonProps) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-200 border border-transparent hover:border-red-200"
        title="Clear all cached data and start fresh"
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
            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
          />
        </svg>
      </button>
      <div className="absolute right-0 mt-2 w-48 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-200 z-50">
        <div className="bg-gray-900 text-white text-xs rounded py-1 px-2 text-center">
          Clear Cache & Start Fresh
        </div>
      </div>
    </div>
  );
}
