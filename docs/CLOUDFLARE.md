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

현재 이메일 알림은 설정하지 않았습니다. 관리자 화면에서 직접 승인할 수 있습니다. 이메일이 필요하면 `RESEND_API_KEY`, `ADMIN_NOTIFY_EMAIL`, `NOTIFY_EMAIL_FROM`을 Worker에 설정하세요. Resend에서 허용한 발신 주소를 사용해야 합니다.

## 운영 범위

작은 이벤트용으로 한 Durable Object에서 암호화된 저장소를 관리하며 API 요청을 순차 처리합니다. 이는 동시에 저장할 때 데이터가 덮어써지는 것을 방지합니다. 참가자 수가 크게 늘면 룸별 저장소 분리와 요청 빈도 조정을 검토하세요.

SQLite 기반 Durable Objects는 Workers Free 플랜에서도 지원되지만 요청·저장량 한도가 있습니다. 플랜 변경이나 유료 구독은 이 배포에서 진행하지 않았습니다. 사용량은 Cloudflare 대시보드에서 확인하세요.

- [Cloudflare Durable Objects 요금 및 한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Static Assets 구성](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

코드 변경은 별도 Git 브랜치로 관리합니다. GitHub 자동 배포 연결은 아직 설정하지 않았으므로 변경 후 위 CLI 명령으로 재배포해야 합니다.
