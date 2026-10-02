process.env.DB = ':memory:'
const { test } = await import('node:test')
const assert = await import('node:assert/strict')
const { buy, emojisIn, price, record, sell } = await import('./market.js')

test('본문에서 이모지만 골라낸다', () => {
  assert.deepEqual(emojisIn('좋아 :+1::skin-tone-2: 12:30:00 :party_parrot:'), ['+1', 'party_parrot'])
})

test('쓰일수록 비싸지고, 사고팔면 코인이 오간다', () => {
  assert.equal(buy('U1', 'tada', 1).ok, false) // 상장 전
  record('tada')
  record('tada::skin-tone-3')
  assert.equal(price('tada'), 20)
  assert.equal(buy('U1', 'tada', 10).ok, true) // 1000 → 800
  assert.equal(buy('U1', 'tada', 50).ok, false) // 1000코인 모자람
  record('tada')
  assert.equal(sell('U1', 'tada', 10).ok, true) // 25 × 10 = 250 → 1050
  assert.equal(sell('U1', 'tada', 1).ok, false)
})

test('초성 뽑기와 몬스터 뽑기', async () => {
  const { choseong, pickMonster, MONSTERS } = await import('./games.js')
  assert.equal(choseong('떡볶이'), 'ㄸㅂㅇ')
  assert.equal(choseong('짜장면!'), 'ㅉㅈㅁ!')
  assert.equal(pickMonster(0).grade, '흔함')
  assert.equal(pickMonster(0.9999).grade, '전설')
  assert.equal(pickMonster(0.9999), MONSTERS.at(-1))
})

test('도감은 많이 모은 사람부터, 같은 종은 한 번만', async () => {
  const { dexText } = await import('./games.js')
  const { db } = await import('./market.js')
  for (const [u, e] of [['U1', 'dog'], ['U1', 'ghost'], ['U2', 'cat'], ['U1', 'dog']]) db.prepare('insert into dex values (?, ?, 0)').run(u, e)
  const lines = dexText().split('\n')
  assert.match(lines[1], /<@U1>  \*2\/31\*  :dog: :ghost:/)
  assert.match(lines[2], /<@U2>  \*1\/31\*  :cat:/)
})
