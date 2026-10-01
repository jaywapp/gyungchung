# 푸시 알림 서버 기획

사용자 확정: 앱 별도 알림 설정 화면, 전체 기본 꺼짐과 종류별 기본 켜짐. 참석 추가/going→not_going, 일정 날짜·시간·장소 변경, 공지 등록, 명시 취소, 전날 경기 안내, 미응답 RSVP·미제출 참여 마감 안내, 본인 의견 응답/상태를 지원한다. 참석 수신 기본은 운영진+해당 일정 참석자이며 events.manage 운영진이 3종 범위를 선택한다. 동일 운영진이 미응답자에게 수동 다시 알리기를 요청할 수 있다.

원본: attendance.status는 RSVP이며 check_in_status는 현장 기록이다. events.starts_at은 날짜+시각이며 venue/address는 snapshot이므로 venues 편집을 일정 변경으로 간주하지 않는다. profiles.id와 auth.uid는 다를 수 있다.

[최종 RPC·위험·검증 계약](push-notifications-contract.md)을 따른다. 운영 적용·발송은 이 작업에서 수행하지 않는다.
