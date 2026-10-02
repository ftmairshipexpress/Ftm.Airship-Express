"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Tooltip } from "@/performance-development-dashboard/components/ui/Tooltip";
import { Modal } from "@/performance-development-dashboard/components/ui/Modal";
import {
  PerformanceButton,
  PerformanceDialogPanel,
} from "@/performance-development-dashboard/components/ui/performance";
import type { Course } from "@/performance-development-dashboard/types";

type Props = {
  course: Course;
  submitting: boolean;
  onSubmit: (courseId: string) => Promise<void>;
  onClose: () => void;
};

/**
 * Employee self-enrollment confirmation. Enrolls ONLY the authenticated
 * employee (identity is server-derived; no employee is selectable here).
 */
export function SelfEnrollCourseModal({
  course,
  submitting,
  onSubmit,
  onClose,
}: Props) {
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await onSubmit(course.id);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to enroll in course."
      );
    }
  }

  return (
    <Modal
      onClose={onClose}
      closeDisabled={submitting}
      labelledBy="self-enroll-course-modal-title"
    >
      <PerformanceDialogPanel labelledBy="self-enroll-course-modal-title">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted">
              Learning &amp; development
            </p>
            <h2
              id="self-enroll-course-modal-title"
              className="mt-1 font-bricolage text-[20px] font-medium tracking-tight text-ink"
            >
              Enroll in this course?
            </h2>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
              <span className="font-medium text-ink">{course.title}</span>{" "}
              will be added to your learning enrollments so you can track
              your progress.
            </p>
          </div>
          <Tooltip label="Close" side="bottom">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent/[0.08] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </Tooltip>
        </div>

        <form onSubmit={handleSubmit} className="mt-6">
          {formError && (
            <p
              aria-live="polite"
              className="rounded-lg bg-red-500/10 px-3 py-2 text-[12.5px] font-medium text-red-600"
            >
              {formError}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <PerformanceButton
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
              className="px-3 py-1.5 text-[12.5px]"
            >
              Cancel
            </PerformanceButton>
            <PerformanceButton
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 text-[12.5px]"
            >
              {submitting ? "Enrolling..." : "Enroll"}
            </PerformanceButton>
          </div>
        </form>
      </PerformanceDialogPanel>
    </Modal>
  );
}
