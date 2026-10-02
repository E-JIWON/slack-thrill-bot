import bolt from '@slack/bolt'
import { registerGames } from './games.js'
import { buy, coins, emojisIn, holdings, ranking, record, sell, top, worth } from './market.js'

// 마지막 안전망: 처리 못 한 에러가 있어도 봇이 꺼지지 않게
process.on('unhandledRejection', (e) => console.error('처리 못 한 에러:', e))

const app = new bolt.App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
})

// ── 블록 조각 ──
const md = (text) => ({ type: 'mrkdwn', text })
const button = (text, action_id, value, style) => ({
  type: 'button', text: { type: 'plain_text', text }, action_id, ...(value && { value }), ...(style && { style }),
})
const title = (text) => ({ type: 'section', text: md(`*${text}*`) })
const note = (text) => ({ type: 'context', elements: [md(text)] })
const divider = { type: 'divider' }
const MEDAL = ['🥇', '🥈', '🥉']

const marketRows = () => {
  const rows = top()
  if (!rows.length) return [note('오늘은 조용해요. 봇이 있는 채널에서 이모지를 써 보세요!')]
  return rows.map((r, i) => ({
    type: 'section',
    text: md(`${MEDAL[i] ?? `\`${i + 1}\``}   :${r.emoji}:   *${r.price}코인*   ${r.change}`),
    accessory: button('사기', 'buy', r.emoji, 'primary'),
  }))
}

const holdingRows = (user) => {
  const rows = holdings(user)
  if (!rows.length) return [note('아직 가진 종목이 없어요. 아래 시세에서 사 보세요')]
  return rows.map((h) => ({
    type: 'section',
    text: md(`:${h.emoji}:   ${h.qty}주 × ${h.price}  =  *${h.qty * h.price}코인*`),
    accessory: button('팔기', 'sell', h.emoji),
  }))
}

const walletFields = (user) => {
  const myRank = ranking().findIndex((r) => r.user === user) + 1
  return {
    type: 'section',
    fields: [md(`*현금*\n💰 ${coins(user)}코인`), md(`*총자산*\n${worth(user)}코인 · ${myRank ? `${myRank}위` : '순위 없음'}`)],
  }
}

const rankingBlock = () => ({
  type: 'section',
  text: md(ranking().slice(0, 5).map((r, i) => `${MEDAL[i] ?? `${i + 1}.`}  <@${r.user}>  ${r.worth}코인`).join('\n') || '아직 투자자가 없어요'),
})

// 앱 홈: 이모지 거래소
const homeView = (user, notice) => ({
  type: 'home',
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: '📈 이모지 거래소' } },
    walletFields(user),
    ...(notice ? [note(`⚠️ ${notice}`)] : []),
    { type: 'actions', elements: [button('새로고침', 'refresh')] },
    divider, title('📦 내 종목'), ...holdingRows(user),
    divider, title('🔥 오늘의 시세'), ...marketRows(),
    divider, title('🏆 부자 랭킹'), rankingBlock(),
    note('시세 = 10 + 최근 24시간 동안 쓰인 횟수 × 5 · 버튼 한 번에 1주씩'),
  ],
})

const publish = (client, user, notice) => client.views.publish({ user_id: user, view: homeView(user, notice) })

// ── 이벤트 ──
app.event('reaction_added', async ({ event, context }) => {
  if (event.user !== context.botUserId) record(event.reaction)
})

app.message(async ({ message }) => {
  if (message.subtype || message.bot_id) return
  for (const e of emojisIn(message.text)) record(e)
})

app.event('app_home_opened', async ({ event, client }) => {
  if (event.tab === 'home') await publish(client, event.user)
})

app.action('refresh', async ({ ack, body, client }) => {
  await ack()
  await publish(client, body.user.id)
})

for (const [id, trade] of [['buy', buy], ['sell', sell]]) {
  app.action(id, async ({ ack, body, action, client }) => {
    await ack()
    const result = trade(body.user.id, action.value, 1)
    await publish(client, body.user.id, result.ok ? null : result.text)
  })
}

await registerGames(app)
await app.start()
console.log('🕹️ 쾌락실 개장')
