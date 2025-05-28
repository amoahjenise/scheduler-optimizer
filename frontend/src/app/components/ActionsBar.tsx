export default function ActionsBar({ onOptimize, onExport }: { onOptimize: () => void; onExport: () => void }) {
    return (
      <div className="flex flex-wrap gap-4 mt-4">
        <button
          onClick={onOptimize}
          className="px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white rounded-md font-medium transition"
        >
          Optimize Schedule
        </button>
        <button
          onClick={onExport}
          className="px-6 py-3 border border-sky-600 text-sky-700 hover:bg-sky-100 rounded-md font-medium transition"
        >
          Export Comments
        </button>
      </div>
    );
  }
  