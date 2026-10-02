# 쾌락실

슬랙 채널에서 친구들이랑 노는 미니게임 봇이에요.

- 💣 **폭탄 돌리기** — 폭탄을 받으면 다른 사람을 @멘션해서 넘기기. 터지면 하루 동안 💀
- 👾 **야생 출몰** — 채팅하다 보면 이모지 몬스터가 나타나요. 리액션을 제일 먼저 누르면 포획, 31종 도감
- 🔤 **초성 퀴즈** — 매일 12시 출제, 채팅으로 정답을 치면 1점. 주간 1등은 👑
- 🎲 **자동 모드** — 켜 두면 2분마다 셋 중 하나가 랜덤으로 터져요
- 📈 **이모지 거래소** — 앱 홈 탭. 많이 쓰인 이모지일수록 비싸지는 가짜 주식시장

## 설치

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App → From a manifest** → `manifest.yml` 붙여 넣기
2. **Basic Information → App-Level Tokens**에서 `connections:write` 토큰(`xapp-`) 만들기
3. **Install App**으로 설치하고 Bot Token(`xoxb-`) 복사
4. `.env.example`을 `.env`로 복사하고 두 토큰 넣기

```bash
pnpm install
pnpm start
```

5. 슬랙 채널에서 `/invite @봇이름` → `/game`

워크스페이스를 하나 더 붙이려면 `.env` 파일을 하나 더 만들고(`DB=다른이름.db` 포함) `node --env-file=.env.다른거 index.js`로 따로 켜면 돼요.

Node 24 이상 필요 (내장 SQLite 사용). 소켓 모드라 공개 주소 없이 내 컴퓨터에서 돌아가요.
