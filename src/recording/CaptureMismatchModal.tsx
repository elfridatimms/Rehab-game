import React, { useEffect } from 'react';
import type { CaptureRates } from './anomaly';
import type { Validity } from './types';

interface CaptureMismatchModalProps {
  open: boolean;
  rates: CaptureRates;
  declaredArm: string;
  reason: string;
  onChoose: (validity: Validity) => void;
  onDiscard: () => void;
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

const CaptureMismatchModalImpl: React.FC<CaptureMismatchModalProps> = ({
  open,
  rates,
  declaredArm,
  reason,
  onChoose,
  onDiscard,
}) => {
  // Close-on-Escape, treated as "Discard" (the safest non-destructive
  // dismissal — nothing is persisted yet).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDiscard();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onDiscard]);

  if (!open) return null;
  const N = rates.totalFrames;

  return (
    <div
      className="capture-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="capture-modal-title"
    >
      <div className="capture-modal">
        <h2 id="capture-modal-title" className="capture-modal-title">
          Capture rate mismatch with selected arm setting.
        </h2>
        <p className="capture-modal-reason">
          Declared <strong>{declaredArm}</strong>. {reason}
        </p>

        <dl className="capture-modal-rates">
          <div>
            <dt>Left</dt>
            <dd>
              {rates.leftCaptured} / {N} frames ({pct(rates.leftPct)})
            </dd>
          </div>
          <div>
            <dt>Right</dt>
            <dd>
              {rates.rightCaptured} / {N} frames ({pct(rates.rightPct)})
            </dd>
          </div>
        </dl>

        <div className="capture-modal-actions">
          <button
            type="button"
            className="btn btn-rec-mod btn-rec-mod-invalid"
            onClick={() => onChoose('invalid')}
          >
            Save as INVALID
          </button>
          <button
            type="button"
            className="btn btn-rec-mod btn-rec-mod-partial"
            onClick={() => onChoose('partial')}
          >
            Save as PARTIAL
          </button>
          <button
            type="button"
            className="btn btn-rec-mod btn-rec-mod-anyway"
            onClick={() => onChoose('save_anyway')}
          >
            Save anyway
          </button>
          <button
            type="button"
            className="btn btn-rec-mod btn-rec-mod-discard"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
};

export const CaptureMismatchModal = React.memo(CaptureMismatchModalImpl);
