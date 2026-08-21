"use client";

import { X } from "lucide-react";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export default function ConfirmDialog({ title, target, description, confirmLabel = "삭제하기", busy = false, onConfirm, onCancel }: {
  title: string;
  /** What is about to be destroyed. Naming it is the whole point of the dialog. */
  target?: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ onRequestClose: onCancel });
  return <div className="modal-backdrop" onClick={onCancel}>
    <div ref={dialogRef} tabIndex={-1} className="editor confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-description" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="modal-close" aria-label="닫기" onClick={onCancel}><X /></button>
      <h2 id="confirm-dialog-title">{title}</h2>
      {target && <p className="confirm-target">{target}</p>}
      <p id="confirm-dialog-description">{description}</p>
      <div className="confirm-actions">
        <button type="button" className="cta ghost" onClick={onCancel}>취소</button>
        <button type="button" className="cta danger" disabled={busy} onClick={onConfirm}>{busy ? "삭제 중…" : confirmLabel}</button>
      </div>
    </div>
  </div>;
}
