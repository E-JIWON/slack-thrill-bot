import { db } from './market.js'

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR

db.exec(`
  create table if not exists settings (key text primary key, value text);
  create table if not exists dex (user text, emoji text, ts integer);
  create table if not exists quiz_wins (user text, ts integer);
  create table if not exists deaths (user text, ts integer);
`)

const setting = (key) => db.prepare('select value from settings where key = ?').get(key)?.value
const setSetting = (key, value) =>
  db.prepare('insert into settings values (?, ?) on conflict (key) do update set value = excluded.value').run(key, value)

const pick = (list) => list[Math.floor(Math.random() * list.length)]

// ── 초성 퀴즈 ──
const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
export const choseong = (word) =>
  [...word].map((ch) => {
    const code = ch.charCodeAt(0) - 0xac00
    return code >= 0 && code < 11172 ? INITIALS[Math.floor(code / 588)] : ch
  }).join('')

export const WORDS = [
  '떡볶이', '김치찌개', '비빔밥', '삼겹살', '짜장면', '짬뽕', '아이스크림', '마라탕', '돈까스', '냉면',
  '붕어빵', '호떡', '김밥', '라면', '탕후루', '소금빵', '제육볶음', '순대국', '칼국수', '부대찌개',
  '감자탕', '닭갈비', '초밥', '햄버거', '떡국', '잡채', '족발', '보쌈', '곱창', '샌드위치',
  '도넛', '마카롱', '팥빙수', '고구마', '쌀국수', '오므라이스', '카레', '우동', '닭강정', '군만두',
]

// ── 야생 출몰 ──
const grade = (names, label, weight) => names.map((emoji) => ({ emoji, grade: label, weight }))
export const MONSTERS = [
  ...grade(['dog', 'cat', 'rabbit', 'frog', 'chicken', 'penguin', 'hamster', 'fox_face', 'bear',
    'koala', 'pig', 'cow', 'monkey_face', 'mouse', 'turtle', 'snail', 'bee', 'duck'], '흔함', 10),
  ...grade(['unicorn_face', 'dragon', 't-rex', 'sauropod', 'octopus', 'flamingo', 'peacock', 'owl', 'sloth', 'otter'], '희귀', 3),
  ...grade(['dragon_face', 'alien', 'ghost'], '전설', 1),
]

export function pickMonster(rand = Math.random()) {
  let roll = rand * MONSTERS.reduce((sum, m) => sum + m.weight, 0)
  return MONSTERS.find((m) => (roll -= m.weight) < 0) ?? MONSTERS[0]
}

// ── 순위 · 배지 ──
function weekStart() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

const weeklyWins = (user) =>
  db.prepare('select count(*) n from quiz_wins where user = ? and ts > ?').get(user, weekStart()).n
const dexCount = (user) => db.prepare('select count(distinct emoji) n from dex where user = ?').get(user).n

const top5 = (sql, ...args) => db.prepare(sql).all(...args)
const MEDAL = ['🥇', '🥈', '🥉', '4.', '5.']
const board = (rows, unit) => rows.map((r, i) => `${MEDAL[i]} <@${r.user}> ${r.n}${unit}`).join('\n') || '아직 없어요'

function rankingText() {
  return [
    '*📕 도감왕*', board(top5('select user, count(distinct emoji) n from dex group by user order by n desc limit 5'), '종'),
    '', '*👑 이번 주 퀴즈왕*', board(top5('select user, count(*) n from quiz_wins where ts > ? group by user order by n desc limit 5', weekStart()), '점'),
    '', '*💀 폭사왕*', board(top5('select user, count(*) n from deaths group by user order by n desc limit 5'), '번'),
  ].join('\n')
}

// 모든 플레이어의 도감: 많이 모은 순
export function dexText() {
  const rows = db.prepare('select user, emoji from dex group by user, emoji').all()
  const byUser = Map.groupBy(rows, (r) => r.user)
  if (!byUser.size) return '*📕 도감*\n아직 아무도 못 잡았어요. 채팅하다 보면 야생이 나타나요!'
  const order = new Map(MONSTERS.map((m, i) => [m.emoji, i]))
  const lines = [...byUser]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([user, caught], i) => {
      const icons = caught.map((r) => r.emoji).sort((a, b) => order.get(a) - order.get(b)).map((e) => `:${e}:`).join(' ')
      return `${MEDAL[i] ?? `${i + 1}.`} <@${user}>  *${caught.length}/${MONSTERS.length}*  ${icons}`
    })
  return [`*📕 도감* (전체 ${MONSTERS.length}종)`, ...lines].join('\n')
}

// ── 메뉴 ──
const button = (text, action_id, style, value) => ({
  type: 'button', text: { type: 'plain_text', text }, action_id, ...(style && { style }), ...(value && { value }),
})
const AUTO_GAP = 20 * SEC // 자동 모드: 한 판 끝나고 다음 판까지
const AUTO_GAMES = [['bomb', '💣 폭탄'], ['quiz', '🔤 퀴즈'], ['spawn', '👾 야생']]
const autoOn = (key) => setting(`auto_${key}`) === 'on'

const autoButton = (key) => button(autoOn(key) ? '🎲 자동 켜짐' : '자동 꺼짐', 'auto_toggle', autoOn(key) ? 'primary' : undefined, key)
const gameRow = (text, ...elements) => [
  { type: 'section', text: { type: 'mrkdwn', text } },
  { type: 'actions', elements },
]

// 게임마다 [지금 하기] [자동 켜짐/꺼짐]을 나란히
const menu = () => ({
  text: '🕹️ 쾌락실',
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: '🕹️ 쾌락실 개장! 이 채널에서 놀아요' } },
    ...gameRow('💣 *폭탄 돌리기*  받으면 다른 사람을 @멘션해서 넘기세요. 터지면 폭사 기록 +1 💀',
      button('💣 지금 던지기', 'game_bomb', 'danger'), autoButton('bomb')),
    ...gameRow('🔤 *초성 퀴즈*  채팅으로 정답을 치면 1점, 주간 1등은 퀴즈왕 👑',
      button('🔤 지금 내기', 'game_quiz', 'primary'), autoButton('quiz')),
    ...gameRow('👾 *야생 출몰*  자동을 켜면 몬스터가 나타나요. 리액션을 제일 먼저 누르면 포획!',
      autoButton('spawn')),
    { type: 'divider' },
    { type: 'actions', elements: [button('📕 도감', 'game_dex'), button('🏆 랭킹', 'game_rank')] },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `🎲 자동이 켜진 게임은 한 판 끝나면 ${AUTO_GAP / SEC}초 뒤에 다음 판이 시작돼요` }] },
  ],
})

export async function registerGames(app) {
  const me = (await app.client.auth.test()).user_id
  const channel = () => setting('channel')
  // 봇이 채널에 없으면(not_in_channel) 실패함 → 로그만 남기고 봇은 계속 돌게
  const warn = (e) => console.error('슬랙 전송 실패:', e.data?.error ?? e.message)
  const post = (text) => app.client.chat.postMessage({ channel: channel(), text }).catch(warn)
  const update = (ts, text) => app.client.chat.update({ channel: channel(), ts, text }).catch(warn)
  const NOT_POSTED = '⚠️ 채널에 글을 못 올렸어요. 봇이 이 채널에 초대돼 있는지 확인해 주세요'
  const seen = new Map() // 게임 채널에서 최근 말한 사람 → 시각
  const ended = { bomb: 0, quiz: 0, spawn: 0 } // 게임별 마지막으로 끝난(또는 시작한) 시각

  // ── 💣 ── 진행 중인 게임 상태는 메모리에만 있음: 봇을 껐다 켜면 돌던 폭탄·퀴즈·몬스터는 사라짐
  let bomb = null
  const arm = (ms) => {
    clearTimeout(bomb.timer)
    bomb.deadline = Date.now() + ms
    bomb.timer = setTimeout(explode, ms)
  }
  async function startBomb(starter) {
    if (bomb) return '이미 폭탄이 돌고 있어요!'
    const recent = [...seen].filter(([, t]) => Date.now() - t < HOUR).map(([u]) => u)
    const holder = recent.length ? pick(recent) : starter
    if (!holder) return
    bomb = { holder, passes: 0 }
    arm((60 + Math.random() * 240) * SEC) // 1~5분
    if (!(await post(`💣 폭탄이 <@${bomb.holder}> 님 손에 떨어졌어요! 다른 사람을 @멘션하면 넘어가요. 언제 터질지는 아무도 몰라요… 째깍째깍`))) {
      clearTimeout(bomb.timer)
      bomb = null
      return NOT_POSTED
    }
  }
  function passBomb(target) {
    const from = bomb.holder
    bomb.holder = target
    bomb.passes++
    arm(Math.max(5 * SEC, (bomb.deadline - Date.now()) * 0.8)) // 비밀: 넘길수록 도화선이 짧아짐
    post(`💣 <@${from}> → <@${target}>  째깍${'째깍'.repeat(Math.min(bomb.passes, 6))}`)
  }
  function explode() {
    const { holder, passes } = bomb
    bomb = null
    ended.bomb = Date.now()
    db.prepare('insert into deaths values (?, ?)').run(holder, Date.now())
    post(`💥 펑!!! <@${holder}> 님이 폭사했어요 (${passes}번 오갔어요) 💀`)
  }

  // ── 👾 ──
  let wild = null
  let lastSpawn = 0
  async function spawn() {
    if (wild) return '이미 야생 몬스터가 나와 있어요! 얼른 잡으세요'
    const m = (wild = { ...pickMonster() })
    lastSpawn = Date.now()
    const res = await post(`🌿 야생의 :${m.emoji}: 이(가) 나타났다!  *[${m.grade}]*  리액션을 제일 먼저 누르면 포획!`)
    if (!res) return void (wild = null)
    m.ts = res.ts
    await app.client.reactions.add({ channel: channel(), timestamp: m.ts, name: m.emoji }).catch(warn)
    m.timer = setTimeout(() => {
      if (wild !== m) return
      wild = null
      ended.spawn = Date.now()
      update(m.ts, `💨 야생의 :${m.emoji}: 이(가) 도망쳤다…`)
    }, MIN)
  }

  app.event('reaction_added', async ({ event }) => {
    const m = wild
    if (!m || event.user === me || event.item.ts !== m.ts) return
    wild = null
    ended.spawn = Date.now()
    clearTimeout(m.timer)
    db.prepare('insert into dex values (?, ?, ?)').run(event.user, m.emoji, Date.now())
    await update(m.ts, `🎉 <@${event.user}> 님이 :${m.emoji}: *[${m.grade}]* 포획!  (도감 ${dexCount(event.user)}/${MONSTERS.length})`)
  })

  // ── 🔤 ──
  let quiz = null
  async function startQuiz() {
    if (quiz) return '이미 퀴즈가 진행 중이에요!'
    const q = (quiz = { answer: pick(WORDS) })
    // 글이 안 올라가면 퀴즈도 없던 일로 (안 그러면 3분 동안 "진행 중"에 갇힘)
    if (!(await post(`🔤 *초성 퀴즈!*   \`${choseong(q.answer)}\`   3분 안에 채팅으로 정답을 쳐 주세요 (점심 메뉴)`))) {
      quiz = null
      return NOT_POSTED
    }
    q.timer = setTimeout(() => {
      if (quiz !== q) return
      quiz = null
      ended.quiz = Date.now()
      post(`⏰ 시간 끝! 정답은 *${q.answer}* 였어요`)
    }, 3 * MIN)
  }
  function solveQuiz(user) {
    const q = quiz
    quiz = null
    ended.quiz = Date.now()
    clearTimeout(q.timer)
    db.prepare('insert into quiz_wins values (?, ?)').run(user, Date.now())
    post(`🎯 정답! <@${user}> 님 *${q.answer}*  (+1점 · 이번 주 ${weeklyWins(user)}점)`)
  }

  // 매일 12시 퀴즈
  setInterval(() => {
    const now = new Date()
    const today = now.toDateString()
    if (!channel() || now.getHours() !== 12 || setting('lastQuiz') === today) return
    setSetting('lastQuiz', today)
    startQuiz()
  }, 30 * SEC)

  // ── 🎲 게임별 자동 모드: 켜 둔 게임은 끝나고 AUTO_GAP 뒤에 다음 판 ──
  const auto = { bomb: () => startBomb(), quiz: startQuiz, spawn }
  const busy = { bomb: () => bomb, quiz: () => quiz, spawn: () => wild }
  setInterval(() => {
    if (!channel()) return
    for (const [key, start] of Object.entries(auto)) {
      if (!autoOn(key) || busy[key]() || Date.now() - ended[key] < AUTO_GAP) continue
      ended[key] = Date.now() // 시작이 실패해도(채팅한 사람 없음 등) AUTO_GAP 뒤에 다시 시도
      Promise.resolve(start()).catch((e) => console.error('자동 게임 실패', e))
    }
  }, 5 * SEC)

  // ── 채팅 ──
  app.message(async ({ message }) => {
    if (message.subtype || message.bot_id) return
    const { user, text = '', ts } = message
    if (message.channel !== channel()) return
    seen.set(user, Date.now())

    const target = text.match(/<@([UW][A-Z0-9]+)/)?.[1]
    if (bomb && user === bomb.holder && target && target !== user && target !== me) passBomb(target)
    if (quiz && text.replace(/\s/g, '') === quiz.answer) solveQuiz(user)
    // 야생 자동이 켜져 있을 때만: 10분에 한 번까지, 채팅 8번에 한 번꼴로 덤으로 출몰
    if (autoOn('spawn') && !wild && Date.now() - lastSpawn > 10 * MIN && Math.random() < 1 / 8) spawn()
  })

  // ── 메뉴 ──
  app.command('/game', async ({ command, ack, respond }) => {
    await ack()
    setSetting('channel', command.channel_id)
    // 봇이 직접 올려 봐서 실패하면 아직 채널에 없는 것
    const posted = await app.client.chat.postMessage({ channel: command.channel_id, ...menu() }).catch(() => null)
    if (!posted) await respond({ response_type: 'ephemeral', text: '⚠️ 봇이 아직 이 채널에 없어요. `/invite @봇이름`으로 먼저 부르고 `/game`을 다시 쳐 주세요' })
  })

  const whisper = (respond, text) => text && respond({ response_type: 'ephemeral', replace_original: false, text })
  const actions = {
    game_bomb: ({ body }) => startBomb(body.user.id),
    game_quiz: () => startQuiz(),
    game_dex: () => dexText(),
    game_rank: () => rankingText(),
  }
  app.action('auto_toggle', async ({ ack, action, respond }) => {
    await ack()
    const on = !autoOn(action.value)
    setSetting(`auto_${action.value}`, on ? 'on' : 'off')
    await respond({ replace_original: true, ...menu() })
    const label = AUTO_GAMES.find(([key]) => key === action.value)[1]
    post(on ? `🎲 ${label} 자동 켜짐! 끝나면 ${AUTO_GAP / SEC}초 뒤에 다음 판` : `⏸ ${label} 자동 꺼짐`)
  })

  for (const [id, run] of Object.entries(actions)) {
    app.action(id, async (args) => {
      await args.ack()
      await whisper(args.respond, await run(args))
    })
  }
}
