import bolt from '@slack/bolt'
import { registerGames } from './games.js'
import { registerTrade } from './trade.js'

// 마지막 안전망: 처리 못 한 에러가 있어도 봇이 꺼지지 않게
process.on('unhandledRejection', (e) => console.error('처리 못 한 에러:', e))

const app = new bolt.App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
})

await registerGames(app)
registerTrade(app)
await app.start()
console.log('🕹️ 쾌락실 개장')
