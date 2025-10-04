# Zoom Meeting SDK 및 Server-to-Server OAuth 설정 가이드

다음 단계는 Zoom Meeting SDK를 사용하여 수업(회의)을 생성하기 위해 **반드시** 완료되어야 합니다.
아래 절차는 Zoom 공식 문서에 기반하며, 각 단계에 필요한 설정값을 정리했습니다.

## 1. Server-to-Server OAuth 앱 생성
1. [Zoom App Marketplace](https://marketplace.zoom.us/)에 관리자로 로그인합니다.
2. `Develop > Build App` 메뉴에서 **Server-to-Server OAuth** 앱을 생성합니다.
3. 앱을 활성화하면 `Account ID`, `Client ID`, `Client Secret` 값을 확인할 수 있습니다.
4. 권한(Scopes)에서 **`meeting:write:admin`**, **`user:read:admin`** 권한이 포함되어 있는지 확인하고 저장합니다.
5. 발급받은 값을 다음 환경 변수에 설정합니다.
   - `ZOOM_ACCOUNT_ID`
   - `ZOOM_CLIENT_ID`
   - `ZOOM_CLIENT_SECRET`

> Server-to-Server OAuth 앱은 `grant_type=account_credentials` 플로우를 사용합니다. 요청이 거부되는 경우 앱이 활성화되어 있는지, Account ID 값이 올바른지, 권한이 부족하지 않은지 다시 확인하세요.

## 2. Meeting SDK 자격 증명 준비
1. Zoom Marketplace에서 **Meeting SDK** 앱을 생성하거나 기존 앱을 엽니다.
2. `SDK Key`와 `SDK Secret` 값을 확인합니다.
3. 백엔드 서버의 환경 변수에 다음과 같이 설정합니다.
   - `ZOOM_SDK_KEY`
   - `ZOOM_SDK_SECRET`

## 3. (선택) 레거시 JWT 자격 증명
- 만약 Server-to-Server OAuth를 사용할 수 없는 환경이라면, 레거시 JWT 앱에서 `ZOOM_API_KEY`, `ZOOM_API_SECRET` 값을 설정할 수 있습니다.
- 단, Zoom에서 JWT 앱을 더 이상 신규 발급하지 않으므로 가능한 경우 Server-to-Server OAuth 방식을 사용하세요.

## 4. 환경 변수 설정 체크리스트
환경 변수를 설정할 때는 아래 사항을 반드시 확인하세요.

- 값 앞뒤에 공백이나 줄바꿈이 없는지 확인합니다.
- 복사한 값 끝에 `Copy` 등의 불필요한 텍스트가 붙어있지 않은지 확인합니다. (백엔드에서 자동으로 제거를 시도하지만, 사람이 직접 확인하는 것이 가장 안전합니다.)
- `.env` 파일에 따옴표(`"` 또는 `'`)로 감싸져 있지 않은 순수 문자열로 저장합니다.
- 서버를 재시작하여 최신 환경 변수 값이 반영되었는지 확인합니다.

## 5. 서버 동작 확인
1. `.env` 파일 또는 배포 환경 변수에 위 항목을 모두 설정합니다.
2. `npm install` 후 `node token-server.js` 혹은 PM2 등의 프로세스 매니저로 서버를 실행합니다.
3. `POST /meeting/create` 요청을 보내 회의가 정상적으로 생성되는지 확인합니다.
   - 회의 생성에 실패하면 서버 로그에 상세 오류 메시지가 기록됩니다.
   - 401 오류가 발생하면 자격 증명이 정확한지, 앱 권한이 충분한지 확인하세요.

위 과정을 완료하면 수업 생성 시 Zoom Meeting 생성과 토큰 발급이 안정적으로 수행됩니다.
