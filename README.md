# Games Sync

프라이빗 이벤트 참가자들이 서로에게 `SIGNAL`을 보내고, 서로의 호감이 확인되면 `SYNC`로 알려주는 모바일 중심 매칭 웹앱입니다.

입장코드가 있는 룸에서 참가자를 관리하고, 운영자가 승인한 참가자만 매칭에 참여하도록 설계했습니다. 연락처와 상태메시지 같은 참가자 정보는 매칭이 성사된 경우에만 필요한 범위에서 확인할 수 있습니다.

## 현재 서비스

- 참가자: <https://games-sync.emile941205.workers.dev>
- 관리자: <https://games-sync.emile941205.workers.dev/admin>
- 기본 룸 코드: `SYNC2026`
- 운영 안내: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md)
- 저장소: <https://github.com/ByungjunPark1205/games-sync>

현재 Cloudflare 서비스는 기존 Render 서비스와 분리된 새 저장소로 시작합니다. 기존 Render 주소는 과거 배포를 확인하기 위한 레거시 주소이며, 현재 운영 주소는 Cloudflare Workers입니다.

## 주요 기능

- 입장코드 기반 프라이빗 룸
- 관리자 승인 후 참가 가능한 입장 흐름
- 참가자 닉네임, 연락처, 상태메시지, 태그 등록
- `SIGNAL`, `OPEN SIGNAL`, `SYNC` 매칭 로직
- 받은 SIGNAL 수와 룸별 순위
- 알림 타임라인
- 내정보 페이지에서 연락처와 상태메시지 수정
- 관리자 페이지에서 룸 생성, 참가자 승인·거절·삭제, SIGNAL 수량 관리
- 모바일 중심 반응형 UI
- 새 입장 요청을 관리자 메일로 알리는 Google Apps Script 연동

## 메일 알림

새 참가자가 룸 입장을 신청하면 기존 비공개 Google Apps Script 프로젝트의 `pollSyncSignupAlerts` 트리거가 15분마다 승인 대기자를 확인합니다. 새로운 요청을 방 코드, 닉네임, 신청 시각, 관리자 링크와 함께 한 통의 메일로 보냅니다.

이미 알린 요청은 다시 보내지 않으며, 메일 발송 실패나 일일 메일 한도 소진 시 다음 실행에서 재시도합니다. 기존 호감핑 알림 기록과 `pollSignupAlerts` 트리거는 별도로 유지됩니다.

관련 코드는 [integrations/google-apps-script/sync-signup-alerts.gs](integrations/google-apps-script/sync-signup-alerts.gs)에 있습니다. 자세한 연결·해제 방법은 [Cloudflare 운영 안내](docs/CLOUDFLARE.md#이메일-알림)를 참고하세요.

## 기술 구성

- Frontend: HTML, CSS, Vanilla JavaScript
- 기존 로컬 실행: Node.js HTTP Server
- Cloudflare 실행: Workers + Static Assets
- Cloudflare 데이터: SQLite 기반 Durable Object `GameStore`
- 암호화: AES-256-GCM 데이터 저장, salted scrypt 비밀번호 해시
- 운영 메일: Google Apps Script `MailApp`
- 배포 도구: Wrangler

Cloudflare Worker는 룸 데이터를 암호화해 Durable Object에 저장하고, 한 룸 저장소에 대한 변경 요청을 순차 처리해 동시에 들어온 요청이 서로의 변경사항을 덮어쓰지 않도록 합니다.

## 로컬 실행

Node.js 22 이상과 pnpm을 사용합니다.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm start
```

접속 주소:

```text
http://localhost:3000
http://localhost:3000/admin
```

Cloudflare Workers 런타임으로 로컬 실행하려면 `.dev.vars.example`을 참고해 `.dev.vars`를 만든 뒤 실행합니다.

```sh
corepack pnpm dev:cloudflare
```

## 환경변수

### Cloudflare Worker

민감한 값은 저장소에 커밋하지 말고 Cloudflare Worker Secrets로 설정합니다.

```text
ADMIN_KEY                  관리자 페이지 인증 키
DATA_ENCRYPTION_KEY        고정 데이터 암호화 키
SIGNUP_ALERT_TOKEN         메일 알림 조회용 64자리 hex 토큰
```

`DATA_ENCRYPTION_KEY`는 저장된 데이터를 복호화하는 데 필요하므로 배포 후에도 유지해야 합니다. 키를 잃거나 바꾸면 기존 암호화 데이터를 열 수 없습니다.

### Node.js·레거시 저장소

`node server.js`로 실행하는 기존 환경에서는 다음 변수를 추가로 사용할 수 있습니다.

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
UPSTASH_STORE_KEY=games-sync:store
DATABASE_PATH
ALLOW_DATABASE_BOOTSTRAP
```

가입 요청 메일을 Resend로 직접 보내는 기존 경로를 사용할 때는 `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, `NOTIFY_EMAIL_FROM`을 설정합니다. Google Apps Script 알림과 동시에 켜면 같은 요청이 두 경로로 발송될 수 있습니다.

## 테스트와 배포

전체 테스트는 번들을 만든 뒤 Cloudflare의 로컬 workerd 런타임과 Apps Script 모의 환경에서 실행됩니다. 실제 운영 데이터나 실제 메일은 테스트에 사용하지 않습니다.

```sh
corepack pnpm test
```

Cloudflare에 배포합니다.

```sh
corepack pnpm exec wrangler login
corepack pnpm test
corepack pnpm deploy
```

`wrangler.jsonc`의 `keep_vars` 설정으로 Cloudflare 대시보드에서 등록한 변수를 재배포 시 보존합니다. Durable Object의 `GameStore` 클래스, `GAME_STORE` 바인딩, `idFromName("games-sync")`는 기존 저장소를 가리키므로 임의로 변경하지 않습니다.

## 프로젝트 구조

```text
application.cjs                         Node.js와 Worker가 공유하는 애플리케이션 로직
cloudflare/worker.mjs                   Cloudflare Worker와 Durable Object 어댑터
public/                                 정적 화면과 클라이언트 코드
integrations/google-apps-script/        승인 요청 메일 연동 코드
tests/                                  Worker·메일 알림 통합 테스트
wrangler.jsonc                          Cloudflare 배포 설정
docs/CLOUDFLARE.md                      운영, 메일 연결, 재배포 안내
server.js                               기존 Node.js 실행 진입점
```

## 보안 및 운영 메모

- 실제 운영 데이터와 Secret 값은 저장소에 포함하지 않습니다.
- 승인 대기 알림 API는 `SIGNUP_ALERT_TOKEN`으로 인증하며 승인 대기자의 방 코드·닉네임·신청 시각만 반환합니다.
- 알림 API는 승인, 연락처, 비밀번호, SIGNAL 내역에 접근할 수 없습니다.
- Cloudflare Workers Free 플랜에는 Durable Objects 요청·저장량 한도가 있습니다. 사용량은 Cloudflare 대시보드에서 확인하세요.
- 이 프로젝트는 개인 토이프로젝트에서 출발했으며, 실제 이벤트 운영을 가정한 인증·승인·암호화·영속성 문제를 직접 다루는 것을 목표로 합니다.
