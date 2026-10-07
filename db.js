import { DatabaseSync } from 'node:sqlite'

// 워크스페이스마다 DB= 로 저장 파일을 따로 씀
export const db = new DatabaseSync(process.env.DB ?? 'market.db')
