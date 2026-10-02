"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Bell, BellOff } from "lucide-react";
import { webPushPreferenceLabels, type WebPushController } from "@/lib/web-push";

export default function WebPushSettings({ controller, eligible }: { controller: WebPushController; eligible: boolean }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  if (!eligible) return <section className="web-push-settings" aria-label="알림 설정"><h3>알림</h3><p className="form-description">활동 회원으로 승인된 뒤 알림을 켤 수 있습니다.</p></section>;
  const status = state.loading ? "알림 설정을 확인하는 중입니다." : state.connected ? "이 기기에서 알림을 받고 있습니다." : "이 기기의 알림이 꺼져 있습니다.";
  return <section className="web-push-settings" aria-labelledby="web-push-title">
    <div className="web-push-heading"><h3 id="web-push-title">경충FC 알림</h3>{state.connected ? <Bell size={19} aria-hidden="true" /> : <BellOff size={19} aria-hidden="true" />}</div>
    <p className="form-description" role="status">{status}</p>
    {state.support === "install" && <div className="web-push-help"><b>홈 화면에서 열어 주세요</b><p>Safari의 공유 메뉴에서 ‘홈 화면에 추가’를 선택하세요. 홈 화면의 경충FC 아이콘에서 로그인한 뒤 알림을 켤 수 있습니다.</p><Link className="text-link" href="/welcome#iphone-install">iPhone 설치 방법</Link></div>}
    {state.support === "unsupported" && <p className="form-description">이 브라우저에서는 알림을 사용할 수 없습니다. iPhone은 iOS 16.4 이상에서 홈 화면에 추가해 이용해 주세요.</p>}
    {state.support === "supported" && state.permission === "denied" && <p className="web-push-help">알림 권한이 차단되어 있습니다. 기기 설정에서 경충FC 알림을 허용한 뒤 ‘다시 확인’을 눌러 주세요.</p>}
    {state.support === "supported" && <div className="web-push-actions">
      {state.connected ? <><button type="button" className="cta small ghost" disabled={state.busy} onClick={() => void controller.test()}>테스트 알림 받기</button><button type="button" className="text-link" disabled={state.busy} onClick={() => void controller.disable()}>이 기기 알림 끄기</button></> : state.permission !== "denied" && <button type="button" className="cta small" disabled={state.busy || state.loading || !state.preferences} onClick={() => void controller.enable()}>{state.busy ? "알림을 연결하는 중…" : "이 기기 알림 켜기"}</button>}
      <button type="button" className="text-link" disabled={state.busy || state.loading} onClick={() => void controller.reload()}>다시 확인</button>
    </div>}
    {state.preferences && <fieldset className="web-push-preferences" disabled={state.busy || state.loading}>
      <legend>내 알림 수신 설정</legend><p className="form-description">같은 계정으로 사용하는 Android 앱에도 적용됩니다.</p>
      <label className="web-push-choice web-push-master"><span>전체 알림</span><input type="checkbox" checked={state.preferences.enabled} onChange={(event) => void controller.savePreferences({ enabled: event.target.checked })} /></label>
      {Object.entries(webPushPreferenceLabels).map(([key, label]) => <label className="web-push-choice" key={key}><span>{label}</span><input type="checkbox" disabled={!state.preferences?.enabled} checked={Boolean(state.preferences?.[key as keyof typeof webPushPreferenceLabels])} onChange={(event) => void controller.savePreferences({ [key]: event.target.checked })} /></label>)}
    </fieldset>}
    {state.error && <p className="form-error" role="alert">{state.error}</p>}
    {state.message && <p className="form-description" role="status">{state.message}</p>}
  </section>;
}
