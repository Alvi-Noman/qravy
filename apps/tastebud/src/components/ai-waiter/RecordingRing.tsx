import React from "react";

type Props = {
  isRecording: boolean;
  size?: number;
  className?: string;
};

export default function RecordingRing({ isRecording, size = 120, className = "" }: Props) {
  const ringSize = size + 20;

  return (
    <div
      className={`relative flex items-center justify-center ${className}`}
      style={{ width: ringSize, height: ringSize }}
    >
      {/* Rotating ring background */}
      <div
        className={`absolute inset-0 rounded-full transition-opacity duration-300 ${
          isRecording ? "opacity-100" : "opacity-0"
        }`}
        style={{
          background: "conic-gradient(from 0deg, #4F46E5 0%, #8B5CF6 50%, #4F46E5 100%)",
          animation: isRecording ? "spin 2s linear infinite" : "none",
        }}
      />

      {/* Inner white circle */}
      <div
        className="absolute rounded-full bg-white"
        style={{
          width: size,
          height: size,
          inset: 10,
        }}
      />

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
