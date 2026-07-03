# Games Sync

프라이빗 이벤트 참가자들이 서로에게 `SIGNAL`을 보내고, 상호 호감이 확인되면 `SYNC`로 알려주는 모바일 중심 매칭 웹앱입니다.

이 프로젝트는 개인 토이프로젝트로 시작했지만, 실제 이벤트 운영을 가정해 입장코드 기반 룸, 관리자 승인, 데이터 영속성, 암호화 저장, 배포 환경 문제까지 직접 설계하고 개선했습니다.

- Live Demo: https://games-sync.onrender.com/
- Repository: https://github.com/ByungjunPark1205/games-sync

## Project Summary

대규모 프라이빗 모임에서 참가자들이 부담 없이 마음을 표현하고, 서로의 SIGNAL이 맞았을 때만 연락처를 확인할 수 있도록 만든 서비스입니다.

단순한 좋아요 기능이 아니라, 실제 운영자가 이벤트를 관리할 수 있도록 관리자 페이지와 룸 관리 기능을 함께 구현했습니다. Render 무료 환경에서 데이터가 초기화되는 문제를 경험한 뒤, Upstash Redis 외부 저장소로 전환해 재시작 후에도 데이터가 유지되도록 개선했습니다.

## Main Features

- 입장코드 기반 프라이빗 룸
- 관리자 승인 후 참가 가능한 입장 흐름
- 참가자 닉네임, 연락처, 상태메시지, 태그 등록
- `SIGNAL`, `OPEN SIGNAL`, `SYNC` 매칭 로직
- 받은 SIGNAL 수 및 룸별 순위
- 알림 타임라인
- 내정보 페이지에서 연락처와 상태메시지 수정
- 관리자 페이지에서 룸 생성, 참가자 승인, SIGNAL 수량 관리
- 모바일 사용을 우선한 반응형 UI

## Tech Stack

- Frontend: HTML, CSS, Vanilla JavaScript
- Backend: Node.js HTTP Server
- Storage: Upstash Redis, encrypted JSON payload
- Security: AES-256-GCM encryption, salted password hashing
- Deploy: Render

## What I Focused On

### Product Flow

처음에는 단순한 이벤트 매칭 페이지로 출발했지만, 실제 운영 상황을 고려하면서 기능을 확장했습니다.

- 외부인이 들어오지 못하도록 입장코드 적용
- 무분별한 참여를 막기 위한 관리자 승인 흐름 추가
- 참가자별 SIGNAL 수 제한 및 관리자 추가 지급 기능 구현
- 룸별로 참가자와 SIGNAL 기록이 분리되도록 구조 변경

### Data Persistence

초기에는 서버 로컬 파일에 데이터를 저장했지만, Render 무료 환경에서는 재시작 또는 재배포 시 파일 데이터가 사라지는 문제가 있었습니다.

이를 해결하기 위해 Upstash Redis를 외부 저장소로 연동했고, 앱은 암호화된 데이터 payload를 Redis key에 저장하도록 변경했습니다. 이 과정에서 데이터 초기화 방지, 저장소 진단 API, 환경변수 검증 로직도 함께 추가했습니다.

### Security

멤버들간의 SIGNAL 내역은 AES-256-GCM 방식으로 암호화 저장되며, 비밀번호는 salted hash로 저장됩니다. 관리자 화면에서는 참가자 간 SIGNAL 내역과 연락처가 직접 노출되지 않도록 구성했습니다.

### AI-assisted Development

AI 코딩 도구를 활용해 초기 구현 속도를 높이고, 실제 운영 중 발견된 문제를 반복적으로 개선했습니다. 요구사항 정리, UX 흐름 결정, 저장소 구조 변경, 암호화 방식 적용, 배포 환경 문제 해결은 직접 판단하고 검증했습니다.

## Screens / UX

주요 화면은 모바일 접속을 기준으로 구성했습니다.

- 입장코드 화면
- 참가자 등록 화면
- 홈 / 내정보 / 알림 / 순위 탭
- SYNC 성공 화면
- 관리자 페이지

## Local Run

```powershell
npm start
```

Open:

```text
http://localhost:3000
```

Admin page:

```text
http://localhost:3000/admin
```

## Environment Variables

```text
ADMIN_KEY=your-admin-key
DATA_ENCRYPTION_KEY=your-stable-encryption-key
UPSTASH_REDIS_REST_URL=your-upstash-rest-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
UPSTASH_STORE_KEY=games-sync:store
```

`DATA_ENCRYPTION_KEY`는 데이터가 생성된 뒤 바꾸면 기존 암호화 데이터를 복호화할 수 없으므로 유지해야 합니다.

## Notes

- 실제 운영 데이터와 환경변수는 저장소에 포함되어 있지 않습니다.
- `data/` 폴더는 로컬 개발용이며 Git에 커밋하지 않습니다.
- 이 프로젝트는 상용 서비스가 아닌 개인 토이프로젝트이지만, 실제 이벤트 운영을 가정해 기획, 구현, 배포, 운영 이슈 개선까지 경험하기 위해 제작했습니다.
