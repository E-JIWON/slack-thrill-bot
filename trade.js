import { db } from './db.js'
import { MONSTERS, setting } from './games.js'

db.exec(`
  create table if not exists trades (
    id integer primary key, from_user text, to_user text, give text, want text, status text, ts integer
  );
`)

const GRADE = new Map(MONSTERS.map((m) => [m.emoji, m.grade]))
const ORDER = new Map(MONSTERS.map((m, i) => [m.emoji, i]))

// 내가 가진 몬스터: 종류별 마릿수, 도감 순서대로
export const collection = (user) =>
  db.prepare('select emoji, count(*) n from dex where user = ? group by emoji').all(user)
    .map(({ emoji, n }) => ({ emoji, n }))
    .sort((a, b) => ORDER.get(a.emoji) - ORDER.get(b.emoji))

const owns = (user, emoji) => !!db.prepare('select 1 from dex where user = ? and emoji = ?').get(user, emoji)

// 한 마리를 다른 사람에게 넘김 (dex 한 줄의 주인만 바꿈)
const hand = (from, to, emoji) =>
  db.prepare('update dex set user = ? where rowid = (select rowid from dex where user = ? and emoji = ? limit 1)').run(to, from, emoji)

// 성공하면 { id }, 안 되면 { field: 틀린 칸, error: '이유' }
export function propose(from, to, give, want) {
  if (from === to) return { field: 'to', error: '나 자신과는 교환할 수 없어요' }
  // 입력 창의 오류 문구에서는 이모지가 안 그려져서 글로만 씀
  if (!owns(from, give)) return { field: 'give', error: '이 몬스터를 갖고 있지 않아요' }
  if (!owns(to, want)) return { field: 'want', error: '친구가 이 몬스터를 갖고 있지 않아요' }
  const { lastInsertRowid } = db.prepare("insert into trades values (null, ?, ?, ?, ?, 'open', ?)").run(from, to, give, want, Date.now())
  return { id: Number(lastInsertRowid) }
}

const getTrade = (id) => db.prepare('select * from trades where id = ?').get(id)
const close = (id, status) => db.prepare('update trades set status = ? where id = ?').run(status, id)

// 받은 사람만 수락할 수 있고, 그 사이 둘 중 하나라도 몬스터가 없어졌으면 실패
export function accept(id, by) {
  const t = getTrade(id)
  if (t?.status !== 'open') return { error: '이미 끝난 교환이에요' }
  if (by !== t.to_user) return { error: `<@${t.to_user}> 님만 수락할 수 있어요` }
  if (!owns(t.from_user, t.give) || !owns(t.to_user, t.want)) {
    close(id, 'failed')
    return { done: 'failed', trade: t }
  }
  hand(t.from_user, t.to_user, t.give)
  hand(t.to_user, t.from_user, t.want)
  close(id, 'done')
  return { done: 'done', trade: t }
}

// 받은 사람은 거절, 보낸 사람은 취소
export function reject(id, by) {
  const t = getTrade(id)
  if (t?.status !== 'open') return { error: '이미 끝난 교환이에요' }
  if (by !== t.to_user && by !== t.from_user) return { error: '교환 당사자만 누를 수 있어요' }
  close(id, by === t.to_user ? 'rejected' : 'canceled')
  return { done: by === t.to_user ? 'rejected' : 'canceled', trade: t }
}

// ── 화면 ──
const md = (text) => ({ type: 'mrkdwn', text })
const option = (emoji, n) => ({
  text: { type: 'plain_text', text: `:${emoji}: ${GRADE.get(emoji)}${n ? ` ×${n}` : ''}`, emoji: true },
  value: emoji,
})

const offerLine = (t) => `<@${t.from_user}> :${t.give}: *[${GRADE.get(t.give)}]*  ↔  :${t.want}: *[${GRADE.get(t.want)}]* <@${t.to_user}>`

const offerMessage = (t) => ({
  text: '🔁 교환 제안',
  blocks: [
    { type: 'section', text: md(`🔁 *교환 제안*\n${offerLine(t)}`) },
    {
      type: 'actions',
      elements: [
        { type: 'button', text: { type: 'plain_text', text: '수락' }, style: 'primary', action_id: 'trade_accept', value: String(t.id) },
        { type: 'button', text: { type: 'plain_text', text: '거절 / 취소' }, action_id: 'trade_reject', value: String(t.id) },
      ],
    },
    { type: 'context', elements: [md(`<@${t.to_user}> 님만 수락할 수 있어요 · 보낸 사람은 취소할 수 있어요`)] },
  ],
})

const RESULT = {
  done: '✅ *교환 완료!*',
  failed: '💨 *교환 실패* — 그 사이 몬스터가 없어졌어요',
  rejected: '🙅 *교환 거절*',
  canceled: '↩️ *교환 취소*',
}

// 받고 싶은 몬스터 칸은 친구를 고른 뒤에, 그 친구가 가진 것만 보여 줌
const wantBlock = (friend) => {
  if (!friend) return { type: 'context', elements: [md('친구를 고르면 그 친구가 가진 몬스터가 나와요')] }
  const theirs = collection(friend)
  if (!theirs.length) return { type: 'context', elements: [md(`<@${friend}> 님은 아직 잡은 몬스터가 없어요`)] }
  return {
    type: 'input', block_id: 'want', label: { type: 'plain_text', text: '받고 싶은 몬스터' },
    element: { type: 'static_select', action_id: 'v', options: theirs.map((c) => option(c.emoji, c.n)) },
  }
}

const tradeModal = (user, channel, friend) => ({
  type: 'modal',
  callback_id: 'trade_submit',
  private_metadata: channel,
  title: { type: 'plain_text', text: '🔁 몬스터 교환' },
  submit: { type: 'plain_text', text: '제안 보내기' },
  close: { type: 'plain_text', text: '닫기' },
  blocks: [
    {
      type: 'input', block_id: 'give', label: { type: 'plain_text', text: '내가 줄 몬스터' },
      element: { type: 'static_select', action_id: 'v', options: collection(user).map((c) => option(c.emoji, c.n)) },
    },
    {
      type: 'input', block_id: 'to', label: { type: 'plain_text', text: '교환할 친구' },
      dispatch_action: true, // 친구를 고르는 순간 아래 칸을 다시 그림
      element: { type: 'users_select', action_id: 'v' },
    },
    wantBlock(friend),
    { type: 'context', elements: [md('제안은 게임 채널에 올라가고, 친구가 수락하면 바로 맞바꿔요')] },
  ],
})

// 앱 홈: 내 도감 (못 잡은 칸은 ❔, 중복은 ×n)
const homeView = (user) => {
  const mine = new Map(collection(user).map((c) => [c.emoji, c.n]))
  const row = (label) => MONSTERS.filter((m) => m.grade === label)
    .map((m) => (mine.has(m.emoji) ? `:${m.emoji}:${mine.get(m.emoji) > 1 ? `×${mine.get(m.emoji)}` : ''}` : '❔'))
    .join('  ')
  return {
    type: 'home',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `📕 내 도감 ${mine.size}/${MONSTERS.length}` } },
      { type: 'section', text: md(`*흔함*\n${row('흔함')}`) },
      { type: 'section', text: md(`*희귀*\n${row('희귀')}`) },
      { type: 'section', text: md(`*전설*\n${row('전설')}`) },
      { type: 'divider' },
      { type: 'context', elements: [md('중복으로 잡은 몬스터는 게임 채널 메뉴의 *🔁 교환* 으로 친구 몬스터와 바꿀 수 있어요')] },
    ],
  }
}

export function registerTrade(app) {
  const warn = (e) => console.error('슬랙 전송 실패:', e.data?.error ?? e.message)

  app.event('app_home_opened', async ({ event, client }) => {
    if (event.tab === 'home') await client.views.publish({ user_id: event.user, view: homeView(event.user) }).catch(warn)
  })

  app.action('trade_open', async ({ ack, body, client, respond }) => {
    await ack()
    if (!collection(body.user.id).length) {
      return respond({ response_type: 'ephemeral', replace_original: false, text: '아직 잡은 몬스터가 없어요. 야생 자동을 켜고 먼저 잡아 보세요!' })
    }
    await client.views.open({ trigger_id: body.trigger_id, view: tradeModal(body.user.id, body.channel?.id ?? setting('channel')) })
  })

  // 친구를 고르면 그 친구의 몬스터 목록으로 창을 다시 그림 (고른 값은 슬랙이 유지)
  app.action({ block_id: 'to', action_id: 'v' }, async ({ ack, body, action, client }) => {
    await ack()
    await client.views.update({
      view_id: body.view.id,
      hash: body.view.hash,
      view: tradeModal(body.user.id, body.view.private_metadata, action.selected_user),
    }).catch(warn)
  })

  app.view('trade_submit', async ({ ack, body, view, client }) => {
    const v = view.state.values
    if (!v.want) return ack({ response_action: 'errors', errors: { to: '몬스터를 가진 친구를 골라 주세요' } })
    const from = body.user.id
    const result = propose(from, v.to.v.selected_user, v.give.v.selected_option.value, v.want.v.selected_option.value)
    if (result.error) return ack({ response_action: 'errors', errors: { [result.field]: result.error } })
    await ack()
    await client.chat.postMessage({ channel: view.private_metadata, ...offerMessage(getTrade(result.id)) }).catch(warn)
  })

  for (const [id, run] of [['trade_accept', accept], ['trade_reject', reject]]) {
    app.action(id, async ({ ack, body, action, respond }) => {
      await ack()
      const result = run(Number(action.value), body.user.id)
      if (result.error) return respond({ response_type: 'ephemeral', replace_original: false, text: `⚠️ ${result.error}` })
      await respond({ replace_original: true, text: RESULT[result.done], blocks: [{ type: 'section', text: md(`${RESULT[result.done]}\n${offerLine(result.trade)}`) }] })
    })
  }
}
