"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Event, Profile } from "@/lib/types";
import type { EventWinningMember } from "@/lib/season-rankings";
import { toErrorMessage } from "@/lib/ui-feedback";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export default function WinnerEditor({ event, profiles, winners, supabase, onClose, onSaved, onError }: {
  event: Event;
  profiles: Profile[];
  winners: EventWinningMember[];
  supabase: SupabaseClient;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => winners.filter((winner) => winner.event_id === event.id).map((winner) => winner.member_id));
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>({ onRequestClose: onClose, active: true });
  const available = profiles.filter((profile) => profile.status === "active" && !profile.is_test_account);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 5 ? [...current, id] : current);
  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("save_event_winners", { target_event_id: event.id, target_member_ids: selected });
    setSaving(false);
    if (error) return onError(toErrorMessage(error));
    onSaved();
  };
  return <div className="modal-backdrop" onClick={() => { if (!saving) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="editor" role="dialog" aria-modal="true" aria-labelledby="winner-editor-title" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close" type="button" aria-label="닫기" onClick={onClose}><X /></button>
      <h2 id="winner-editor-title">우승 명단 기록</h2>
      <p>{new Date(event.starts_at).toLocaleDateString("ko-KR")} · {event.title}</p>
      <p className="form-description">그날 최종 우승팀 회원을 최대 5명 선택하세요. 저장하면 올해 MVP 순위에 일정당 1회 반영됩니다.</p>
      <p role="status">선택 {selected.length}/5명</p>
      <div className="winner-picker">
        {available.map((profile) => <label className="winner-option" key={profile.id}>
          <input type="checkbox" checked={selected.includes(profile.id)} disabled={saving || (!selected.includes(profile.id) && selected.length >= 5)} onChange={() => toggle(profile.id)} />
          <span>{profile.name}</span>
        </label>)}
      </div>
      {available.length === 0 && <p>선택할 활동 회원이 없습니다.</p>}
      <button className="cta" type="button" disabled={saving} onClick={() => void save()}>{saving ? "저장 중…" : "우승 명단 저장"}</button>
    </section>
  </div>;
}
