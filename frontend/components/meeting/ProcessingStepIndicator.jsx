'use client';

import { Check, Loader2, Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const steps = [
  { id: 'upload', label: 'Upload', description: 'Audio file uploaded' },
  { id: 'transcription', label: 'Transcription', description: 'Converting speech to text' },
  { id: 'diarization', label: 'Speaker Detection', description: 'Identifying speakers' },
  { id: 'analysis', label: 'Analysis', description: 'AI analyzing content' },
  { id: 'embedding', label: 'Embedding', description: 'Storing in vector database' },
  { id: 'ready', label: 'Ready', description: 'Processing complete' }
];

const statusIcons = {
  pending: Clock,
  running: Loader2,
  done: Check,
  failed: X
};

const statusColors = {
  pending: 'bg-slate-700 border-slate-600 text-muted-foreground',
  running: 'bg-blue-500/20 border-blue-500 text-blue-400',
  done: 'bg-green-500/20 border-green-500 text-green-400',
  failed: 'bg-red-500/20 border-red-500 text-red-400'
};

export default function ProcessingStepIndicator({ processingSteps, error }) {
  const getStepStatus = (stepId) => {
    const step = processingSteps?.find(s => s.step === stepId);
    return step?.status || 'pending';
  };

  const getStepMessage = (stepId) => {
    const step = processingSteps?.find(s => s.step === stepId);
    return step?.message;
  };

  const currentStepIndex = steps.findIndex(step => {
    const status = getStepStatus(step.id);
    return status === 'running' || status === 'failed';
  });

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4">
        {steps.map((step, index) => {
          const status = getStepStatus(step.id);
          const Icon = statusIcons[status];
          const isActive = index <= currentStepIndex;
          const isLast = index === steps.length - 1;

          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300',
                    statusColors[status],
                    status === 'running' && 'animate-pulse'
                  )}
                >
                  <Icon
                    className={cn(
                      'w-5 h-5',
                      status === 'running' && 'animate-spin'
                    )}
                  />
                </div>
                <span
                  className={cn(
                    'mt-2 text-xs font-medium',
                    isActive ? 'text-foreground' : 'text-slate-500'
                  )}
                >
                  {step.label}
                </span>
                {getStepMessage(step.id) && (
                  <span className="mt-1 text-[10px] text-muted-foreground max-w-[100px] text-center">
                    {getStepMessage(step.id)}
                  </span>
                )}
              </div>

              {!isLast && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-2 transition-all duration-500',
                    index < currentStepIndex ? 'bg-green-500' : 'bg-slate-700'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400">
          <p className="font-medium">Processing Error</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      <div className="mt-4 text-center">
        <p className="text-sm text-muted-foreground">
          {currentStepIndex >= 0 && currentStepIndex < steps.length
            ? `Current: ${steps[currentStepIndex].description}`
            : processingSteps?.find(s => s.step === 'ready')?.status === 'done'
            ? 'Processing complete!'
            : 'Waiting to start...'}
        </p>
      </div>
    </div>
  );
}
