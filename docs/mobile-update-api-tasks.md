# 모바일 업데이트 API 작업

| 작업 | owner | model | effort | depends_on | parallel_group | 상태 |
|---|---|---|---|---|---|---|
| 계약·설계 문서 | mobile_update_api | gpt-6.1-sol (sonnet 역할) | medium | 없음 | api | 완료 |
| 검증·캐시·인증·스트림 | mobile_update_api | gpt-6.1-sol (sonnet 역할) | high | 설계 | api | 완료 |
| 주입 계약 테스트·배포 안내 | mobile_update_api | gpt-6.1-sol (sonnet 역할) | high | 구현 | api | 완료 |

서버 코드만 지정된 작업 트리에서 수정한다. 앱/UI와 네이티브 구현은 리더 및 별도 작업자가 독립 경로에서 담당한다. 커밋·푸시·배포·시크릿 등록은 수행하지 않는다.
