import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

type Props = {
  /** Fastest pace in the current unit (smallest numeric value). */
  min: number;
  /** Slowest pace in the current unit (largest numeric value). */
  max: number;
  /** Current fast handle value. */
  fast: number;
  /** Current slow handle value. */
  slow: number;
  /** Step in minutes (defaults to one second). */
  step?: number;
  /** Accessible label for the slider group. */
  ariaLabel?: string;
  onChange: (fast: number, slow: number) => void;
};

const DEFAULT_STEP = 1 / 60;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * A two-handle range slider where the left handle is the fastest pace bound
 * and the right handle is the slowest pace bound. Both handles are clamped to
 * the supplied data extent and cannot cross each other.
 */
export function PaceRangeSlider({
  min,
  max,
  fast,
  slow,
  step = DEFAULT_STEP,
  ariaLabel,
  onChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"fast" | "slow" | null>(null);

  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const span = Math.max(upper - lower, step);

  const toPercent = (value: number) => clamp((value - lower) / span, 0, 1) * 100;

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return lower;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return lower;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const raw = lower + ratio * span;
      return clamp(Math.round(raw / step) * step, lower, upper);
    },
    [lower, span, step, upper],
  );

  const applyValue = useCallback(
    (handle: "fast" | "slow", value: number) => {
      if (handle === "fast") {
        const nextFast = clamp(Math.min(value, slow - step), lower, upper);
        onChange(nextFast, slow);
      } else {
        const nextSlow = clamp(Math.max(value, fast + step), lower, upper);
        onChange(fast, nextSlow);
      }
    },
    [fast, slow, step, lower, upper, onChange],
  );

  const updateFromClientX = useCallback(
    (handle: "fast" | "slow", clientX: number) => {
      applyValue(handle, valueFromClientX(clientX));
    },
    [applyValue, valueFromClientX],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => updateFromClientX(dragging, event.clientX);
    const onUp = () => setDragging(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, updateFromClientX]);

  const handleKeyDown = (handle: "fast" | "slow", event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? -1
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? 1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    const delta = step * (event.shiftKey ? 10 : 1) * direction;
    applyValue(handle, (handle === "fast" ? fast : slow) + delta);
  };

  const onTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== trackRef.current) return;
    const value = valueFromClientX(event.clientX);
    const handle = Math.abs(value - fast) <= Math.abs(value - slow) ? "fast" : "slow";
    setDragging(handle);
    applyValue(handle, value);
  };

  return (
    <div className="pace-range-slider" role="group" aria-label={ariaLabel}>
      <div className="pace-range-track" ref={trackRef} onPointerDown={onTrackPointerDown}>
        <div
          className="pace-range-track-fill"
          style={{ left: `${toPercent(fast)}%`, width: `${Math.max(0, toPercent(slow) - toPercent(fast))}%` }}
        />
        <div
          className={`pace-range-thumb${dragging === "fast" ? " dragging" : ""}`}
          style={{ left: `${toPercent(fast)}%` }}
          role="slider"
          tabIndex={0}
          aria-label={`${ariaLabel ?? ""} fast`}
          aria-valuemin={lower}
          aria-valuemax={slow}
          aria-valuenow={fast}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging("fast");
          }}
          onKeyDown={(event) => handleKeyDown("fast", event)}
        />
        <div
          className={`pace-range-thumb${dragging === "slow" ? " dragging" : ""}`}
          style={{ left: `${toPercent(slow)}%` }}
          role="slider"
          tabIndex={0}
          aria-label={`${ariaLabel ?? ""} slow`}
          aria-valuemin={fast}
          aria-valuemax={upper}
          aria-valuenow={slow}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging("slow");
          }}
          onKeyDown={(event) => handleKeyDown("slow", event)}
        />
      </div>
    </div>
  );
}
