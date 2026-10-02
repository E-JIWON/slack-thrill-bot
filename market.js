import { DatabaseSync } from 'node:sqlite'

const START_COINS = 1000
const DAY = 86_400_000

export const db = new DatabaseSync(process.env.DB ?? 'market.db')
db.exec(`
  create table if not exists uses (emoji text, ts integer);
  create index if not exists uses_emoji_ts on uses (emoji, ts);
  create table if not exists wallets (user text primary key, coins integer);
  create table if not exists holdings (user text, emoji text, qty integer, primary key (user, emoji));
`)

// `:+1::skin-tone-2:` → +1, 시각 `12:30:00`의 `:30:`은 버림
export function emojisIn(text = '') {
  return [...text.matchAll(/:([a-z0-9_+'-]+):/g)]
    .map((m) => m[1])
    .filter((e) => !e.startsWith('skin-tone-') && !/^\d+$/.test(e))
}

// uses 테이블은 지우지 않음. 워크스페이스가 커지면 2일 지난 건 일별 집계로 접기
export function record(emoji, ts = Date.now()) {
  db.prepare('insert into uses values (?, ?)').run(emoji.split('::')[0], ts)
}

const usesBetween = (emoji, from, to) =>
  db.prepare('select count(*) n from uses where emoji = ? and ts > ? and ts <= ?').get(emoji, from, to).n

// 시세 = 최근 24시간 사용 횟수
export function price(emoji, now = Date.now()) {
  return 10 + 5 * usesBetween(emoji, now - DAY, now)
}

const listed = (emoji) => !!db.prepare('select 1 from uses where emoji = ? limit 1').get(emoji)

export function coins(user) {
  db.prepare('insert or ignore into wallets values (?, ?)').run(user, START_COINS)
  return db.prepare('select coins from wallets where user = ?').get(user).coins
}

const held = (user, emoji) =>
  db.prepare('select qty from holdings where user = ? and emoji = ?').get(user, emoji)?.qty ?? 0

// 성공하면 { ok: true, text }, 실패하면 { ok: false, text }
export function buy(user, emoji, qty) {
  if (!listed(emoji)) return { ok: false, text: `:${emoji}: 는 아직 상장 전이에요. 누가 한 번이라도 써야 상장돼요` }
  const cost = price(emoji) * qty
  const have = coins(user)
  if (have < cost) return { ok: false, text: `코인이 모자라요 (필요 ${cost} · 보유 ${have})` }
  db.prepare('update wallets set coins = coins - ? where user = ?').run(cost, user)
  db.prepare(
    'insert into holdings values (?, ?, ?) on conflict (user, emoji) do update set qty = qty + excluded.qty',
  ).run(user, emoji, qty)
  return { ok: true, text: `<@${user}> 님이 :${emoji}: ${qty}주 매수! (주당 ${price(emoji)}코인)` }
}

export function sell(user, emoji, qty) {
  if (held(user, emoji) < qty) return { ok: false, text: `:${emoji}: 를 ${qty}주나 갖고 있지 않아요` }
  const gain = price(emoji) * qty
  coins(user)
  db.prepare('update wallets set coins = coins + ? where user = ?').run(gain, user)
  db.prepare('update holdings set qty = qty - ? where user = ? and emoji = ?').run(qty, user, emoji)
  db.prepare('delete from holdings where qty <= 0').run()
  return { ok: true, text: `<@${user}> 님이 :${emoji}: ${qty}주 매도! (+${gain}코인)` }
}

// 어제 같은 시각 대비 등락: ▲5 / ▼5 / –0
export function change(emoji, now = Date.now()) {
  const diff = price(emoji, now) - (10 + 5 * usesBetween(emoji, now - 2 * DAY, now - DAY))
  return `${diff > 0 ? '▲' : diff < 0 ? '▼' : '–'}${Math.abs(diff)}`
}


// 오늘 많이 쓰인 10종목
export const top = (now = Date.now()) =>
  db.prepare('select emoji from uses where ts > ? group by emoji order by count(*) desc limit 10')
    .all(now - DAY)
    .map(({ emoji }) => ({ emoji, price: price(emoji, now), change: change(emoji, now) }))

export const holdings = (user) =>
  db.prepare('select emoji, qty from holdings where user = ?').all(user)
    .map(({ emoji, qty }) => ({ emoji, qty, price: price(emoji) }))


export const worth = (user) =>
  coins(user) +
  db.prepare('select emoji, qty from holdings where user = ?').all(user)
    .reduce((sum, h) => sum + price(h.emoji) * h.qty, 0)


export const ranking = () =>
  db.prepare('select user from wallets').all()
    .map((r) => ({ user: r.user, worth: worth(r.user) }))
    .sort((a, b) => b.worth - a.worth)

