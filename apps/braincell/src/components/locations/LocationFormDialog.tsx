import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { PLAN_CATALOG } from '../../api/billing';
import { useAuthContext } from '../../context/AuthContext';
import { getCategories } from '../../api/categories';
import { importMenuFromLocation, type Location as LocationItem } from '../../api/locations';
import {
  ArrowPathIcon,
  CheckIcon,
  DocumentArrowUpIcon,
  FolderPlusIcon,
  ListBulletIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

export type LocationFormValues = {
  name: string;
  address: string;
  zip: string;
  country: string;
};

// Reusable components matching MenuItemModal styles
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] placeholder-[#a9a9ab] transition-colors hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0 ${className || ''}`}
      />
    );
  }
);
Input.displayName = 'Input';

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <label className={`block text-sm font-medium text-[#2e2e30] mb-1 ${className}`}>{children}</label>;
}

export default function LocationFormDialog({
  open,
  title,
  initialValues,
  existingNames = [],
  onClose,
  onSubmit,
  isSubmitting = false,
  tenant,
  isAddingExtraLocation = false,
  locations = [],
}: {
  open: boolean;
  title: string;
  initialValues: LocationFormValues;
  existingNames?: string[];
  onClose: () => void;
  onSubmit: (values: LocationFormValues) => any;
  isSubmitting?: boolean;
  tenant?: any;
  isAddingExtraLocation?: boolean;
  locations?: LocationItem[];
}) {
  const navigate = useNavigate();
  const { token } = useAuthContext();

  // Step wizard state
  const [step, setStep] = useState<1 | 2>(1);
  const [step1Values, setStep1Values] = useState<LocationFormValues | null>(null);

  // Setup Menu Data state
  const [importOption, setImportOption] = useState<'clone' | 'scratch'>('clone');
  const [scratchMode, setScratchMode] = useState<'pdf' | 'photo' | 'manual'>('pdf');
  const [sourceLocationId, setSourceLocationId] = useState<string>('');
  const [importScope, setImportScope] = useState<'all' | 'selective'>('all');

  // Selective categories state
  const [categories, setCategories] = useState<any[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [selectedCatIds, setSelectedCatIds] = useState<Set<string>>(new Set());

  // Upload/import status state
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  
  // Simulated file upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting: rhfSubmitting },
  } = useForm<LocationFormValues>({
    defaultValues: initialValues,
    mode: 'onChange',
  });

  // Reset states when the dialog closes/opens
  useEffect(() => {
    if (open) {
      reset(initialValues);
      setStep(1);
      setStep1Values(null);
      setImportOption('clone');
      setScratchMode('pdf');
      setSourceLocationId('');
      setImportScope('all');
      setCategories([]);
      setSelectedCatIds(new Set());
      setUploadedFile(null);
      setImportError(null);
      setUploadProgress(0);
      setIsUploading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch categories when source location changes
  useEffect(() => {
    if (sourceLocationId && token) {
      setLoadingCategories(true);
      getCategories(token, { locationId: sourceLocationId })
        .then((cats) => {
          setCategories(cats);
          setSelectedCatIds(new Set(cats.map((c) => c.id))); // default to select all
        })
        .catch((err) => {
          console.error('Failed to load categories:', err);
        })
        .finally(() => {
          setLoadingCategories(false);
        });
    } else {
      setCategories([]);
      setSelectedCatIds(new Set());
    }
  }, [sourceLocationId, token]);

  const validateName = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 'Location name is required.';
    if (existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      return 'A location with this name already exists.';
    }
    return true;
  };

  const handleNextStep = (v: LocationFormValues) => {
    const isEditMode = !title.toLowerCase().includes('add') && !title.toLowerCase().includes('create');
    
    if (isEditMode) {
      // If editing, skip step 2 and submit immediately
      onSubmit({
        name: v.name.trim(),
        address: v.address?.trim() || '',
        zip: v.zip?.trim() || '',
        country: v.country?.trim() || '',
      });
      return;
    }

    setStep1Values({
      name: v.name.trim(),
      address: v.address?.trim() || '',
      zip: v.zip?.trim() || '',
      country: v.country?.trim() || '',
    });
    
    // Check if there are other locations to clone from
    const others = (locations || []).filter(
      (l) => l.name.toLowerCase() !== v.name.trim().toLowerCase()
    );
    if (others.length > 0) {
      setImportOption('clone');
      setSourceLocationId(others[0].id);
    } else {
      setImportOption('scratch');
      setSourceLocationId('');
      setScratchMode('pdf');
    }
    
    setStep(2);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    setIsUploading(true);
    setUploadProgress(0);
    
    // Simulate upload progress
    const timer = window.setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          setIsUploading(false);
          return 100;
        }
        return prev + 25;
      });
    }, 150);
  };

  const handleImportSubmit = async () => {
    if (!step1Values) return;
    setIsImporting(true);
    setImportError(null);

    try {
      // 1. Create the location first!
      const created = await onSubmit(step1Values);
      if (!created || !created.id) {
        throw new Error('Could not create location. Please check your billing details.');
      }

      // 2. Perform import if selected
      if (importOption === 'clone') {
        if (!sourceLocationId) {
          throw new Error('Please select a source location.');
        }
        const catIds = importScope === 'selective' ? Array.from(selectedCatIds) : undefined;
        await importMenuFromLocation(created.id, sourceLocationId, catIds);
      } else if (importOption === 'scratch') {
        if (scratchMode === 'pdf' || scratchMode === 'photo') {
          if (!uploadedFile) {
            throw new Error(`Please upload a menu ${scratchMode === 'pdf' ? 'PDF' : 'Photo'}.`);
          }
          // Real AI import for the new branch: upload → review → import
          onClose();
          navigate('/menu-import', { state: { files: [uploadedFile], locationId: created.id } });
          return;
        }
      }
      
      // Setup successful, close the wizard
      onClose();
    } catch (err: any) {
      setImportError(err?.message || 'Failed to complete menu setup.');
    } finally {
      setIsImporting(false);
    }
  };

  const planId = tenant?.planInfo?.planId || 'p1_m';
  const basePlanId = planId.split('_')[0].toLowerCase();
  const catalogEntry = PLAN_CATALOG[basePlanId] || PLAN_CATALOG.p1;
  const planName = catalogEntry.name;
  const planPrice = `$${(catalogEntry.monthlyCents / 100).toFixed(2)}`;
  const hasCard = !!tenant?.hasCardOnFile;

  const disabledForm = isAddingExtraLocation && !hasCard;
  const isProcessing = isSubmitting || rhfSubmitting;
  const inputsDisabled = isProcessing || disabledForm;

  const otherLocations = (locations || []).filter(
    (l) => l.name.toLowerCase() !== step1Values?.name.toLowerCase()
  );

  const scratchOptions = [
    {
      id: 'pdf',
      title: 'Upload Menu PDF',
      description: 'PDF format (up to 50MB)',
      icon: DocumentArrowUpIcon,
    },
    {
      id: 'photo',
      title: 'Upload Menu Photo',
      description: 'Photo of your menu (add more pages next)',
      icon: PhotoIcon,
    },
    {
      id: 'manual',
      title: 'Upload Manually',
      description: 'Start fresh & add items manually',
      icon: ListBulletIcon,
    }
  ];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Modal Container */}
          <motion.aside
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`relative z-10 w-full ${step === 1 ? 'max-w-md' : 'max-w-lg'} bg-[#f5f5f5] border border-[#dbdbdb] rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[85vh] md:max-h-[90vh] transition-all duration-200`}
            role="dialog"
            aria-modal="true"
          >
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <form
                  key="step-1"
                  onSubmit={handleSubmit(handleNextStep)}
                  className="flex flex-col flex-1 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#dbdbdb] sticky top-0 bg-[#fcfcfc]">
                    <div>
                      <h3 className="text-lg font-semibold text-[#2e2e30]">{title}</h3>
                      <p className="text-xs text-[#6b6b70] mt-0.5">Add the location details below.</p>
                    </div>
                    <button
                      className="text-[#6b7280] hover:text-[#374151]"
                      onClick={onClose}
                      aria-label="Close"
                      disabled={isProcessing}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-y-auto p-5 bg-[#fcfcfc] space-y-4">
                    {isAddingExtraLocation && (
                      <div>
                        {hasCard ? (
                          <div className="rounded-lg border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-[12px] text-slate-700 leading-normal shadow-sm">
                            ℹ️ Adding this location will update your subscription at your <strong>{planName}</strong> plan rate (<strong>{planPrice}/mo</strong>). A prorated charge will be applied to your card ending in <strong>•••• {tenant?.payment?.last4 || 'xxxx'}</strong>.
                          </div>
                        ) : (
                          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 leading-normal shadow-sm">
                            ⚠️ You must add a billing payment method to create locations.
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <Label>Location name</Label>
                        <Input
                          disabled={inputsDisabled}
                          {...register('name', { validate: validateName })}
                          placeholder="e.g., Headquarters"
                          autoFocus
                          className={errors.name?.message ? 'border-red-500' : ''}
                        />
                        {errors.name?.message ? (
                          <div className="text-xs text-red-600 mt-1">{errors.name.message}</div>
                        ) : null}
                      </div>

                      <div>
                        <Label>Address</Label>
                        <Input
                          disabled={inputsDisabled}
                          {...register('address')}
                          placeholder="e.g., Street, city, state"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>Zip/Postal</Label>
                          <Input
                            disabled={inputsDisabled}
                            {...register('zip')}
                            placeholder="e.g., 94105"
                          />
                        </div>
                        <div>
                          <Label>Country</Label>
                          <Input
                            disabled={inputsDisabled}
                            {...register('country')}
                            placeholder="e.g., United States"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-4 border-t border-[#dbdbdb] sticky bottom-0 bg-[#fcfcfc] flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={isProcessing}
                      className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    {disabledForm ? (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          navigate('/settings/billing');
                        }}
                        className="px-4 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 font-medium"
                      >
                        Go to Billing Settings
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={isProcessing}
                        className="px-4 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 disabled:opacity-50 font-medium"
                      >
                        {isProcessing ? (
                          'Saving…'
                        ) : !title.toLowerCase().includes('add') && !title.toLowerCase().includes('create') ? (
                          'Save Changes'
                        ) : (
                          'Next Step'
                        )}
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <div
                  key="step-2"
                  className="flex flex-col flex-1 overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4 border-b border-[#dbdbdb] sticky top-0 bg-[#fcfcfc]">
                    <div>
                      <h3 className="text-lg font-semibold text-[#2e2e30]">Setup Menu Data</h3>
                      <p className="text-xs text-[#6b6b70] mt-0.5">
                        Choose how to populate the menu for <strong>{step1Values?.name}</strong>.
                      </p>
                    </div>
                    <button
                      className="text-[#6b7280] hover:text-[#374151]"
                      onClick={onClose}
                      aria-label="Close"
                      disabled={isImporting}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Body */}
                  <div className="flex-1 overflow-y-auto p-5 bg-[#fcfcfc] space-y-4">
                    {/* Top Level Options (Clone vs Scratch) - Only visible if other locations exist */}
                    {otherLocations.length > 0 && (
                      <div className="space-y-3">
                        <div
                          onClick={() => {
                            setImportOption('clone');
                            setUploadedFile(null);
                          }}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all duration-200 shadow-sm hover:shadow-md hover:border-slate-350 ${
                            importOption === 'clone'
                              ? 'border-slate-400 bg-slate-50/50 shadow-md'
                              : 'border-[#dbdbdb] bg-white'
                          }`}
                        >
                          <div className={`mt-0.5 rounded-lg p-2 transition-colors border ${
                            importOption === 'clone' ? 'bg-[#2e2e30] text-white border-[#2e2e30]' : 'bg-slate-50 text-[#5b5b5d] border-slate-100'
                          }`}>
                            <FolderPlusIcon className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <span className="font-semibold text-sm text-[#2e2e30]">Clone from Existing Location</span>
                            <p className="text-xs text-[#6b6b70] mt-0.5 leading-normal">
                              Copy category visibility, item availability, and settings from another branch.
                            </p>
                          </div>
                        </div>

                        <div
                          onClick={() => {
                            setImportOption('scratch');
                            setUploadedFile(null);
                          }}
                          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-all duration-200 shadow-sm hover:shadow-md hover:border-slate-350 ${
                            importOption === 'scratch'
                              ? 'border-slate-400 bg-slate-50/50 shadow-md'
                              : 'border-[#dbdbdb] bg-white'
                          }`}
                        >
                          <div className={`mt-0.5 rounded-lg p-2 transition-colors border ${
                            importOption === 'scratch' ? 'bg-[#2e2e30] text-white border-[#2e2e30]' : 'bg-slate-50 text-[#5b5b5d] border-slate-100'
                          }`}>
                            <ListBulletIcon className="h-5 w-5" />
                          </div>
                          <div className="flex-1">
                            <span className="font-semibold text-sm text-[#2e2e30]">Start from Scratch</span>
                            <p className="text-xs text-[#6b6b70] mt-0.5 leading-normal">
                              Setup a new menu configuration for this location.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Options details area */}
                    {importOption === 'clone' && otherLocations.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="rounded-xl border border-[#dbdbdb] bg-[#fcfcfc] p-4 space-y-3 shadow-sm"
                      >
                        <div>
                          <Label className="text-xs font-semibold text-[#5b5b5d] mb-1">
                            Source Location
                          </Label>
                          <select
                            value={sourceLocationId}
                            onChange={(e) => setSourceLocationId(e.target.value)}
                            className="w-full rounded-md border border-[#dbdbdb] bg-[#fcfcfc] px-3 py-2 text-sm text-[#2e2e30] hover:border-[#111827] focus:border-[#111827] focus:outline-none focus:ring-0 transition-colors"
                          >
                            <option value="">Select a location to copy from...</option>
                            {otherLocations.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {sourceLocationId && (
                          <div className="space-y-3 pt-1">
                            <div className="flex items-center gap-4">
                              <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer font-semibold">
                                <input
                                  type="radio"
                                  name="importScope"
                                  checked={importScope === 'all'}
                                  onChange={() => setImportScope('all')}
                                  className="text-[#2e2e30] focus:ring-0 border-[#dbdbdb] bg-[#fcfcfc]"
                                />
                                Clone All Categories & Items
                              </label>
                              <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer font-semibold">
                                <input
                                  type="radio"
                                  name="importScope"
                                  checked={importScope === 'selective'}
                                  onChange={() => setImportScope('selective')}
                                  className="text-[#2e2e30] focus:ring-0 border-[#dbdbdb] bg-[#fcfcfc]"
                                />
                                Select Specific Categories
                              </label>
                            </div>

                            {importScope === 'selective' && (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-[11px] text-[#5b5b5d] font-semibold px-1">
                                  <span>SELECT CATEGORIES</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (selectedCatIds.size === categories.length) {
                                        setSelectedCatIds(new Set());
                                      } else {
                                        setSelectedCatIds(new Set(categories.map((c) => c.id)));
                                      }
                                    }}
                                    className="text-[#2e2e30] hover:underline font-semibold"
                                  >
                                    {selectedCatIds.size === categories.length ? 'Deselect All' : 'Select All'}
                                  </button>
                                </div>
                                <div className="border border-[#dbdbdb] rounded-md bg-[#fcfcfc] max-h-36 overflow-y-auto p-2 space-y-1.5 shadow-inner">
                                  {loadingCategories ? (
                                    <div className="flex items-center justify-center py-4 text-slate-400 text-xs gap-1.5">
                                      <ArrowPathIcon className="h-4 w-4 animate-spin text-[#2e2e30]" />
                                      Loading categories...
                                    </div>
                                  ) : categories.length === 0 ? (
                                    <div className="text-slate-400 text-xs py-4 text-center">
                                      No categories found in this location.
                                    </div>
                                  ) : (
                                    categories.map((cat) => {
                                      const isChecked = selectedCatIds.has(cat.id);
                                      return (
                                        <label
                                          key={cat.id}
                                          className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => {
                                              const next = new Set(selectedCatIds);
                                              if (next.has(cat.id)) {
                                                next.delete(cat.id);
                                              } else {
                                                next.add(cat.id);
                                              }
                                              setSelectedCatIds(next);
                                            }}
                                            className="rounded border-[#dbdbdb] text-[#2e2e30] focus:ring-0 bg-[#fcfcfc]"
                                          />
                                          {cat.name}
                                        </label>
                                      );
                                    })
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* Scratch / Manual Mode Options */}
                    {(importOption === 'scratch' || otherLocations.length === 0) && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="space-y-4"
                      >
                        <div className="text-[11px] font-semibold text-[#5b5b5d] uppercase tracking-wider mb-1">
                          Choose Setup Option:
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {scratchOptions.map((opt) => {
                            const Icon = opt.icon;
                            const isSelected = scratchMode === opt.id;
                            return (
                              <div
                                key={opt.id}
                                onClick={() => {
                                  setScratchMode(opt.id as any);
                                  setUploadedFile(null);
                                }}
                                className={`flex flex-col items-center justify-center cursor-pointer rounded-xl border p-4 text-center transition-all duration-200 shadow-sm hover:shadow-md hover:border-slate-350 ${
                                  isSelected
                                    ? 'border-slate-400 bg-slate-50/50 shadow-md'
                                    : 'border-[#dbdbdb] bg-white'
                                }`}
                              >
                                <div className={`rounded-lg p-2 mb-2 transition-colors border ${
                                  isSelected ? 'bg-[#2e2e30] text-white border-[#2e2e30]' : 'bg-slate-50 text-[#5b5b5d] border-slate-100'
                                }`}>
                                  <Icon className="h-4 w-4" />
                                </div>
                                <span className="font-semibold text-xs text-[#2e2e30] leading-none">{opt.title}</span>
                                <p className="text-[10px] text-[#6b6b70] mt-1.5 leading-normal max-w-[130px]">{opt.description}</p>
                              </div>
                            );
                          })}
                        </div>

                        {/* File Upload Zone for PDF / Photo */}
                        {(scratchMode === 'pdf' || scratchMode === 'photo') && (
                          <motion.div
                            key={scratchMode}
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="rounded-xl border border-dashed border-[#dbdbdb] hover:border-slate-350 bg-[#fcfcfc] p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md"
                            onClick={() => {
                              const inputId = scratchMode === 'pdf' ? 'menu-pdf-upload' : 'menu-photo-upload';
                              const input = document.getElementById(inputId) as HTMLInputElement;
                              if (input) input.click();
                            }}
                          >
                            <input
                              id="menu-pdf-upload"
                              type="file"
                              accept="application/pdf"
                              className="hidden"
                              onChange={handleFileSelect}
                            />
                            <input
                              id="menu-photo-upload"
                              type="file"
                              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                              className="hidden"
                              onChange={handleFileSelect}
                            />
                            
                            {isUploading ? (
                              <div className="space-y-2 w-full max-w-xs">
                                <ArrowPathIcon className="h-8 w-8 animate-spin text-[#2e2e30] mx-auto" />
                                <span className="text-xs font-semibold text-[#2e2e30] block">
                                  Uploading {scratchMode === 'pdf' ? 'PDF' : 'Photo'}...
                                </span>
                                <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className="bg-[#2e2e30] h-1.5 transition-all duration-150"
                                    style={{ width: `${uploadProgress}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-[#6b6b70] block">{uploadProgress}% complete</span>
                              </div>
                            ) : uploadedFile ? (
                              <div className="space-y-2">
                                <CheckIcon className="h-8 w-8 text-green-600 mx-auto bg-green-50 p-1.5 rounded-full border border-green-200" />
                                <span className="text-xs font-semibold text-green-700 block text-center truncate max-w-xs mx-auto">
                                  {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setUploadedFile(null);
                                  }}
                                  className="text-xs text-rose-600 hover:underline font-semibold"
                                >
                                  Remove file
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {scratchMode === 'pdf' ? (
                                  <DocumentArrowUpIcon className="h-10 w-10 text-slate-400 mx-auto mb-1" />
                                ) : (
                                  <PhotoIcon className="h-10 w-10 text-slate-400 mx-auto mb-1" />
                                )}
                                <p className="text-xs font-semibold text-[#2e2e30]">
                                  Click to upload or drag & drop {scratchMode === 'pdf' ? 'PDF' : 'Photo'}
                                </p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Accepts {scratchMode === 'pdf' ? 'PDF (up to 10MB)' : 'Images (up to 10MB)'}
                                </p>
                              </div>
                            )}
                          </motion.div>
                        )}

                        {scratchMode === 'manual' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="rounded-xl border border-[#dbdbdb] bg-[#fcfcfc] p-4 text-center shadow-sm"
                          >
                            <p className="text-xs text-[#2e2e30] font-medium leading-normal">Starting fresh is perfect if this branch has its own unique menu.</p>
                            <p className="text-[11px] text-[#6b6b70] mt-1.5 leading-normal">You will be able to add categories and menu items one by one manually.</p>
                          </motion.div>
                        )}
                      </motion.div>
                    )}

                    {importError && (
                      <div className="text-xs text-rose-600 font-semibold bg-rose-50 border border-rose-200 rounded p-2">
                        ⚠️ {importError}
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-4 border-t border-[#dbdbdb] sticky bottom-0 bg-[#fcfcfc] flex items-center justify-between">
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={handleImportSubmit}
                      className="text-xs font-semibold text-[#6b7280] hover:text-[#374151] transition-colors disabled:opacity-50 hover:underline"
                    >
                      Skip Setup & Start Fresh
                    </button>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isImporting}
                        onClick={() => {
                          setStep(1);
                        }}
                        className="px-4 py-2 rounded-md border border-[#dbdbdb] transition-colors text-sm text-[#2e2e30] bg-[#fcfcfc] hover:bg-[#f3f4f6] hover:border-[#111827] disabled:opacity-50"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        disabled={
                          isImporting ||
                          (importOption === 'clone' && !sourceLocationId) ||
                          (importOption === 'scratch' && (scratchMode === 'pdf' || scratchMode === 'photo') && !uploadedFile)
                        }
                        onClick={handleImportSubmit}
                        className="px-4 py-2 rounded-md text-sm text-white transition-opacity bg-[#2e2e30] hover:opacity-90 disabled:opacity-50 font-medium"
                      >
                        {isImporting ? (
                          <>
                            <ArrowPathIcon className="h-4 w-4 animate-spin" />
                            Importing...
                          </>
                        ) : importOption === 'clone' ? (
                          'Clone Menu'
                        ) : scratchMode === 'pdf' ? (
                          'Import PDF'
                        ) : scratchMode === 'photo' ? (
                          'Import Photo'
                        ) : (
                          'Start Fresh'
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </AnimatePresence>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}