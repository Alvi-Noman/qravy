import { useState } from 'react';

export default function SettingsPrivacy(): JSX.Element {
  const [exportInProgress, setExportInProgress] = useState(false);
  const [exportRef, setExportRef] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteRequested, setDeleteRequested] = useState(false);

  const orgLegal = 'Demo Restaurant LLC';

  const requestExport = async () => {
    setExportInProgress(true);
    await new Promise((r) => setTimeout(r, 1500));
    setExportInProgress(false);
    setExportRef('export_2025-01-01_1042');
  };

  const requestDeletion = () => {
    if (deleteConfirmText !== orgLegal) return;
    setDeleteRequested(true);
  };

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold text-slate-900">Export data</div>
            <div className="text-[12px] text-slate-600">Download orders, menu items, categories, and settings.</div>
          </div>
          <button
            onClick={requestExport}
            disabled={exportInProgress}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {exportInProgress ? 'Preparing…' : 'Request export'}
          </button>
        </div>
        {exportRef && (
          <div className="mt-2">
            <a href="#" className="rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-[12px] text-slate-700 hover:bg-slate-50">
              Download {exportRef}.zip
            </a>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#ececec] bg-white p-4 shadow-sm">
        <div className="text-[14px] font-semibold text-slate-900">Delete account</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label className="text-[12px] font-medium text-slate-700">Type your legal name to confirm</label>
            <input
              className="rounded-md border border-[#e2e2e2] px-2 py-2 text-sm"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={orgLegal}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={requestDeletion}
              disabled={deleteConfirmText !== orgLegal}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              Delete account
            </button>
          </div>
        </div>
        {deleteRequested && <div className="mt-2 rounded-md bg-amber-50 p-2 text-[12px] text-amber-800">Deletion requested. Contact support to cancel.</div>}
      </div>
    </div>
  );
}