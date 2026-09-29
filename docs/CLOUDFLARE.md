# Cloudflare 운영 안내

이 배포는 기존 Render/Upstash 서비스와 독립적인 새 서비스입니다.

- 참가자: https://games-sync.emile941205.workers.dev
- 관리자: https://games-sync.emile941205.workers.dev/admin
- 웹 화면과 API: Cloudflare Workers + Static Assets
- 데이터: SQLite 기반 Durable Object `GameStore`
- 관리자 키와 암호화 키: Cloudflare Worker Secrets

## 처음 사용하기

1. 관리자 페이지에서 `ADMIN_KEY`로 접속합니다. 처음 접속하면 빈 데이터 저장소와 기본 방 `SYNC2026`이 생성됩니다.
2. 필요하면 새 입장코드로 방을 만들고 참가자에게 서비스 주소와 입장코드를 전달합니다.
3. 참가자 가입 후 관리자 화면에서 승인하면 SIGNAL을 보낼 수 있습니다.

이번 배포에 사용한 키는 이 컴퓨터의 Git 제외 파일 `.env.cloudflare`에만 별도로 보관합니다. 이 파일을 GitHub에 올리거나 공유하지 마세요. Cloudflare 대시보드의 Worker → Settings → Variables and Secrets에서도 키 이름을 확인할 수 있습니다.

`DATA_ENCRYPTION_KEY`는 기존 데이터를 읽는 데 필요하므로 고정해야 합니다. 키를 잃거나 바꾸면 이미 저장된 데이터를 열 수 없습니다. 저장소 전체는 AES-256-GCM으로 암호화하며, 비밀번호는 기존 scrypt 방식으로 저장합니다.

## 개발 및 검증

Node.js 22 이상에서 실행합니다.

```sh
corepack pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
# .dev.vars의 키를 로컬 테스트용 값으로 수정
corepack pnpm dev:cloudflare
corepack pnpm test
```

`pnpm test`는 번들을 생성한 뒤 Cloudflare의 workerd 런타임으로 화면 경로, 관리자 초기화, 동시 가입, 승인, 상호 SIGNAL, 잘못된 요청, 저장 암호화와 재시작 복구를 검증합니다. 테스트 데이터는 임시 로컬 저장소에만 기록합니다.

기존 Node.js 실행 방식은 `node server.js`로 유지됩니다. Render와 로컬 파일/Upstash 저장을 위한 기존 환경변수도 계속 사용할 수 있습니다.

## 다시 배포하기

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm exec wrangler login
corepack pnpm test
corepack pnpm deploy
```

배포 명령은 `wrangler.jsonc`의 `games-sync` Worker를 갱신하고 기존 Secrets와 Durable Object 데이터를 유지합니다. `GameStore` 클래스 이름, 바인딩, `idFromName("games-sync")`를 임의로 바꾸면 다른 데이터 저장소를 가리킬 수 있습니다.

다른 계정에 처음 배포할 때는 별도의 강한 키를 생성해 다음 명령으로 등록한 뒤 관리자 페이지에 접속합니다.

```sh
corepack pnpm exec wrangler secret put ADMIN_KEY
corepack pnpm exec wrangler secret put DATA_ENCRYPTION_KEY
```

키가 없거나 기본 관리자 키를 사용하면 API가 503으로 닫히고 화면만 제공됩니다. 초기화 전에는 참가자 입장도 차단됩니다. 관리자 인증으로만 빈 저장소를 초기화할 수 있습니다.

## 이메일 알림

승인 요청 알림은 호감핑과 같은 Google Apps Script 방식으로 연결돼 있습니다. 기존 비공개 `칭찬핑` 프로젝트에 `Sync.gs`와 `pollSyncSignupAlerts` 트리거를 추가했습니다. 15분 간격으로 모든 방의 승인 대기자를 확인하고, 신규 요청의 방 코드·닉네임·신청 시각과 관리자 링크를 한 통에 모아 보냅니다. 확인 전에 승인 또는 삭제된 요청은 제외합니다. 같은 요청은 반복 발송하지 않으며 메일 실패나 일일 한도 소진 시 다음 실행에서 재시도합니다.

Worker의 `SIGNUP_ALERT_TOKEN`과 Apps Script 속성의 같은 이름에 동일한 64자리 소문자 hex 값을 설정합니다. 토큰은 승인 대기 목록만 조회하며 승인, 연락처, SIGNAL 내역에 접근할 수 없습니다. Wrangler의 `keep_vars` 설정으로 대시보드에서 등록한 변수를 재배포 때 보존합니다.

기존 비공개 승인 알림 Apps Script 프로젝트에 `integrations/google-apps-script/sync-signup-alerts.gs`를 **새 파일 `Sync.gs`**로 추가합니다. 기존 `ALERT_TO` 수신 주소와 `SIGNUP_ALERT_TOKEN`을 재사용합니다. SYNC만 다른 토큰을 쓰면 `SYNC_SIGNUP_ALERT_TOKEN` 속성에 그 값을 설정합니다. `installSyncSignupAlerts`를 한 번 실행해 `pollSyncSignupAlerts` 15분 트리거를 설치하고, `testSyncSignupAlerts`로 테스트 메일을 보낼 수 있습니다. 기존 호감핑 코드와 알림 기록은 유지됩니다.

구글의 실제 트리거 실행 및 메일 전달이 지연될 수 있습니다. 연결 직후 현재 승인 대기 중인 참가자도 알림 대상이며, 메일 발송 직후 속성 저장에 실패한 경우 다음 실행에서 중복 발송될 수 있습니다. 수신함 읽기 권한이나 웹 앱 공개 배포는 필요하지 않습니다. 연결 해제 시 SYNC의 `pollSyncSignupAlerts` 트리거만 제거합니다.

기존 Resend 발송 방식도 `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, `NOTIFY_EMAIL_FROM` 설정 시 동작합니다. Google 알림과 함께 켜면 같은 요청이 두 방식으로 발송되므로 한 가지 방식만 사용하세요.

## 운영 범위

작은 이벤트용으로 한 Durable Object에서 암호화된 저장소를 관리하며 API 요청을 순차 처리합니다. 이는 동시에 저장할 때 데이터가 덮어써지는 것을 방지합니다. 참가자 수가 크게 늘면 룸별 저장소 분리와 요청 빈도 조정을 검토하세요.

SQLite 기반 Durable Objects는 Workers Free 플랜에서도 지원되지만 요청·저장량 한도가 있습니다. 플랜 변경이나 유료 구독은 이 배포에서 진행하지 않았습니다. 사용량은 Cloudflare 대시보드에서 확인하세요.

- [Cloudflare Durable Objects 요금 및 한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Static Assets 구성](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

코드 변경은 별도 Git 브랜치로 관리합니다. GitHub 자동 배포 연결은 아직 설정하지 않았으므로 변경 후 위 CLI 명령으로 재배포해야 합니다.
