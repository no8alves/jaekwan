# REHAB LAB · 재활운동 처방 실습실

고등학교 체육 수업용 웹앱. 사용자(교사)와는 한국어로 대화한다.

## 파일
- `index.html`: 학생용 앱 전체(한 파일). 3D 해부 모델은 `models/`
- `teacher.html`: 교사용 현황판 (교사용 암호 필요)
- `apps-script-proxy.gs`: Google Apps Script 프록시 원본 (AI 검토, 시트 저장, 조 로그인, 현황판)

## 주소
- 학생용: https://no8alves.github.io/jaekwan/
- 교사용 현황판: https://no8alves.github.io/jaekwan/teacher.html
- GitHub Pages는 `main` 브랜치에 push하면 1~2분 뒤 반영됨

## Apps Script 프록시
- 스크립트 ID: `1wEnCgfdfBGIrylPZuoyaIMTWCPILj6sTLP64qz5wyNDCjg-KgVNkbPgy` (Apps Script 목록에서 "제목 없는 프로젝트")
- 학생용 배포 ID: `AKfycbxEZ6Obkq4oEG3LMSI9Plh4G1wcdFxd8v2i0DTiFB1zglQb1nuFAFBcZodn1uV2YFzo` (index.html의 `AI_PROXY`)
- 같은 계정의 "REHAB LAB"이라는 다른 스크립트는 예전 버전이라 이 프록시가 아님
- 스크립트 속성: `GEMINI_KEY`, `SHEET_ID`(시트 「REHAB LAB 진행 저장」), `TEACHER_KEY`(교사만 앎). 값은 저장소에 적지 않는다
- 고칠 때: `clasp clone` → 저장소의 `apps-script-proxy.gs`와 비교 → `clasp push` → `clasp deploy -i <배포 ID>`

## 수업 구조
- 학생은 조 이름 + 암호(숫자 4자리)로 로그인, 진행 내용은 시트에 조마다 한 줄로 자동 저장
- 2차시 구성: 1차시 = 1~2주차 처방, 2차시 = 2주 경과(모의)를 보고 3~4주차 더하기·빼기 (`S.phase`, `S.p1`)

## 작업 규칙
- 고친 뒤 미리보기에서 시험하고 보고한 다음, 교사가 "올려 줘"라고 하면 그때 commit·push한다
- Apps Script 재배포나 사이트 반영 전에는 수업 중이 아닌지 확인한다
- 로컬 시험 때는 fetch의 `action:'live'`를 막는다(안 그러면 실제 현황판에 시험 화면이 뜸)
- 교사가 쓰는 미리보기와 다른 포트에서 시험하고, 교사 쪽 localStorage/sessionStorage는 지우지 않는다
