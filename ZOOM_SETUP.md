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

## 6. Meeting SDK 서명 유효성 검증

- 백엔드는 Meeting SDK 서명을 생성할 때 회의 번호에서 숫자가 아닌 문자는 제거한 뒤 사용합니다. Zoom 대시보드에서 복사한 회의 번호에 공백이나 대시(`-`)가 포함되어 있어도 문제없이 작동하지만, 가능하면 숫자만 포함된 형태로 사용하는 것이 안전합니다.
- 서명 문자열은 Zoom 공식 샘플과 동일하게 Base64로 인코딩한 뒤 URL 안전한 형태(`+` → `-`, `/` → `_`)로 정규화하고, 끝에 붙는 `=` 패딩은 제거합니다. 이렇게 하면 Meeting SDK에서 발생하던 `Signature is invalid` 오류를 예방할 수 있습니다.
- 호스트로 입장할 때는 서명 외에도 Zoom에서 발급한 ZAK 토큰이 필요합니다. Server-to-Server OAuth 또는 JWT 자격 증명이 정확하게 설정되어 있어야 하며, `/meeting/create` 응답에 `zak` 값이 포함되는지 확인하세요.
- 서명 값이 정상적으로 생성되었는지 즉시 확인하고 싶다면 `/meeting/signature` 또는 `/meeting/create` 호출 시 `{"debugSignature": true}`(혹은 `includeSignatureDetails`) 속성을 추가하세요. 응답에 `signatureDetails` 필드가 포함되어 Base64 URL 디코딩된 JWT header/payload 내용을 확인할 수 있습니다. 여기서 `mn`, `sdkKey`, `iat`, `exp`, `tokenExp` 값이 기대한대로 들어있다면 Zoom 웹 SDK가 같은 값을 검증하게 됩니다.
