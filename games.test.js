process.env.DB = ':memory:'
const { test } = await import('node:test')
const assert = await import('node:assert/strict')
const { db } = await import('./db.js')
const { choseong, pickMonster, MONSTERS, dexText } = await import('./games.js')
const { propose, accept, reject, collection } = await import('./trade.js')

const catchAs = (user, emoji) => db.prepare('insert into dex values (?, ?, 0)').run(user, emoji)

test('초성 뽑기와 몬스터 뽑기', () => {
  assert.equal(choseong('떡볶이'), 'ㄸㅂㅇ')
  assert.equal(choseong('짜장면!'), 'ㅉㅈㅁ!')
  assert.equal(pickMonster(0).grade, '흔함')
  assert.equal(pickMonster(0.9999).grade, '전설')
  assert.equal(pickMonster(0.9999), MONSTERS.at(-1))
})

test('도감은 많이 모은 사람부터, 같은 종은 한 번만', () => {
  for (const [u, e] of [['U1', 'dog'], ['U1', 'ghost'], ['U2', 'cat'], ['U1', 'dog']]) catchAs(u, e)
  const lines = dexText().split('\n')
  assert.match(lines[1], /<@U1>  \*2\/31\*  :dog: :ghost:/)
  assert.match(lines[2], /<@U2>  \*1\/31\*  :cat:/)
})

test('교환: 수락하면 한 마리씩 맞바꾸고, 당사자만 누를 수 있다', () => {
  // U1: dog ×2, ghost / U2: cat
  assert.equal(propose('U1', 'U1', 'dog', 'cat').field, 'to')
  assert.equal(propose('U1', 'U2', 'owl', 'cat').field, 'give')
  assert.equal(propose('U1', 'U2', 'dog', 'owl').field, 'want')

  const { id } = propose('U1', 'U2', 'dog', 'cat')
  assert.match(accept(id, 'U1').error, /U2/) // 보낸 사람은 수락 못 함
  assert.equal(accept(id, 'U2').done, 'done')
  assert.deepEqual(collection('U1'), [{ emoji: 'dog', n: 1 }, { emoji: 'cat', n: 1 }, { emoji: 'ghost', n: 1 }])
  assert.deepEqual(collection('U2'), [{ emoji: 'dog', n: 1 }])
  assert.ok(accept(id, 'U2').error) // 두 번 수락 안 됨
})

test('교환: 그 사이 몬스터를 넘겨 버렸으면 실패, 거절과 취소', () => {
  const a = propose('U1', 'U2', 'ghost', 'dog')
  const b = propose('U1', 'U2', 'ghost', 'dog')
  assert.equal(accept(a.id, 'U2').done, 'done') // ghost가 U2에게 감
  assert.equal(accept(b.id, 'U2').done, 'failed') // U1에게 ghost가 없음

  const c = propose('U2', 'U1', 'ghost', 'cat')
  assert.ok(reject(c.id, 'U3').error)
  assert.equal(reject(c.id, 'U2').done, 'canceled')
  const d = propose('U2', 'U1', 'ghost', 'cat')
  assert.equal(reject(d.id, 'U1').done, 'rejected')
})
